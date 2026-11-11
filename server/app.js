import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import snippetRoutes from "./routes/snippets.js";
import { optionalAuth } from "./middleware/auth.js";

export function createApp({ serveClient = true, databaseReady = () => true } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  const allowedOrigins = (process.env.CLIENT_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: "5mb" }));
  app.get("/api/health", (_req, res) => {
    const ready = databaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "database_unavailable", database: ready });
  });
  app.use("/api", (req, res, next) => {
    if (databaseReady()) return next();
    res.status(503).json({ message: "Database is not configured or is unavailable. Set MONGODB_URI and start MongoDB." });
  });
  app.use("/api", optionalAuth);
  app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
  app.use("/api/auth/forgot-password", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }));
  app.use("/api/auth", authRoutes);
  app.use("/api/snippets", rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }), snippetRoutes);
  app.use("/api", (_req, res) => res.status(404).json({ message: "API endpoint not found." }));

  if (serveClient) {
    const root = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.static(path.resolve(root, "../dist")));
    app.get("*", (_req, res) => res.sendFile(path.resolve(root, "../dist/index.html")));
  }

  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.too.large") return res.status(413).json({ message: "Request is too large." });
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return res.status(400).json({ message: "Request body must be valid JSON." });
    }
    if (error?.code === 11000) return res.status(409).json({ message: "That email is already registered." });
    if (error?.name === "CastError") return res.status(400).json({ message: "Invalid record ID." });
    console.error(error);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  });
  return app;
}
