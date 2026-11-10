import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/code-share-app/" : "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:5051" } },
});
