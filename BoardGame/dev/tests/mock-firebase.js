/**
 * Offline Firebase for UI tests: zero Firestore reads/writes.
 *
 * The pages load the Firebase compat SDK from gstatic via
 * shared/scripts/firebase-loader.js. installMockFirebase() intercepts those
 * SDK URLs and serves an in-memory fake (FAKE_SDK below) instead, so the real
 * loader and page code run unchanged against a synthetic store. Every request
 * to a Google API host is aborted and counted: callers assert that
 * `blockedGoogleRequests()` stays 0, which guarantees the test cost nothing.
 *
 * Usage:
 *   const mock = await installMockFirebase(page, { uid: 'demo-player' });
 *   await page.goto(...);
 *   mock.blockedGoogleRequests(); // -> [] when nothing tried to reach Google
 *
 * Writes made by the page land in the in-memory store and fire listeners, so
 * interactions (drink counter, queue reorder...) behave, but nothing persists
 * past the page.
 */

const DEMO_TID = 'demo';

// ---------------------------------------------------------------------------
// Demo data (synthetic only, never copy production docs or emails in here)
// ---------------------------------------------------------------------------

function hexCoordsV2() {
    const R = 7, out = [];
    for (let q = -R; q <= R; q++) {
        for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) out.push(`q${q}r${r}`);
    }
    return out;
}

