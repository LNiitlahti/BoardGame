/**
 * Coverage for view.html's spell-window slide helpers.
 *
 * There is no turn order for spells: any player can walk up to the admin
 * at any point during an open spell window and ask to use a spell; the
 * admin types it into the manual spell log (addSpellLogEntry() in
 * admin-improved-adapter.js) and it shows next to that team. spellPhase's
 * turnOrder / currentTeamIndex / teamsCompleted are only ever populated by
 * spell-engine.js's beginSpellPhase(), which is wired exclusively on
 * god.html and never reached from admin.html — so this slide must not
 * express turn semantics (current/choosing/passed/reverse-standings order)
 * that don't exist in the real game.
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

test('the phase banner always reads exactly SPELL WINDOW, no team named', () => {
    const dm = makeDisplayManager();
    const banner = { style: {}, textContent: '' };
    global.document = {
        getElementById: (id) => (id === 'phaseBanner' ? banner : null),
        querySelector: () => null
    };
    dm._gameData = { teams: [{ id: 't5', name: 'Tiimi 5' }, { id: 't4', name: 'Tiimi 4' }] };

    try {
        dm.renderPhaseDisplay({
            currentPhase: { name: 'spell_window_1', roundNumber: 2 },
            teams: [{ id: 't5', name: 'Tiimi 5' }, { id: 't4', name: 'Tiimi 4' }],
            spellPhase: {
                isActive: true,
                turnOrder: ['t5', 't4'],
                currentTeamIndex: 0,
                teamsCompleted: ['t5']
            }
        });

        assert.strictEqual(banner.textContent, 'SPELL WINDOW');
    } finally {
        delete global.document;
    }
});

test('an IDLE spell window still takes over the screen (admin.html never sets isActive)', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_1', roundNumber: 2 },
        spellPhase: { isActive: false, turnOrder: [], teamsCompleted: [] },
        gameQueue: []
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'spell_window_1');
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
    const dm = makeDisplayManager();
    const data = {
        displayOverride: { mode: 'spell_window_1' },
        currentPhase: { name: 'scoring_vp', roundNumber: 2 },
        gameQueue: []
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'spell_window_1');
});

test('the spell-window phase now wins over the ongoing-matches fallback', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_1', roundNumber: 2 },
        spellPhase: { isActive: false },
        gameQueue: [{ id: 'm1', status: 'ongoing' }]
    };

    assert.strictEqual(dm._determineDisplayMode(data), 'spell_window_1');
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

test('all teams render, in data.teams natural array order, regardless of points', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1' },
        teams: [
            { id: 't1', name: 'Tiimi 1', color: '#ff0000', points: 10 },
            { id: 't2', name: 'Tiimi 2', color: '#00ff00', points: 2 },
            { id: 't3', name: 'Tiimi 3', color: '#0000ff', points: 6 }
        ]
    });

    const rowPattern = /<span class="dm-spell-turn-name">([^<]*)</g;
    const names = [...html.matchAll(rowPattern)].map(m => m[1]);

    assert.deepStrictEqual(names, ['Tiimi 1', 'Tiimi 2', 'Tiimi 3']);
});

test('rendering does not mutate data.teams', () => {
    const teams = [
        { id: 't1', name: 'Tiimi 1', color: '#ff0000', points: 10 },
        { id: 't2', name: 'Tiimi 2', color: '#00ff00', points: 2 }
    ];
    const original = teams.map(t => t.id);

    renderSpellSlide({ currentPhase: { name: 'spell_window_1' }, teams });

    assert.deepStrictEqual(teams.map(t => t.id), original);
});

test('a team with a manual spellWindowLog entry shows the spell name and is marked done', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Fireball', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    const rowPattern = /<div class="dm-spell-turn dm-spell-turn--(\w+)"[^>]*>\s*<span class="dm-spell-turn-name">([^<]*)<\/span>\s*<span class="dm-spell-turn-note">([^<]*)</g;
    const rows = [...html.matchAll(rowPattern)].map(m => ({ state: m[1], name: m[2], note: m[3] }));

    assert.deepStrictEqual(rows, [
        { state: 'done', name: 'Tiimi 1', note: 'Fireball' },
        { state: 'waiting', name: 'Tiimi 2', note: '' },
        { state: 'waiting', name: 'Tiimi 3', note: '' }
    ]);
});

test('multiple spells for one team are joined with ", "', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Fireball', addedAt: '2026-08-06T12:01:00.000Z' },
            { id: 'sl_2', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Ice Wall', addedAt: '2026-08-06T12:02:00.000Z' }
        ]
    });

    assert.match(html, /Fireball, Ice Wall/);
});

test('a spellHistory entry from before currentPhase.startedAt still does not appear', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellHistory: [
            { timestamp: '2026-08-06T11:00:00.000Z', spellName: 'Old Spell', teamId: 't1', teamName: 'Tiimi 1' }
        ]
    });

    assert.doesNotMatch(html, /Old Spell/);
});

test('dm-spell-turn--current and the words choosing/passed never appear', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Fireball', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    assert.doesNotMatch(html, /dm-spell-turn--current/);
    assert.doesNotMatch(html, /choosing/);
    assert.doesNotMatch(html, /passed/);
});

test('no .dm-spell-log element is emitted', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: 'Fireball', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    assert.doesNotMatch(html, /dm-spell-log/);
});

test('an admin-typed spell name is HTML-escaped', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1', startedAt: '2026-08-06T12:00:00.000Z' },
        teams: SPELL_TEAMS,
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Tiimi 1', spellName: '<img src=x onerror=alert(1)>', addedAt: '2026-08-06T12:01:00.000Z' }
        ]
    });

    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
});

test('the empty-teams case still renders dm-spell-subtitle', () => {
    const html = renderSpellSlide({
        currentPhase: { name: 'spell_window_1' },
        teams: []
    });

    assert.match(html, /dm-spell-subtitle/);
});
