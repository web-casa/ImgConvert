// SPDX-License-Identifier: Apache-2.0
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default [
  {
    ignores: [
      ".svelte-kit/**",
      "**/.flatpak-builder/**",
      "**/dist/**",
      "node_modules/**",
      "fuzz/target/**",
      "fuzz/artifacts/**",
      "src-tauri/target/**",
      "target/**",
      "docs-site/**",
      "THIRD_PARTY_LICENSES.md",
    ],
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  ...svelte.configs["flat/recommended"],
  ...svelte.configs["flat/prettier"],
  {
    files: ["**/*.{js,ts,svelte}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
      parserOptions: {
        extraFileExtensions: [".svelte"],
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
  },
  {
    files: [
      "*.config.{js,ts}",
      ".pnpmfile.cjs",
      "eslint.config.js",
      "scripts/**/*.mjs",
      "tests/**/*.ts",
      "e2e/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
