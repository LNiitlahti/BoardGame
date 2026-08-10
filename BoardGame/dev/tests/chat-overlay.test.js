/**
 * Unit coverage for the two pure decisions inside chat-overlay.js, the
 * read-only tournament-chat feed on view.html's big screen.
 *
 *   newMessagesFrom()     - which snapshot changes deserve a toast
 *   resolveSenderIdentity() - whose name and team colour to paint it in
 *
 * Everything else in that file is Firestore subscription and DOM, exercised
 * by dev/tests/e2e-view-chat-overlay.js instead.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../../full/scripts/chat-overlay.js');
const ChatOverlay = global.window.ChatOverlay;

// ---------- newMessagesFrom ----------

test('the first snapshot yields nothing — a fresh page load must not burst the backlog', () => {
    const changes = [
        { type: 'added', id: 'a', data: { text: 'old one' } },
        { type: 'added', id: 'b', data: { text: 'old two' } }
    ];
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom(changes, true), []);
});

test('added changes after the first snapshot are returned in order', () => {
    const changes = [
        { type: 'added', id: 'c', data: { text: 'hello' } },
        { type: 'added', id: 'd', data: { text: 'there' } }
    ];
    const result = ChatOverlay.newMessagesFrom(changes, false);
    assert.deepStrictEqual(result.map(m => m.id), ['c', 'd']);
    assert.strictEqual(result[0].data.text, 'hello');
});

test('modified and removed changes never produce a toast', () => {
    const changes = [
        { type: 'modified', id: 'e', data: { text: 'edited' } },
        { type: 'removed', id: 'f', data: { text: 'deleted' } },
        { type: 'added', id: 'g', data: { text: 'real' } }
    ];
    const result = ChatOverlay.newMessagesFrom(changes, false);
    assert.deepStrictEqual(result.map(m => m.id), ['g']);
});

test('an empty or missing change list is handled without throwing', () => {
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom([], false), []);
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom(undefined, false), []);
});

// ---------- resolveSenderIdentity ----------

const GAME_DATA = {
    teams: [
        {
            id: 1,
            name: 'Tiimi 1',
            color: '#de392c',
            players: [{ id: 'p_aaa', uid: 'uid_aaa', name: 'Wustra' }]
        },
        {
            id: 2,
            name: 'Tiimi 2',
            color: '#2278a3',
            players: [{ id: 'p_bbb', uid: 'uid_bbb', name: 'Touch' }]
        }
    ]
};

test('a linked player gets their roster name and their team colour', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_bbb', 'stale stored name'),
        { name: 'Touch', color: '#2278a3' }
    );
});

test('the roster name wins over the name stored on the message', () => {
    // senderName is frozen at send time; a later rename must still show the
    // current name, the same way _getPlayerCurrentName() works for matches.
    const identity = ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_aaa', 'OldNickname');
    assert.strictEqual(identity.name, 'Wustra');
});

test('an unlinked sender (admin/god/spectator) falls back to the stored name and a neutral colour', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_nobody', 'Inffi (GOD)'),
        { name: 'Inffi (GOD)', color: '#c8b37e' }
    );
});

test('missing gameData or teams does not throw', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(null, 'uid_aaa', 'Someone'),
        { name: 'Someone', color: '#c8b37e' }
    );
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity({}, 'uid_aaa', undefined),
        { name: 'Player', color: '#c8b37e' }
    );
});
