/**
 * Coverage for shared/scripts/challenge-bundle.js — the Round 12B multi-hex
 * bundling logic (bipartition/odd-cycle validation, uninvolved-team roster
 * fill, and per-dispute hex-transfer resolution). See
 * docs/guides/EVENT_BUG_REPORTS.md, "Challenge matches can't run
 * concurrently, and can only be logged against one contested hex" for the
 * worked example this is built from.
 */
const test = require('node:test');
const assert = require('node:assert');

const ChallengeBundle = require('../../shared/scripts/challenge-bundle.js');
const { bipartitionDisputes, parseSymmetricFormat, fillBundleRoster, resolveBundleDisputes, resolveBundleFromQueueEntry, buildChallengeBundle } = ChallengeBundle;

// ---------------------------------------------------------------------------
// bipartitionDisputes
// ---------------------------------------------------------------------------

test('bipartitionDisputes: single dispute splits challenger and defender onto opposite sides', () => {
    const result = bipartitionDisputes([{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'q0r0' }]);
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.sideA.includes(1) && result.sideB.includes(2), true);
    // challenger and defender must never share a side
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.notStrictEqual(sideOf(1), sideOf(2));
});

test('bipartitionDisputes: disjoint dispute pairs (two independent 1-edge components) bipartition independently', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'hexA' },
        { challengerTeamId: 3, defenderTeamId: 4, hexCoord: 'hexB' }
    ]);
    assert.ok(!result.error, JSON.stringify(result));
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.notStrictEqual(sideOf(1), sideOf(2));
    assert.notStrictEqual(sideOf(3), sideOf(4));
    // all 4 teams accounted for exactly once
    const all = [...result.sideA, ...result.sideB].map(String).sort();
    assert.deepStrictEqual(all, ['1', '2', '3', '4'].sort());
});

test('bipartitionDisputes: worked example from EVENT_BUG_REPORTS.md — Team5->Team1, Team1->Team2, Team2->Team3', () => {
    // Doc: bipartition should be {Team1, Team3} vs {Team2, Team5}
    const result = bipartitionDisputes([
        { challengerTeamId: 5, defenderTeamId: 1, hexCoord: 'hexA' },
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'hexB' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'hexC' }
    ]);
    assert.ok(!result.error, JSON.stringify(result));
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.strictEqual(sideOf(1), sideOf(3));
    assert.strictEqual(sideOf(2), sideOf(5));
    assert.notStrictEqual(sideOf(1), sideOf(2));
});

test('bipartitionDisputes: a chain of 4 disputes (5 teams) bipartitions alternately', () => {
    // 1->2->3->4->5 (challenger->defender chain)
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: 4, hexCoord: 'h3' },
        { challengerTeamId: 4, defenderTeamId: 5, hexCoord: 'h4' }
    ]);
    assert.ok(!result.error, JSON.stringify(result));
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.strictEqual(sideOf(1), sideOf(3));
    assert.strictEqual(sideOf(3), sideOf(5));
    assert.strictEqual(sideOf(2), sideOf(4));
    assert.notStrictEqual(sideOf(1), sideOf(2));
});

test('bipartitionDisputes: odd cycle (3-way loop) is rejected with the specific teams named', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: 1, hexCoord: 'h3' }
    ]);
    assert.ok(result.error, 'expected an odd-cycle error');
    assert.strictEqual(result.error.type, 'odd-cycle');
    assert.deepStrictEqual(result.error.teamIds.map(String).sort(), ['1', '2', '3']);
    assert.match(result.error.message, /odd cycle/i);
    // every named team actually appears in the human-readable message
    assert.match(result.error.message, /Team 1/);
    assert.match(result.error.message, /Team 2/);
    assert.match(result.error.message, /Team 3/);
});

test('bipartitionDisputes: a 5-way odd cycle is also rejected', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: 4, hexCoord: 'h3' },
        { challengerTeamId: 4, defenderTeamId: 5, hexCoord: 'h4' },
        { challengerTeamId: 5, defenderTeamId: 1, hexCoord: 'h5' }
    ]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'odd-cycle');
    assert.strictEqual(result.error.teamIds.length, 5);
});

