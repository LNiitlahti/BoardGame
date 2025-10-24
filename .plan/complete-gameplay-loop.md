# Complete Gameplay Loop

## Full Tournament Lifecycle

```
╔══════════════════════════════════════════════════════════════════╗
║                     🎮 FULL GAMEPLAY CYCLE                       ║
╚══════════════════════════════════════════════════════════════════╝

    START → Setup Tournament (PHASE 1)
              ↓
         Playing Status
              ↓
        ┌─────────────────────────────────┐
        │                                 │
        ↓                                 ↑
    Plan Match (PHASE 2)                  │
        ↓                                 │
    Add to Queue                          │
        ↓                                 │
    Play Match (External)                 │
        ↓                                 │
    Confirm Result                        │
        ↓                                 │
    Create Turn Queue ← NEW! (Multi-team) │
        ↓                                 │
    Team 1 Places Plate (PHASE 3)         │
        ↓                                 │
    Team 2 Places Plate                   │
        ↓                                 │
    Team N Places Plate                   │
        ↓                                 │
    Calculate Points (PHASE 4)            │
        ↓                                 │
    Check Win Condition (PHASE 5)         │
        ↓                                 │
    Winner? ─NO─────────────────────────────┘
        │
       YES
        ↓
    🏆 Tournament Finished!
```

## Detailed Phase Breakdown

### Phase 1: Tournament Setup
**File**: [phase-1-tournament-setup.md](phase-1-tournament-setup.md)
- Admin creates tournament
- Configure win condition
- Select games
- Create teams with auto-assigned colors
- Save to Firebase

### Phase 2: Match Cycle
**File**: [phase-2-match-cycle.md](phase-2-match-cycle.md)
- Plan matches (automatic or manual)
- Add to game queue
- Play match externally
- Confirm result in system
- Identify winning teams
- Create turn queue for all winners

### Phase 3: Hex Board Placement
**File**: [phase-3-hex-board-placement.md](phase-3-hex-board-placement.md)
- **NEW**: Multi-team turn support
- Each winning team places one plate
- Turn queue manages multiple teams
- Validate placement rules
- Capture heart hexes
- Advance to next team in queue

### Phase 4: Point Calculation
**File**: [phase-4-point-calculation.md](phase-4-point-calculation.md)
- Calculate base points (adjacency clusters)
- Add heart hex bonuses
- Update team rankings
- Refresh UI displays

### Phase 5: Win Condition Check
**File**: [phase-5-win-condition.md](phase-5-win-condition.md)
- Check if any team reached win condition
- If no: Return to Phase 2 (plan next match)
- If yes: Declare winner, lock tournament

## Key Cycle Characteristics

### Continuous Loop
- Phases 2-5 repeat until victory
- Each match → plate placement → point calculation → win check
- Can run indefinitely until win condition met

### Multi-Team Innovation
The **Turn Queue System** (Phase 3) is a key innovation:
- Multiple teams can win a single match as allies
- Each allied winner gets their own turn
- Turns process sequentially
- All teams place before returning to Phase 2

### Example Full Cycle

```
1. Setup (Phase 1)
   - Create "Summer Tournament 2024"
   - Win condition: 50 points
   - 5 teams created

2. First Match (Phase 2)
   - Plan: Team A vs Team B in CS2
   - Play match
   - Team A wins
   - Turn queue: [Team A]

3. Board Placement (Phase 3)
   - Team A places plate at q0r0
   - Captures normal heart
   - Points calculated: 1 + 1 = 2 points

4. Point Calc (Phase 4)
   - Team A: 2 points
   - Others: 0 points

5. Win Check (Phase 5)
   - Highest: 2 points
   - Win condition: 50 points
   - Continue → Back to Phase 2

6. Second Match (Phase 2)
   - Plan: Team C vs Team D in Dota 2
   - Team C wins
   - Turn queue: [Team C]

7. Board Placement (Phase 3)
   - Team C places plate at q4r0
   - Points: 1 point

... (Cycle continues)

50. Final Match (Phase 2)
    - Team A vs Team E in Valorant
    - Team A wins (allied with Team C)
    - Turn queue: [Team A, Team C]

51. Board Placement (Phase 3)
    - Team A places plate (connects huge cluster)
    - Team C places plate
    - Points calculated

52. Point Calc (Phase 4)
    - Team A: 52 points (cluster of 7²=49 + hearts)
    - Team C: 45 points

53. Win Check (Phase 5)
    - Team A: 52 >= 50
    - 🏆 WINNER!
    - Tournament finished
```

## Time Estimates

### Per Cycle (Match → Placement → Points)
- Match planning: 1-2 minutes
- External match: 15-45 minutes (varies by game)
- Result confirmation: 30 seconds
- Plate placement: 30 seconds per team
- Point calculation: Instant
- Win check: Instant

**Total per cycle**: ~20-50 minutes

### Full Tournament
- With 5 teams and 50 point goal
- Estimate: 10-20 matches needed
- Total time: 3-10 hours (depending on match length)

## Parallel Activities

While matches are being played externally:
- Admin can plan next matches
- View page updated in real-time
- Players can check standings
- Multiple queued matches possible

## State Persistence

All state saved to Firebase after:
- Tournament creation
- Match confirmation
- Each plate placement
- Status changes

This allows:
- Resume after interruptions
- Multiple admins working together
- Real-time updates across devices
- Full audit trail

## Visual Journey

```
[Setup Screen]
     ↓
[Match Planning]
     ↓
[Game Queue] ─→ [External Match] ─→ [Confirm Result]
     ↑                                      ↓
     │                              [Turn Queue Created]
     │                                      ↓
     │                              [Team 1 Places]
     │                                      ↓
     │                              [Team 2 Places]
     │                                      ↓
     │                              [Points Updated]
     │                                      ↓
     │                              [Rankings Shown]
     │                                      ↓
     └──────────────────────────────[Check Winner?]
                                            │
                                       [NO] │ [YES]
                                            ↓
                                    [Victory Screen]
```

## User Roles in Loop

### God/Admin
- Creates tournament
- Plans matches
- Confirms results
- Places plates (on behalf of teams)
- Monitors progress

### Players/Teams
- Play external matches
- Report results to admin
- Watch view page for standings
- Strategize next moves

### Spectators
- Watch view page
- See live updates
- Track favorite teams

## Integration Points

### Pages Involved
1. **setup.html** - Phase 1 (tournament creation)
2. **god.html** - Phases 2-5 (main game loop)
3. **view.html** - Real-time display (read-only)

### Scripts Involved
1. **config.js** - Team colors
2. **tournament-manager.js** - Tournament CRUD
3. **god-scripts.js** - Main game logic
4. **board-module.js** - Board validation
5. **board-renderer.js** - Visual rendering
6. **action-history.js** - Undo/redo support

### Firebase Collections
- **tournaments/** - All tournament data
- **users/** - User accounts (for authentication)

## Next Steps

For detailed information about each phase, see individual phase documents:
1. [Phase 1: Tournament Setup](phase-1-tournament-setup.md)
2. [Phase 2: Match Cycle](phase-2-match-cycle.md)
3. [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md)
4. [Phase 4: Point Calculation](phase-4-point-calculation.md)
5. [Phase 5: Win Condition Check](phase-5-win-condition.md)

See [Firebase Data Structure](firebase-data-structure.md) for complete data model.
