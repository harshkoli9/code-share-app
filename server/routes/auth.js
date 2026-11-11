import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const credentials = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
});
function issueSession(user) {
  return jwt.sign({ userId: user.id, authVersion: user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "8h" });
}

const resetRequest = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) });
const resetPassword = z.object({ token: z.string().min(32).max(256), password: z.string().min(10).max(72) });
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

async function sendResetEmail(email, resetUrl) {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error("Password reset email is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: "Reset your CodeShare password", html: `<p>Use this link within 15 minutes to reset your CodeShare password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>` }),
  });
  if (!response.ok) throw new Error("Password reset email delivery failed.");
}

router.post("/forgot-password", asyncRoute(async (req, res) => {
  const input = resetRequest.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Enter a valid email address." });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.FRONTEND_URL) {
    return res.status(503).json({ message: "Password reset email is not configured. Contact the site administrator." });
  }
  const user = await User.findOne({ email: input.data.email });
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.resetTokenHash = tokenHash;
    user.resetTokenExpiresAt = expiresAt;
    await user.save();
    const resetUrl = `${process.env.FRONTEND_URL.replace(/\/$/, "")}/#reset/${token}`;
    try { await sendResetEmail(user.email, resetUrl); }
    catch (error) {
      await User.updateOne({ _id: user._id, resetTokenHash: tokenHash }, { $unset: { resetTokenHash: 1, resetTokenExpiresAt: 1 } });
      throw error;
    }
  }
  res.json({ message: "If an account matches that email, a reset link will arrive shortly." });
}));

router.post("/reset-password", asyncRoute(async (req, res) => {
  const input = resetPassword.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Use a reset link and a password with at least 10 characters." });
  const updated = await User.findOneAndUpdate(
    { resetTokenHash: hashToken(input.data.token), resetTokenExpiresAt: { $gt: new Date() } },
    { $set: { passwordHash: await bcrypt.hash(input.data.password, 12) }, $unset: { resetTokenHash: 1, resetTokenExpiresAt: 1 }, $inc: { authVersion: 1 } },
    { new: true },
  );
  if (!updated) return res.status(400).json({ message: "This reset link is invalid or has expired. Request a new one." });
  res.json({ message: "Password updated. Sign in with your new password." });
}));

router.post("/register", asyncRoute(async (req, res) => {
  const input = credentials.extend({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Enter a name, valid email, and password (at least 10 characters)." });
  const { name, email, password } = input.data;
  if (await User.exists({ email })) return res.status(409).json({ message: "An account with that email already exists." });
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
  const token = issueSession(user);
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email }, token });
}));

router.post("/login", asyncRoute(async (req, res) => {
  const input = credentials.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Enter a valid email and password." });
  const user = await User.findOne({ email: input.data.email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.data.password, user.passwordHash))) {
    return res.status(401).json({ message: "Email or password is incorrect." });
  }
  const token = issueSession(user);
  res.json({ user: { id: user.id, name: user.name, email: user.email }, token });
}));

router.post("/logout", (_req, res) => res.status(204).end());

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
