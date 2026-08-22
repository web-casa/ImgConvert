// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listingPath = path.join(repoRoot, "snap", "store-listing.json");
const listing = JSON.parse(readFileSync(listingPath, "utf8"));
const dryRun = process.argv.includes("--dry-run");

validateListing(listing);

if (dryRun) {
  console.log(JSON.stringify(listing, null, 2));
  process.exit(0);
}

const snapId = requireEnvironment("IMGCONVERT_SNAP_ID");
const credentials = decodeCredentials(requireEnvironment("SNAPCRAFT_STORE_CREDENTIALS"));
const endpoint = `https://dashboard.snapcraft.io/dev/api/snaps/${encodeURIComponent(snapId)}/metadata?conflict_on_update=false`;
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Accept: "application/json",
    Authorization: `Macaroon root=${credentials.root}, discharge=${credentials.discharge}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(listing),
});
const responseBody = await response.text();
if (!response.ok) {
  throw new Error(`Snap Store metadata update failed (${response.status}): ${responseBody}`);
}

const updated = JSON.parse(responseBody);
for (const field of Object.keys(listing)) {
  if (updated[field] !== listing[field]) {
    throw new Error(`Snap Store returned an unexpected ${field} value`);
  }
}
console.log(`Snap Store metadata updated for ${listing.title}.`);

function validateListing(candidate) {
  for (const field of ["title", "summary", "description", "license", "website", "contact"]) {
    if (typeof candidate[field] !== "string" || candidate[field].trim() === "") {
      throw new Error(`snap/store-listing.json has an invalid ${field}`);
    }
  }
  const wordCount = candidate.description.trim().split(/\s+/u).length;
  if (wordCount > 100) {
    throw new Error(`Snap Store description has ${wordCount} words; expected at most 100`);
  }
  for (const field of ["website", "contact"]) {
    const url = new URL(candidate[field]);
    if (url.protocol !== "https:") {
      throw new Error(`Snap Store ${field} must use HTTPS`);
    }
  }
}

function decodeCredentials(encoded) {
  let candidate;
  try {
    candidate = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
  } catch (error) {
    throw new Error("SNAPCRAFT_STORE_CREDENTIALS is not valid exported Snapcraft credentials", {
      cause: error,
    });
  }

  const value = candidate.t === "u1-macaroon" ? candidate.v : candidate;
  if (!value || typeof value.r !== "string" || typeof value.d !== "string") {
    throw new Error("SNAPCRAFT_STORE_CREDENTIALS is missing its macaroon or discharge");
  }
  return { root: value.r, discharge: value.d };
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
