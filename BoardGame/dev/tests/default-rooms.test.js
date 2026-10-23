const test = require('node:test');
const assert = require('node:assert');
const DR = require('../../shared/scripts/default-rooms.js');
const BoardLayouts = require('../../shared/scripts/board-layouts.js');

function fakeDb(initial = {}) {
    const store = { ...initial };
    const reads = [];
    const writes = [];
    return {
        store, reads, writes,
        collection(name) {
            assert.strictEqual(name, 'config');
            return {
                doc(id) {
                    return {
                        async get() {
                            reads.push(id);
                            const data = store[id];
                            return { exists: data !== undefined, data: () => data };
                        },
                        async set(data) {
                            writes.push(id);
                            store[id] = data;
                        }
                    };
                }
            };
        }
    };
}

test('no docId -> Legacy doc defaultRooms (unchanged behaviour)', async () => {
    const db = fakeDb({ defaultRooms: { rooms: ['q0r1'], updatedAt: 't', updatedBy: 'x' } });
    assert.deepStrictEqual(await DR.loadDefaultRoomsDoc(db), ['q0r1']);
    const meta = await DR.loadDefaultRoomsMeta(db);
    assert.deepStrictEqual(meta, { rooms: ['q0r1'], updatedAt: 't', updatedBy: 'x' });
    await DR.saveDefaultRoomsDoc(db, ['q1r1'], 'me');
    assert.deepStrictEqual(db.reads, ['defaultRooms', 'defaultRooms']);
    assert.deepStrictEqual(db.writes, ['defaultRooms']);
});

test('docId defaultRoomsV2 touches only that doc', async () => {
    const db = fakeDb({
        defaultRooms: { rooms: ['legacy'] },
        defaultRoomsV2: { rooms: ['q6r1'], updatedAt: 'a', updatedBy: 'b' }
    });
    assert.deepStrictEqual(await DR.loadDefaultRoomsDoc(db, 'defaultRoomsV2'), ['q6r1']);
    assert.strictEqual((await DR.loadDefaultRoomsMeta(db, 'defaultRoomsV2')).updatedBy, 'b');
    await DR.saveDefaultRoomsDoc(db, ['q7r-3'], 't1', 'defaultRoomsV2');
    assert.ok(db.reads.every(id => id === 'defaultRoomsV2'));
    assert.deepStrictEqual(db.writes, ['defaultRoomsV2']);
    assert.deepStrictEqual(db.store.defaultRooms, { rooms: ['legacy'] });
});

test('saved doc shape and array copy', async () => {
    const db = fakeDb();
    const rooms = ['q1r1', 'q2r2'];
    await DR.saveDefaultRoomsDoc(db, rooms, 'tourn', 'defaultRoomsV2');
    const saved = db.store.defaultRoomsV2;
    assert.deepStrictEqual(saved.rooms, rooms);
    assert.notStrictEqual(saved.rooms, rooms);
    assert.strictEqual(saved.updatedBy, 'tourn');
    assert.strictEqual(new Date(saved.updatedAt).toISOString(), saved.updatedAt);
    await DR.saveDefaultRoomsDoc(db, rooms);
    assert.strictEqual(db.store.defaultRooms.updatedBy, 'unknown');
});

test('missing or empty doc returns null', async () => {
    const db = fakeDb({ defaultRoomsV2: { rooms: [] } });
    assert.strictEqual(await DR.loadDefaultRoomsDoc(db, 'defaultRoomsV2'), null);
    assert.strictEqual(await DR.loadDefaultRoomsMeta(db, 'defaultRoomsV2'), null);
    assert.strictEqual(await DR.loadDefaultRoomsDoc(db), null);
    assert.strictEqual(await DR.loadDefaultRoomsMeta(db), null);
});

test('layouts carry their defaultRoomsDocId', () => {
    assert.strictEqual(BoardLayouts.get(1).defaultRoomsDocId, 'defaultRooms');
    assert.strictEqual(BoardLayouts.get(2).defaultRoomsDocId, 'defaultRoomsV2');
});

test('localDefaultRoomsFor: Legacy copy, Version 2 fresh copy of its own list', () => {
    const legacy = DR.localDefaultRoomsFor(BoardLayouts.get(1));
    assert.strictEqual(legacy.length, 24);
    assert.deepStrictEqual(legacy, DR.LOCAL_DEFAULT_ROOMS);
    assert.notStrictEqual(legacy, DR.LOCAL_DEFAULT_ROOMS);
    const v2a = DR.localDefaultRoomsFor(BoardLayouts.get(2));
    const v2b = DR.localDefaultRoomsFor(BoardLayouts.get(2));
    assert.deepStrictEqual(v2a, DR.LOCAL_DEFAULT_ROOMS_V2);
    assert.strictEqual(v2a.length, 32);
    assert.notStrictEqual(v2a, v2b);
    assert.notStrictEqual(v2a, DR.LOCAL_DEFAULT_ROOMS_V2);
    assert.strictEqual(DR.localDefaultRoomsFor(undefined).length, 24);
});

test('LOCAL_DEFAULT_ROOMS_V2: 32 unique rooms, all on the Version 2 board, none on a heart/start/centre', () => {
    const v2 = BoardLayouts.get(2);
    const special = new Set([...v2.startingLocations, ...v2.sideHeartLocations, v2.mountainHeartLocation]);
    const rooms = DR.LOCAL_DEFAULT_ROOMS_V2;
    assert.strictEqual(rooms.length, 32);
    assert.strictEqual(new Set(rooms).size, 32, 'no duplicates');
    for (const c of rooms) {
        const [q, r] = c.match(/-?\d+/g).map(Number);
        assert.ok(BoardLayouts.isValid(v2, q, r), c + ' is on the board');
        assert.ok(!special.has(c), c + ' is not a heart, start or the centre');
    }
});
