/**
 * Coverage for view.html's spell-window slide helpers
 * (docs/superpowers/specs/2026-08-06-view-spell-window-design.md).
 *
 * Same require pattern as display-manager-slot-requirements.test.js: stub
 * global.window, require the plain-script file, read the class back off it.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

function makeDisplayManager() {
    return new DisplayManager({ container: null, boardModule: null, boardRenderer: null });
}

test('current team is the first in turnOrder not yet completed', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: {
            isActive: true,
            turnOrder: ['t5', 't4', 't3', 't2', 't1'],
            currentTeamIndex: 0,
            teamsCompleted: ['t5', 't4']
        }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 't3');
});

test('a stale currentTeamIndex does NOT decide the current team', () => {
    // The team.html cast/pass paths never advance currentTeamIndex, so it
    // sits at 0 while teamsCompleted grows. Reading the index would wrongly
    // report t5 as still choosing.
    const dm = makeDisplayManager();
    const data = {
        spellPhase: {
            isActive: true,
            turnOrder: ['t5', 't4'],
            currentTeamIndex: 0,
            teamsCompleted: ['t5']
        }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 't4');
});

test('numeric team ids in turnOrder match string ids in teamsCompleted', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: { isActive: true, turnOrder: [5, 4, 3], teamsCompleted: ['5', 4] }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 3);
});

test('returns null when every team has completed', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: { isActive: true, turnOrder: ['t1', 't2'], teamsCompleted: ['t1', 't2'] }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), null);
});

test('returns null when the spell phase is not active', () => {
    const dm = makeDisplayManager();
    const data = { spellPhase: { isActive: false, turnOrder: ['t1'], teamsCompleted: [] } };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), null);
});

test('returns null when there is no spellPhase at all', () => {
    const dm = makeDisplayManager();

    assert.strictEqual(dm._spellWindowCurrentTeamId({}), null);
});

test('spellHistory entries from before this window are excluded', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2', startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [
            { timestamp: '2026-08-06T11:00:00.000Z', spellName: 'Old Spell', teamId: 't1', teamName: 'Tiimi 1' },
            { timestamp: '2026-08-06T12:05:00.000Z', spellName: 'New Spell', teamId: 't2', teamName: 'Tiimi 2' }
        ]
    };

    const casts = dm._collectSpellWindowCasts(data);

    assert.strictEqual(casts.length, 1);
    assert.strictEqual(casts[0].spellName, 'New Spell');
});

test('manual spellWindowLog entries are merged in and sorted by time', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2', startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [
            { timestamp: '2026-08-06T12:06:00.000Z', spellName: 'In-App Cast', teamId: 't2', teamName: 'Tiimi 2' }
        ],
        spellWindowLog: [
            { id: 'sl_1', addedAt: '2026-08-06T12:03:00.000Z', spellName: 'Table Cast', teamId: 't1', teamName: 'Tiimi 1' }
        ]
    };

    const casts = dm._collectSpellWindowCasts(data);

    assert.deepStrictEqual(casts.map(c => c.spellName), ['Table Cast', 'In-App Cast']);
    assert.deepStrictEqual(casts.map(c => c.teamId), ['t1', 't2']);
});

test('with no startedAt, spellHistory is excluded entirely but the manual log survives', () => {
    // Without a window boundary there is no way to tell this window's casts
    // from the whole tournament's, so the cumulative source is dropped
    // rather than dumping every spell ever cast onto the room display.
    // spellWindowLog is per-window by construction, so it is always safe.
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2' },
        spellHistory: [{ timestamp: '2026-08-06T12:05:00.000Z', spellName: 'Unbounded', teamId: 't1' }],
        spellWindowLog: [{ id: 'sl_1', addedAt: '2026-08-06T12:03:00.000Z', spellName: 'Table Cast', teamId: 't1' }]
    };

    assert.deepStrictEqual(dm._collectSpellWindowCasts(data).map(c => c.spellName), ['Table Cast']);
});

test('falls back to spellId when a history entry has no spellName', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [{ timestamp: '2026-08-06T12:05:00.000Z', spellId: 'spell_fireball', teamId: 't1' }]
    };

    assert.strictEqual(dm._collectSpellWindowCasts(data)[0].spellName, 'spell_fireball');
});

test('returns an empty array when neither source has anything', () => {
    const dm = makeDisplayManager();

    assert.deepStrictEqual(dm._collectSpellWindowCasts({ currentPhase: {} }), []);
});

test('the phase banner names the derived current team, not the stale index', () => {
    // renderPhaseDisplay needs a #phaseBanner element; node has no DOM, so
    // stub the two document lookups it makes.
    const dm = makeDisplayManager();
    const banner = { style: {}, textContent: '' };
    global.document = {
        getElementById: (id) => (id === 'phaseBanner' ? banner : null),
        querySelector: () => null
    };
    // _getCurrentTeamName reads this._gameData, which onFirebaseSnapshot sets
    // before it calls renderPhaseDisplay. This test calls the method directly,
    // so set it by hand.
    dm._gameData = { teams: [{ id: 't5', name: 'Tiimi 5' }, { id: 't4', name: 'Tiimi 4' }] };

    try {
        dm.renderPhaseDisplay({
            currentPhase: { name: 'spell_window_1', roundNumber: 2 },
            teams: [{ id: 't5', name: 'Tiimi 5' }, { id: 't4', name: 'Tiimi 4' }],
            spellPhase: {
                isActive: true,
                turnOrder: ['t5', 't4'],
                currentTeamIndex: 0,      // stale — t5 has already cast
                teamsCompleted: ['t5']
            }
        });

        assert.match(banner.textContent, /Tiimi 4 is choosing/);
    } finally {
        delete global.document;
    }
});

test('the phase banner drops the "is choosing" suffix once every team has acted', () => {
    const dm = makeDisplayManager();
    const banner = { style: {}, textContent: '' };
    global.document = {
        getElementById: (id) => (id === 'phaseBanner' ? banner : null),
        querySelector: () => null
    };

    try {
        dm.renderPhaseDisplay({
            currentPhase: { name: 'spell_window_1', roundNumber: 2 },
            teams: [{ id: 't5', name: 'Tiimi 5' }],
            spellPhase: { isActive: true, turnOrder: ['t5'], teamsCompleted: ['t5'] }
        });

        assert.strictEqual(banner.textContent, 'SPELL WINDOW');
    } finally {
        delete global.document;
    }
});

test('an IDLE spell window does not take over the screen', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_1', roundNumber: 2 },
        spellPhase: { isActive: false, turnOrder: [], teamsCompleted: [] },
        gameQueue: []
    };

    assert.strictEqual(dm._determineDisplayMode(data), null);
});

test('an ACTIVE spell window takes over the screen', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_3', roundNumber: 2 },
        spellPhase: { isActive: true, turnOrder: ['t1'], teamsCompleted: [] },
        gameQueue: []
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'spell_window_3');
});

test('god.html can force the spell slide even with no active spell phase', () => {
    // displayOverride is checked before the isActive guard, deliberately, so
    // the screen can be rehearsed before the event.
    const dm = makeDisplayManager();
    const data = {
        displayOverride: { mode: 'spell_window_1' },
        currentPhase: { name: 'scoring_vp', roundNumber: 2 },
        gameQueue: []
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'spell_window_1');
});

test('an idle spell window still falls through to live matches', () => {
    // Pre-existing behavior, unchanged by the guard: a stale ongoing queue
    // entry outranks a phase that yields no slide.
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_1', roundNumber: 2 },
        spellPhase: { isActive: false },
        gameQueue: [{ id: 'm1', status: 'ongoing' }]
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'matches_in_progress');
});

function renderSpellSlide(data) {
    const dm = makeDisplayManager();
    dm._gameData = data;   // _getTeamColor / _getCurrentTeamName read this
    const container = { innerHTML: '' };
    dm._renderSpellWindowSlide(container, data);
    return container.innerHTML;
}

const SPELL_TEAMS = [
    { id: 't1', name: 'Tiimi 1', color: '#ff0000' },
    { id: 't2', name: 'Tiimi 2', color: '#00ff00' },
    { id: 't3', name: 'Tiimi 3', color: '#0000ff' }
];

test('the slide marks each team as done, choosing, or waiting', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellPhase: { isActive: true, turnOrder: ['t1', 't2', 't3'], teamsCompleted: ['t1'] },
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Fireball', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    // Pin each state class to the team row it actually landed on, not just
    // its presence somewhere in the document -- a bug that mis-maps state
    // to team (e.g. an off-by-one in the done.includes check) would still
    // emit all three class strings once each and slip past a bare
    // assert.match(html, /dm-spell-turn--done/) check.
    const rowPattern = /<div class="dm-spell-turn dm-spell-turn--(\w+)"[^>]*>\s*<span class="dm-spell-turn-name">([^<]*)</g;
    const rows = [...html.matchAll(rowPattern)].map(m => ({ state: m[1], name: m[2] }));

    assert.deepStrictEqual(rows, [
        { state: 'done', name: 'Tiimi 1' },
        { state: 'current', name: 'Tiimi 2' },
        { state: 'waiting', name: 'Tiimi 3' }
    ]);
    assert.match(html, /Fireball/);
});

test('a team that completed without casting is labelled as having passed', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellPhase: { isActive: true, turnOrder: ['t1', 't2'], teamsCompleted: ['t1'] },
        spellWindowLog: []
    });

    assert.match(html, /passed/);
});

test('the slide renders with an empty turnOrder (god.html forced it)', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1' },
        teams: SPELL_TEAMS,
        spellPhase: undefined
    });

    assert.match(html, /dm-spell-screen/);
    assert.doesNotMatch(html, /undefined/);
});

test('an admin-typed spell name is HTML-escaped', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellPhase: { isActive: true, turnOrder: ['t1'], teamsCompleted: ['t1'] },
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: '<img src=x onerror=alert(1)>', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
});