function buildDemoStore() {
    const now = Date.now();
    const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
    const ts = (minsAgo) => ({ seconds: Math.floor((now - minsAgo * 60000) / 1000), nanoseconds: 0 });

    // Long names on purpose: mobile layouts must survive them.
    const teams = [
        { id: 1, name: 'Crimson Wolves of the North', color: '#de392c', points: 30, gamesWon: 9 },
        { id: 2, name: 'Azure Hawks', color: '#2278a3', points: 24, gamesWon: 7 },
        { id: 3, name: 'Emerald Serpents', color: '#2e9158', points: 21, gamesWon: 6 },
        { id: 4, name: 'Golden Lions Esports Club', color: '#f7ba32', points: 12, gamesWon: 4 },
        { id: 5, name: 'Violet Phantoms', color: '#9b59b6', points: 10, gamesWon: 3 },
    ];
    const names = ['Lansen', 'Riktor', 'Vexalandrion', 'Nira', 'Torque', 'Sable', 'Kael', 'Miraculous', 'Dusk', 'Ember'];
    teams.forEach((t, i) => {
        t.splitCount = 2; t.challengeSplitCount = 0;
        t.players = [0, 1].map(k => {
            const n = i * 2 + k;
            // p1 is the logged-in demo player (team.html checks players[].uid)
            const uid = n === 0 ? 'demo-player' : `demo-user-${n + 1}`;
            return { id: `p${n + 1}`, name: names[n], uid, userId: uid };
        });
    });

    const players = {}, playerRegistry = {};
    teams.forEach(t => t.players.forEach(p => {
        players[p.id] = { id: p.id, name: p.name, teamId: t.id, uid: p.uid, userId: p.uid };
        playerRegistry[p.id] = { id: p.id, name: p.name, teamId: t.id, uid: p.uid, userId: p.uid };
    }));
    const mk = (pid) => {
        const p = players[pid], t = teams.find(x => x.id === p.teamId);
        return { id: p.id, name: p.name, originalTeamId: t.id, originalTeamColor: t.color, teamColor: t.color,
                 teamName: t.name, originalTeamName: t.name };
    };

    // Version 2 board: each team owns a wedge, centre and a few hexes neutral.
    const board = {};
    hexCoordsV2().forEach((c, i) => {
        const [, q, r] = /q(-?\d+)r(-?\d+)/.exec(c).map(Number);
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        if (ring <= 1 || i % 7 === 0) return;
        const angle = Math.atan2(r + q / 2, q * 0.866);
        board[c] = 1 + Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 5) % 5;
    });

    const side = (ids) => ({ playerIds: ids, players: ids.map(mk) });
    const match = (id, game, playType, status, a, b, extra = {}) => ({
        id, matchNumber: id - 1000, game, gameType: game, playType, status, isChallenge: false,
        teams: [{ id: 'TEAM_A', ...side(a) }, { id: 'TEAM_B', ...side(b) }],
        roundNumber: 3, slot: 1, createdAt: iso(30), ...extra,
    });
    const gameQueue = [
        match(1001, 'cs2', '5v5', 'completed', ['p1', 'p3', 'p5', 'p7', 'p9'], ['p2', 'p4', 'p6', 'p8', 'p10'],
            { winningSide: 'A', winnerIndex: 0, roundNumber: 2, startedAt: iso(120), completedAt: iso(90) }),
        match(1002, 'aoe4', '3v3', 'completed', ['p2', 'p4', 'p5'], ['p1', 'p3', 'p6'],
            { winningSide: 'B', winnerIndex: 1, roundNumber: 2, startedAt: iso(80), completedAt: iso(55) }),
        match(1003, 'valorant', '5v5', 'ongoing', ['p1', 'p4', 'p6', 'p8', 'p9'], ['p2', 'p3', 'p5', 'p7', 'p10'],
            { startedAt: iso(5) }),
        match(1004, 'cs2', '2v2', 'pending', ['p1', 'p2'], ['p7', 'p8'], { slot: 2 }),
        match(1005, 'aoe4', '3v3', 'pending', ['p3', 'p5', 'p9'], ['p4', 'p6', 'p10'], { slot: 2 }),
    ];

    // Same shape the result flow writes (player IDs, tournamentRound).
    const gameHistory = gameQueue.filter(m => m.status === 'completed').map(m => ({
        ...m, gameId: m.game, timestamp: m.completedAt, round: m.roundNumber, tournamentRound: m.roundNumber,
        winningPlayerIds: m.teams[m.winnerIndex].playerIds, losingPlayerIds: m.teams[1 - m.winnerIndex].playerIds,
        winningPlayers: m.teams[m.winnerIndex].players, losingPlayers: m.teams[1 - m.winnerIndex].players,
        matchDuration: { durationMinutes: 25 },
    }));

    const tournament = {
        tournamentId: DEMO_TID, id: DEMO_TID,
        name: 'Demo Cup 2026', friendlyName: 'Demo Cup 2026',
        status: 'playing', phase: 'matches_in_progress',
        currentPhase: { name: 'matches_in_progress', roundNumber: 3, startedAt: iso(10), slots: { 1: 'playing', 2: 'setup' } },
        currentRound: 3, gamesPlayed: 2, boardVersion: 2, winningPoints: 50,
        teams, players, playerRegistry, gameQueue, gameHistory,
        selectedGames: ['cs2', 'aoe4', 'valorant'],
        gameDefinitions: {
            cs2: { id: 'cs2', name: 'Counter-Strike 2' },
            aoe4: { id: 'aoe4', name: 'Age of Empires IV' },
            valorant: { id: 'valorant', name: 'Valorant' },
        },
        board, heartHexControl: {}, rooms: [], seatingOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        smartMatchState: {}, pointsHistory: [], seasonId: 'demo-season',
        createdAt: iso(60 * 24), startedAt: iso(240), updatedAt: iso(1),
    };

    const eventLog = {};
    gameHistory.forEach((m, i) => {
        eventLog[`e${i + 1}`] = {
            type: 'game_win', gameName: tournament.gameDefinitions[m.game].name, playType: m.playType,
            winningSide: m.winningSide, isChallenge: false, teamsCount: 2, round: m.roundNumber,
            winningPlayers: m.winningPlayers, losingPlayers: m.losingPlayers, timestamp: ts(60 + i * 30),
        };
    });

    const user = (uid, extra) => ({
        uid, email: `${uid}@demo.invalid`, displayName: extra.firstName, fullName: `${extra.firstName} Demo`,
        lastName: 'Demo', isAdmin: false, isSuperAdmin: false, isGod: false,
        assignedTournamentId: null, assignedTeamId: null, assignedTeamName: null, assignedPlayerId: null,
        createdAt: iso(60 * 24 * 30), lastLogin: iso(5), ...extra,
    });

    const store = {
        [`tournaments/${DEMO_TID}`]: tournament,
        'users/demo-td': user('demo-td', { firstName: 'Admin', isAdmin: true, isSuperAdmin: true, isGod: true, role: 'admin' }),
        'users/demo-player': user('demo-player', {
            firstName: 'Lansen', assignedTournamentId: DEMO_TID, assignedTeamId: 1,
            assignedTeamName: teams[0].name, assignedPlayerId: 'p1', isPlayer: true,
        }),
        'seasons/demo-season': {
            id: 'demo-season', name: 'Season #1 - Demo Mountain', status: 'active',
            tournamentIds: [DEMO_TID], plannedTournaments: 4, createdAt: iso(60 * 24 * 60),
        },
    };
    const onboarding = { players: {}, secretHash: '', _migrated_to_ids: true };
    Object.keys(players).forEach((pid, i) => {
        onboarding.players[pid] = {
            friendsAdded: Object.fromEntries(Object.keys(players).filter(o => o !== pid).slice(0, i % 6).map(o => [o, true])),
            gamesTested: i % 2 ? { cs2: true } : {},
            lastUpdated: i % 3 ? iso(10) : null,
            completedAt: null,
        };
    });
    store[`tournaments/${DEMO_TID}/onboarding/state`] = onboarding;
    Object.entries(eventLog).forEach(([id, d]) => { store[`tournaments/${DEMO_TID}/eventLog/${id}`] = d; });
    return store;
}

