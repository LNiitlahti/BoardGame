/**
 * Board Module - Reusable hex grid logic
 * Handles hex coordinate math, neighbor detection, and board state
 */

class BoardModule {
    constructor(scale = 1) {
        this.scale = scale;
        this.hexSize = 32 * scale; // Increased from 30 to reduce gaps
        this.centerOffset = { x: 375 * scale, y: 375 * scale };
        
        // Define special locations (fixed)
        this.startingLocations = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];
        this.centerLocation = 'q0r0';

        // Define heart hexes (matching physical board)
        // Side hearts give +1 VP per game when controlled
        this.sideHeartLocations = ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4'];
        // Mountain heart (center) gives +2 VP per game when controlled
        this.mountainHeartLocation = 'q0r0';

        // Room hexes (admin-defined during tournament setup)
        // When a team places a tile on a room, they draw a spell card
        this.roomHexes = []; // Loaded from tournament data
    }

    /**
     * Generate all valid hex coordinates for a 91-hex board
     * Uses axial coordinates (q, r) where -5 <= q, r <= 5 and -5 <= q+r <= 5
     */
    generateHexCoordinates() {
        const coordinates = [];
        for (let q = -5; q <= 5; q++) {
            const r1 = Math.max(-5, -q - 5);
            const r2 = Math.min(5, -q + 5);
            for (let r = r1; r <= r2; r++) {
                coordinates.push([q, r]);
            }
        }
        return coordinates;
    }

    /**
     * Convert hex axial coordinates (q, r) to pixel position (x, y)
     * Uses flat-top hexagon orientation
     * Formula: x = s * (3/2) * q, y = s * √3 * (r + q/2)
     */
    hexToPixel(q, r) {
        const s = this.hexSize;
        const x = s * (3/2) * q;
        const y = s * Math.sqrt(3) * (r + q/2);
        return [x + this.centerOffset.x, y + this.centerOffset.y];
    }

    /**
     * Convert pixel position to hex axial coordinates
     * Returns [q, r] or null if outside valid range
     */
    pixelToHex(x, y) {
        const size = this.hexSize;
        const relX = x - this.centerOffset.x;
        const relY = y - this.centerOffset.y;
        
        const q = (2/3 * relX) / size;
        const r = (-1/3 * relX + Math.sqrt(3)/3 * relY) / size;
        
        return this.hexRound(q, r);
    }

    /**
     * Round fractional hex coordinates to nearest valid hex
     */
    hexRound(q, r) {
        const s = -q - r;
        
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);
        
        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);
        
        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        }
        
        return [rq, rr];
    }

    /**
     * Get the 6 neighboring hex coordinates
     * Returns array of coordinate strings like "q1r2"
     */
    getHexNeighbors(q, r) {
        const directions = [
            [1, 0], [1, -1], [0, -1],
            [-1, 0], [-1, 1], [0, 1]
        ];
        
        return directions.map(([dq, dr]) => {
            const nq = q + dq;
            const nr = r + dr;
            return `q${nq}r${nr}`;
        }).filter(coord => {
            // Check if within board bounds
            const matches = coord.match(/-?\d+/g);
            if (!matches) return false;
            const [nq, nr] = matches.map(Number);
            return Math.abs(nq) <= 5 && Math.abs(nr) <= 5 && Math.abs(nq + nr) <= 5;
        });
    }

    /**
     * Get distance between two hexes (in hex steps)
     */
    getHexDistance(q1, r1, q2, r2) {
        return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
    }

    /**
     * Check if coordinates are within valid board bounds
     */
    isValidHex(q, r) {
        return Math.abs(q) <= 5 && Math.abs(r) <= 5 && Math.abs(q + r) <= 5;
    }

    /**
     * Get hex type (normal, starting-location, side-heart, mountain-heart, room)
     */
    getHexType(q, r) {
        const coord = `q${q}r${r}`;

        // Priority order (hearts and starting squares cannot be rooms)
        if (coord === this.mountainHeartLocation) return 'mountain-heart';
        if (this.startingLocations.includes(coord)) return 'starting-location';
        if (this.sideHeartLocations.includes(coord)) return 'side-heart';
        if (this.roomHexes.includes(coord)) return 'room';

        return 'normal';
    }

    /**
     * Get passive income value for a hex.
     * Reads HEART_INCOME so the values live in exactly one place —
     * see calculateHeartIncome() below and docs/architecture/scoring.md.
     */
    getHexValue(q, r) {
        return HEART_INCOME[this.getHexType(q, r)] || 0;
    }

    /**
     * Check if a team can place at given coordinates
     * teamPlates: array of coordinate strings ["q1r2", "q2r3", ...]
     */
    canPlaceAt(q, r, teamPlates, occupiedHexes) {
        const coord = `q${q}r${r}`;
        
        // Check if hex is already occupied
        if (occupiedHexes && occupiedHexes.includes(coord)) {
            return false;
        }
        
        // If no plates yet, can only place at starting corners
        if (teamPlates.length === 0) {
            return this.startingLocations.includes(coord);
        }
        
        // Check adjacency to existing plates
        const neighbors = this.getHexNeighbors(q, r);
        return neighbors.some(neighborCoord => teamPlates.includes(neighborCoord));
    }

    /**
     * Get all valid placement positions for a team
     */
    getValidPlacements(teamPlates, occupiedHexes) {
        const validPlacements = [];
        const coordinates = this.generateHexCoordinates();
        
        coordinates.forEach(([q, r]) => {
            if (this.canPlaceAt(q, r, teamPlates, occupiedHexes)) {
                validPlacements.push({ 
                    q, 
                    r, 
                    coord: `q${q}r${r}`,
                    value: this.getHexValue(q, r)
                });
            }
        });
        
        return validPlacements;
    }

    // calculateTeamPoints() was DELETED 2026-08-04. It summed getHexValue()
    // (heart income: mountain 2, side 1, normal 0) over every hex a team
    // owned — a board-derived scoring model that was never adopted. Its only
    // caller, BoardManager.calculatePoints(), was itself dead and has also
    // been removed. Real scoring lives in admin.js's confirmResult() /
    // awardRoundPoints(); see docs/architecture/scoring.md.
    // getHexValue() is KEPT: still used by getValidPlacements() above and by
    // tools/spell-generator.html.

    /**
     * Set room hexes (admin-defined during setup)
     * @param {Array<string>} roomCoords - Array of coordinate strings like "q1r2"
     */
    setRoomHexes(roomCoords) {
        // Validate that rooms don't overlap with heart hexes
        const invalidRooms = roomCoords.filter(coord =>
            this.sideHeartLocations.includes(coord) ||
            coord === this.mountainHeartLocation
        );

        if (invalidRooms.length > 0) {
            console.warn('[BoardModule] Rooms cannot overlap with heart hexes:', invalidRooms);
            this.roomHexes = roomCoords.filter(coord => !invalidRooms.includes(coord));
        } else {
            this.roomHexes = [...roomCoords];
        }

        console.log('[BoardModule] Room hexes configured:', this.roomHexes);
    }

    /**
     * Get all hexes in a ring around a center hex
     */
    getHexRing(centerQ, centerR, radius) {
        const results = [];
        
        if (radius === 0) {
            return [[centerQ, centerR]];
        }
        
        let q = centerQ - radius;
        let r = centerR + radius;
        
        const directions = [
            [1, 0], [0, -1], [-1, -1],
            [-1, 0], [0, 1], [1, 1]
        ];
        
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < radius; j++) {
                if (this.isValidHex(q, r)) {
                    results.push([q, r]);
                }
                q += directions[i][0];
                r += directions[i][1];
            }
        }
        
        return results;
    }
}

