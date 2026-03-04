/**
 * BALANCE OPTIMIZER - Greedy Variance Minimization
 *
 * Mathematical approach:
 * - Track W (with) and A (against) matrices for all player pairs
 * - At each match, enumerate all valid partitions
 * - Select the partition that minimizes the cost function increase
 *
 * Cost function: C = Σ(i<j) [(W_ij - μW)² + (A_ij - μA)²]
 *
 * This is a greedy correction heuristic that actively minimizes variance,
 * rather than relying on fixed rotation patterns.
 */

class BalanceOptimizer {
    constructor(numTeams = 5, playersPerTeam = 2) {
        this.numTeams = numTeams;
        this.playersPerTeam = playersPerTeam;
        this.numPlayers = numTeams * playersPerTeam;

        // Player IDs: "1a", "1b", "2a", "2b", etc.
        this.players = this.generatePlayerIds();

        // Initialize W and A matrices (using player ID as key)
        this.W = {};  // With-matrix: times on same side
        this.A = {};  // Against-matrix: times on opposite sides

        this.initializeMatrices();

        // Track total matches for mean calculation
        this.totalMatches = { '5v5': 0, '3v3': 0, '2v2': 0 };

        // Track split history for fairness
        this.splitCounts = {};      // How many times each team has been split
        this.lastSplitMatch = {};   // Match number when team was last split
        this.currentMatchNumber = 0;

        // Initialize split tracking
        for (let t = 1; t <= numTeams; t++) {
            this.splitCounts[t] = 0;
            this.lastSplitMatch[t] = -Infinity;  // Never split yet
        }

        // Weight for split fairness in cost function (higher = more important)
        // This balances pairing fairness vs split fairness
        this.splitFairnessWeight = 10;
    }

    generatePlayerIds() {
        const players = [];
        for (let team = 1; team <= this.numTeams; team++) {
            for (let i = 0; i < this.playersPerTeam; i++) {
                players.push(`${team}${String.fromCharCode(97 + i)}`); // 1a, 1b, 2a, 2b, etc.
            }
        }
        return players;
    }

    initializeMatrices() {
        this.players.forEach(p1 => {
            this.W[p1] = {};
            this.A[p1] = {};
            this.players.forEach(p2 => {
                this.W[p1][p2] = 0;
                this.A[p1][p2] = 0;
            });
        });
    }

    /**
     * Reset matrices (for new tournament)
     */
    reset() {
        this.initializeMatrices();
        this.totalMatches = { '5v5': 0, '3v3': 0, '2v2': 0 };

        // Reset split tracking
        this.currentMatchNumber = 0;
        for (let t = 1; t <= this.numTeams; t++) {
            this.splitCounts[t] = 0;
            this.lastSplitMatch[t] = -Infinity;
        }
    }

    /**
     * Get team ID from player ID (e.g., "2a" -> 2)
     */
    getTeamId(playerId) {
        return parseInt(playerId.charAt(0));
    }

    /**
     * Get all players from a team
     */
    getTeamPlayers(teamId) {
        return this.players.filter(p => this.getTeamId(p) === teamId);
    }

    /**
     * Calculate current means for cross-team pairs only
     */
    calculateMeans() {
        let sumW = 0, sumA = 0, count = 0;

        this.players.forEach(p1 => {
            this.players.forEach(p2 => {
                if (p1 < p2) {  // Unordered pairs
                    const team1 = this.getTeamId(p1);
                    const team2 = this.getTeamId(p2);
                    if (team1 !== team2) {  // Cross-team only
                        sumW += this.W[p1][p2];
                        sumA += this.A[p1][p2];
                        count++;
                    }
                }
            });
        });

        return {
            μW: count > 0 ? sumW / count : 0,
            μA: count > 0 ? sumA / count : 0,
            pairCount: count  // Should be C(5,2) * 4 = 40 cross-team pairs
        };
    }

