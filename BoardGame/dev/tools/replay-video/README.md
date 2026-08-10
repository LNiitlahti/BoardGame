# Replay Video Renderer

Renders a completed tournament's replay into a clean mp4: simplified hex
board (black background, white/gray hexes, flat team colors), a tidy score
bar, and a fading toast whenever a team casts a spell. Runs entirely on your
own machine — it never talks to Firestore.

## 1. Export the bundle

Open `replay.html?tournamentId=<id>` for the finished tournament, wait for it
to load, then click **Export Video Data**. This downloads a
`tournament-video-<id>-<timestamp>.json` file containing everything the
renderer needs (tournament doc, backups, action log).

## 2. Install dependencies

Requires Python 3.9+ and [ffmpeg](https://ffmpeg.org/download.html) on your
PATH (`winget install ffmpeg` / `brew install ffmpeg` / `apt install ffmpeg`).

```bash
cd BoardGame/dev/tools/replay-video
pip install -r requirements.txt
```

## 3. Render

```bash
python render_replay.py path/to/tournament-video-xxx.json output.mp4
```

## Configuration

Edit `config.json` for repeated tweaks, or override individual values per run:

```bash
python render_replay.py bundle.json output.mp4 \
  --fps 30 \
  --resolution 1920x1080 \
  --seconds-per-action 0.75 \
  --recency-count 10 \
  --recency-brightness-max 0.5 \
  --recency-brightness-min 0.1 \
  --toast-duration 2.0
```

| Setting | Meaning |
|---|---|
| `fps` / `width` / `height` | Output video frame rate and resolution |
| `seconds_per_action` | How long each replay action stays on screen |
| `recency_tile_count` | How many of the most-recently-changed tiles get a brightness glow |
| `recency_brightness_max` / `recency_brightness_min` | Brightness boost for the most-recent vs. the oldest tile still in the recency window |
| `spell_toast_duration_seconds` | How long a spell-cast toast stays visible (fade in/out included) |

## Running the tests

```bash
pip install -r requirements-dev.txt
pytest
```

## Troubleshooting

- **"ffmpeg was not found on PATH"** — install ffmpeg (see step 2) and make
  sure it's on your PATH; restart your terminal after installing.
- **Colors look off for an old tournament** — legacy tournaments store team
  colors as names (`"red"`, `"blue"`, ...) instead of hex codes; these are
  resolved via the same fallback table `replay.html` uses. If a team's color
  isn't recognized it renders as gray (`#888888`).
- **"--resolution must be in WIDTHxHEIGHT format"** — the `--resolution` flag needs exactly one `x` between two numbers, e.g. `1920x1080`. Check for typos (extra `x`, missing digits, or a non-numeric value).
- **"bundle file not found" / "is not valid JSON"** — double check the path you passed to `render_replay.py` points at the JSON file you downloaded from replay.html's Export Video Data button, and that the download completed fully (a partial/interrupted download won't be valid JSON).
