import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageRoot = __dirname;
const workspaceRoot = resolve(packageRoot, "../..");

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [workspaceRoot],
    },
    port: 5175,
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(packageRoot, "index.html"),
        reference: resolve(packageRoot, "reference/index.html"),
      },
    },
  },
});
