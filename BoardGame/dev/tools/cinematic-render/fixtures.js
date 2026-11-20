// Empty-board snapshots fed to view.html's window.__devPreviewSnapshot in
// render mode. No teams/owners: the cinematic plays at tournament start and
// the video must not contain any tournament-specific data.
function fixture(boardVersion) {
    const base = {
        tournamentName: 'Render',
        teams: [],
        players: {},
        board: {}, rooms: [], lobbyReady: {}, gameQueue: [],
        currentPhase: { name: 'pre_game_setup', roundNumber: 0 }
    };
    return boardVersion === '2' ? { ...base, boardVersion: 2 } : base;
}
module.exports = { fixture };
