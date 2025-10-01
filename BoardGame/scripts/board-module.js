/**
 * Board Module - Reusable hex grid logic
 * Handles hex coordinate math, neighbor detection, and board state
 */

class BoardModule {
    constructor(scale = 1) {
        this.scale = scale;
        this.hexSize = 32 * scale; // Increased from 30 to reduce gaps
        this.centerOffset = { x: 375 * scale, y: 375 * scale };
        
        // Define special locations
        this.startingLocations = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];
        this.highValueLocations = ['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2'];
        this.centerLocation = 'q0r0';
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
     * Get hex type (normal, starting-location, high-value, center)
     */
    getHexType(q, r) {
        const coord = `q${q}r${r}`;
        
        if (this.startingLocations.includes(coord)) return 'starting-location';
        if (this.highValueLocations.includes(coord)) return 'high-value';
        if (coord === this.centerLocation) return 'center';
        
        return 'normal';
    }

    /**
     * Get point value for a hex
     */
    getHexValue(q, r) {
        const type = this.getHexType(q, r);
        if (type === 'high-value' || type === 'center') return 2;
        return 1;
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

    /**
     * Calculate total points for a team
     */
    calculateTeamPoints(teamPlates) {
        let points = 0;
        teamPlates.forEach(coord => {
            const matches = coord.match(/-?\d+/g);
            if (matches) {
                const [q, r] = matches.map(Number);
                points += this.getHexValue(q, r);
            }
        });
        return points;
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

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.BoardModule = BoardModule;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardModule;
}