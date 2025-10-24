# Phase 2: Match Cycle

## Match Planning & Execution Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    🔄 MATCH PLANNING & EXECUTION                  │
└──────────────────────────────────────────────────────────────────┘
                                  │
            ┌─────────────────────┴─────────────────────┐
            │                                           │
            ↓                                           ↓
   ┌────────────────────┐                    ┌────────────────────┐
   │  AUTOMATIC MODE    │                    │   MANUAL MODE      │
   │  (Match Scheduler) │                    │   (God Mode)       │
   └────────────────────┘                    └────────────────────┘
            │                                           │
            ↓                                           ↓
   ┌────────────────────┐                    ┌────────────────────┐
   │ AI suggests        │                    │ Admin manually     │
   │ matchups based on: │                    │ drags players to:  │
   │ • Teams not played │                    │ • TEAM A           │
   │ • Game variety     │                    │ • TEAM B           │
   │ • Player rotation  │                    │                    │
   └────────────────────┘                    └────────────────────┘
            │                                           │
            └─────────────────────┬─────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  Game Added to Queue     │
                    │  Status: "queued"        │
                    │                          │
                    │  Queue Entry:            │
                    │  • Game: "CS2"           │
                    │  • PlayType: "2v2"       │
                    │  • TEAM A: [Players]     │
                    │  • TEAM B: [Players]     │
                    │  • Notes                 │
                    └──────────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  ⚔️ MATCH PLAYED         │
                    │  (Outside the system)    │
                    └──────────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  Admin: "Confirm Result" │
                    │  Tab in god.html         │
                    └──────────────────────────┘
                                  │
                                  ↓
        ┌────────────────────────────────────────────┐
        │  Select Winner(s):                         │
        │  • For 2-team match: 1 winner              │
        │  • For 3+ teams: Check all allied winners  │
        └────────────────────────────────────────────┘
                                  │
                                  ↓
            ┌─────────────────────────────────┐
            │  confirmGameResult() executes:  │
            ├─────────────────────────────────┤
            │  1. ✅ Record game in history   │
            │  2. 📈 Update team.gamesWon     │
            │  3. 🎯 Create turn queue        │
            │  4. 🏁 Start first team's turn  │
            └─────────────────────────────────┘
```

## Automatic vs Manual Mode

### Automatic Mode (Match Scheduler)
- AI-powered matchup suggestions
- Considers teams that haven't played together
- Rotates game types for variety
- Ensures all players get equal playtime
- **File**: `scripts/match-scheduler.js`

### Manual Mode (God Mode)
- Full admin control
- Drag & drop interface
- Can create any matchup combination
- Override AI suggestions
- **File**: `scripts/god-scripts.js`

## Queue System

Games are added to `gameState.gameQueue[]` with structure:

```javascript
{
  id: 1234567890,
  game: "CS2",
  playType: "2v2",
  teams: [
    {
      id: "TEAM_A",
      name: "TEAM A",
      players: [
        {
          name: "Player 1",
          originalTeamId: 1,
          originalTeamName: "Team Alpha",
          originalTeamColor: "#ff4444"
        },
        // ...
      ]
    },
    {
      id: "TEAM_B",
      name: "TEAM B",
      players: [/* ... */]
    }
  ],
  notes: "Optional admin notes",
  status: "queued",
  createdAt: "2024-01-15T10:30:00.000Z"
}
```

## Result Confirmation

When admin confirms a match result:

1. **Identify Winners**: Can select multiple teams (allied winners)
2. **Extract Original Team IDs**: Map virtual teams (TEAM_A/B) back to real teams
3. **Create Game History Entry**: Record full match details
4. **Update Team Stats**: Increment `gamesWon` for all winning teams
5. **Create Turn Queue**: All winning teams get added to turn queue
6. **Start First Turn**: Begin [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md)

## Multi-Team Winner Support (NEW!)

**Key Innovation**: When multiple teams win as allies, ALL get turns:

```javascript
// Example: Team 2 & Team 5 win together
winningTeamIds = [2, 5];

// Turn queue created
gameState.turnQueue = [
  { teamId: 2, gameResultId: 7 },
  { teamId: 5, gameResultId: 7 }
];

// Team 2 goes first, then Team 5
```

## Key Functions

- `addGameToQueue()` - Add match to queue (god-scripts.js:1420+)
- `confirmGameResult()` - Process match result (god-scripts.js:1578+)
- `loadQueuedGame()` - Load game for confirmation (god-scripts.js:1499+)

## Next Phase

After confirming a match result, proceed to [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md).