// ---------------------------------------------------------------------------
// Fake compat SDK (runs in the page; must be self-contained)
// ---------------------------------------------------------------------------

const FAKE_SDK = String.raw`
(function () {
  if (window.firebase && window.firebase.__mock) return;
  const store = window.__MOCK_STORE__ || {};
  const log = window.__mockLog = [];
  const listeners = new Set();
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  class Timestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
    static now() { return Timestamp.fromMillis(Date.now()); }
    static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  }
  // Stored {seconds, nanoseconds} objects come back as Timestamps.
  function revive(v) {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      const k = Object.keys(v);
      if (k.length === 2 && 'seconds' in v && 'nanoseconds' in v) return new Timestamp(v.seconds, v.nanoseconds);
      const o = {}; for (const key of k) o[key] = revive(v[key]); return o;
    }
    return v;
  }
  function getField(obj, path) {
    return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  const SENTINEL = '__mockFieldValue';
  const FieldValue = {
    serverTimestamp: () => ({ [SENTINEL]: 'ts' }),
    delete: () => ({ [SENTINEL]: 'delete' }),
    increment: (n) => ({ [SENTINEL]: 'inc', n }),
    arrayUnion: (...items) => ({ [SENTINEL]: 'union', items }),
    arrayRemove: (...items) => ({ [SENTINEL]: 'remove', items }),
  };
  function applyValue(prev, v) {
    if (v instanceof Timestamp) return { seconds: v.seconds, nanoseconds: v.nanoseconds };
    if (v instanceof Date) return { seconds: Math.floor(v.getTime() / 1000), nanoseconds: 0 };
    if (!v || typeof v !== 'object') return v;
    if (v[SENTINEL] === 'ts') { const t = Timestamp.now(); return { seconds: t.seconds, nanoseconds: t.nanoseconds }; }
    if (v[SENTINEL] === 'inc') return (typeof prev === 'number' ? prev : 0) + v.n;
    if (v[SENTINEL] === 'union') {
      const arr = Array.isArray(prev) ? prev.slice() : [];
      v.items.forEach(i => { if (!arr.some(a => JSON.stringify(a) === JSON.stringify(i))) arr.push(clone(i)); });
      return arr;
    }
    if (v[SENTINEL] === 'remove') {
      const drop = v.items.map(i => JSON.stringify(i));
      return (Array.isArray(prev) ? prev : []).filter(a => !drop.includes(JSON.stringify(a)));
    }
    if (Array.isArray(v)) return v.map(x => applyValue(undefined, x));
    const o = {}; for (const k of Object.keys(v)) o[k] = applyValue(undefined, v[k]); return o;
  }
  function setPath(obj, path, v) {
    const keys = String(path).split('.'); let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    const last = keys[keys.length - 1];
    if (v && v[SENTINEL] === 'delete') delete o[last]; else o[last] = applyValue(o[last], v);
  }
  function mergeDeep(target, src) {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !v[SENTINEL] && !(v instanceof Timestamp) && !(v instanceof Date)) {
        if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
        mergeDeep(target[k], v);
      } else if (v && v[SENTINEL] === 'delete') delete target[k];
      else target[k] = applyValue(target[k], v);
    }
  }
  function notify() {
    setTimeout(() => listeners.forEach(l => { try { l(); } catch (e) { console.error('[mock-firebase] listener', e); } }), 0);
  }

  let autoId = 0;
  const newId = () => 'mock' + Date.now().toString(36) + (autoId++);

  class DocSnap {
    constructor(ref) { this.ref = ref; this.id = ref.id; const d = store[ref.path]; this.exists = d !== undefined; this._d = d; }
    data() { return this._d === undefined ? undefined : revive(clone(this._d)); }
    get(f) { return getField(this.data(), f); }
  }
  class QuerySnap {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = !docs.length; }
    forEach(fn) { this.docs.forEach(fn); }
    docChanges() { return this.docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })); }
  }

  class DocRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    get parent() { return new Query(this.path.split('/').slice(0, -1).join('/')); }
    collection(sub) { return new Query(this.path + '/' + sub); }
    get() { log.push('get ' + this.path); return Promise.resolve(new DocSnap(this)); }
    set(data, opts) {
      log.push('set ' + this.path);
      if (opts && (opts.merge || opts.mergeFields)) { store[this.path] = store[this.path] || {}; mergeDeep(store[this.path], data); }
      else store[this.path] = applyValue(undefined, data);
      notify(); return Promise.resolve();
    }
    update(a, ...rest) {
      log.push('update ' + this.path);
      if (store[this.path] === undefined) return Promise.reject(Object.assign(new Error('No document to update: ' + this.path), { code: 'not-found' }));
      const fields = typeof a === 'string' ? { [a]: rest[0] } : a;
      for (let i = 1; typeof a === 'string' && i + 1 < rest.length; i += 2) fields[rest[i]] = rest[i + 1];
      Object.keys(fields).forEach(k => setPath(store[this.path], k, fields[k]));
      notify(); return Promise.resolve();
    }
    delete() { log.push('delete ' + this.path); delete store[this.path]; notify(); return Promise.resolve(); }
    onSnapshot(a, b, c) {
      const next = typeof a === 'function' ? a : (a && a.next) || b;
      log.push('listen ' + this.path);
      const fire = () => { try { next(new DocSnap(this)); } catch (e) { console.error('[mock-firebase] onSnapshot cb', e); } };
      listeners.add(fire); setTimeout(fire, 30);
      return () => listeners.delete(fire);
    }
    isEqual(o) { return o && o.path === this.path; }
  }

  class Query {
    constructor(path, ops) { this.path = path; this.id = path.split('/').pop(); this._ops = ops || []; }
    _with(op) { return new Query(this.path, this._ops.concat([op])); }
    doc(id) { return new DocRef(this.path + '/' + (id || newId())); }
    add(data) { const ref = this.doc(); return ref.set(data).then(() => ref); }
    where(f, op, v) { return this._with({ t: 'where', f: String(f), op, v }); }
    orderBy(f, dir) { return this._with({ t: 'order', f: String(f), dir: dir || 'asc' }); }
    limit(n) { return this._with({ t: 'limit', n }); }
    limitToLast(n) { return this._with({ t: 'limitLast', n }); }
    startAfter() { return this; } startAt() { return this; } endBefore() { return this; } endAt() { return this; }
    _docs() {
      const depth = this.path.split('/').length + 1;
      let refs = Object.keys(store)
        .filter(p => p.startsWith(this.path + '/') && p.split('/').length === depth)
        .map(p => new DocRef(p));
      for (const op of this._ops) {
        if (op.t === 'where') {
          refs = refs.filter(r => {
            const val = op.f === '__name__' ? r.id : getField(store[r.path], op.f);
            switch (op.op) {
              case '==': return JSON.stringify(val) === JSON.stringify(op.v);
              case '!=': return JSON.stringify(val) !== JSON.stringify(op.v);
              case '<': return val < op.v; case '<=': return val <= op.v;
              case '>': return val > op.v; case '>=': return val >= op.v;
              case 'in': return (op.v || []).some(x => JSON.stringify(x) === JSON.stringify(val));
              case 'not-in': return !(op.v || []).some(x => JSON.stringify(x) === JSON.stringify(val));
              case 'array-contains': return Array.isArray(val) && val.some(x => JSON.stringify(x) === JSON.stringify(op.v));
              case 'array-contains-any': return Array.isArray(val) && val.some(x => (op.v || []).some(y => JSON.stringify(x) === JSON.stringify(y)));
              default: return true;
            }
          });
        } else if (op.t === 'order') {
          const key = (r) => { const v = getField(store[r.path], op.f); return v && typeof v === 'object' && 'seconds' in v ? v.seconds : v; };
          refs.sort((x, y) => { const a = key(x), b = key(y); const c = a < b ? -1 : a > b ? 1 : 0; return op.dir === 'desc' ? -c : c; });
        } else if (op.t === 'limit') refs = refs.slice(0, op.n);
        else if (op.t === 'limitLast') refs = refs.slice(-op.n);
      }
      return refs.map(r => new DocSnap(r));
    }
    get() { log.push('query ' + this.path); return Promise.resolve(new QuerySnap(this._docs())); }
    onSnapshot(a, b) {
      const next = typeof a === 'function' ? a : (a && a.next) || b;
      log.push('listenQuery ' + this.path);
      const fire = () => { try { next(new QuerySnap(this._docs())); } catch (e) { console.error('[mock-firebase] onSnapshot cb', e); } };
      listeners.add(fire); setTimeout(fire, 30);
      return () => listeners.delete(fire);
    }
  }

  class Batch {
    constructor() { this.ops = []; }
    set(ref, d, o) { this.ops.push(() => ref.set(d, o)); return this; }
    update(ref, ...a) { this.ops.push(() => ref.update(...a)); return this; }
    delete(ref) { this.ops.push(() => ref.delete()); return this; }
    commit() { return Promise.all(this.ops.map(f => f())).then(() => undefined); }
  }

  const db = {
    collection: (p) => new Query(p),
    doc: (p) => new DocRef(p),
    collectionGroup: (id) => new Query(id),
    batch: () => new Batch(),
    runTransaction: (fn) => fn({
      get: (ref) => ref.get(), set: (r, d, o) => { r.set(d, o); }, update: (r, ...a) => { r.update(...a); }, delete: (r) => { r.delete(); },
    }),
    settings() {}, enablePersistence: () => Promise.resolve(), enableNetwork: () => Promise.resolve(),
    disableNetwork: () => Promise.resolve(),
  };

  // --- auth ---
  let currentUser = window.__MOCK_UID__ ? makeUser(window.__MOCK_UID__) : null;
  const authListeners = new Set();
  function makeUser(uid) {
    const doc = store['users/' + uid] || {};
    return { uid, email: doc.email || uid + '@demo.invalid', displayName: doc.displayName || null, isAnonymous: false,
             emailVerified: true, photoURL: null, getIdToken: () => Promise.resolve('mock-token'),
             getIdTokenResult: () => Promise.resolve({ claims: {} }), reload: () => Promise.resolve() };
  }
  function emitAuth() { authListeners.forEach(cb => setTimeout(() => cb(currentUser), 0)); }
  const auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged(cb) { authListeners.add(cb); setTimeout(() => cb(currentUser), 20); return () => authListeners.delete(cb); },
    onIdTokenChanged(cb) { return this.onAuthStateChanged(cb); },
    setPersistence: () => Promise.resolve(),
    signInWithEmailAndPassword(email) {
      const uid = Object.keys(store).filter(p => p.startsWith('users/')).map(p => p.slice(6))
        .find(u => store['users/' + u].email === email);
      if (!uid) return Promise.reject(Object.assign(new Error('auth/user-not-found'), { code: 'auth/user-not-found' }));
      currentUser = makeUser(uid); emitAuth(); return Promise.resolve({ user: currentUser });
    },
    signInAnonymously() { currentUser = { uid: 'mock-anon', isAnonymous: true, getIdToken: () => Promise.resolve('t') }; emitAuth(); return Promise.resolve({ user: currentUser }); },
    signOut() { currentUser = null; emitAuth(); return Promise.resolve(); },
    createUserWithEmailAndPassword: () => Promise.reject(new Error('mock: signup disabled')),
    sendPasswordResetEmail: () => Promise.resolve(),
  };

  const firestoreFn = () => db;
  firestoreFn.FieldValue = FieldValue;
  firestoreFn.Timestamp = Timestamp;
  firestoreFn.FieldPath = { documentId: () => '__name__' };
  const authFn = () => auth;
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  authFn.GoogleAuthProvider = function () {};
  const app = {
    name: '[DEFAULT]', options: {},
    firestore: firestoreFn, auth: authFn,
    functions: () => ({ httpsCallable: (name) => () => { log.push('callable ' + name); return Promise.resolve({ data: {} }); } }),
  };
  window.firebase = {
    __mock: true, apps: [], SDK_VERSION: 'mock',
    initializeApp() { this.apps = [app]; return app; },
    app: () => app,
    firestore: firestoreFn, auth: authFn, functions: () => app.functions(),
  };
})();
`;

