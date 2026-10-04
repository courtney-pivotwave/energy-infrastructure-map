# Video walkthroughs

Scripted demos of the real map, recorded with headless Chrome and encoded with ffmpeg. Kept out of the site
build (and out of Vercel via `.vercelignore`) so the site itself stays dependency-free.

```
cd tools/video
npm install                      # playwright-core only; uses your installed Google Chrome
brew install ffmpeg              # once
node record.mjs what-if-hormuz   # builds the site, records, writes out/what-if-hormuz.mp4 + .srt
```

To put renders on the website: `node publish.mjs [id ...]` (default: the videos marked `site: true`) writes
1080p30 web versions, poster frames and `media/videos.json` (title, length, recording date, transcript from the
captions) to `media/` at the repo root. The About page and the map's Tour button render from `videos.json`, so
re-record, re-publish and commit `media/` to update the site. Each published video adds ~4–12 MB to the repo.

Flags: `--no-build` (reuse `dist/`), `--draft` (960×540 at 10 fps, to check a storyboard quickly), `--fps 60` (smoother; about twice the render time), `--4k` (3840×2160),
`--debug` (per-step timings). Other frame rates and 4K get their own filenames (`what-if-hormuz-60fps.mp4`).

- `record.mjs`: serves `dist/`, drives Chrome at 1440×810 CSS px (×4/3 → 1080p), captures CDP screencast
  frames with timestamps (so playback speed is right even if the machine is busy) and encodes H.264 at 30 fps.
- `overlay.js`: injected before the page loads. Exposes the Leaflet map as `window.__map` and draws captions,
  cursor, click ripples, highlight rings and title/end cards.
- `scenes/<name>.mjs`: one storyboard per video, exporting `setup(v)` (runs before recording) and `run(v)`.
  Read numbers from `v.data()` or the rendered panel rather than hard-coding them, so a re-record after a data
  update stays accurate, and escape anything from data before putting it in a caption. Use the API (`v.wait`,
  `v.flyBounds`, `v.scrollTo`…) rather than real-time sleeps or native smooth scrolling, which don't follow
  the virtual clock.

- `assets/`: pages that exist only for videos, served at `/_video/` (e.g. the mock host page for the embed video).
- `descriptions/`: YouTube description text, for anything viewers need to copy (like the embed code).

Recordings never count as visits: the analytics script is blocked.
