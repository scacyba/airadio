# Google Play preview video assets for AI Radio

This folder contains a localized Japanese Google Play preview package for **AI Radio**.

## Files

- `preview_video.svg` — 1920×1080 animated SVG storyboard intended to be exported/recorded as a 30-second YouTube preview video.
- `feature_graphic.svg` — 1024×500 feature graphic source to export as a 24-bit PNG/JPEG cover asset.

## Google Play compliance notes checked on 2026-06-02

Official source: <https://support.google.com/googleplay/android-developer/answer/1078870?hl=en>

- Google Play accepts **one preview video URL** in Play Console, and it must be a **video's YouTube URL**, not a playlist or channel URL.
- Do **not** add extra URL parameters such as timecodes.
- The video must be **public or unlisted**, **not private**, **not age-restricted**, **embeddable**, and **ads must be disabled**.
- A preview video can appear before screenshots and may autoplay muted for up to the first 30 seconds; this asset is therefore designed as a concise 30-second loop.
- The video should show the actual app experience early, with at least 80% representative app UI, and use copy that remains understandable when muted.
- Landscape and portrait are supported; this asset uses landscape 16:9 without side black bars.
- The feature graphic requirement is 1024×500 JPEG or 24-bit PNG with no alpha; export `feature_graphic.svg` to PNG/JPEG before uploading.

## Creative choices

- Uses the current app UI structure from the provided screenshot: app title, era chips, playback card, Now Playing card, Interlude News TTS card, and STOP / NEWS NEXT controls.
- Removes phone status bar details, service provider indicators, third-party logos, and specific copyrighted music metadata from the user-provided capture.
- Avoids Google Play ranking, awards, pricing, and call-to-action phrases such as “install now” or “download now.”
- Includes large Japanese captions so the preview works when muted.

## Export checklist

1. Open `preview_video.svg` in a browser at 1920×1080.
2. Record exactly 30 seconds or export with a motion/SVG-capable video tool.
3. Upload the rendered video to YouTube as public or unlisted.
4. Turn off monetization/ads, avoid copyrighted audio claims, enable embedding, and verify it is not age-restricted.
5. Paste the clean full YouTube watch URL in Play Console, for example `https://www.youtube.com/watch?v=VIDEO_ID`.
6. Export `feature_graphic.svg` as `feature_graphic.png` or `.jpg` at 1024×500 with no alpha and upload it as the cover graphic.
