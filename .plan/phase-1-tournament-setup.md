# Phase 1: Tournament Setup

## Tournament Creation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    🏁 TOURNAMENT CREATION                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────────────────────────┐
        │   Admin opens setup.html                │
        │   or god.html → "Create New"            │
        └─────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────────────────────────┐
        │   1. Enter Tournament ID                │
        │   2. Set Win Condition (e.g., 50 pts)   │
        │   3. Select Games (CS2, Dota2, etc.)    │
        └─────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────────────────────────┐
        │   4. Create Teams (2-8 teams)           │
        │      • Team Name                        │
        │      • Player 1 Name                    │
        │      • Player 2 Name                    │
        │      • Auto-assigned Color (config.js)  │
        └─────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────────────────────────┐
        │   💾 Save to Firebase                   │
        │   Collection: "tournaments"             │
        │   Document ID: tournament-id            │
        └─────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────────────────────────┐
        │   Status: "setup" → "playing"           │
        └─────────────────────────────────────────┘
```

## Key Files Involved

- **setup.html** - Full tournament creation wizard
- **god.html** - Quick tournament creation
- **scripts/config.js** - Team color defaults
- **scripts/tournament-manager.js** - Tournament CRUD operations
- **Firebase Collection** - `tournaments/{tournamentId}`

## Initial Tournament Data Structure

```javascript
{
  gameId: "tournament-2024-01-15",
  status: "setup",
  winCondition: 50,
  teams: [
    {
      id: 1,
      name: "Team Alpha",
      color: "#ff4444",  // From config.js
      players: [
        { name: "Player 1", points: 0 },
        { name: "Player 2", points: 0 }
      ],
      points: 0,
      gamesWon: 0
    }
  ],
  board: {},
  heartHexControl: {},
  heartHexes: ['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2'],
  gameQueue: [],
  gameHistory: [],
  currentRound: 0,
  gamesPlayed: 0,
  currentTurn: null,
  createdAt: "2024-01-15T10:00:00.000Z"
}
```

## Next Phase

After setup is complete and status is set to "playing", proceed to [Phase 2: Match Cycle](phase-2-match-cycle.md).