test('bipartitionDisputes: an even cycle (4-way loop) is valid and bipartitions correctly', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: 4, hexCoord: 'h3' },
        { challengerTeamId: 4, defenderTeamId: 1, hexCoord: 'h4' }
    ]);
    assert.ok(!result.error, JSON.stringify(result));
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.strictEqual(sideOf(1), sideOf(3));
    assert.strictEqual(sideOf(2), sideOf(4));
    assert.notStrictEqual(sideOf(1), sideOf(2));
});

test('bipartitionDisputes: a dispute graph disconnected across multiple unrelated bundles — one odd cycle among them still fails the whole bundle', () => {
    const result = bipartitionDisputes([
        // clean disjoint pair
        { challengerTeamId: 10, defenderTeamId: 11, hexCoord: 'h1' },
        // odd cycle among unrelated teams
        { challengerTeamId: 20, defenderTeamId: 21, hexCoord: 'h2' },
        { challengerTeamId: 21, defenderTeamId: 22, hexCoord: 'h3' },
        { challengerTeamId: 22, defenderTeamId: 20, hexCoord: 'h4' }
    ]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'odd-cycle');
    assert.deepStrictEqual(result.error.teamIds.map(String).sort(), ['20', '21', '22']);
});

test('bipartitionDisputes: disconnected components that are each individually fine all bipartition successfully', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 10, defenderTeamId: 11, hexCoord: 'h1' },
        { challengerTeamId: 20, defenderTeamId: 21, hexCoord: 'h2' },
        { challengerTeamId: 21, defenderTeamId: 22, hexCoord: 'h3' }
    ]);
    assert.ok(!result.error, JSON.stringify(result));
    const sideOf = (id) => result.sideA.includes(id) ? 'A' : 'B';
    assert.notStrictEqual(sideOf(10), sideOf(11));
    assert.notStrictEqual(sideOf(20), sideOf(21));
    assert.strictEqual(sideOf(20), sideOf(22));
});

test('bipartitionDisputes: rejects empty input', () => {
    const result = bipartitionDisputes([]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'empty');
});

test('bipartitionDisputes: rejects a dispute missing a field', () => {
    const result = bipartitionDisputes([{ challengerTeamId: 1, defenderTeamId: 2 }]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'invalid-dispute');
});

test('bipartitionDisputes: rejects a team disputing its own hex', () => {
    const result = bipartitionDisputes([{ challengerTeamId: 1, defenderTeamId: 1, hexCoord: 'h1' }]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'self-dispute');
});

test('bipartitionDisputes: rejects the same hex disputed twice', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 3, defenderTeamId: 4, hexCoord: 'h1' }
    ]);
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'duplicate-hex');
});

test('bipartitionDisputes: tolerates mixed string/number team ids referring to the same team', () => {
    const result = bipartitionDisputes([
        { challengerTeamId: '1', defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: '3', hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: '1', hexCoord: 'h3' }
    ]);
    // This is the same odd-cycle shape as team 1/2/3 above, just with mixed types
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'odd-cycle');
});

// ---------------------------------------------------------------------------
// parseSymmetricFormat
// ---------------------------------------------------------------------------

test('parseSymmetricFormat: parses symmetric formats', () => {
    assert.strictEqual(parseSymmetricFormat('5v5'), 5);
    assert.strictEqual(parseSymmetricFormat('1v1'), 1);
    assert.strictEqual(parseSymmetricFormat(' 3v3 '), 3);
    assert.strictEqual(parseSymmetricFormat('3V3'), 3);
});

test('parseSymmetricFormat: rejects asymmetric or malformed formats', () => {
    assert.strictEqual(parseSymmetricFormat('3v5'), null);
    assert.strictEqual(parseSymmetricFormat('garbage'), null);
    assert.strictEqual(parseSymmetricFormat(''), null);
    assert.strictEqual(parseSymmetricFormat(null), null);
    assert.strictEqual(parseSymmetricFormat(undefined), null);
    assert.strictEqual(parseSymmetricFormat('0v0'), null);
});

