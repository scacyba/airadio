#!/usr/bin/env python3
"""Write a validated Firebase google-services.json from CI secrets.

The FIREBASE_GOOGLE_SERVICES_JSON secret is usually stored as the raw JSON file
contents, but CI UIs and copy/paste workflows can also leave it as a quoted or
escaped JSON string, shell assignment, URL-escaped text, or base64/base64url
text. This script accepts those common forms, validates that the result is a
JSON object, and only then writes the Gradle input file.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import codecs
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote


SECRET_ENV_NAME = "FIREBASE_GOOGLE_SERVICES_JSON"


def _add_candidate(candidates: list[str], value: str | None) -> None:
    if value is None:
        return

    stripped_value = value.strip().removeprefix("\ufeff").strip()
    if stripped_value and stripped_value not in candidates:
        candidates.append(stripped_value)


def _strip_wrapping_quotes(value: str) -> str | None:
    quote_pairs = (("'", "'"), ('"', '"'), ("`", "`"))
    for start_quote, end_quote in quote_pairs:
        if (
            value.startswith(start_quote)
            and value.endswith(end_quote)
            and len(value) >= 2
        ):
            return value[1:-1]
    return None


def _strip_shell_assignment(value: str) -> str | None:
    assignment_match = re.match(
        rf"^(?:export\s+)?{re.escape(SECRET_ENV_NAME)}\s*=\s*(.+)$",
        value,
        flags=re.DOTALL,
    )
    if assignment_match:
        return assignment_match.group(1)
    return None


def _extract_json_object_text(value: str) -> str | None:
    start_index = value.find("{")
    if start_index == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start_index, len(value)):
        character = value[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return value[start_index : index + 1]

    return None


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
    if "," in compact_value and compact_value.lower().startswith("data:"):
        compact_value = compact_value.split(",", 1)[1]

    compact_value = compact_value.removeprefix("base64:").removeprefix("BASE64:")
    compact_value += "=" * (-len(compact_value) % 4)

    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            decoded = decoder(compact_value)
        except (binascii.Error, ValueError):
            continue

        try:
            return decoded.decode("utf-8")
        except UnicodeDecodeError:
            continue

    return None


def _expanded_candidate_values(value: str) -> list[str]:
    candidates: list[str] = []
    _add_candidate(candidates, value)

    index = 0
    while index < len(candidates):
        candidate = candidates[index]
        _add_candidate(candidates, _strip_shell_assignment(candidate))
        _add_candidate(candidates, _strip_wrapping_quotes(candidate))
        _add_candidate(candidates, _extract_json_object_text(candidate))

        try:
            _add_candidate(candidates, codecs.decode(candidate, "unicode_escape"))
        except UnicodeDecodeError:
            pass

        decoded_url = unquote(candidate)
        if decoded_url != candidate:
            _add_candidate(candidates, decoded_url)

        _add_candidate(candidates, _decode_base64(candidate))
        index += 1

    return candidates


def _candidate_values(secret: str) -> list[str]:
    return _expanded_candidate_values(secret)


def load_google_services_json(secret: str) -> dict[str, Any]:
    for candidate in _candidate_values(secret):
        parsed = _parse_json_object(candidate)
        if parsed is not None:
            return parsed

    secret_fingerprint = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:8]
    raise ValueError(
        f"{SECRET_ENV_NAME} must contain google-services.json as raw JSON, "
        "a quoted/escaped JSON string, base64/base64url-encoded JSON, or "
        f"{SECRET_ENV_NAME}=<JSON>. "
        f"Received {len(secret)} characters; sha256 prefix {secret_fingerprint}."
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
