import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        zh: resolve(import.meta.dirname, "index.html"),
        en: resolve(import.meta.dirname, "en/index.html"),
        privacyZh: resolve(import.meta.dirname, "privacy/index.html"),
        privacyEn: resolve(import.meta.dirname, "en/privacy/index.html"),
        legalZh: resolve(import.meta.dirname, "legal/index.html"),
        legalEn: resolve(import.meta.dirname, "en/legal/index.html"),
        resourceTemplate: resolve(import.meta.dirname, "resource-template/index.html"),
        windowsPngToAvifZh: resolve(import.meta.dirname, "windows/png-to-avif/index.html"),
        windowsPngToAvifEn: resolve(import.meta.dirname, "en/windows/png-to-avif/index.html"),
        windowsBatchImageCompressionZh: resolve(
          import.meta.dirname,
          "windows/batch-image-compression/index.html",
        ),
        windowsBatchImageCompressionEn: resolve(
          import.meta.dirname,
          "en/windows/batch-image-compression/index.html",
        ),
        macosHeicToJpgZh: resolve(import.meta.dirname, "macos/heic-to-jpg/index.html"),
        macosHeicToJpgEn: resolve(import.meta.dirname, "en/macos/heic-to-jpg/index.html"),
        macosPngToWebpZh: resolve(import.meta.dirname, "macos/png-to-webp/index.html"),
        macosPngToWebpEn: resolve(import.meta.dirname, "en/macos/png-to-webp/index.html"),
        ubuntuWebpLosslessZh: resolve(
          import.meta.dirname,
          "ubuntu/webp-lossless-compression/index.html",
        ),
        ubuntuWebpLosslessEn: resolve(
          import.meta.dirname,
          "en/ubuntu/webp-lossless-compression/index.html",
        ),
        linuxJpegToAvifZh: resolve(import.meta.dirname, "linux/jpeg-to-avif/index.html"),
        linuxJpegToAvifEn: resolve(import.meta.dirname, "en/linux/jpeg-to-avif/index.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
});