// ---------------------------------------------------------------------------
// fillBundleRoster
// ---------------------------------------------------------------------------

function team(id, playerCount, name) {
    const players = [];
    for (let i = 1; i <= playerCount; i++) players.push({ id: `t${id}p${i}`, name: `${name || 'Team' + id} Player ${i}` });
    return { id, name: name || `Team ${id}`, players };
}

test('fillBundleRoster: disputing teams alone exactly fill the format — no split needed', () => {
    const allTeams = [team(1, 2), team(2, 2)];
    const result = fillBundleRoster({ sideATeamIds: [1], sideBTeamIds: [2], allTeams, format: '2v2' });
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.sideAPlayers.length, 2);
    assert.strictEqual(result.sideBPlayers.length, 2);
    assert.deepStrictEqual(result.splitTeamIds, []);
});

test('fillBundleRoster: fills deficit from uninvolved teams, splitting one player per side', () => {
    // disputing teams 1 (2p) vs 2 (2p), format 3v3 -> needs 1 more per side
    const allTeams = [team(1, 2), team(2, 2), team(3, 2, 'Uninvolved3'), team(4, 2, 'Uninvolved4')];
    const result = fillBundleRoster({ sideATeamIds: [1], sideBTeamIds: [2], allTeams, format: '3v3' });
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.sideAPlayers.length, 3);
    assert.strictEqual(result.sideBPlayers.length, 3);
    assert.deepStrictEqual(result.splitTeamIds, [3]);
    // the split player(s) are flagged
    assert.strictEqual(result.sideAPlayers.filter(p => p.isSplit).length, 1);
    assert.strictEqual(result.sideBPlayers.filter(p => p.isSplit).length, 1);
    // uninvolved team 4 wasn't touched — team 3 alone covered the deficit
    assert.ok(!result.sideAPlayers.some(p => p.originalTeamId === 4));
    assert.ok(!result.sideBPlayers.some(p => p.originalTeamId === 4));
});

test('fillBundleRoster: pulls from a second uninvolved team when one is not enough', () => {
    // disputing teams 1(1p) vs 2(1p), format 5v5 -> needs 4 more per side, spread across uninvolved teams
    const allTeams = [
        team(1, 1), team(2, 1),
        team(3, 2, 'U3'), team(4, 2, 'U4'), team(5, 2, 'U5'), team(6, 2, 'U6')
    ];
    const result = fillBundleRoster({ sideATeamIds: [1], sideBTeamIds: [2], allTeams, format: '5v5' });
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.sideAPlayers.length, 5);
    assert.strictEqual(result.sideBPlayers.length, 5);
    assert.deepStrictEqual(result.splitTeamIds.sort(), [3, 4, 5, 6].sort());
});

test('fillBundleRoster: errors clearly when disputing teams alone exceed the chosen format', () => {
    // 2 teams of 2 players (4) on side A vs 1 team, format 2v2 too small for side A
    const allTeams = [team(1, 2), team(11, 2), team(2, 2)];
    const result = fillBundleRoster({ sideATeamIds: [1, 11], sideBTeamIds: [2], allTeams, format: '2v2' });
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'format-too-small');
});

test('fillBundleRoster: errors clearly when there are not enough uninvolved players to fill the format', () => {
    const allTeams = [team(1, 1), team(2, 1)]; // no uninvolved teams at all
    const result = fillBundleRoster({ sideATeamIds: [1], sideBTeamIds: [2], allTeams, format: '3v3' });
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'not-enough-players');
    assert.strictEqual(result.error.perSide, 3);
});

test('fillBundleRoster: errors on unrecognized/asymmetric format', () => {
    const allTeams = [team(1, 2), team(2, 2)];
    const result = fillBundleRoster({ sideATeamIds: [1], sideBTeamIds: [2], allTeams, format: '2v3' });
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'bad-format');
});

// ---------------------------------------------------------------------------
// resolveBundleDisputes
// ---------------------------------------------------------------------------

