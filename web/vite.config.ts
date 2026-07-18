import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

let sha = "dev";
try { sha = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* non-git build */ }

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_SHA__: JSON.stringify(sha) },
  server: {
    port: 5180,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
