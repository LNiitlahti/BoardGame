const test = require('node:test');
const assert = require('node:assert');
const BoardRenderer = require('../../shared/scripts/board-renderer.js');
const BoardModule = require('../../shared/scripts/board-module.js');
const BoardLayouts = require('../../shared/scripts/board-layouts.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('extent of one unrotated hex is the hex box, centred', () => {
    const e = BoardRenderer.computeVisualExtent([[50, 50]], 66, 58, 100, 0);
    close(e.width, 66);
    close(e.height, 58);
    close(e.offsetX, 0);
    close(e.offsetY, 0);
});

test('a 90deg rotation swaps width and height', () => {
    const e = BoardRenderer.computeVisualExtent([[50, 50]], 66, 58, 100, 90);
    close(e.width, 58);
    close(e.height, 66);
});

test('an off-centre hex reports its offset from the container centre', () => {
    const e = BoardRenderer.computeVisualExtent([[80, 50]], 66, 58, 100, 0);
    close(e.offsetX, 30);
    close(e.offsetY, 0);
});

for (const version of [1, 2]) {
    test(`v${version} board: rotated extent fits inside the old 1.366 bound and is centred`, () => {
        const mod = new BoardModule(1, BoardLayouts.get(version));
        const centers = mod.generateHexCoordinates().map(([q, r]) => mod.hexToPixel(q, r));
        const size = 2 * mod.layout.nativeHalf;
        const e = BoardRenderer.computeVisualExtent(centers, 66, 58, size, 30);
        assert.ok(e.width > 0 && e.width < size * 1.366);
        assert.ok(e.height > 0 && e.height < size * 1.366);
        assert.ok(Math.abs(e.offsetX) < 40 && Math.abs(e.offsetY) < 40, `offset ${e.offsetX},${e.offsetY}`);
    });
}

test('compactFit: scaled visual width equals the available width', () => {
    const extent = { width: 600, height: 520, offsetX: 4, offsetY: -2 };
    const f = BoardRenderer.compactFit(extent, 360, 1000, 2.2);
    close(f.scale, 360 / 600);
    close(extent.width * f.scale, 360);
});

test('compactFit: the margin box equals the scaled visual box (no empty bands, no overflow)', () => {
    const extent = { width: 600, height: 520, offsetX: 4, offsetY: -2 };
    const f = BoardRenderer.compactFit(extent, 360, 1000, 2.2);
    close(1000 + 2 * f.marginX, extent.width * f.scale);
    close(1000 + 2 * f.marginY, extent.height * f.scale);
});

test('compactFit: translate cancels the scaled offset so the visual box is centred', () => {
    const extent = { width: 600, height: 520, offsetX: 4, offsetY: -2 };
    const f = BoardRenderer.compactFit(extent, 360, 1000, 2.2);
    close(f.translateX, -4 * f.scale);
    close(f.translateY, 2 * f.scale);
});

test('compactFit: scale is capped', () => {
    const f = BoardRenderer.compactFit({ width: 100, height: 100, offsetX: 0, offsetY: 0 }, 800, 750, 2.2);
    close(f.scale, 2.2);
});

test('compactFit: a height limit shrinks the board to fit it', () => {
    const extent = { width: 600, height: 600, offsetX: 0, offsetY: 0 };
    const f = BoardRenderer.compactFit(extent, 600, 1000, 2.2, 300);
    close(f.scale, 0.5);
});
