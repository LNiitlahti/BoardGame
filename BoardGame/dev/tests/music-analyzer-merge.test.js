// BoardGame/dev/tests/music-analyzer-merge.test.js
const test = require('node:test');
const assert = require('node:assert');
const { mergeEnvelopes } = require('../music-merge-envelopes.js');

test('mergeEnvelopes: point-wise max of two equal-length envelopes', () => {
    const a = [{ t: 0, amp: 0.2 }, { t: 100, amp: 0.8 }];
    const b = [{ t: 0, amp: 0.5 }, { t: 100, amp: 0.3 }];
    const result = mergeEnvelopes(a, b);
    assert.deepStrictEqual(result, [{ t: 0, amp: 0.5 }, { t: 100, amp: 0.8 }]);
});

test('mergeEnvelopes: shorter array contributes 0 past its own end', () => {
    const a = [{ t: 0, amp: 0.2 }, { t: 100, amp: 0.9 }, { t: 200, amp: 0.4 }];
    const b = [{ t: 0, amp: 0.1 }];
    const result = mergeEnvelopes(a, b);
    assert.deepStrictEqual(result, [
        { t: 0, amp: 0.2 },
        { t: 100, amp: 0.9 },
        { t: 200, amp: 0.4 }
    ]);
});

test('mergeEnvelopes: longer track wins ties on t via its own timestamp', () => {
    const a = [];
    const b = [{ t: 50, amp: 0.7 }];
    const result = mergeEnvelopes(a, b);
    assert.deepStrictEqual(result, [{ t: 50, amp: 0.7 }]);
});
