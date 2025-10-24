# 📝 Name Change Tracking System

**Version:** 2.0 (ID-Based)
**Last Updated:** October 24, 2025

---

## 🎯 Overview

The BoardGame Tournament System uses **ID-based references** to ensure historical accuracy even when teams or players change names mid-tournament.

**Problem Solved:** If a team renames from "Team A" to "Team Alpha" after Match 1, we need to:
- Show historical matches with the correct name at match time ("Team A won")
- Link to the current team (now called "Team Alpha")
- Track the complete rename history

**Solution:** The system uses **artificial IDs** for everything:
1. **Team IDs never change** - Team 1 is always Team 1, regardless of name
2. **Player UIDs never change** - Players tracked by Firebase UID
3. **Names are looked up dynamically** - Fetch current or historical name as needed
4. **nameHistory tracks all renames** - Complete audit trail in team objects

---

## 🔑 Key Features

### 1. ID-Based Match Records

Match results store **only IDs**, no redundant names:

```json
{
  "id": 3,
  "game": "CS2",
  "winningTeamIds": [1, 3],      // IDs only!
  "losingTeamIds": [2, 4],        // IDs only!
  "matchup": {
    "teamASide": [
      {"uid": "abc123", "teamId": 1},
      {"uid": "def456", "teamId": 1}
    ],
    "teamBSide": [
      {"uid": "ghi789", "teamId": 2},
      {"uid": "jkl012", "teamId": 2}
    ]
  },
  "timestamp": "2025-10-12T21:08:30.717Z"
}
```

**Benefits:**
- ✅ **Single source of truth** - Names only stored in team objects
- ✅ **No data duplication** - Match records are lightweight
- ✅ **Always current** - Lookups always get latest data
- ✅ **Historical accuracy** - Use `nameHistory` to get name at match time

### 2. Name Change History

Each team object tracks its rename history:

```json
{
  "id": 1,
  "name": "Team Alpha Warriors",
  "color": "red",
  "nameHistory": [
    {
      "oldName": "Team A",
      "newName": "Team Alpha",
      "changedAt": "2025-10-15T14:30:00Z",
      "changedBy": "admin@tournament.com"
    },
    {
      "oldName": "Team Alpha",
      "newName": "Team Alpha Warriors",
      "changedAt": "2025-10-18T10:15:00Z",
      "changedBy": "admin@tournament.com"
    }
  ]
}
```

**Tracked Information:**
- Old name (before change)
- New name (after change)
- Timestamp (when changed)
- Changed by (who made the change)

### 3. Player Identification with UIDs

Players are identified **only by UID**, no names stored in matches:

```json
{
  "matchup": {
    "teamASide": [
      {
        "uid": "jmZmyE7YTVgsMzWB5UHZxjVn7jS2",
        "teamId": 1
      }
    ]
  }
}
```

**To get player name:**
```javascript
// Look up by UID in team roster
const team = teams.find(t => t.id === teamId);
const player = team.players.find(p => p.uid === uid);
const playerName = player.name;  // Current name
```

**Benefits:**
- ✅ Player can change name, UID stays same
- ✅ Can track individual player performance across name changes
- ✅ Links to Firebase user authentication
- ✅ No stale player names in old matches

### 4. Visual Name Change Indicators

When viewing match history, if teams have been renamed, you'll see:

```
Match #1 - CS2 5v5
🏆 Winner: Team A & Team C
Loser: Team B & Team D

ℹ️ Name changes: "Team A" is now "Team Alpha Warriors", "Team C" is now "Team Champions"
```

---

## 📊 Export Format v2.0

Exports use **ID-based references** with `nameHistory` in teams:

