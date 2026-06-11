#!/usr/bin/env python3
"""Write a validated Firebase google-services.json from CI secrets.

The FIREBASE_GOOGLE_SERVICES_JSON secret is usually stored as the raw JSON file
contents, but CI UIs and copy/paste workflows can also leave it as an escaped
JSON string or base64-encoded text. This script accepts those common forms,
validates that the result is a JSON object, and only then writes the Gradle
input file.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import codecs
import json
import os
import sys
from pathlib import Path
from typing import Any


SECRET_ENV_NAME = "FIREBASE_GOOGLE_SERVICES_JSON"


def _parse_json_object(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None

    if isinstance(parsed, str):
        return _parse_json_object(parsed)

    if isinstance(parsed, dict):
        return parsed

    return None


def _decode_base64(value: str) -> str | None:
    compact_value = "".join(value.split())
    try:
        decoded = base64.b64decode(compact_value, validate=True)
    except (binascii.Error, ValueError):
        return None

    try:
        return decoded.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _candidate_values(secret: str) -> list[str]:
    stripped_secret = secret.strip()
    candidates = [stripped_secret]

    try:
        unescaped_secret = codecs.decode(stripped_secret, "unicode_escape")
    except UnicodeDecodeError:
        unescaped_secret = None

    if unescaped_secret and unescaped_secret not in candidates:
        candidates.append(unescaped_secret)

    base64_decoded_secret = _decode_base64(stripped_secret)
    if base64_decoded_secret and base64_decoded_secret not in candidates:
        candidates.append(base64_decoded_secret.strip())

    return candidates


def load_google_services_json(secret: str) -> dict[str, Any]:
    for candidate in _candidate_values(secret):
        parsed = _parse_json_object(candidate)
        if parsed is not None:
            return parsed

    raise ValueError(
        f"{SECRET_ENV_NAME} must contain google-services.json as raw JSON, "
        "an escaped JSON string, or base64-encoded JSON."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="app/google-services.json",
        help="Path to write the validated google-services.json file.",
    )
    args = parser.parse_args()

    secret = os.environ.get(SECRET_ENV_NAME, "")
    if not secret.strip():
        print(f"{SECRET_ENV_NAME} is empty; skipping Firebase config generation.")
        return 0

    try:
        google_services_json = load_google_services_json(secret)
    except ValueError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(google_services_json, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote validated Firebase config to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