    /**
     * Calculate current cost function value
     * C = Σ(i<j) [(W_ij - μW)² + (A_ij - μA)²]
     */
    calculateCost(μW = null, μA = null) {
        if (μW === null || μA === null) {
            const means = this.calculateMeans();
            μW = means.μW;
            μA = means.μA;
        }

        let cost = 0;

        this.players.forEach(p1 => {
            this.players.forEach(p2 => {
                if (p1 < p2) {
                    const team1 = this.getTeamId(p1);
                    const team2 = this.getTeamId(p2);
                    if (team1 !== team2) {
                        cost += Math.pow(this.W[p1][p2] - μW, 2);
                        cost += Math.pow(this.A[p1][p2] - μA, 2);
                    }
                }
            });
        });

        return cost;
    }

    /**
     * Calculate split fairness penalty for choosing a particular team to split
     * Lower penalty = better choice (team hasn't been split recently, or has fewer total splits)
     *
     * @param {number} splitTeamId - The team being considered for splitting
     * @returns {number} Penalty value (lower is better)
     */
    calculateSplitFairnessPenalty(splitTeamId) {
        // Factor 1: How recently was this team split?
        // Penalize splitting the same team again soon
        const matchesSinceLastSplit = this.currentMatchNumber - this.lastSplitMatch[splitTeamId];
        const recencyPenalty = matchesSinceLastSplit <= 1 ? 100 : // Just split - heavy penalty
                              matchesSinceLastSplit <= 2 ? 50 :   // Split 2 matches ago
                              matchesSinceLastSplit <= 3 ? 20 :   // Split 3 matches ago
                              0;                                   // Long enough ago - no penalty

        // Factor 2: Total split count imbalance
        // Prefer splitting teams that have been split fewer times
        const avgSplits = Object.values(this.splitCounts).reduce((a, b) => a + b, 0) / this.numTeams;
        const thisSplitCount = this.splitCounts[splitTeamId];
        const splitCountPenalty = Math.max(0, (thisSplitCount - avgSplits) * 5);

        // Factor 3: Bonus for splitting the team with longest drought
        // Find which team has gone longest without being split
        let maxDrought = 0;
        let teamWithMaxDrought = 1;
        for (let t = 1; t <= this.numTeams; t++) {
            const drought = this.currentMatchNumber - this.lastSplitMatch[t];
            if (drought > maxDrought) {
                maxDrought = drought;
                teamWithMaxDrought = t;
            }
        }

        // Give a bonus (negative penalty) if this is the team with the longest drought
        const droughtBonus = (splitTeamId === teamWithMaxDrought && maxDrought > 2) ? -30 : 0;

        return recencyPenalty + splitCountPenalty + droughtBonus;
    }

    /**
     * Calculate the cost delta if we apply a given partition
     * Returns the change in cost function
     */
    calculateCostDelta(sideA, sideB, μW, μA) {
        let delta = 0;

        // Pairs that will be on the same side (increment W)
        const sameSidePairs = [
            ...this.getPairs(sideA),
            ...this.getPairs(sideB)
        ];

        // Pairs that will be on opposite sides (increment A)
        const oppositePairs = this.getCrossPairs(sideA, sideB);

        // Calculate delta for W increments
        sameSidePairs.forEach(([p1, p2]) => {
            const team1 = this.getTeamId(p1);
            const team2 = this.getTeamId(p2);
            if (team1 !== team2) {  // Only count cross-team
                const oldDev = Math.pow(this.W[p1][p2] - μW, 2);
                const newDev = Math.pow(this.W[p1][p2] + 1 - μW, 2);
                delta += newDev - oldDev;
            }
        });

        // Calculate delta for A increments
        oppositePairs.forEach(([p1, p2]) => {
            const team1 = this.getTeamId(p1);
            const team2 = this.getTeamId(p2);
            if (team1 !== team2) {  // Only count cross-team
                const oldDev = Math.pow(this.A[p1][p2] - μA, 2);
                const newDev = Math.pow(this.A[p1][p2] + 1 - μA, 2);
                delta += newDev - oldDev;
            }
        });

        return delta;
    }

