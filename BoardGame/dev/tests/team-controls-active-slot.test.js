/**
 * Regression coverage for team-controls.js's _getMyActiveSlot() — used to
 * default to slot 1 (`.slot || 1`) whenever the player's active match had
 * no `.slot` tag, which meant a player in a genuinely-ambiguous untagged
 * legacy match always got shown slot 1's ready-check/live-match UI. The
 * fix returns the real (possibly undefined) `.slot` value instead — every
 * current caller already treats a falsy return as "unknown/no slot".
 *
 * team-controls.js is a plain browser script with no module.exports (it's
 * a full/scripts page controller, not a shared/scripts testable module),
 * so it can't be `require()`d directly like phase-manager.js. It's loaded
 * here via Node's `vm` module instead: the real source is executed once in
 * a sandboxed context stubbed with the minimal window/document surface it
 * touches at load time (registering a `firebase-ready`/`beforeunload`
 * listener — never invoked), with a small bridge appended in the SAME
 * script execution so it shares the top-level `let gameData/currentUser/
 * teamData` lexical bindings the real functions close over. This exercises
 * the actual, unmodified _getMyActiveSlot()/_matchInvolvesUs() source.
 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'full', 'scripts', 'team-controls.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const BRIDGE = `
;globalThis.__testBridge = {
    getMyActiveSlot: () => _getMyActiveSlot(),
    setState: (nextGameData, nextCurrentUser, nextTeamData) => {
        gameData = nextGameData;
        currentUser = nextCurrentUser;
        teamData = nextTeamData;
    }
};
`;

function loadTeamControls() {
    const windowStub = { addEventListener: () => {}, location: { search: '' }, dispatchEvent: () => {} };
    const sandbox = {
        console,
        window: windowStub,
        document: { addEventListener: () => {}, getElementById: () => null },
        URLSearchParams,
        CustomEvent: function CustomEvent() {},
        // The icon refactor made the script reference bare ICON_SVGS at load
        // time; any icon name resolves to '' — tests don't render markup.
        ICON_SVGS: new Proxy({}, { get: () => '' })
    };
    sandbox.window.window = sandbox.window;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(source + BRIDGE, context, { filename: 'team-controls.js' });
    return context.__testBridge;
}

function team(uid) {
    return { players: [{ uid, id: uid }] };
}

function matchInvolving(uid, extra = {}) {
    return { teams: [{ players: [{ uid }] }], status: 'pending', ...extra };
}

// ---- core regression: no more silent default to slot 1 ----

test('_getMyActiveSlot returns undefined (not 1) for a match with no .slot tag', () => {
    const bridge = loadTeamControls();
    const match = matchInvolving('u1', { id: 'untagged-match-1' });
    bridge.setState({ gameQueue: [match] }, { uid: 'u1' }, team('u1'));

    const result = bridge.getMyActiveSlot();
    assert.strictEqual(result, undefined, `expected undefined for an untagged match, got ${JSON.stringify(result)}`);
});

test('_getMyActiveSlot returns null when the player has no active match at all', () => {
    const bridge = loadTeamControls();
    bridge.setState({ gameQueue: [] }, { uid: 'u1' }, team('u1'));

    assert.strictEqual(bridge.getMyActiveSlot(), null);
});

// ---- no regression: correctly tagged matches still resolve to their real slot ----

test('_getMyActiveSlot returns the real slot number for a correctly tagged match', () => {
    const bridge = loadTeamControls();
    const match = matchInvolving('u1', { id: 'tagged-match-1', slot: 2 });
    bridge.setState({ gameQueue: [match] }, { uid: 'u1' }, team('u1'));

    assert.strictEqual(bridge.getMyActiveSlot(), 2);
});

test('_getMyActiveSlot prefers the ongoing match over a pending one, tagged case', () => {
    const bridge = loadTeamControls();
    const pending = matchInvolving('u1', { id: 'pending-1', slot: 1, status: 'pending' });
    const ongoing = matchInvolving('u1', { id: 'ongoing-1', slot: 2, status: 'ongoing' });
    bridge.setState({ gameQueue: [pending, ongoing] }, { uid: 'u1' }, team('u1'));

    assert.strictEqual(bridge.getMyActiveSlot(), 2);
});

// ---- round scoping: a mass-imported future round must not leak in ----
// (found live 2026-08-03: the "Your Next Match" panel rendered a card for
// EVERY remaining match in a mass-imported multi-round schedule, because
// nothing filtered the queue by round — only isBreak/isChallenge/status/
// _matchInvolvesUs. _getMyActiveSlot shares the same underlying `mine`
// filter as the match-cards panel, so this exercises the shared fix.)

test('_getMyActiveSlot ignores a match tagged for a future round', () => {
    const bridge = loadTeamControls();
    const futureMatch = matchInvolving('u1', { id: 'future-1', slot: 1, roundNumber: 3 });
    bridge.setState(
        { gameQueue: [futureMatch], currentPhase: { roundNumber: 2 } },
        { uid: 'u1' }, team('u1')
    );

    assert.strictEqual(bridge.getMyActiveSlot(), null,
        'a future round\'s match must not be treated as the active match');
});

test('_getMyActiveSlot picks the current round\'s match over a future round\'s, when both exist', () => {
    const bridge = loadTeamControls();
    const current = matchInvolving('u1', { id: 'current-1', slot: 1, roundNumber: 2 });
    const future = matchInvolving('u1', { id: 'future-2', slot: 2, roundNumber: 3 });
    bridge.setState(
        { gameQueue: [future, current], currentPhase: { roundNumber: 2 } },
        { uid: 'u1' }, team('u1')
    );

    assert.strictEqual(bridge.getMyActiveSlot(), 1);
});

test('_getMyActiveSlot still resolves an untagged (legacy) match regardless of currentPhase.roundNumber', () => {
    const bridge = loadTeamControls();
    const legacyMatch = matchInvolving('u1', { id: 'legacy-no-round-1', slot: 1 });
    bridge.setState(
        { gameQueue: [legacyMatch], currentPhase: { roundNumber: 5 } },
        { uid: 'u1' }, team('u1')
    );

    assert.strictEqual(bridge.getMyActiveSlot(), 1,
        'a match with no roundNumber at all must still count (untagged = ambiguous, include it)');
});

// ---- console.warn: fires once per untagged match id, deduped across calls ----

test('console.warn fires exactly once for an untagged active match across repeated calls', () => {
    const bridge = loadTeamControls();
    const match = matchInvolving('u1', { id: 'warn-dedup-active-1' });
    bridge.setState({ gameQueue: [match] }, { uid: 'u1' }, team('u1'));

    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
        bridge.getMyActiveSlot();
        bridge.getMyActiveSlot();
        bridge.getMyActiveSlot();
    } finally {
        console.warn = originalWarn;
    }

    assert.strictEqual(calls.length, 1, `expected exactly one console.warn, got ${calls.length}: ${JSON.stringify(calls)}`);
    assert.match(calls[0], /\[Team Controls\].*no \.slot tag/);
});

test('console.warn does NOT fire for a correctly tagged active match', () => {
    const bridge = loadTeamControls();
    const match = matchInvolving('u1', { id: 'tagged-no-warn-1', slot: 1 });
    bridge.setState({ gameQueue: [match] }, { uid: 'u1' }, team('u1'));

    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
        bridge.getMyActiveSlot();
    } finally {
        console.warn = originalWarn;
    }

    assert.strictEqual(calls.length, 0, `expected no console.warn for a tagged match, got: ${JSON.stringify(calls)}`);
});