```json
{
  "exportVersion": "2.0",
  "exportNotes": "This export uses ID-based references. Team and player names should be looked up by ID. Team nameHistory tracks all renames.",
  "tournamentId": "tournament-2025",
  "tournamentName": "Fall Championship 2025",
  "exportedAt": "2025-10-24T18:54:22.208Z",

  "matchHistory": [
    {
      "id": 1,
      "winningTeamIds": [1, 3],     // IDs only
      "losingTeamIds": [2, 4],       // IDs only
      "matchup": {
        "teamASide": [
          {"uid": "abc123", "teamId": 1}  // UIDs + team IDs
        ]
      },
      "timestamp": "2025-10-12T21:08:30.717Z"
    }
  ],

  "teams": [
    {
      "id": 1,
      "name": "Team Alpha Warriors",  // Current name
      "nameHistory": [                 // Rename history
        {"oldName": "Team A", "newName": "Team Alpha", "changedAt": "..."},
        {"oldName": "Team Alpha", "newName": "Team Alpha Warriors", "changedAt": "..."}
      ]
    }
  ]
}
```

**To analyze exports:**
1. Look up team by ID in `teams` array
2. Use `nameHistory` to find name at specific timestamp
3. Player names: Look up UID in team roster

---

## 🔄 How It Works

### When a Match is Confirmed:

1. **System stores only IDs:**
   ```javascript
   const result = {
       id: 1,
       game: "CS2",
       winningTeamIds: [1, 3],      // Store IDs only
       losingTeamIds: [2, 4],        // Store IDs only
       matchup: {
           teamASide: players.map(p => ({
               uid: p.uid,           // Player UID
               teamId: p.teamId      // Team ID
           }))
       },
       timestamp: new Date().toISOString()
   };
   gameState.gameHistory.push(result);
   ```

2. **No names stored in match record** - keeps data clean and normalized

### When a Team is Renamed:

1. **Admin clicks team name to edit in god mode**

2. **System records the change:**
   ```javascript
   team.nameHistory.push({
       oldName: "Team A",
       newName: "Team Alpha",
       changedAt: new Date().toISOString(),
       changedBy: currentUser.email
   });
   team.name = "Team Alpha";
   ```

3. **Saved to Firebase immediately**

4. **Match history shows name change indicator**

### When Viewing History:

1. **System looks up names by ID using nameHistory:**
   ```javascript
   function getTeamNameAtTime(teamId, timestamp) {
       const team = teams.find(t => t.id === teamId);
       if (!team.nameHistory || team.nameHistory.length === 0) {
           return team.name;  // No renames, use current name
       }

       // Walk through nameHistory to find name at that time
       const matchTime = new Date(timestamp).getTime();
       let nameAtTime = team.name;

       for (let i = team.nameHistory.length - 1; i >= 0; i--) {
           const change = team.nameHistory[i];
           if (new Date(change.changedAt).getTime() > matchTime) {
               nameAtTime = change.oldName;  // Change was after match
           } else {
               break;  // Change was before match, we found it
           }
       }

       return nameAtTime;
   }
   ```

2. **Display shows historical name:**
   ```javascript
   const winnerName = getTeamNameAtTime(1, match.timestamp);  // "Team A"
   const currentName = teams.find(t => t.id === 1).name;       // "Team Alpha"

   // Show: "Winner: Team A" with note "Team A is now Team Alpha"
   ```

---

## 📈 Benefits for Analysis

### Historical Accuracy
- **Before:** "Team A won 5 matches" but Team A doesn't exist anymore
- **After:** "Team 1 (currently 'Team Alpha Warriors', formerly 'Team A') won 5 matches"

### Player Tracking
- **Before:** Can't track player if they change name
- **After:** UID tracks player across all name changes

### Export Analysis
When analyzing exports months later:

```python
# Python analysis example
import json

with open('tournament-export.json') as f:
    data = json.load(f)

# Get all matches for team ID 1
team_1_matches = [
    match for match in data['matchHistory']
    if 1 in match['winningTeamIds'] or 1 in match['losingTeamIds']
]

# Check what team 1 was called during each match
for match in team_1_matches:
    name_at_match_time = match['teamNamesSnapshot']['1']
    print(f"Match {match['id']}: Team 1 was called '{name_at_match_time}'")

# Current name
current_name = next(t['name'] for t in data['teams'] if t['id'] == 1)
print(f"Team 1 is currently called '{current_name}'")
```