test('resolveBundleDisputes: challenger on winning side takes the hex', () => {
    const disputes = [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }];
    const outcomes = resolveBundleDisputes({ disputes, sideA: [1], sideB: [2], winningSide: 'A' });
    assert.strictEqual(outcomes.length, 1);
    assert.strictEqual(outcomes[0].outcome, 'challenger_won');
    assert.strictEqual(outcomes[0].newOwnerTeamId, 1);
});

test('resolveBundleDisputes: defender on winning side keeps the hex', () => {
    const disputes = [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }];
    const outcomes = resolveBundleDisputes({ disputes, sideA: [1], sideB: [2], winningSide: 'B' });
    assert.strictEqual(outcomes[0].outcome, 'defender_won');
    assert.strictEqual(outcomes[0].newOwnerTeamId, 2);
});

test('resolveBundleDisputes: worked example — every dispute gets a consistent, independently-correct outcome from one result', () => {
    // Team5->Team1, Team1->Team2, Team2->Team3 ; bipartition {1,3} vs {2,5}
    const disputes = [
        { challengerTeamId: 5, defenderTeamId: 1, hexCoord: 'hexA' },
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'hexB' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'hexC' }
    ];
    const sideA = [1, 3];
    const sideB = [2, 5];

    // Side A (1,3) wins: dispute1 challenger(5) is on B (loses) -> defender(1) keeps hexA
    //                    dispute2 challenger(1) is on A (wins) -> takes hexB from 2
    //                    dispute3 challenger(2) is on B (loses) -> defender(3) keeps hexC
    const winA = resolveBundleDisputes({ disputes, sideA, sideB, winningSide: 'A' });
    assert.deepStrictEqual(winA.map(o => [o.hexCoord, o.outcome, o.newOwnerTeamId]), [
        ['hexA', 'defender_won', 1],
        ['hexB', 'challenger_won', 1],
        ['hexC', 'defender_won', 3]
    ]);

    // Side B (2,5) wins: dispute1 challenger(5) on B (wins) -> takes hexA from 1
    //                    dispute2 challenger(1) on A (loses) -> defender(2) keeps hexB
    //                    dispute3 challenger(2) on B (wins) -> takes hexC from 3
    const winB = resolveBundleDisputes({ disputes, sideA, sideB, winningSide: 'B' });
    assert.deepStrictEqual(winB.map(o => [o.hexCoord, o.outcome, o.newOwnerTeamId]), [
        ['hexA', 'challenger_won', 5],
        ['hexB', 'defender_won', 2],
        ['hexC', 'challenger_won', 2]
    ]);
});

// ---------------------------------------------------------------------------
// buildChallengeBundle (integration of the three pieces)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// resolveBundleFromQueueEntry — the winnerIndex(0/1) -> bundleSideA/B
// mapping contract admin.js's confirmResult() and result-manager.js's
// ResultManager.confirmResult() both rely on. See admin.js's
// confirmChallengeBundleSetup(): queueEntry.teams is always built as
// [TEAM_A (bundleSideA), TEAM_B (bundleSideB)], so winnerIndex 0 must
// resolve exactly like resolveBundleDisputes(..., winningSide: 'A') and
// winnerIndex 1 exactly like winningSide: 'B'.
// ---------------------------------------------------------------------------

test('resolveBundleFromQueueEntry: winnerIndex 0 resolves identically to winningSide "A"', () => {
    const queueEntry = {
        bundleDisputes: [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }],
        bundleSideA: [1],
        bundleSideB: [2]
    };
    const viaIndex = resolveBundleFromQueueEntry(queueEntry, 0);
    const viaSide = resolveBundleDisputes({
        disputes: queueEntry.bundleDisputes, sideA: queueEntry.bundleSideA, sideB: queueEntry.bundleSideB, winningSide: 'A'
    });
    assert.deepStrictEqual(viaIndex, viaSide);
    assert.strictEqual(viaIndex[0].outcome, 'challenger_won');
});

