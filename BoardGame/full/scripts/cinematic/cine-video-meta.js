// BoardGame/full/scripts/cinematic/cine-video-meta.js
// Pure checks for the pre-rendered cinematic's cinematic-meta.json (written by
// dev/tools/cinematic-render/render.js). Shared by view.html (cine-video.js)
// and the render tool.

const META_VERSION = 1;

// Same rule as BoardLayouts: a missing/unknown boardVersion means Legacy.
function boardVersionOf(gameState) {
    const v = gameState && gameState.boardVersion;
    return (v === 2 || v === '2') ? '2' : '1';
}

function isUsable(meta, gameState) {
    if (!meta || meta.version !== META_VERSION) return false;
    if (String(meta.boardVersion) !== boardVersionOf(gameState)) return false;
    if (!(meta.durationMs > 0)) return false;
    if (!Array.isArray(meta.nameWindows)) return false;
    return meta.nameWindows.every(w => w && w.startMs >= 0 && w.endMs > w.startMs);
}

const CineVideoMeta = { META_VERSION, boardVersionOf, isUsable };
if (typeof window !== 'undefined') window.CineVideoMeta = CineVideoMeta;
if (typeof module !== 'undefined' && module.exports) module.exports = CineVideoMeta;