---

## 🧪 Testing Name Changes

### Test Scenario 1: Mid-Tournament Rename

1. Create tournament with 5 teams
2. Play 2 matches
3. Rename "Tiimi 1" to "Super Team 1"
4. Play 2 more matches
5. **Verify:**
   - First 2 matches show "Tiimi 1"
   - Last 2 matches show "Super Team 1"
   - Name change indicator appears on first 2 matches
   - Export includes rename in `teamNameChanges`

### Test Scenario 2: Multiple Renames

1. Rename team: "Team A" → "Team Alpha"
2. Play matches
3. Rename team: "Team Alpha" → "Team Alpha Warriors"
4. **Verify:**
   - `nameHistory` has 2 entries
   - Old matches show correct historical names
   - Export shows complete rename chain

### Test Scenario 3: Player Name Changes

1. Player "Alice" plays matches
2. Change player name to "Alice Cooper"
3. **Verify:**
   - Old matches still show "Alice"
   - UID is same in all matches
   - Can track all of Alice's matches via UID

---

## 🔍 Troubleshooting

### Issue: Old matches don't have `teamNamesSnapshot`

**Cause:** Matches created before v2.0 upgrade
**Solution:**
- New matches automatically get snapshots
- Old matches show team IDs only
- Consider re-entering critical historical matches

### Issue: Name change history not showing

**Cause:** Team renamed before v2.0
**Solution:**
- Only tracks changes after system upgrade
- Can manually add to `nameHistory` array via Firebase

### Issue: Player UID is null

**Cause:** Player not properly linked to Firebase user
**Solution:**
- Ensure player has Firebase UID in team roster
- Falls back to email if UID unavailable

---

## 📝 Data Migration Notes

### Upgrading from v1.x to v2.0

**Existing tournaments:**
- Continue to work without issues
- New matches get v2.0 features automatically
- Old match data remains unchanged

**Manual migration (optional):**
If you want to add snapshots to old matches:

```javascript
// In Firebase console or admin script
gameHistory.forEach(match => {
    if (!match.teamNamesSnapshot) {
        const snapshot = {};
        [...match.winningTeamIds, ...match.losingTeamIds].forEach(id => {
            const team = teams.find(t => t.id === id);
            snapshot[id] = team.name;  // Use current name
        });
        match.teamNamesSnapshot = snapshot;
    }
});
```

**Note:** This uses *current* names, not historical names. Best for recent tournaments where names haven't changed yet.

---

## 💡 Best Practices

1. **Avoid renaming during active tournament** - Rename between tournaments when possible

2. **Document rename reasons** - Add tournament notes explaining why teams renamed

3. **Export regularly** - Back up data before major changes

4. **Check history after rename** - Verify old matches show name change indicators

5. **Use meaningful team names** - Helps with long-term analysis

---

## 🎯 Summary

The ID-based name change tracking system ensures your tournament data remains accurate and analyzable forever, regardless of how many times teams or players change names.

**Key Design Principles:**
- ✅ **Store IDs, not names** - All match records use team IDs and player UIDs
- ✅ **Single source of truth** - Names only stored in team/player objects
- ✅ **Dynamic lookups** - Fetch names at display time
- ✅ **Complete audit trail** - nameHistory tracks all changes
- ✅ **Historical accuracy** - Function to get name at any timestamp
- ✅ **Visual feedback** - Rename indicators in match history

**Data Integrity:**
- ✅ Team IDs never change (stable reference)
- ✅ Player UIDs never change (stable reference)
- ✅ `nameHistory` array preserves complete rename chain
- ✅ Timestamps allow temporal lookups
- ✅ Smaller, cleaner match records

---

**Questions or Issues?**
Check the main documentation or review Firebase data structure for more details.
