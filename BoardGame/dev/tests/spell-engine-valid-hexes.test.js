const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.document = global.document || { getElementById: () => null };

require('../../full/scripts/spell-engine.js');
const SpellEngine = global.window.SpellEngine;

const spellsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data/spells.json'), 'utf8')
);
const byId = {};
spellsData.spells.forEach(s => { byId[s.id] = s; });

function makeGameState(overrides = {}) {
    return {
        spellDefinitions: byId,
        teams: [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }],
        board: {},
        heartHexControl: {},
        activeEffects: [],
        spellPiles: {},
        currentPhase: { roundNumber: 2 },
        ...overrides
    };
}

// Minimal fake BoardManager: canPlaceAt is true for any hex not already
// occupied, mirroring board-module.js's real placement rule for a team
// with no adjacency requirement yet (their first tile).
function makeFakeBoardManager(gameState) {
    return {
        generateHexCoordinates() {
            const coords = [];
            for (let q = -1; q <= 1; q++) {
                for (let r = -1; r <= 1; r++) {
                    if (Math.abs(q + r) <= 1) coords.push([q, r]);
                }
            }
            return coords;
        },
        canPlaceAt(q, r, teamId) {
            const coord = `q${q}r${r}`;
            return gameState.board[coord] === undefined;
        },
        getHexType: () => null
    };
}

test('getValidHexesForField(extra_placement) returns every empty hex on the board', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const boardManager = makeFakeBoardManager(gs);
    const engine = new SpellEngine(gs, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        boardManager,
        saveCallback: async () => {},
        logActionCallback: () => {}
    });

    const valid = engine.getValidHexesForField('extra_placement', 'coords', byId['sarja2-k4'], 1, {});
    assert.ok(!valid.includes('q0r0'), 'occupied hex must be excluded');
    assert.ok(valid.includes('q1r0'), 'empty hex must be included');
});

test('getValidHexesForField(reposition, moves) — from-step returns the caster\'s own occupied hexes', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r-1': 2 } });
    const boardManager = makeFakeBoardManager(gs);
    const engine = new SpellEngine(gs, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        boardManager,
        saveCallback: async () => {},
        logActionCallback: () => {}
    });

    const fromCandidates = engine.getValidHexesForField('reposition', 'moves', byId['sarja3-k3'], 1, {});
    assert.deepStrictEqual(fromCandidates, ['q0r0']);
});

test('getValidHexesForField(reposition, moves) — to-step returns neighbors of the chosen from hex', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const boardManager = makeFakeBoardManager(gs);
    const engine = new SpellEngine(gs, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        boardManager,
        saveCallback: async () => {},
        logActionCallback: () => {}
    });

    const toCandidates = engine.getValidHexesForField('reposition', 'moves', byId['sarja3-k3'], 1, { from: 'q0r0' });
    assert.deepStrictEqual(toCandidates.sort(), engine._getHexNeighbors('q0r0').sort());
});
