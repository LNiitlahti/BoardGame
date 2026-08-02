/**
 * resolveTournamentId — shared URL-param-then-cache lookup for the active
 * tournament, used by every page's init bootstrap (god/admin/view).
 *
 * Centralized because a page landing without a URL param (stale bookmark,
 * a nav link that forgot to carry the id, browser autocomplete) should
 * still pick up the tournament the navbar/localStorage already has cached,
 * instead of silently rendering an empty page.
 */
function resolveTournamentId({ search, paramNames, cached }) {
    const params = new URLSearchParams(search || '');
    for (const name of paramNames) {
        const value = params.get(name);
        if (value) return value;
    }
    return cached || null;
}

if (typeof window !== 'undefined') window.resolveTournamentId = resolveTournamentId;
if (typeof module !== 'undefined' && module.exports) module.exports = { resolveTournamentId };
