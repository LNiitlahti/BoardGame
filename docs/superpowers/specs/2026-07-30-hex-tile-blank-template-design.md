# Hex Tile Slicer: Blank Template Download

## Problem

`BoardGame/tools/hex-tile-slicer.html` slices a single uploaded board image into 91 hex tiles using hard-coded hex-grid math (`hexToPixel`, `hexSize=32`, native `boardSize=750`, extraction box `66x58`). Users currently have no way to know where hex boundaries fall when creating original artwork — they must guess or eyeball the grid before uploading.

## Goal

Let users download a blank guide image showing where each of the 91 hex tile extraction boxes falls, so they can paint/illustrate directly on top of it in an external art tool, then re-upload the result through the existing "Main Board Image" upload for slicing — with guaranteed pixel alignment.

## Design

### New button: "Download Blank Template"

Added to Step 1 panel (Main Board Image), next to the existing upload zone. Always enabled — does not require an image to be uploaded first.

### Template generation

On click, generate a 750×750 canvas (native `boardSize`, so `scaleX = scaleY = 1`, `centerX = centerY = 375`):

1. Fill background solid white.
2. For each of the 91 hex coordinates (from `generateHexCoordinates()`), compute its pixel position via the existing `hexToPixel(q, r)` math and draw a `66x58` black-stroked rectangle (2px line width) centered on that position — identical box the slicer itself extracts from during `Generate Tiles`.
3. Draw the hex's coordinate string (e.g. `q0r0`) centered inside the box, small light-gray text, for orientation. No visual distinction between normal and special (mountain-heart / side-heart / starting-location) hexes — artists cross-reference the special hex list separately if needed.
4. Export canvas via `toDataURL('image/png')` and trigger download as `hex-template-blank.png`.

### Round-trip

User edits/paints over the template in their own tool (the guide lines and labels are just a visual aid — they draw over/around them as desired), then uploads the result through the existing Main Board Image upload zone. Because the template was generated at the native `boardSize=750` with rotation-equivalent 0, the user should leave the Rotation field at `0` on re-import (already covered by the existing help text: "Set to 0 if already axis-aligned").

### Implementation note: shared geometry helper

The per-hex rectangle math (`hexToPixel`, `extractW`/`extractH` computation) currently lives inline inside the `generateBtn` click handler. Extract it into a small shared function, e.g. `computeHexBoxes(canvasSize)` returning `[{ q, r, coord, x, y, w, h }, ...]`, so both:
- the existing tile-generation/extraction logic, and
- the new template-generation logic

compute identical positions from one source of truth, preventing future drift between the two.

## Out of scope

- No change to overlay upload, ZIP export, or tile preview grid behavior.
- No configurable template size/resolution (fixed at native 750px per user decision).
- No true hexagon outlines (rectangular extraction boxes only, matching what the tool actually extracts).
- No color-coding of special hex types on the template.
