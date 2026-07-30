# Hex Tile Slicer Blank Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a "Download Blank Template" button to `BoardGame/tools/hex-tile-slicer.html` that exports a 750x750 white PNG with black-outlined, coordinate-labeled hex extraction boxes, so users can illustrate original art aligned to the tool's grid and re-import it for slicing.

**Architecture:** Extract the existing inline hex-position/extraction-box math (currently duplicated logic inside the `generateBtn` click handler) into one shared function, `computeHexBoxes(canvasWidth, canvasHeight)`, that both the existing tile-generation code and the new template-generation code call. This guarantees the template and the actual slicing use identical geometry. No build step or test framework exists for this project — it's a single static HTML file opened directly in a browser — so verification is manual browser testing, not automated tests.

**Tech Stack:** Vanilla JS, HTML5 Canvas, no dependencies beyond the existing JSZip CDN include already in the file.

---

### Task 1: Extract shared `computeHexBoxes` geometry helper — DONE

**Files:**
- Modify: `BoardGame/tools/hex-tile-slicer.html:491-502` (near `generateHexCoordinates`)
- Modify: `BoardGame/tools/hex-tile-slicer.html:637-798` (`generateBtn` click handler)

- [x] **Step 1: Add `computeHexBoxes` function right after `generateHexCoordinates`**
- [x] **Step 2: Replace the inline geometry math in `generateBtn` with a call to `computeHexBoxes`**
- [x] **Step 3: Manual verification — existing slicing still works** (verified computationally: `computeHexBoxes(750,750)` produces 91 boxes, no NaN, center box at expected position; full interactive browser test still recommended, see note at end of file)
- [x] **Step 4: Commit** — `a4a2a77` "Extract shared computeHexBoxes helper in hex tile slicer"

---

### Task 2: Add "Download Blank Template" button and generation logic — DONE

**Files:**
- Modify: `BoardGame/tools/hex-tile-slicer.html` (HTML markup near the main upload zone, and JS near the other button handlers)

- [x] **Step 1: Add the button to the HTML, in the Step 1 panel**
- [x] **Step 2: Add the `downloadBlankBtn` DOM reference**
- [x] **Step 3: Add the click handler**
- [x] **Step 4: Manual verification — template downloads and round-trips correctly** (not run interactively — see note below)
- [x] **Step 5: Commit** — `28bb8ab` "Add blank template download to hex tile slicer"

---

## Self-Review Notes

- **Spec coverage:** Rectangular boxes (not true hexagons) — Task 2 Step 3 uses `strokeRect`. Coordinate labels on every hex — Task 2 Step 3 `fillText(box.coord, ...)`. No color-coding of special hexes — confirmed, all boxes use the same `strokeStyle`/`fillStyle`. White background — confirmed. 750px native size — confirmed (`canvasSize = 750`, no size input added). Shared geometry helper to prevent drift — Task 1.
- **Type consistency:** `computeHexBoxes` return shape `{q, r, coord, x, y, w, h}` is used identically in both the refactored `generateBtn` handler (Task 1 Step 2: `box.x, box.y, box.w, box.h`) and the new template handler (Task 2 Step 3: same fields). Function name and signature match everywhere it's referenced.
- **No placeholders:** all steps contain complete, runnable code.

## Verification note

This is a static HTML file with no build/test tooling. Verification performed:
- JS syntax check of the full inline `<script>` block via Node (`new Function(script)`).
- Isolated execution of `computeHexBoxes(750, 750)` in Node: confirmed 91 boxes returned, no NaN values, center hex (`q0r0`) box centered near canvas middle, edge hex (`q-5r5`) within bounds.

**Not performed:** actually opening the file in a real browser and clicking through the UI (upload image, click buttons, inspect the downloaded PNG visually). No browser automation tool was available in this session. Recommend the user open `BoardGame/tools/hex-tile-slicer.html` directly and click "Download Blank Template" to visually confirm the guide image looks correct before relying on it.
