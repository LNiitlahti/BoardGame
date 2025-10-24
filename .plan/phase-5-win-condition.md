# Phase 5: Win Condition Check

## Win Condition Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    🏁 CHECK WIN CONDITION                         │
└──────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
                    ┌──────────────────────────┐
                    │  After each plate placed │
                    │  checkWinCondition()     │
                    └──────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │  Any team.points >=       │
                    │  winCondition?            │
                    └─────────────┬─────────────┘
                         NO │          │ YES
                            │          │
                            ↓          ↓
                ┌──────────────┐   ┌──────────────────────┐
                │ Continue     │   │ 🏆 GAME OVER!        │
                │ game loop    │   │                      │
                │              │   │ gamePhase = finished │
                └──────────────┘   │ finishedAt = now     │
                      │            └──────────────────────┘
                      │                       │
                      │                       ↓
                      │            ┌──────────────────────┐
                      │            │ Display winner       │
                      │            │ Log final standings  │
                      │            │ Tournament locked    │
                      │            └──────────────────────┘
                      │
                      ↓
    ┌────────────────────────────────────────┐
    │  Return to PHASE 2: Plan next match    │
    └────────────────────────────────────────┘
```

## Win Condition Logic

### Simple Check
```javascript
function checkWinCondition() {
    if (!gameState?.teams) return;

    const winner = gameState.teams.find(
        team => team.points >= gameState.winCondition
    );

    if (winner) {
        // Game over!
        gameState.gamePhase = 'finished';
        gameState.finishedAt = new Date().toISOString();

        addLog(`🏆 GAME OVER! ${winner.name} wins with ${winner.points} points!`, 'success');
        showStatus(`🏆 ${winner.name} wins the game!`, 'success');
    }
}
```

### Multiple Teams Can Win
If multiple teams reach the win condition simultaneously:
- **First team found wins** (array order determines tiebreaker)
- Can be enhanced to:
  - Award win to highest scorer
  - Declare a tie
  - Trigger sudden death round

## Win Condition Types

### Standard Point-Based (Current)
- Default: 50 points
- Configurable during tournament setup
- Can be 10-500 points

### Potential Extensions
1. **Time-based**: First to X points within Y turns
2. **Domination**: Control all heart hexes simultaneously
3. **Elimination**: Last team with plates on board
4. **Hybrid**: Multiple conditions (e.g., 50 pts OR control center for 3 turns)

## Game Phase States

```javascript
gameState.gamePhase = "setup" | "playing" | "finished"
```

### Setup Phase
- Tournament created but not started
- Teams being configured
- No matches played yet

### Playing Phase
- Active tournament
- Matches being planned and played
- Board being modified
- Default state after tournament starts

### Finished Phase
- Winner declared
- No more matches can be added
- Board locked (no more placements)
- Tournament archived

## Post-Victory Actions

### What Happens When Game Ends

1. **Lock the Board**
   - No more plate placements allowed
   - `currentTurn = null`
   - Turn queue cleared

2. **Update Tournament Status**
   ```javascript
   {
     gamePhase: "finished",
     finishedAt: "2024-01-15T15:30:00.000Z",
     winner: {
       teamId: 3,
       teamName: "Team Charlie",
       finalScore: 52,
       gamesWon: 8
     }
   }
   ```

3. **UI Updates**
   - Victory banner displayed
   - Leaderboard shows final standings
   - Board renderer shows final state
   - Match planning disabled

4. **Notifications**
   - Log message: "🏆 GAME OVER! Team Charlie wins with 52 points!"
   - Status message for admin
   - (Future: Email notifications, Discord webhooks, etc.)

5. **Data Preservation**
   - Full game history preserved
   - Final board state saved
   - All match records intact
   - Can be reviewed later

## Tournament Archiving

After a tournament finishes, admin can:

### Archive Tournament
```javascript
// Change status to archived
tournament.status = "archived";
tournament.archivedAt = new Date().toISOString();
```

Archived tournaments:
- Removed from active list
- Can be viewed in archive
- Can be duplicated for new tournament
- Historical data preserved

### Delete Tournament
- Permanently removes from database
- Cannot be recovered
- Should require confirmation

## Victory Analytics

### Metrics Captured
```javascript
{
  winner: {
    teamId: 3,
    teamName: "Team Charlie",
    finalScore: 52,
    gamesWon: 8,
    gamesLost: 2,
    totalPlatesPlaced: 15,
    heartsControlled: 4,
    largestCluster: 12,
    timeToVictory: "2h 45m"
  },
  runnerUp: {
    teamId: 1,
    finalScore: 48,
    // ...
  }
}
```

## Restart/Rematch Options

Admin can create a rematch:
1. Duplicate tournament
2. Reset board and scores
3. Keep same teams
4. Start fresh tournament

## Key Functions

- `checkWinCondition()` - Check for winner (god-scripts.js:1991+)
- `updateTournamentStatus()` - Update tournament state
- `archiveTournament()` - Archive finished tournament (tournament-manager.js)

## Leaderboard Display

Final standings show:
```
🏆 TOURNAMENT CHAMPION: Team Charlie (52 points)

Final Standings:
🥇 Team Charlie - 52 pts (8 wins, 2 losses)
🥈 Team Alpha - 48 pts (7 wins, 3 losses)
🥉 Team Beta - 45 pts (6 wins, 4 losses)
4. Team Delta - 38 pts (5 wins, 5 losses)
5. Team Echo - 32 pts (4 wins, 6 losses)
```

## Integration with Other Systems

### View Page (view.html)
- Shows final board state
- Displays winner banner
- Read-only mode
- Shareable link for participants

### Statistics
- Added to tournament statistics
- Historical performance tracking
- Can analyze winning strategies

## Return to Cycle

If game is NOT finished:
- Continue to [Phase 2: Match Cycle](phase-2-match-cycle.md)
- Plan and play more matches
- Keep placing plates
- Keep accumulating points

## Complete Loop

See [Complete Gameplay Loop](complete-gameplay-loop.md) for full cycle visualization.
