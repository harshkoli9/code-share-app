import mongoose from "mongoose";

const snippetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, maxlength: 1000000 },
    language: { type: String, enum: ["javascript", "python", "html", "css", "markdown", "text"], default: "javascript" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    authorName: { type: String, required: true, maxlength: 40 },
    legacyId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

snippetSchema.index({ createdAt: -1 });

export default mongoose.model("Snippet", snippetSchema);