/**
 * Points per MATCH HELD THROUGH for each heart type. A heart pays for every
 * scoring match whose confirm-time control snapshot shows you holding it —
 * see calculateHeartIncome(). The only place these numbers live;
 * getHexValue() and calculateHeartIncome() both read them.
 */
const HEART_INCOME = Object.freeze({
    'mountain-heart': 2,
    'side-heart': 1
});

/**
 * A normal round has two match slots. Used ONLY by projectRoundsToWin() to
 * turn per-match income into an expected per-round pace — the actual payout
 * never assumes this, it counts the matches that really happened.
 */
const TYPICAL_MATCHES_PER_ROUND = 2;

/**
 * How many scoring matches a round actually contained.
 *
 * This is a GATE, not a multiplier: a round in which nothing was played pays
 * no heart income at all, but a round with four matches pays exactly the same
 * as a round with one. Only matches a team could win count — challenge matches
 * award nothing (they move hex control, not score) and breaks are not matches.
 *
 * Counts from gameHistory, which is append-only and survives queue clears.
 * confirmResult() stamps `roundNumber` onto every history entry from the queue
 * entry's own tag; see docs/architecture/scoring.md.
 *
 * @param {Object} gameState
 * @param {number} roundNumber - the round being paid for (the one that just ended)
 * @returns {number} count of scoring matches in that round
 */
