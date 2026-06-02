#!/usr/bin/env python3
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
SVG_NS = "{http://www.w3.org/2000/svg}"

checks = []

def check(condition: bool, message: str) -> None:
    checks.append((condition, message))

preview = ROOT / "preview_video.svg"
feature = ROOT / "feature_graphic.svg"
readme = ROOT / "README.md"

for file in (preview, feature, readme):
    check(file.exists(), f"{file.name} exists")

preview_root = ET.parse(preview).getroot()
feature_root = ET.parse(feature).getroot()

check(preview_root.get("width") == "1920", "preview video source width is 1920")
check(preview_root.get("height") == "1080", "preview video source height is 1080")
check(feature_root.get("width") == "1024", "feature graphic source width is 1024")
check(feature_root.get("height") == "500", "feature graphic source height is 500")

preview_text = preview.read_text(encoding="utf-8")
asset_text = preview_text + "\n" + feature.read_text(encoding="utf-8")

prohibited_terms = [
    "download now",
    "install now",
    "play now",
    "try now",
    "best",
    "#1",
    "free",
    "sale",
    "discount",
    "million downloads",
]
for term in prohibited_terms:
    haystack = asset_text.lower()
    if term == "#1":
        found = re.search(r"(?<![0-9a-f])#1(?![0-9a-f])", haystack) is not None
    else:
        found = term in haystack
    check(not found, f"no prohibited Play metadata phrase: {term}")

check("https://support.google.com/googleplay/android-developer/answer/1078870" in readme.read_text(encoding="utf-8"), "README links official Google Play asset guidance")
check("30s" in preview_text or "30-second" in readme.read_text(encoding="utf-8"), "30-second preview timing documented")

failed = [message for ok, message in checks if not ok]
for ok, message in checks:
    print(("PASS" if ok else "FAIL") + f": {message}")

if failed:
    raise SystemExit(f"Asset validation failed: {failed}")