test('resolveBundleFromQueueEntry: winnerIndex 1 resolves identically to winningSide "B"', () => {
    const queueEntry = {
        bundleDisputes: [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }],
        bundleSideA: [1],
        bundleSideB: [2]
    };
    const viaIndex = resolveBundleFromQueueEntry(queueEntry, 1);
    const viaSide = resolveBundleDisputes({
        disputes: queueEntry.bundleDisputes, sideA: queueEntry.bundleSideA, sideB: queueEntry.bundleSideB, winningSide: 'B'
    });
    assert.deepStrictEqual(viaIndex, viaSide);
    assert.strictEqual(viaIndex[0].outcome, 'defender_won');
});

test('resolveBundleFromQueueEntry: full worked-example bundle resolves the same via index 0/1 as via side A/B', () => {
    const queueEntry = {
        bundleDisputes: [
            { challengerTeamId: 5, defenderTeamId: 1, hexCoord: 'hexA' },
            { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'hexB' },
            { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'hexC' }
        ],
        bundleSideA: [1, 3],
        bundleSideB: [2, 5]
    };
    assert.deepStrictEqual(
        resolveBundleFromQueueEntry(queueEntry, 0),
        resolveBundleDisputes({ disputes: queueEntry.bundleDisputes, sideA: queueEntry.bundleSideA, sideB: queueEntry.bundleSideB, winningSide: 'A' })
    );
    assert.deepStrictEqual(
        resolveBundleFromQueueEntry(queueEntry, 1),
        resolveBundleDisputes({ disputes: queueEntry.bundleDisputes, sideA: queueEntry.bundleSideA, sideB: queueEntry.bundleSideB, winningSide: 'B' })
    );
});

test('resolveBundleFromQueueEntry: rejects any winnerIndex other than 0 or 1 (a bundle is always exactly 2-sided)', () => {
    const queueEntry = { bundleDisputes: [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }], bundleSideA: [1], bundleSideB: [2] };
    assert.throws(() => resolveBundleFromQueueEntry(queueEntry, 2));
    assert.throws(() => resolveBundleFromQueueEntry(queueEntry, -1));
    assert.throws(() => resolveBundleFromQueueEntry(queueEntry, undefined));
});

test('resolveBundleFromQueueEntry: missing bundleDisputes/sideA/sideB degrade to empty arrays rather than throwing', () => {
    const queueEntry = {};
    assert.deepStrictEqual(resolveBundleFromQueueEntry(queueEntry, 0), []);
    assert.deepStrictEqual(resolveBundleFromQueueEntry(queueEntry, 1), []);
});

test('buildChallengeBundle: happy path returns rosters and bipartition together', () => {
    const allTeams = [team(1, 2), team(2, 2), team(3, 2), team(5, 2), team(9, 2, 'Uninvolved')];
    const disputes = [
        { challengerTeamId: 5, defenderTeamId: 1, hexCoord: 'hexA' },
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'hexB' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'hexC' }
    ];
    // 4 disputing teams (1,2,3,5) each 2p -> sideA/sideB each already have 4 players from 2 teams -> 4v4 fits exactly
    const result = buildChallengeBundle({ disputes, allTeams, format: '4v4' });
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.sideAPlayers.length, 4);
    assert.strictEqual(result.sideBPlayers.length, 4);
    assert.deepStrictEqual(result.splitTeamIds, []);
});

test('buildChallengeBundle: surfaces the odd-cycle error before ever attempting roster fill', () => {
    const allTeams = [team(1, 2), team(2, 2), team(3, 2)];
    const disputes = [
        { challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' },
        { challengerTeamId: 2, defenderTeamId: 3, hexCoord: 'h2' },
        { challengerTeamId: 3, defenderTeamId: 1, hexCoord: 'h3' }
    ];
    const result = buildChallengeBundle({ disputes, allTeams, format: '5v5' });
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'odd-cycle');
});

test('buildChallengeBundle: surfaces the not-enough-players error after a successful bipartition', () => {
    const allTeams = [team(1, 2), team(2, 2)];
    const disputes = [{ challengerTeamId: 1, defenderTeamId: 2, hexCoord: 'h1' }];
    const result = buildChallengeBundle({ disputes, allTeams, format: '5v5' });
    assert.ok(result.error);
    assert.strictEqual(result.error.type, 'not-enough-players');
});
