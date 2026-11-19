/**
 * ADMIN LAYOUT — Board mode / Match mode
 *
 * Board mode (board big, queue column narrow) during the phases where the
 * admin works on the board; Match mode (queue column wide) while games are
 * being played. A switch never happens mid-action: while dragging, with a
 * tap-armed item, an open pop-up/menu or a hex-pick mode active, it is held
 * as `pendingMode` and shown as a hint in the command bar.
 *
 * The pure functions below are exported for node:test; the DOM wiring at
 * the bottom only runs in a browser.
 */
(function () {
    const BOARD_PHASES = [
        'scoring_vp', 'scoring_hex',
        'hex_placement_1', 'hex_placement_2',
        'spell_window_1', 'spell_window_2', 'spell_window_3', 'spell_window_4',
        'challenges', 'board_resolved', 'tournament_end'
    ];
    const MATCH_PHASES = ['pre_game_setup', 'matches_in_progress', 'challenge_game', 'round_advance'];

    function phaseToMode(phase) {
        if (BOARD_PHASES.includes(phase)) return 'board';
        if (MATCH_PHASES.includes(phase)) return 'match';
        return null; // 'break', unknown, or no phase: keep the current mode
    }

    function decideMode(state, input) {
        const next = { ...state };
        if (input.phase !== state.lastPhase) {
            next.override = null;
            next.lastPhase = input.phase;
        }
        const wanted = next.override || phaseToMode(input.phase) || state.mode;
        if (wanted === state.mode) {
            next.pendingMode = null;
            return next;
        }
        if (input.busy) {
            next.pendingMode = wanted;
            return next;
        }
        next.mode = wanted;
        next.pendingMode = null;
        return next;
    }

    function toggleOverride(state) {
        const target = state.mode === 'board' ? 'match' : 'board';
        return { ...state, override: target, mode: target, pendingMode: null };
    }

    function applyPending(state) {
        if (!state.pendingMode) return state;
        return { ...state, mode: state.pendingMode, pendingMode: null };
    }

    const api = { BOARD_PHASES, MATCH_PHASES, phaseToMode, decideMode, toggleOverride, applyPending };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // ── Browser wiring is added in Task 7 ──
    window.AdminLayout = api;
})();
