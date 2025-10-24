# Phase 3: Hex Board Placement

## Multi-Team Plate Placement Cycle (NEW FEATURE!)

```
┌──────────────────────────────────────────────────────────────────┐
│                    📍 PLATE PLACEMENT CYCLE                       │
└──────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │  Turn Queue Created       │
                    │  [Team 3, Team 5, Team 1] │ ← All allied winners
                    └─────────────┬─────────────┘
                                  │
                                  ↓
        ╔═══════════════════════════════════════════════╗
        ║         🎯 TEAM 3's TURN (First in queue)     ║
        ╚═══════════════════════════════════════════════╝
                                  │
                    ┌─────────────┴─────────────┐
                    │  currentTurn = {          │
                    │    teamId: 3,             │
                    │    needsPlacement: true   │
                    │  }                        │
                    └─────────────┬─────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  UI Shows:               │
                    │  "🎯 Team 3's Turn"      │
                    │  "⏱️ Waiting: Team 5,    │
                    │              Team 1"     │
                    └──────────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  Admin clicks hex on     │
                    │  board (q, r coords)     │
                    └──────────────────────────┘
                                  │
                                  ↓
        ┌────────────────────────────────────────────┐
        │  Validation (BoardModule):                 │
        │  ✓ Adjacent to own plate OR starting hex?  │
        │  ✓ Not already occupied?                   │
        └────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │         VALID?            │
                    └─────────────┬─────────────┘
                         YES │         │ NO
                             ↓         ↓
                ┌──────────────┐   ┌──────────────┐
                │ placePlate() │   │ Error message│
                └──────────────┘   └──────────────┘
                        │
                        ↓
        ┌───────────────────────────────────────┐
        │  1. 🎨 Set board[coord] = teamId      │
        │  2. ❤️ Check if heart hex → capture   │
        │  3. 📊 calculatePoints()              │
        │  4. 🎯 Move to next team in queue     │
        │  5. 💾 Save to Firebase               │
        └───────────────────────────────────────┘
                        │
                        ↓
        ╔═══════════════════════════════════════════════╗
        ║         🎯 TEAM 5's TURN (Next in queue)      ║
        ╚═══════════════════════════════════════════════╝
                        │
                        ↓
              [Same placement process]
                        │
                        ↓
        ╔═══════════════════════════════════════════════╗
        ║         🎯 TEAM 1's TURN (Last in queue)      ║
        ╚═══════════════════════════════════════════════╝
                        │
                        ↓
              [Same placement process]
                        │
                        ↓
        ┌───────────────────────────────────────┐
        │  ✅ All teams placed!                 │
        │  turnQueue = [] (empty)               │
        │  currentTurn = null                   │
        └───────────────────────────────────────┘
```

## Hex Coordinate System

The board uses axial coordinates (q, r):
- **q**: Horizontal axis
- **r**: Diagonal axis
- Stored as strings: `"q0r0"`, `"q2r-4"`, etc.

## Placement Validation Rules

### 1. First Placement (Starting Hex)
Teams can place on their designated starting corner hexes:
- Defined in `BoardModule.getHexType(q, r)`
- Returns `'starting-location'` for corners
- Usually 6 starting positions (one per team)

### 2. Subsequent Placements (Adjacency)
Must be adjacent to an existing plate of the same team:
- Uses `BoardModule.getAdjacentCoords(q, r)`
- Checks all 6 neighboring hexes
- At least one neighbor must be owned by the placing team

### 3. Occupation Check
Hex must not already be occupied:
- Check `gameState.board[coord]` is undefined
- Each hex can only be owned by one team

## Heart Hex Capture

Special hexes that provide passive point bonuses:

```javascript
// Check if placed hex is a heart
const hexType = boardModule.getHexType(q, r);

if (hexType === 'high-value' || hexType === 'center') {
    // Capture the heart hex
    gameState.heartHexControl[coord] = teamId;

    // Bonus: +1 per turn (normal heart)
    //        +2 per turn (mountain heart - center)
}
```

### Heart Hex Locations
```javascript
heartHexes: [
  'q2r-4',   // 12 o'clock
  'q4r-2',   // 2 o'clock
  'q2r2',    // 4 o'clock
  'q-2r4',   // 8 o'clock
  'q-4r2',   // 10 o'clock
  'q-2r-2'   // Center (Mountain Heart - worth 2x)
]
```

## Turn Queue System (NEW!)

After a match with multiple allied winners:

```javascript
// Example: Team 2, Team 5, Team 7 win together
gameState.turnQueue = [
  { teamId: 2, gameResultId: 10, timestamp: "..." },
  { teamId: 5, gameResultId: 10, timestamp: "..." },
  { teamId: 7, gameResultId: 10, timestamp: "..." }
];

// Current turn points to first team
gameState.currentTurn = {
  teamId: 2,
  needsPlacement: true,
  gameResultId: 10,
  startTime: "..."
};
```

After each placement, the turn advances:
```javascript
// Remove current team from queue
gameState.turnQueue.shift();

// If more teams waiting, start next turn
if (gameState.turnQueue.length > 0) {
  const nextTurn = gameState.turnQueue[0];
  gameState.currentTurn = {
    teamId: nextTurn.teamId,
    needsPlacement: true,
    ...
  };
}
```

## UI Feedback

### Turn Display
Shows current team and waiting teams:
```
🎯 Team Alpha's Turn
Player1 & Player2
📍 Click a hex to place plate

⏱️ Waiting: Team Beta, Team Gamma
```

### Board Highlights
- **Green**: Valid placement locations
- **Team Color**: Occupied by that team
- **Gold**: Starting corners
- **Pink**: Heart hexes
- **Purple**: Mountain heart (center)

## Key Functions

- `handleHexClick(q, r)` - Handle board click (god-scripts.js:1845+)
- `placePlate(q, r, teamId)` - Place plate and update state (god-scripts.js:1874+)
- `highlightValidPlacements()` - Show valid moves (god-scripts.js:2007+)
- `updateCurrentTurnInfo()` - Update turn display with queue (god-scripts.js:2113+)

## Board Module Integration

Uses `BoardModule` for game logic:
- `canPlaceAtLocation(q, r, teamId, board)` - Validate placement
- `getAdjacentCoords(q, r)` - Get neighboring hexes
- `getHexType(q, r)` - Determine hex special type
- `calculateTeamPoints(plates)` - Calculate adjacency points

## Next Phase

After all plates are placed and points calculated, proceed to [Phase 4: Point Calculation](phase-4-point-calculation.md).
