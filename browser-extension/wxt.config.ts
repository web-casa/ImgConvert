// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "wxt";

import packageJson from "./package.json";

const runtimeDiagnosticsEnabled = process.env.IMGCONVERT_RUNTIME_DIAGNOSTICS === "1";

export default defineConfig({
  modules: ["@wxt-dev/module-svelte"],
  outDirTemplate: runtimeDiagnosticsEnabled
    ? "{{browser}}-mv{{manifestVersion}}-diagnostics"
    : "{{browser}}-mv{{manifestVersion}}{{modeSuffix}}",
  vite: () => ({
    build: {
      cssTarget: "chrome116",
      target: "chrome116",
    },
    define: {
      __IMGCONVERT_RUNTIME_DIAGNOSTICS__: JSON.stringify(runtimeDiagnosticsEnabled),
    },
  }),
  manifest: {
    action: {
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
      default_title: "__MSG_actionTitle__",
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    default_locale: "en",
    description: "__MSG_extensionDescription__",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    homepage_url: "https://imgconvert.web.casa/",
    minimum_chrome_version: "116",
    name: "__MSG_extensionName__",
    optional_host_permissions: ["https://*/*"],
    permissions: ["storage", "contextMenus", "sidePanel"],
    side_panel: {
      default_path: "converter.html?surface=side-panel",
    },
    version: packageJson.version,
  },
  zip: {
    artifactTemplate: "imgconvert-{{browser}}-{{manifestVersion}}-{{versionName}}.zip",
    sourcesTemplate: "imgconvert-{{versionName}}-sources.zip",
  },
});
