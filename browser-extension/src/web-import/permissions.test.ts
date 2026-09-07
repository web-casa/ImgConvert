// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { releaseOptionalHostPermission } from "./permissions";

describe("optional host permission helpers", () => {
  it("verifies that a newly granted pattern was actually removed", async () => {
    const api = {
      contains: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      remove: vi.fn(async () => true),
    };

    await expect(releaseOptionalHostPermission(api, "https://cdn.example.net/*")).resolves.toBe(
      true,
    );
    await expect(releaseOptionalHostPermission(api, "https://cdn.example.net/*")).resolves.toBe(
      false,
    );
  });

  it("fails closed when removal throws", async () => {
    const api = {
      contains: vi.fn(async () => true),
      remove: vi.fn(async () => {
        throw new Error("managed permission");
      }),
    };

    await expect(releaseOptionalHostPermission(api, "https://cdn.example.net/*")).resolves.toBe(
      false,
    );
  });
});
