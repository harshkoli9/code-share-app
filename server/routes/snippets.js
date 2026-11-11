import { Router } from "express";
import { z } from "zod";
import Snippet from "../models/Snippet.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const inputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  code: z.string().min(1).max(1000000),
  language: z.enum(["javascript", "python", "html", "css", "markdown", "text"]).default("javascript"),
});
const serialize = (snippet) => ({
  id: snippet._id?.toString() || snippet.id,
  title: snippet.title,
  code: snippet.code,
  language: snippet.language,
  author: snippet.authorName,
  ownerId: snippet.owner?.toString() || null,
  createdAt: snippet.createdAt,
  updatedAt: snippet.updatedAt,
});

router.get("/", requireAuth, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const search = String(req.query.search || "").trim().slice(0, 100);
  const language = String(req.query.language || "");
  const query = {
    ...(language && inputSchema.shape.language.safeParse(language).success ? { language } : {}),
    ...(search ? { $or: [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { code: { $regex: escapeRegex(search), $options: "i" } },
        { authorName: { $regex: escapeRegex(search), $options: "i" } },
      ] } : {}),
  };
  const [items, total] = await Promise.all([
    Snippet.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Snippet.countDocuments(query),
  ]);
  res.json({ snippets: items.map(serialize), page, pages: Math.ceil(total / limit), total });
}));

router.get("/:id", requireAuth, asyncRoute(async (req, res) => {
  const snippet = await Snippet.findById(req.params.id).lean();
  if (!snippet) return res.status(404).json({ message: "Snippet not found." });
  res.json({ snippet: serialize(snippet) });
}));

router.post("/", requireAuth, asyncRoute(async (req, res) => {
  const input = inputSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Add a title and code. Snippets can contain at most 1,000,000 characters." });
  const snippet = await Snippet.create({ ...input.data, owner: req.user.id, authorName: req.user.name });
  res.status(201).json({ snippet: serialize(snippet) });
}));

router.put("/:id", requireAuth, asyncRoute(async (req, res) => {
  const input = inputSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: "Add a title and code." });
  const snippet = await Snippet.findOneAndUpdate(
    { _id: req.params.id, owner: req.user.id },
    { ...input.data, authorName: req.user.name },
    { new: true, runValidators: true },
  );
  if (!snippet) return res.status(404).json({ message: "Snippet not found or you do not own it." });
  res.json({ snippet: serialize(snippet) });
}));

router.delete("/:id", requireAuth, asyncRoute(async (req, res) => {
  const snippet = await Snippet.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  if (!snippet) return res.status(404).json({ message: "Snippet not found or you do not own it." });
  res.status(204).end();
}));

router.delete("/mine/all", requireAuth, asyncRoute(async (req, res) => {
  const result = await Snippet.deleteMany({ owner: req.user.id });
  res.json({ deleted: result.deletedCount });
}));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default router;
