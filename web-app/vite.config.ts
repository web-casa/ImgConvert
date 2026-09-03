import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  base: "/convert/",
  plugins: [svelte()],
  preview: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
  },
  server: {
    host: "0.0.0.0",
    port: 4174,
    strictPort: true,
  },
});
