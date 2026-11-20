// BoardGame/full/scripts/cinematic/cine-names.js
// Pure schedule for the cinematic's title/player-name overlay. Shared by the
// live timeline (cinematic-controller.js) and the pre-rendered video overlay
// (cine-video.js), so both show names at exactly the same moments.
// Within each window: text changes every intervalMs ([start, end)), cycling
// [title, ...names] with the cycle index continuing across windows; a flicker
// on every vocal beat with start <= beat <= end; a clear at each window end.

const TYPE_ORDER = { text: 0, flicker: 1, clear: 2 };

function schedule({ windows, intervalMs, title, names, vocalBeats }) {
    const cycle = [title, ...(names || [])];
    const events = [];
    let i = 0;
    for (const w of windows || []) {
        for (let at = w.startMs; at < w.endMs; at += intervalMs, i++) {
            events.push({ at, type: 'text', text: cycle[i % cycle.length] });
        }
        for (const beat of vocalBeats || []) {
            if (beat >= w.startMs && beat <= w.endMs) events.push({ at: beat, type: 'flicker' });
        }
        events.push({ at: w.endMs, type: 'clear' });
    }
    return events.sort((a, b) => (a.at - b.at) || (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]));
}

function namesFromGameState(gameState) {
    return ((gameState && gameState.teams) || [])
        .flatMap(team => ((team && team.players) || []).map(p => p && p.name))
        .filter(Boolean);
}

// speedAt(ms) -> flicker speed factor (CineTempo.computeTempo at that time).
function apply(textObj, ev, speedAt) {
    if (ev.type === 'text') textObj.setText(ev.text);
    else if (ev.type === 'flicker') textObj.triggerFlicker(speedAt(ev.at));
    else if (ev.type === 'clear') textObj.setText('');
}

const CineNames = { schedule, namesFromGameState, apply };
if (typeof window !== 'undefined') window.CineNames = CineNames;
if (typeof module !== 'undefined' && module.exports) module.exports = CineNames;
