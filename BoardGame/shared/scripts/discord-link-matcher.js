/**
 * Suggests which guild member a roster player probably is, by comparing the
 * Discord username they typed at onboarding against the cached guild member
 * list.
 *
 * Pure and dependency-free: no DOM, no Firestore, no network. Runs in the
 * browser (god panel) and under node:test unchanged.
 *
 * EXACT match after normalisation only — fuzzy/closest-match suggestion is
 * deliberately not implemented. The whole reason the mover uses confirmed
 * links instead of matching usernames at move time is to eliminate silent
 * wrong matches. A near-miss suggestion is exactly what a human
 * rubber-stamps during a fast "confirm all" pass, which would reintroduce
 * that failure through the back door.
 */

/**
 * Reduce a Discord username to a comparable form: trimmed, no leading '@',
 * no trailing discriminator, lowercased.
 *
 * Handles both the legacy 'name#1234' format and the modern 'name#0'
 * that Discord still emits in some payloads.
 */
function normalizeDiscordName(value) {
    if (typeof value !== 'string') return '';

    let name = value.trim();
    if (name.startsWith('@')) name = name.slice(1);

    // lastIndexOf > 0 so a name that legitimately STARTS with '#' is left
    // alone — only a separator with something before it is a discriminator.
    const hashIndex = name.lastIndexOf('#');
    if (hashIndex > 0) name = name.slice(0, hashIndex);

    return name.trim().toLowerCase();
}

/**
 * Find the single guild member whose username or display name normalises to
 * the same string as `typedName`.
 *
 * Returns null when nothing matches AND when more than one member matches.
 * An ambiguous match is not a suggestion, it is a coin flip — surfacing it
 * as a confident pre-selection is precisely the silent-wrong-match risk this
 * module exists to avoid. The operator picks manually in that case.
 *
 * @param {string} typedName  What the player entered at onboarding
 * @param {Array<{discordUserId: string, username: string, displayName: string}>} members
 * @returns {object|null} the matched member object, or null
 */
function suggestMember(typedName, members) {
    const target = normalizeDiscordName(typedName);
    if (!target) return null;

    const matches = (members || []).filter(member =>
        normalizeDiscordName(member.username) === target ||
        normalizeDiscordName(member.displayName) === target
    );

    return matches.length === 1 ? matches[0] : null;
}

if (typeof window !== 'undefined') {
    window.DiscordLinkMatcher = { normalizeDiscordName, suggestMember };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeDiscordName, suggestMember };
}