    /**
     * Get all unordered pairs from a list
     */
    getPairs(list) {
        const pairs = [];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                pairs.push([list[i], list[j]]);
            }
        }
        return pairs;
    }

    /**
     * Get all cross-pairs between two lists
     */
    getCrossPairs(listA, listB) {
        const pairs = [];
        listA.forEach(a => {
            listB.forEach(b => {
                pairs.push([a, b]);
            });
        });
        return pairs;
    }

    /**
     * Enumerate all valid 5v5 partitions
     * Structure: 1 split team + 2 full teams per side
     */
    enumerate5v5Partitions() {
        const partitions = [];
        const teamIds = Array.from({ length: this.numTeams }, (_, i) => i + 1);

        // Choose which team to split (5 options)
        for (const splitTeam of teamIds) {
            const remainingTeams = teamIds.filter(t => t !== splitTeam);

            // Choose 2 teams for side A from remaining 4 (C(4,2) = 6 options)
            const sideACombinations = this.combinations(remainingTeams, 2);

            for (const sideATeams of sideACombinations) {
                const sideBTeams = remainingTeams.filter(t => !sideATeams.includes(t));

                // Choose which split player goes to side A (2 options)
                const splitPlayers = this.getTeamPlayers(splitTeam);

                for (let splitIdx = 0; splitIdx < splitPlayers.length; splitIdx++) {
                    const splitPlayerA = splitPlayers[splitIdx];
                    const splitPlayerB = splitPlayers[1 - splitIdx];

                    // Build side rosters
                    const sideA = [];
                    const sideB = [];

                    // Add full teams to sides
                    sideATeams.forEach(teamId => {
                        sideA.push(...this.getTeamPlayers(teamId));
                    });
                    sideBTeams.forEach(teamId => {
                        sideB.push(...this.getTeamPlayers(teamId));
                    });

                    // Add split players
                    sideA.push(splitPlayerA);
                    sideB.push(splitPlayerB);

                    partitions.push({
                        format: '5v5',
                        splitTeam,
                        sideATeams,
                        sideBTeams,
                        splitPlayerA,
                        splitPlayerB,
                        sideA,
                        sideB
                    });
                }
            }
        }

        return partitions;  // 5 × 6 × 2 = 60 partitions
    }

    /**
     * Enumerate all valid 3v3 partitions (for 3v3+2v2 format)
     * Structure: 1 split team (1 each side) + 1 full team per side
     * Returns both 3v3 and corresponding 2v2 match
     */
    enumerate3v3_2v2Partitions() {
        const partitions = [];
        const teamIds = Array.from({ length: this.numTeams }, (_, i) => i + 1);

        // Choose which team to split (5 options)
        for (const splitTeam of teamIds) {
            const remainingTeams = teamIds.filter(t => t !== splitTeam);

            // For 3v3: Choose 1 team for side A from remaining 4 (4 options)
            for (const team3v3A of remainingTeams) {
                // Choose 1 team for side B from remaining 3 (3 options)
                const available3v3B = remainingTeams.filter(t => t !== team3v3A);

                for (const team3v3B of available3v3B) {
                    // Remaining 2 teams play 2v2
                    const teams2v2 = remainingTeams.filter(t => t !== team3v3A && t !== team3v3B);

                    // Choose which split player goes to side A (2 options)
                    const splitPlayers = this.getTeamPlayers(splitTeam);

                    for (let splitIdx = 0; splitIdx < splitPlayers.length; splitIdx++) {
                        const splitPlayerA = splitPlayers[splitIdx];
                        const splitPlayerB = splitPlayers[1 - splitIdx];

                        // Build 3v3 rosters
                        const sideA_3v3 = [...this.getTeamPlayers(team3v3A), splitPlayerA];
                        const sideB_3v3 = [...this.getTeamPlayers(team3v3B), splitPlayerB];

                        // Build 2v2 rosters
                        const sideA_2v2 = this.getTeamPlayers(teams2v2[0]);
                        const sideB_2v2 = this.getTeamPlayers(teams2v2[1]);

                        partitions.push({
                            format: '3v3+2v2',
                            splitTeam,
                            match3v3: {
                                sideATeam: team3v3A,
                                sideBTeam: team3v3B,
                                splitPlayerA,
                                splitPlayerB,
                                sideA: sideA_3v3,
                                sideB: sideB_3v3
                            },
                            match2v2: {
                                sideATeam: teams2v2[0],
                                sideBTeam: teams2v2[1],
                                sideA: sideA_2v2,
                                sideB: sideB_2v2
                            }
                        });
                    }
                }
            }
        }

        return partitions;  // 5 × 4 × 3 × 2 = 120 partitions
    }

    /**
     * Generate combinations of k elements from array
     */
    combinations(arr, k) {
        if (k === 0) return [[]];
        if (arr.length === 0) return [];

        const [first, ...rest] = arr;
        const withFirst = this.combinations(rest, k - 1).map(c => [first, ...c]);
        const withoutFirst = this.combinations(rest, k);

        return [...withFirst, ...withoutFirst];
    }

    /**
     * Select the optimal 5v5 partition using greedy variance minimization
     * Includes split fairness penalty to ensure teams are split in rotation
     * When multiple partitions have equal cost, randomly select among them
     */
    selectOptimal5v5() {
        const partitions = this.enumerate5v5Partitions();
        const { μW, μA } = this.calculateMeans();

        // Calculate cost delta for all partitions (pairing balance + split fairness)
        const scored = partitions.map(partition => {
            const pairingDelta = this.calculateCostDelta(partition.sideA, partition.sideB, μW, μA);
            const splitPenalty = this.calculateSplitFairnessPenalty(partition.splitTeam);
            return {
                partition,
                pairingDelta,
                splitPenalty,
                totalDelta: pairingDelta + (splitPenalty * this.splitFairnessWeight)
            };
        });

        // Find minimum total delta
        const minDelta = Math.min(...scored.map(s => s.totalDelta));

        // Get all partitions with minimum (or near-minimum) delta
        const epsilon = 0.001;
        const bestPartitions = scored.filter(s => s.totalDelta <= minDelta + epsilon);

        // Randomly select among the best partitions (tie-breaking)
        const selected = bestPartitions[Math.floor(Math.random() * bestPartitions.length)];

        return {
            partition: selected.partition,
            costDelta: selected.pairingDelta,
            splitPenalty: selected.splitPenalty,
            totalDelta: selected.totalDelta,
            alternativesCount: partitions.length,
            tiedCount: bestPartitions.length
        };
    }

    /**
     * Select the optimal 3v3+2v2 partition using greedy variance minimization
     * Considers both matches' impact on the cost function
     * Includes split fairness penalty to ensure teams are split in rotation
     * When multiple partitions have equal cost, randomly select among them
     */
    selectOptimal3v3_2v2() {
        const partitions = this.enumerate3v3_2v2Partitions();
        const { μW, μA } = this.calculateMeans();

        // Calculate cost delta for all partitions (pairing balance + split fairness)
        const scored = partitions.map(partition => {
            const delta3v3 = this.calculateCostDelta(
                partition.match3v3.sideA,
                partition.match3v3.sideB,
                μW, μA
            );
            const delta2v2 = this.calculateCostDelta(
                partition.match2v2.sideA,
                partition.match2v2.sideB,
                μW, μA
            );
            const pairingDelta = delta3v3 + delta2v2;
            const splitPenalty = this.calculateSplitFairnessPenalty(partition.splitTeam);
            return {
                partition,
                pairingDelta,
                splitPenalty,
                totalDelta: pairingDelta + (splitPenalty * this.splitFairnessWeight)
            };
        });

        // Find minimum total delta
        const minDelta = Math.min(...scored.map(s => s.totalDelta));

        // Get all partitions with minimum (or near-minimum) delta
        const epsilon = 0.001;
        const bestPartitions = scored.filter(s => s.totalDelta <= minDelta + epsilon);

        // Randomly select among the best partitions (tie-breaking)
        const selected = bestPartitions[Math.floor(Math.random() * bestPartitions.length)];

        return {
            partition: selected.partition,
            costDelta: selected.pairingDelta,
            splitPenalty: selected.splitPenalty,
            totalDelta: selected.totalDelta,
            alternativesCount: partitions.length,
            tiedCount: bestPartitions.length
        };
    }

    /**
     * Record that a team was split in the current match
     * Call this after selecting a partition
     */
    recordSplit(splitTeamId) {
        this.splitCounts[splitTeamId]++;
        this.lastSplitMatch[splitTeamId] = this.currentMatchNumber;
    }

    /**
     * Advance the match counter
     * Call this before selecting the next match
     */
    advanceMatch() {
        this.currentMatchNumber++;
    }

    /**
     * Apply a partition to the matrices (update W and A)
     */
    applyPartition(sideA, sideB) {
        // Update W matrix (same side pairs)
        this.getPairs(sideA).forEach(([p1, p2]) => {
            this.W[p1][p2]++;
            this.W[p2][p1]++;
        });
        this.getPairs(sideB).forEach(([p1, p2]) => {
            this.W[p1][p2]++;
            this.W[p2][p1]++;
        });

        // Update A matrix (opposite side pairs)
        this.getCrossPairs(sideA, sideB).forEach(([p1, p2]) => {
            this.A[p1][p2]++;
            this.A[p2][p1]++;
        });
    }

    /**
     * Generate next optimal 5v5 match
     */
    generateNext5v5Match(gameId = 'default') {
        const result = this.selectOptimal5v5();
        const partition = result.partition;

        // Apply to matrices
        this.applyPartition(partition.sideA, partition.sideB);
        this.totalMatches['5v5']++;

        return {
            game: gameId,
            playType: '5v5',
            splitTeamId: partition.splitTeam,
            sideATeams: partition.sideATeams,
            sideBTeams: partition.sideBTeams,
            sideA: partition.sideA,
            sideB: partition.sideB,
            splitPlayerA: partition.splitPlayerA,
            splitPlayerB: partition.splitPlayerB,
            costDelta: result.costDelta,
            alternativesConsidered: result.alternativesCount
        };
    }

    /**
     * Generate next optimal 3v3+2v2 match pair
     */
    generateNext3v3_2v2Matches(gameId = 'default') {
        const result = this.selectOptimal3v3_2v2();
        const partition = result.partition;

        // Apply both matches to matrices
        this.applyPartition(partition.match3v3.sideA, partition.match3v3.sideB);
        this.applyPartition(partition.match2v2.sideA, partition.match2v2.sideB);
        this.totalMatches['3v3']++;
        this.totalMatches['2v2']++;

        return {
            match3v3: {
                game: gameId,
                playType: '3v3',
                splitTeamId: partition.splitTeam,
                sideATeam: partition.match3v3.sideATeam,
                sideBTeam: partition.match3v3.sideBTeam,
                sideA: partition.match3v3.sideA,
                sideB: partition.match3v3.sideB,
                isSimultaneous: true
            },
            match2v2: {
                game: gameId,
                playType: '2v2',
                splitTeamId: null,  // 2v2 has no split - two full teams
                sideATeam: partition.match2v2.sideATeam,
                sideBTeam: partition.match2v2.sideBTeam,
                sideA: partition.match2v2.sideA,
                sideB: partition.match2v2.sideB,
                isSimultaneous: true
            },
            costDelta: result.costDelta,
            alternativesConsidered: result.alternativesCount
        };
    }

    /**
     * Get split distribution statistics
     */
    getSplitStats() {
        const counts = Object.values(this.splitCounts);
        const total = counts.reduce((a, b) => a + b, 0);
        const mean = total / this.numTeams;
        const min = Math.min(...counts);
        const max = Math.max(...counts);
        const range = max - min;

        return {
            splitCounts: { ...this.splitCounts },
            lastSplitMatch: { ...this.lastSplitMatch },
            total,
            mean,
            min,
            max,
            range,
            isBalanced: range <= 2
        };
    }

    /**
     * Get current balance statistics
     */
    getBalanceStats() {
        const { μW, μA, pairCount } = this.calculateMeans();
        const cost = this.calculateCost(μW, μA);

        // Calculate variance
        let varianceW = 0, varianceA = 0;
        let minW = Infinity, maxW = -Infinity;
        let minA = Infinity, maxA = -Infinity;

        this.players.forEach(p1 => {
            this.players.forEach(p2 => {
                if (p1 < p2) {
                    const team1 = this.getTeamId(p1);
                    const team2 = this.getTeamId(p2);
                    if (team1 !== team2) {
                        varianceW += Math.pow(this.W[p1][p2] - μW, 2);
                        varianceA += Math.pow(this.A[p1][p2] - μA, 2);
                        minW = Math.min(minW, this.W[p1][p2]);
                        maxW = Math.max(maxW, this.W[p1][p2]);
                        minA = Math.min(minA, this.A[p1][p2]);
                        maxA = Math.max(maxA, this.A[p1][p2]);
                    }
                }
            });
        });

        varianceW /= pairCount;
        varianceA /= pairCount;

        return {
            totalMatches: this.totalMatches,
            crossTeamPairs: pairCount,
            with: {
                mean: μW,
                variance: varianceW,
                stdDev: Math.sqrt(varianceW),
                min: minW === Infinity ? 0 : minW,
                max: maxW === -Infinity ? 0 : maxW,
                range: maxW - minW
            },
            against: {
                mean: μA,
                variance: varianceA,
                stdDev: Math.sqrt(varianceA),
                min: minA === Infinity ? 0 : minA,
                max: maxA === -Infinity ? 0 : maxA,
                range: maxA - minA
            },
            totalCost: cost,
            isBalanced: (maxW - minW) <= 2 && (maxA - minA) <= 2
        };
    }

    /**
     * Get the W and A matrices for display
     */
    getMatrices() {
        return {
            players: this.players,
            W: this.W,
            A: this.A
        };
    }

    /**
     * Import existing match history to reconstruct matrices
     */
    importMatchHistory(matches) {
        this.reset();

        matches.forEach(match => {
            if (match.sideA && match.sideB) {
                // Convert team IDs to player IDs if needed
                const sideA = this.normalizePlayerList(match.sideA, match);
                const sideB = this.normalizePlayerList(match.sideB, match);

                if (sideA.length > 0 && sideB.length > 0) {
                    this.applyPartition(sideA, sideB);

                    if (match.playType) {
                        this.totalMatches[match.playType] = (this.totalMatches[match.playType] || 0) + 1;
                    }
                }
            }
        });
    }

    /**
     * Normalize player list (handle both player IDs and team IDs)
     */
    normalizePlayerList(list, match) {
        if (!list || list.length === 0) return [];

        // Check if list contains player IDs (strings like "1a") or team IDs (numbers)
        const firstItem = list[0];

        if (typeof firstItem === 'string' && /^\d[a-z]$/.test(firstItem)) {
            // Already player IDs
            return list;
        }

        if (typeof firstItem === 'number') {
            // Team IDs - expand to player IDs
            const players = [];
            list.forEach(teamId => {
                players.push(...this.getTeamPlayers(teamId));
            });

            // Handle split team if present
            if (match.splitTeamId && match.splitPlayerA) {
                // Remove split team players from the expanded list
                // They should be added individually based on which side
            }

            return players;
        }

        return list;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.BalanceOptimizer = BalanceOptimizer;
}

// Export for Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BalanceOptimizer;
}
