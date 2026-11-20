# Cinematic renderer

Renders view.html's cinematic offline, frame by frame, into a smooth 1080p60
MP4 so the event laptop only has to play a video. Player names are NOT in the
video — view.html draws them live on top.

## Render (on the fast PC)

From `BoardGame/`:

    node dev/tools/cinematic-render/render.js --board=2            # full render
    node dev/tools/cinematic-render/render.js --board=2 --preview=20  # first 20 s, quick look

Needs ffmpeg on PATH and Google Chrome installed. A Chrome window opens and is driven automatically —
leave it alone (or add `--headless`). A full render takes ~15 minutes. Output: `full/video/cinematic.mp4` + `full/video/cinematic-meta.json`.

`--board=1` renders the Legacy board instead. Only one video can be live at a
time; a tournament whose board doesn't match the video uses the live cinematic.

## Upload

Upload BOTH files to the web host as `full/video/cinematic.mp4` and
`full/video/cinematic-meta.json` (same folder level as `full/view.html`).
They are gitignored on purpose (too big for git).

## Is my uploaded video out of date?

    node dev/tools/cinematic-render/render.js --check

Exit 0 = up to date, 2 = stale (art, music, scene timings or cinematic code
changed since the render). Re-render and re-upload when stale.

## At the event

`view.html?tournamentId=...&cinematic=1` plays the video if it exists and
matches the tournament's board; otherwise the live cinematic runs exactly as
before. S or Esc skips.
