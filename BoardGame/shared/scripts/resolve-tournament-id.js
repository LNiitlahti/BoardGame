/**
 * resolveTournamentId — shared URL-param-then-cache lookup for the active
 * tournament, used by every page's init bootstrap (god/admin/view).
 *
 * Centralized because a page landing without a URL param (stale bookmark,
 * a nav link that forgot to carry the id, browser autocomplete) should
 * still pick up the tournament the navbar/localStorage already has cached,
 * instead of silently rendering an empty page.
 *
 * `legacyParamNames` (optional): old query-param names (`tournament`,
 * `gameId`, `game`, ...) that used to be accepted aliases for the
 * canonical `tournamentId` and no longer are. If any is present in the
 * URL, a console.warn is logged (dev-facing only — never surfaced in the
 * UI) so a stale bookmark or link silently falls through to `cached`/null
 * exactly as if the param were absent, instead of resolving from it.
 */
function resolveTournamentId({ search, paramNames, cached, legacyParamNames }) {
    const params = new URLSearchParams(search || '');

    if (legacyParamNames) {
        const legacyName = legacyParamNames.find(name => params.has(name));
        if (legacyName) {
            console.warn(`[resolveTournamentId] Ignoring legacy query param "${legacyName}" — use "tournamentId" instead.`);
        }
    }

    for (const name of paramNames) {
        const value = params.get(name);
        if (value) return value;
    }
    return cached || null;
}

if (typeof window !== 'undefined') window.resolveTournamentId = resolveTournamentId;
if (typeof module !== 'undefined' && module.exports) module.exports = { resolveTournamentId };
