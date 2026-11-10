import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./app.js";

const hasDatabaseConfig = Boolean(process.env.MONGODB_URI);
const hasAuthConfig = Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);
let connectionAttempt;

async function connectDatabase() {
  if (!hasDatabaseConfig || !hasAuthConfig || mongoose.connection.readyState === 1) return;
  if (!connectionAttempt) {
    connectionAttempt = mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      .catch((error) => console.error(`[startup] MongoDB connection failed: ${error.message}`))
      .finally(() => { connectionAttempt = undefined; });
  }
  await connectionAttempt;
}

if (!hasDatabaseConfig) console.warn("[startup] MONGODB_URI is missing. Copy .env.example to .env and configure MongoDB.");
if (!hasAuthConfig) console.warn("[startup] JWT_SECRET must be set to a random value of at least 32 characters.");
await connectDatabase();

if (hasDatabaseConfig && hasAuthConfig && mongoose.connection.readyState !== 1) {
  const retryTimer = setInterval(connectDatabase, 15000);
  retryTimer.unref();
}

const app = createApp({
  serveClient: process.env.SERVE_CLIENT !== "false",
  databaseReady: () => hasDatabaseConfig && hasAuthConfig && mongoose.connection.readyState === 1,
});

const port = Number(process.env.PORT) || 5051;
app.listen(port, () => console.log(`CodeShare API listening on http://localhost:${port}`));
