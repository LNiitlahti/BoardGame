# Phase 4: Point Calculation

## Point Calculation System

```
┌──────────────────────────────────────────────────────────────────┐
│                    📈 CALCULATE POINTS (After Each Plate)         │
└──────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
        ┌─────────────────────────────────────────┐
        │  For Each Team:                         │
        └─────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ↓                           ↓
        ┌────────────────────┐      ┌────────────────────┐
        │  BASE POINTS       │      │  BONUS POINTS      │
        │  (Adjacency)       │      │  (Heart Hexes)     │
        └────────────────────┘      └────────────────────┘
                    │                           │
                    ↓                           ↓
        ┌────────────────────┐      ┌────────────────────┐
        │ Count connected    │      │ For each heart     │
        │ clusters of own    │      │ hex controlled:    │
        │ plates:            │      │                    │
        │ • 1 plate = 1 pt   │      │ • Normal ❤️ = +1  │
        │ • 2 plates = 3 pts │      │ • Mountain ❤️ = +2│
        │ • 3 plates = 6 pts │      │                    │
        │ • n plates = n²    │      │ (PER TURN!)        │
        └────────────────────┘      └────────────────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ↓
                    ┌──────────────────────────┐
                    │  team.points = base +    │
                    │                bonus     │
                    └──────────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  Update UI displays      │
                    │  • Scoreboard            │
                    │  • Team rankings         │
                    └──────────────────────────┘
```

## Base Points: Adjacency Calculation

The board uses a **cluster-based scoring system** where connected groups of plates are worth exponentially more:

### Formula
For a connected cluster of `n` plates:
```
points = n²
```

### Examples

**Single Isolated Plate:**
```
    [T1]
```
Points = 1² = **1 point**

**Two Connected Plates:**
```
    [T1]-[T1]
```
Points = 2² = **3 points** (not 2!)

**Three Connected Plates:**
```
    [T1]-[T1]
        /
    [T1]
```
Points = 3² = **6 points**

**Two Separate Clusters:**
```
    [T1]-[T1]        [T1]
```
Points = 2² + 1² = 3 + 1 = **4 points**

**Five Connected Plates:**
```
    [T1]-[T1]
        /   \
    [T1]    [T1]
            /
        [T1]
```
Points = 5² = **25 points**

### Strategic Implications
- **Big clusters are valuable**: 5 connected plates = 25 pts (vs 5 separate = 5 pts)
- **Defend clusters**: Breaking up opponent's large cluster significantly reduces their points
- **Expansion vs Consolidation**: Grow existing clusters vs starting new ones

## Bonus Points: Heart Hex Control

Heart hexes provide **passive point generation** each turn they're controlled:

### Heart Hex Types

#### Normal Hearts (6 locations)
- **Locations**: Around the outer ring (q2r-4, q4r-2, q2r2, q-2r4, q-4r2)
- **Value**: +1 point per turn
- **Visual**: Pink highlight

#### Mountain Heart (1 location)
- **Location**: Center hex (q-2r-2)
- **Value**: +2 points per turn
- **Visual**: Purple highlight
- **Strategic**: Most contested position on the board

### Capture Mechanic
A heart hex is controlled when a team places a plate on it:
```javascript
if (hexType === 'high-value' || hexType === 'center') {
    gameState.heartHexControl[coord] = teamId;
}
```

Hearts can be **stolen** by placing on them (if valid placement).

### Example Scenario
```
Team Alpha controls:
- 2 normal hearts = +2 pts/turn
- 1 mountain heart = +2 pts/turn
- Total heart bonus = +4 pts every turn

After 10 turns: +40 bonus points (in addition to base points)
```

## Complete Calculation Flow

```javascript
function calculatePoints() {
    gameState.teams.forEach(team => {
        // 1. Get all hexes owned by this team
        const teamPlates = Object.entries(gameState.board)
            .filter(([_, occupier]) => occupier === team.id)
            .map(([coord, _]) => coord);

        // 2. Calculate base points from adjacency (BoardModule)
        team.points = boardModule.calculateTeamPoints(teamPlates);

        // 3. Add heart hex bonuses
        Object.entries(gameState.heartHexControl).forEach(([heartHex, controllingTeam]) => {
            if (controllingTeam === team.id) {
                const hexType = getHexType(heartHex);
                team.points += hexType === 'center' ? 2 : 1;
            }
        });
    });
}
```

## Point Display

Points are displayed in multiple locations:
- **Team rankings** - Sorted by points (highest first)
- **Team cards** - Individual team displays
- **Scoreboard** - Overview of all teams
- **Stats panel** - Detailed statistics

### Ranking Icons
- 🥇 1st place
- 🥈 2nd place
- 🥉 3rd place
- 4., 5., etc. for remaining teams

## Real Example Calculation

**Team Alpha owns:**
- 8 connected hexes in one cluster
- 2 isolated hexes
- Controls 3 normal hearts
- Controls 1 mountain heart

**Calculation:**
```
Base points:
  8² + 1² + 1² = 64 + 1 + 1 = 66 points

Heart bonuses:
  3 normal hearts = +3 points
  1 mountain heart = +2 points
  Total bonus = +5 points

Total = 66 + 5 = 71 points
```

## Timing

Points are recalculated:
1. **After each plate placement** - Immediate feedback
2. **Before win condition check** - Ensures accuracy
3. **On game load** - Recalculates from board state

## Key Functions

- `calculatePoints()` - Main calculation (god-scripts.js:1961+)
- `boardModule.calculateTeamPoints(plates)` - Adjacency scoring
- `updateTeamsList()` - Update rankings display (god-scripts.js:2077+)

## Next Phase

After points are calculated, check if any team has won: [Phase 5: Win Condition Check](phase-5-win-condition.md).