function scoringMatchesInRound(gameState, roundNumber) {
    if (!gameState || roundNumber === undefined || roundNumber === null) return [];

    return (gameState.gameHistory || []).filter(entry =>
        entry &&
        !entry.isChallenge &&
        !entry.isBreak &&
        // Untagged entries (pre-phase-flow matches, stamped `roundNumber: null`)
        // belong to no round. Without this guard `Number(null) === 0` matches
        // them all whenever roundNumber is 0 — which is exactly what the
        // previews pass during round 1, so a round that pays nothing would
        // preview a full backlog's worth of income.
        entry.roundNumber !== null &&
        entry.roundNumber !== undefined &&
        Number(entry.roundNumber) === Number(roundNumber)
    );
}

function countScoringMatchesInRound(gameState, roundNumber) {
    return scoringMatchesInRound(gameState, roundNumber).length;
}

/**
 * Heart income for every team, for one round.
 *
 * THE single heart-income calculation. Payouts (admin.js, stats-manager.js)
 * and previews (stats-manager.js's Next Round modal, display-manager.js's
 * live panel on view.html, the adapter's Award Points dialog) all call this,
 * so a preview can never promise a different number than the payout delivers.
 * It used to be written out six times, and the copies drifted.
 *
 * The rule: a heart pays for every scoring match it was HELD THROUGH —
 * +1 per side heart, +2 for the mountain heart, per match. "Held through"
 * is judged by the control snapshot confirmResult() stamps onto each history
 * entry (heartControlSnapshot), so a heart captured mid-round pays only for
 * the matches confirmed after the capture, and a heart that changed hands
 * pays each holder for their own matches. Entries without a snapshot
 * (confirmed before stamping existed) are judged by current control.
 *
 * Still paid once per round, at the scoring_hex phase, guarded against
 * double-award by pointsHistory. Hearts under an unresolved challenge are
 * frozen for the whole round. A round with no scoring matches pays nothing.
 *
 * @param {Object} gameState
 * @param {Object} boardModule - a BoardModule instance, for getHexType()
 * @param {number} roundNumber - the round being paid for (the one that ended)
 * @returns {{
 *   roundPlayed: boolean,
 *   matchesPlayed: number,
 *   byTeam: Object<string, {points: number, mountainCount: number, sideCount: number}>
 * }}
 * byTeam counts are heart-match credits: a mountain heart held through two
 * matches is mountainCount 2 (and +4 points).
 */
