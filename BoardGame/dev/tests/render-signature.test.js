const test = require('node:test');
const assert = require('node:assert');
const RenderSignature = require('../../shared/scripts/render-signature.js');

test('computeFieldSignature is stable for identical data', () => {
    const data = { name: 'Cup', currentRound: 2, teams: [{ id: 1, points: 3 }] };
    const sig1 = RenderSignature.computeFieldSignature(data);
    const sig2 = RenderSignature.computeFieldSignature(data);
    assert.strictEqual(sig1, sig2);
});

test('computeFieldSignature changes when a non-excluded field changes', () => {
    const before = { name: 'Cup', lobbyReady: { team1: false } };
    const after = { name: 'Cup', lobbyReady: { team1: true } };
    assert.notStrictEqual(
        RenderSignature.computeFieldSignature(before),
        RenderSignature.computeFieldSignature(after)
    );
});

test('computeFieldSignature ignores excluded keys', () => {
    const before = { name: 'Cup', onboarding: { alice: 'eating' } };
    const after = { name: 'Cup', onboarding: { alice: 'smoking' } };
    assert.strictEqual(
        RenderSignature.computeFieldSignature(before, RenderSignature.EXCLUDED_KEYS),
        RenderSignature.computeFieldSignature(after, RenderSignature.EXCLUDED_KEYS)
    );
});

test('computeFieldSignature is independent of key order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    assert.strictEqual(
        RenderSignature.computeFieldSignature(a),
        RenderSignature.computeFieldSignature(b)
    );
});

test('computeBoardSignature changes when board changes', () => {
    const rooms = ['q0r0'];
    const sigBefore = RenderSignature.computeBoardSignature({ q0r0: 1 }, rooms);
    const sigAfter = RenderSignature.computeBoardSignature({ q0r0: 2 }, rooms);
    assert.notStrictEqual(sigBefore, sigAfter);
});

test('computeBoardSignature changes when rooms changes but board does not', () => {
    const board = { q0r0: 1 };
    const sigBefore = RenderSignature.computeBoardSignature(board, ['q0r0']);
    const sigAfter = RenderSignature.computeBoardSignature(board, ['q0r0', 'q1r0']);
    assert.notStrictEqual(sigBefore, sigAfter);
});

test('computeBoardSignature is stable when neither board nor rooms changes', () => {
    const board = { q0r0: 1 };
    const rooms = ['q0r0'];
    assert.strictEqual(
        RenderSignature.computeBoardSignature(board, rooms),
        RenderSignature.computeBoardSignature(board, rooms)
    );
});

test('computeBoardSignature tolerates undefined board/rooms (initial state)', () => {
    assert.strictEqual(
        RenderSignature.computeBoardSignature(undefined, undefined),
        RenderSignature.computeBoardSignature({}, [])
    );
});
