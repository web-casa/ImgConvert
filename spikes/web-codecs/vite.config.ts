import { defineConfig } from "vite";

const codecPackages = ["@jsquash/avif", "@jsquash/jpeg", "@jsquash/png", "@jsquash/webp"];
const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const benchmarkHeaders =
  process.env.IMGCONVERT_CODEC_ISOLATION === "1" ? isolationHeaders : undefined;

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: codecPackages,
  },
  preview: {
    headers: benchmarkHeaders,
    strictPort: true,
  },
  server: {
    strictPort: true,
  },
  worker: {
    format: "es",
  },
});