function calculateHeartIncome(gameState, boardModule, roundNumber) {
    const teams = gameState?.teams || [];
    const byTeam = {};
    teams.forEach(team => {
        byTeam[team.id] = { points: 0, mountainCount: 0, sideCount: 0 };
    });

    const matches = scoringMatchesInRound(gameState, roundNumber);
    const matchesPlayed = matches.length;
    const roundPlayed = matchesPlayed > 0;

    if (!gameState || !boardModule || !roundPlayed) {
        return { roundPlayed, matchesPlayed, byTeam };
    }

    // Hexes under an unresolved challenge pay nobody — not the holder, not
    // the challenger, and not even for matches they were held through. The
    // income is withheld until the dispute settles.
    const contestedHexes = new Set();
    (gameState.gameQueue || []).forEach(m => {
        if (m && m.isChallenge && m.challengeHexCoord &&
            (m.status === 'pending' || m.status === 'ongoing')) {
            contestedHexes.add(m.challengeHexCoord);
        }
    });

    const teamIds = new Set(teams.map(t => t.id));

    matches.forEach(match => {
        const control = match.heartControlSnapshot || gameState.heartHexControl || {};
        Object.entries(control).forEach(([coord, ownerId]) => {
            if (contestedHexes.has(coord)) return;
            if (!teamIds.has(ownerId)) return;

            const m = coord.match(/q(-?\d+)r(-?\d+)/);
            if (!m) return;

            const hexType = boardModule.getHexType(parseInt(m[1]), parseInt(m[2]));
            const value = HEART_INCOME[hexType];
            if (!value) return;

            const entry = byTeam[ownerId];
            entry.points += value;
            if (hexType === 'mountain-heart') entry.mountainCount++;
            else entry.sideCount++;
        });
    });

    return { roundPlayed, matchesPlayed, byTeam };
}

/**
 * How many more rounds each team needs to reach gameState.winCondition on
 * heart income alone.
 *
 * A FLOOR, not a forecast: match wins and hearts not yet captured are
 * excluded because they can't be known. The contested-heart freeze is
 * deliberately ignored too — a projection is about steady state, and a
 * dispute resolves. Income is per match held through, so the per-round pace
 * assumes TYPICAL_MATCHES_PER_ROUND matches and uninterrupted control.
 * Teams holding no hearts get `roundsToWin: null` and sort last; callers
 * render them as an em dash rather than Infinity.
 *
 * @param {Object} gameState
 * @param {Object} boardModule - a BoardModule instance, for getHexType()
 * @returns {Array<{teamId, teamName, points, incomePerRound, roundsToWin}>}
 *          sorted by soonest-to-win first
 */
function projectRoundsToWin(gameState, boardModule) {
    const target = gameState?.winCondition || 0;
    const teams = gameState?.teams || [];
    if (!target || !boardModule) return [];

    const control = Object.entries(gameState.heartHexControl || {});

    return teams.map(team => {
        let incomePerMatch = 0;
        control.forEach(([coord, ownerId]) => {
            if (ownerId !== team.id) return;
            const m = coord.match(/q(-?\d+)r(-?\d+)/);
            if (!m) return;
            incomePerMatch += HEART_INCOME[
                boardModule.getHexType(parseInt(m[1]), parseInt(m[2]))
            ] || 0;
        });
        const incomePerRound = incomePerMatch * TYPICAL_MATCHES_PER_ROUND;

        const points = team.points || 0;
        const deficit = Math.max(0, target - points);
        const roundsToWin = deficit === 0
            ? 0
            : (incomePerRound > 0 ? Math.ceil(deficit / incomePerRound) : null);

        return {
            teamId: team.id,
            teamName: team.name || `Team ${team.id}`,
            points,
            incomePerRound,
            roundsToWin
        };
    }).sort((a, b) => {
        if (a.roundsToWin === null && b.roundsToWin === null) return 0;
        if (a.roundsToWin === null) return 1;
        if (b.roundsToWin === null) return -1;
        return a.roundsToWin - b.roundsToWin;
    });
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.BoardModule = BoardModule;
    window.countScoringMatchesInRound = countScoringMatchesInRound;
    window.calculateHeartIncome = calculateHeartIncome;
    window.projectRoundsToWin = projectRoundsToWin;
    window.HEART_INCOME = HEART_INCOME;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardModule;
    module.exports.countScoringMatchesInRound = countScoringMatchesInRound;
    module.exports.calculateHeartIncome = calculateHeartIncome;
    module.exports.projectRoundsToWin = projectRoundsToWin;
    module.exports.HEART_INCOME = HEART_INCOME;
}