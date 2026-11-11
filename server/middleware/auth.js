import jwt from "jsonwebtoken";
import User from "../models/User.js";

export function optionalAuth(req, _res, next) {
  resolveUser(req).then(() => next()).catch(next);
}

async function resolveUser(req) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token) {
    try {
      const { userId, authVersion = 0 } = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(userId).select("name email authVersion");
      if (user && (user.authVersion || 0) === authVersion) req.user = user;
    } catch {
      // An expired or invalid token simply represents a signed-out visitor.
    }
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Please sign in to continue." });
  next();
}
