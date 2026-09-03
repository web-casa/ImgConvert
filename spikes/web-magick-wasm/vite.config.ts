import { defineConfig } from "vite";

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  server: {
    strictPort: true,
  },
  preview: {
    strictPort: true,
  },
});
