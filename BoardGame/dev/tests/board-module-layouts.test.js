const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert');
const BoardModule = require('../../shared/scripts/board-module.js');
const BoardLayouts = require('../../shared/scripts/board-layouts.js');

const V2 = BoardLayouts.get(2);

// BoardModule logs on setRoomHexes; keep test output readable.
const realLog = console.log;
const realWarn = console.warn;
before(() => { console.log = () => {}; console.warn = () => {}; });
after(() => { console.log = realLog; console.warn = realWarn; });

test('default constructor is the Legacy board, exactly as before', () => {
    const m = new BoardModule();
    assert.strictEqual(m.layout, BoardLayouts.get(1));
    assert.strictEqual(m.generateHexCoordinates().length, 91);
    assert.deepStrictEqual(m.startingLocations, ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0']);
    assert.deepStrictEqual(m.sideHeartLocations, ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4']);
    assert.deepStrictEqual(m.centerOffset, { x: 375, y: 375 });
    assert.ok(m.isValidHex(5, 0));
    assert.ok(!m.isValidHex(6, 0));
    assert.strictEqual(m.getHexType(-4, 2), 'side-heart');
    assert.strictEqual(m.getHexType(0, -5), 'starting-location');
});

test('scale still multiplies hex size and centre offset', () => {
    const m = new BoardModule(1.5);
    assert.strictEqual(m.hexSize, 48);
    assert.deepStrictEqual(m.centerOffset, { x: 562.5, y: 562.5 });
    const v2 = new BoardModule(1.5, V2);
    assert.deepStrictEqual(v2.centerOffset, { x: 750, y: 750 });
});

test('Version 2 module: 169 hexes, new corners and hearts, bigger box', () => {
    const m = new BoardModule(1, V2);
    assert.strictEqual(m.generateHexCoordinates().length, 169);
    assert.deepStrictEqual(m.centerOffset, { x: 500, y: 500 });
    assert.strictEqual(m.getHexType(0, -7), 'starting-location');
    assert.strictEqual(m.getHexType(3, -6), 'side-heart');
    assert.strictEqual(m.getHexType(0, 0), 'mountain-heart');
    // Legacy heart and corner spots are ordinary hexes on Version 2
    assert.strictEqual(m.getHexType(-4, 2), 'normal');
    assert.strictEqual(m.getHexType(0, -5), 'normal');
});

test('neighbours are clipped to the layout bounds', () => {
    const legacy = new BoardModule();
    assert.deepStrictEqual(legacy.getHexNeighbors(5, 0), ['q5r-1', 'q4r0', 'q4r1']);
    assert.strictEqual(legacy.getHexNeighbors(4, 0).length, 6);

    const v2 = new BoardModule(1, V2);
    assert.deepStrictEqual(v2.getHexNeighbors(7, 0), ['q7r-1', 'q6r0', 'q6r1']);
    assert.strictEqual(v2.getHexNeighbors(5, 0).length, 6); // legacy rim, interior on v2
});

test('first tile may only go on a corner of the module\'s own layout', () => {
    const v2 = new BoardModule(1, V2);
    assert.ok(v2.canPlaceAt(0, -7, [], []));
    assert.ok(!v2.canPlaceAt(0, -5, [], []));
    const legacy = new BoardModule();
    assert.ok(legacy.canPlaceAt(0, -5, [], []));
    assert.ok(!legacy.canPlaceAt(0, -7, [], []));
});

test('setLayout switches a module in place (same object, new geometry)', () => {
    const m = new BoardModule();
    const same = m;
    m.setLayout(V2);
    assert.strictEqual(same, m);
    assert.strictEqual(m.layout, V2);
    assert.strictEqual(m.generateHexCoordinates().length, 169);
    assert.deepStrictEqual(m.centerOffset, { x: 500, y: 500 });
    m.setLayout(BoardLayouts.get(1));
    assert.strictEqual(m.generateHexCoordinates().length, 91);
});

test('isValidCoord() checks a coordinate string against the layout', () => {
    const legacy = new BoardModule();
    assert.ok(legacy.isValidCoord('q5r0'));
    assert.ok(!legacy.isValidCoord('q6r0'));
    assert.ok(!legacy.isValidCoord('garbage'));
    assert.ok(!legacy.isValidCoord(undefined));
    const v2 = new BoardModule(1, V2);
    assert.ok(v2.isValidCoord('q6r0'));
    assert.ok(!v2.isValidCoord('q8r0'));
});

test('setRoomHexes drops hearts, starts and hexes that are off this board', () => {
    const legacy = new BoardModule();
    legacy.setRoomHexes(['q1r0', 'q6r0', 'q0r0', 'q0r-5']);
    assert.deepStrictEqual(legacy.roomHexes, ['q1r0']);

    const v2 = new BoardModule(1, V2);
    v2.setRoomHexes(['q6r0', 'q8r0', 'q3r-6', 'q0r-7', 'q-4r2']);
    assert.deepStrictEqual(v2.roomHexes, ['q6r0', 'q-4r2']);
});

test('getHexRing follows the layout bounds', () => {
    const v2 = new BoardModule(1, V2);
    assert.strictEqual(v2.getHexRing(0, 0, 7).length, 42);
    const legacy = new BoardModule();
    assert.strictEqual(legacy.getHexRing(0, 0, 5).length, 30);
    assert.strictEqual(legacy.getHexRing(0, 0, 7).length, 0);
});