// Firebase backends only: Google Fonts (fonts.googleapis.com / fonts.gstatic.com) is free and allowed.
const GOOGLE_HOSTS = /(^|\.)(firestore|identitytoolkit|securetoken|firebaseinstallations|firebase|firebasestorage|firebaselogging)\.googleapis\.com$|(^|\.)(firebaseio\.com|firebaseapp\.com|cloudfunctions\.net)$/;

async function installMockFirebase(page, { uid = null, store = buildDemoStore() } = {}) {
    const blocked = [];
    await page.evaluateOnNewDocument((s, u) => {
        window.__MOCK_STORE__ = s;
        window.__MOCK_UID__ = u;
    }, store, uid);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        let host = '';
        try { host = new URL(req.url()).hostname; } catch { /* data: etc */ }
        const url = req.url();
        if (url.includes('gstatic.com/firebasejs/')) {
            const body = url.includes('firebase-app-compat') ? FAKE_SDK : '/* mock-firebase: provided by app-compat fake */';
            return req.respond({ status: 200, contentType: 'text/javascript', body });
        }
        if (GOOGLE_HOSTS.test(host)) {
            blocked.push(url);
            return req.abort();
        }
        return req.continue();
    });
    return { blockedGoogleRequests: () => blocked.slice(), store };
}

module.exports = { installMockFirebase, buildDemoStore, DEMO_TID, FAKE_SDK };
