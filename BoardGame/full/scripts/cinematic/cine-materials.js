// BoardGame/full/scripts/cinematic/cine-materials.js
// Resolves a material ("lava"/"water"/"magic"/"dust") for any hex
// coordinate, loaded from shared/data/hex-materials.json. Lives under
// shared/ rather than full/data/ (unlike cinematic-scene.json) because
// materials are tied to the fixed terrain art and are meant to eventually
// be read by the live board renderer too, not just the cinematic.

function resolveBoardLayouts() {
    if (typeof window !== 'undefined' && window.BoardLayouts) return window.BoardLayouts;
    if (typeof require === 'function') return require('../../../shared/scripts/board-layouts.js');
    return null;
}

class CineMaterials {
    constructor(doc) {
        this.default = (doc && doc.default) || 'dust';
        this.materials = (doc && doc.materials) || {};
        this.layout = null;
    }

    // Optional: make a hex take the material of the tile art it displays
    // (mirrored outer hexes, swapped heart spots). Without it: by coord.
    setLayout(layout) {
        this.layout = layout || null;
    }

    materialFor(coord) {
        if (this.layout) {
            const BL = resolveBoardLayouts();
            const art = BL && BL.artCoordFor(this.layout, coord);
            return this.materials[art || coord] || this.default;
        }
        return this.materials[coord] || this.default;
    }

    // Never throws: a failed/missing fetch degrades to an all-default
    // CineMaterials instance rather than blocking the cinematic.
    static async load(url) {
        try {
            const res = await fetch(url);
            const doc = await res.json();
            return new CineMaterials(doc);
        } catch (e) {
            console.error('[CineMaterials] Failed to load, falling back to all-default:', e);
            return new CineMaterials(null);
        }
    }
}

if (typeof window !== 'undefined') window.CineMaterials = CineMaterials;
if (typeof module !== 'undefined' && module.exports) module.exports = CineMaterials;
