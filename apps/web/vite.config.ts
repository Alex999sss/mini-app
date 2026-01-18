import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  resolve: {
    alias: {
      "@mini-app/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  optimizeDeps: {
    include: ["@mini-app/shared"]
  },
  build: {
    commonjsOptions: {
      include: [
        /node_modules/,
        path.resolve(__dirname, "../../packages/shared/dist")
      ]
    }
  }
});
