import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;
const disableUpdater = process.env.IMGCONVERT_DISABLE_UPDATER === "1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), svelte()],

  define: {
    "import.meta.env.VITE_IMGCONVERT_DISABLE_UPDATER": JSON.stringify(disableUpdater ? "1" : ""),
  },

  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Keep this sizeable, stable dependency independently cacheable.
              // Low-frequency dialogs are loaded dynamically from App.svelte.
              name: "icons",
              test: /node_modules[\\/]phosphor-svelte[\\/]/,
            },
          ],
        },
      },
    },
  },

  resolve: {
    alias: {
      $lib: resolve("./src/lib"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. ignore Rust/Tauri/Flatpak build outputs; they can contain large trees or symlink loops.
      ignored: ["**/src-tauri/**", "**/target/**", "**/.flatpak-builder/**"],
    },
  },
}));
