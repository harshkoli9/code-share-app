import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const credentials = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
});
function issueSession(user) {
  return jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
}

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
