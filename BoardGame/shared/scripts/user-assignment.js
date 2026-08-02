/**
 * A user's Firestore doc (users/{uid}) has exactly one
 * assignedTournamentId/assignedTeamId/assignedPlayerId "pointer" — not a
 * list. A person CAN legitimately be a linked player in more than one
 * tournament at once (each tournament's own roster/registry is a fully
 * separate document); the pointer just tracks whichever tournament linked
 * them most recently, driving home.html's dashboard banner and
 * team-controls.js's no-URL-param bootstrap redirect.
 *
 * Because of that, removing/swapping someone out of a tournament must NOT
 * blindly null the pointer fields — if they've since been linked into a
 * different, newer tournament, the pointer already moved on, and clearing
 * it here would wrongly wipe out that unrelated, more recent assignment.
 * Only clear when the pointer still points at exactly what's being removed.
 */
function shouldClearUserAssignment(userData, { tournamentId, playerId }) {
    if (!userData) return false;
    return userData.assignedTournamentId === tournamentId && userData.assignedPlayerId === playerId;
}

const UserAssignment = { shouldClearUserAssignment };

if (typeof window !== 'undefined') window.UserAssignment = UserAssignment;
if (typeof module !== 'undefined' && module.exports) module.exports = UserAssignment;
