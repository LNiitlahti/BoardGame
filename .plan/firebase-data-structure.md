# Firebase Data Structure

## Complete Data Model

```javascript
tournaments/{tournamentId}
```

## Tournament Document Structure

```javascript
{
  // ============================================================================
  // BASIC INFO
  // ============================================================================
  gameId: "tournament-2024-01-15",
  status: "setup" | "playing" | "finished" | "archived",
  winCondition: 50,                    // Points needed to win
  createdAt: "2024-01-15T10:00:00.000Z",
  finishedAt: "2024-01-15T18:30:00.000Z",  // null if not finished
  archivedAt: "2024-01-16T09:00:00.000Z",  // null if not archived

  // ============================================================================
  // GAME STATE
  // ============================================================================
  gamePhase: "setup" | "playing" | "finished",
  currentRound: 5,
  gamesPlayed: 15,

  // ============================================================================
  // TEAMS
  // ============================================================================
  teams: [
    {
      id: 1,                           // Unique team ID (1-based)
      name: "Team Alpha",
      color: "#ff4444",                // From config.js initially, stored here
      players: [
        {
          name: "Player One",
          points: 0,                   // Individual points (if tracked)
          uid: "firebase-user-id-1"    // Optional: linked user account
        },
        {
          name: "Player Two",
          points: 0,
          uid: "firebase-user-id-2"
        }
      ],
      points: 23,                      // Total team points (calculated)
      gamesWon: 3,
      gamesLost: 2
    },
    {
      id: 2,
      name: "Team Beta",
      color: "#44ff44",
      players: [/* ... */],
      points: 18,
      gamesWon: 2,
      gamesLost: 3
    }
    // ... more teams
  ],

  // ============================================================================
  // BOARD STATE
  // ============================================================================
  board: {
    "q0r0": 1,                         // Hex coordinate → team ID
    "q1r0": 1,
    "q0r1": 2,
    "q2r-4": 3,                        // Can be any valid hex coordinate
    // ... more placements
  },

  heartHexes: [
    "q2r-4",    // Normal heart (12 o'clock)
    "q4r-2",    // Normal heart (2 o'clock)
    "q2r2",     // Normal heart (4 o'clock)
    "q-2r4",    // Normal heart (8 o'clock)
    "q-4r2",    // Normal heart (10 o'clock)
    "q-2r-2"    // Mountain heart (center)
  ],

  heartHexControl: {
    "q2r-4": 1,                        // Heart hex coord → controlling team ID
    "q4r-2": 3,
    "q-2r-2": 2                        // Mountain heart controlled by team 2
  },

  // ============================================================================
  // TURN MANAGEMENT (NEW!)
  // ============================================================================
  currentTurn: {
    teamId: 3,                         // Team whose turn it is
    needsPlacement: true,              // false after placement
    gameResultId: 10,                  // Which game result led to this turn
    startTime: "2024-01-15T14:23:00.000Z"
  },

  turnQueue: [                         // Queue of teams waiting for turns
    {
      teamId: 3,                       // Current team (first in queue)
      gameResultId: 10,
      timestamp: "2024-01-15T14:22:50.000Z"
    },
    {
      teamId: 5,                       // Next team
      gameResultId: 10,
      timestamp: "2024-01-15T14:22:50.000Z"
    },
    {
      teamId: 1,                       // Last team
      gameResultId: 10,
      timestamp: "2024-01-15T14:22:50.000Z"
    }
  ],

  // ============================================================================
  // GAME QUEUE (Match Planning)
  // ============================================================================
  gameQueue: [
    {
      id: 1673456789012,               // Timestamp-based unique ID
      game: "CS2",                     // Game type
      playType: "2v2",                 // Match format
      teams: [
        {
          id: "TEAM_A",                // Virtual team ID for this match
          name: "TEAM A",
          players: [
            {
              name: "Player One",
              originalTeamId: 1,       // Real team ID
              originalTeamName: "Team Alpha",
              originalTeamColor: "#ff4444"
            },
            {
              name: "Player Two",
              originalTeamId: 1,
              originalTeamName: "Team Alpha",
              originalTeamColor: "#ff4444"
            }
          ]
        },
        {
          id: "TEAM_B",
          name: "TEAM B",
          players: [
            {
              name: "Player Three",
              originalTeamId: 2,
              originalTeamName: "Team Beta",
              originalTeamColor: "#44ff44"
            },
            {
              name: "Player Four",
              originalTeamId: 2,
              originalTeamName: "Team Beta",
              originalTeamColor: "#44ff44"
            }
          ]
        }
      ],
      notes: "Best of 3",              // Optional admin notes
      status: "queued" | "completed",
      createdAt: "2024-01-15T13:00:00.000Z",
      completedAt: "2024-01-15T14:22:00.000Z",  // null if not completed
      resultId: 10                     // Links to gameHistory entry
    }
    // ... more queued games
  ],

  // ============================================================================
  // GAME HISTORY (Match Results)
  // ============================================================================
  gameHistory: [
    {
      id: 1,                           // Sequential ID
      game: "CS2",
      playType: "2v2",
      matchup: {
        teamA: [
          { name: "Player One", originalTeam: "Team Alpha" },
          { name: "Player Two", originalTeam: "Team Alpha" }
        ],
        teamB: [
          { name: "Player Three", originalTeam: "Team Beta" },
          { name: "Player Four", originalTeam: "Team Beta" }
        ]
      },
      winningSide: "TEAM_A",           // Which virtual team won
      winningPlayers: [
        { name: "Player One", originalTeamId: 1 },
        { name: "Player Two", originalTeamId: 1 }
      ],
      winningTeamIds: [1],             // Real team IDs that won
      losingTeamIds: [2],              // Real team IDs that lost
      winner: "Team Alpha",            // For display
      loser: "Team Beta",              // For display
      queuedGameId: 1673456789012,     // Links back to queue entry
      planNotes: "Best of 3",
      resultNotes: "Close game, went to overtime",
      timestamp: "2024-01-15T14:22:00.000Z"
    },
    {
      id: 2,
      game: "Dota 2",
      // Multi-team win example
      winningTeamIds: [1, 3, 5],       // Three teams won together!
      losingTeamIds: [2, 4],
      winner: "Team Alpha & Team Charlie & Team Echo",
      loser: "Team Beta & Team Delta",
      // ... rest of structure
    }
    // ... more match results
  ],

  // ============================================================================
  // SELECTED GAMES
  // ============================================================================
  selectedGames: [
    { id: "cs2", name: "Counter-Strike 2", icon: "🎮" },
    { id: "dota2", name: "Dota 2", icon: "⚔️" },
    { id: "valorant", name: "Valorant", icon: "💥" }
  ]
}
```

