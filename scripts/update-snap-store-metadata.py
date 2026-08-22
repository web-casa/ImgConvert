#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0

"""Update ImgConvert's public Snap Store listing metadata."""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parent.parent
LISTING_PATH = REPO_ROOT / "snap" / "store-listing.json"
LISTING_FIELDS = ("title", "summary", "description", "license", "website", "contact")


def main() -> None:
    """Validate listing data and optionally update the Snap Store."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    listing = json.loads(LISTING_PATH.read_text(encoding="utf-8"))
    validate_listing(listing)
    if args.dry_run:
        print(json.dumps(listing, ensure_ascii=False, indent=2))
        return

    snap_id = require_environment("IMGCONVERT_SNAP_ID")
    credentials = require_environment("SNAPCRAFT_STORE_CREDENTIALS")
    authorization = create_authorization_header(credentials)
    updated = update_store_metadata(snap_id, listing, authorization)
    for field, expected in listing.items():
        if updated.get(field) != expected:
            raise RuntimeError(f"Snap Store returned an unexpected {field} value")
    print(f"Snap Store metadata updated for {listing['title']}.")


def validate_listing(candidate: dict[str, Any]) -> None:
    """Validate fields shared by the package and public store listing."""
    for field in LISTING_FIELDS:
        value = candidate.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"snap/store-listing.json has an invalid {field}")

    word_count = len(candidate["description"].split())
    if word_count > 100:
        raise ValueError(
            f"Snap Store description has {word_count} words; expected at most 100"
        )
    for field in ("website", "contact"):
        if not candidate[field].startswith("https://"):
            raise ValueError(f"Snap Store {field} must use HTTPS")


def create_authorization_header(encoded: str) -> str:
    """Decode exported Snapcraft credentials and bind their discharge macaroon."""
    try:
        candidate = json.loads(base64.b64decode(encoded.strip(), validate=True))
    except (ValueError, json.JSONDecodeError) as error:
        raise ValueError(
            "SNAPCRAFT_STORE_CREDENTIALS is not valid exported Snapcraft credentials"
        ) from error

    value = candidate.get("v") if candidate.get("t") == "u1-macaroon" else candidate
    if not isinstance(value, dict):
        raise ValueError("SNAPCRAFT_STORE_CREDENTIALS has an invalid payload")
    root = value.get("r")
    discharge = value.get("d")
    if not isinstance(root, str) or not isinstance(discharge, str):
        raise ValueError(
            "SNAPCRAFT_STORE_CREDENTIALS is missing its macaroon or discharge"
        )

    from pymacaroons import Macaroon

    root_macaroon = Macaroon.deserialize(root)
    discharge_macaroon = Macaroon.deserialize(discharge)
    bound_discharge = root_macaroon.prepare_for_request(discharge_macaroon).serialize()
    authorization_scheme = "Macaroon"
    return f"{authorization_scheme} root={root}, discharge={bound_discharge}"


def update_store_metadata(
    snap_id: str, listing: dict[str, Any], authorization: str
) -> dict[str, Any]:
    """Send validated listing fields to the official Snap Store endpoint."""
    endpoint = (
        "https://dashboard.snapcraft.io/dev/api/snaps/"
        f"{quote(snap_id, safe='')}/metadata?conflict_on_update=false"
    )
    request = Request(
        endpoint,
        data=json.dumps(listing).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Authorization": authorization,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except HTTPError as error:
        response_body = error.read().decode(errors="replace")
        raise RuntimeError(
            f"Snap Store metadata update failed ({error.code}): {response_body}"
        ) from error


def require_environment(name: str) -> str:
    """Return a required environment variable without logging its value."""
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


if __name__ == "__main__":
    main()
