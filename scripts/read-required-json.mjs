// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read a required repository JSON file without bypassing the caller's
 * aggregated guardrail report with a raw ENOENT/SyntaxError stack trace.
 *
 * @param {string} root
 * @param {string} relativePath
 * @param {string[]} failures
 * @returns {Record<string, unknown>}
 */
export function readRequiredJson(root, relativePath, failures) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      failures.push(`${relativePath} must contain a JSON object`);
      return {};
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      failures.push(`${relativePath} is required but missing`);
    } else if (error instanceof SyntaxError) {
      failures.push(`${relativePath} must contain valid JSON: ${error.message}`);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${relativePath} could not be read: ${detail}`);
    }
    return {};
  }
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