## Data Flow Visualization

```
┌─────────────────────────────────────────────────────────────┐
│                    💾 DATA FLOW DIAGRAM                      │
└─────────────────────────────────────────────────────────────┘

    [Tournament Created]
            ↓
    ┌──────────────────┐
    │ tournaments/     │
    │   {tournamentId} │
    └──────────────────┘
            ↓
    [Initial State Saved]
    • teams: []
    • board: {}
    • gameQueue: []
    • currentTurn: null
            ↓
    [Admin Plans Match]
            ↓
    [gameQueue Updated]
    • New entry added
    • status: "queued"
            ↓
    [Match Played & Confirmed]
            ↓
    [Multiple Updates]
    • gameHistory: new entry
    • teams[].gamesWon: +1
    • gameQueue[].status: "completed"
    • turnQueue: created with winners
    • currentTurn: set to first winner
            ↓
    [Plate Placed]
            ↓
    [Board Updated]
    • board[coord]: teamId
    • heartHexControl: updated if heart
    • teams[].points: recalculated
    • turnQueue: shift to next team
    • currentTurn: updated
            ↓
    [Win Condition Met?]
      YES ↓         ↓ NO
    [Finish]    [Continue Loop]
    • status: "finished"
    • finishedAt: timestamp
    • currentTurn: null
```

## Key Relationships

### Teams → Board
```javascript
// Team owns hexes on board
board = {
  "q0r0": 1,  // Team 1's plate
  "q1r0": 1,  // Team 1's plate
  "q0r1": 2   // Team 2's plate
}
```

### Teams → Heart Control
```javascript
// Team controls heart hexes
heartHexControl = {
  "q2r-4": 1,   // Team 1 controls this heart
  "q-2r-2": 3   // Team 3 controls mountain heart
}
```

### Queue → History
```javascript
// Queue entry links to history entry via IDs
gameQueue[0].resultId === gameHistory[5].id
gameHistory[5].queuedGameId === gameQueue[0].id
```

### History → Turn Queue
```javascript
// Match result creates turn queue
gameHistory[5].winningTeamIds = [2, 5]
  ↓
turnQueue = [
  { teamId: 2, gameResultId: 5 },
  { teamId: 5, gameResultId: 5 }
]
```

## Indexing & Queries

### Common Queries

**Get all active tournaments:**
```javascript
db.collection('tournaments')
  .where('status', '==', 'playing')
  .orderBy('createdAt', 'desc')
```

**Get tournaments by date:**
```javascript
db.collection('tournaments')
  .where('createdAt', '>=', startDate)
  .where('createdAt', '<=', endDate)
```

**Get finished tournaments:**
```javascript
db.collection('tournaments')
  .where('status', '==', 'finished')
  .orderBy('finishedAt', 'desc')
```

## Data Size Estimates

### Single Tournament
- Base document: ~5 KB
- Per team: ~500 bytes
- Per queued game: ~1 KB
- Per history entry: ~800 bytes
- Per board hex: ~20 bytes
- **Average tournament**: 20-50 KB
- **Large tournament**: 100-200 KB

### Storage Considerations
- Firebase free tier: 1 GB storage
- Can store ~10,000 average tournaments
- Recommend archiving old tournaments

## Backup Strategy

### What to Backup
1. **Full tournament documents** - Complete state
2. **Game history** - Historical records
3. **Final standings** - Winners and scores

### When to Backup
- After tournament finishes
- Before major updates
- Weekly automatic backups

### Export Format
```javascript
// Export entire tournament as JSON
const backup = {
  exportedAt: new Date().toISOString(),
  tournament: tournamentData,
  version: "1.0"
};
```

## Security Rules

### Recommended Firestore Rules
```javascript
match /tournaments/{tournamentId} {
  // Anyone can read
  allow read: if true;

  // Only authenticated users can create
  allow create: if request.auth != null;

  // Only god/admin can update/delete
  allow update, delete: if request.auth != null &&
    (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isGod == true ||
     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true);
}
```

## Migration & Versioning

### Schema Versioning
```javascript
{
  schemaVersion: "2.0",  // Track schema changes
  // ... rest of tournament data
}
```

### Migration Example
When adding new fields (like `turnQueue`):
```javascript
// Old tournaments won't have turnQueue
if (!tournament.turnQueue) {
  tournament.turnQueue = [];
}
```

## Related Documentation

- [Complete Gameplay Loop](complete-gameplay-loop.md)
- [Phase 1: Tournament Setup](phase-1-tournament-setup.md)
- [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md)
