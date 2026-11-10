import "dotenv/config";
import mongoose from "mongoose";
import Snippet from "../models/Snippet.js";

const databaseUrl = process.env.FIREBASE_DATABASE_URL;
const mongoUri = process.env.MONGODB_URI;
if (!databaseUrl || !mongoUri) {
  console.error("Set FIREBASE_DATABASE_URL and MONGODB_URI in .env before importing.");
  process.exit(1);
}

try {
  const url = new URL(`${databaseUrl.replace(/\/$/, "")}/snippets.json`);
  if (process.env.FIREBASE_AUTH_TOKEN) url.searchParams.set("auth", process.env.FIREBASE_AUTH_TOKEN);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Firebase export failed (${response.status}). Check database access and the optional auth token.`);
  const data = await response.json();
  await mongoose.connect(mongoUri);
  const entries = Object.entries(data || {});
  let imported = 0;
  let skipped = 0;
  for (const [legacyId, item] of entries) {
    if (!item || typeof item.title !== "string" || typeof item.code !== "string" || item.code.length > 1000000) {
      skipped += 1;
      continue;
    }
    const timestamp = Number(item.createdAt);
    const createdAt = Number.isFinite(timestamp) && Math.abs(timestamp) < 8.64e15 ? new Date(timestamp) : new Date();
    const result = await Snippet.updateOne(
      { legacyId },
      { $setOnInsert: {
        legacyId,
        title: item.title.trim().slice(0, 120) || "Untitled snippet",
        code: item.code,
        language: "javascript",
        authorName: String(item.user || "Legacy user").slice(0, 40),
        owner: null,
        createdAt,
      } },
      { upsert: true },
    );
    if (result.upsertedCount) imported += 1;
  }
  console.log(`Imported ${imported} Firebase snippets; skipped ${skipped} invalid or oversized records. Run again safely to skip already imported records.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
