# 🧪 BoardGame System - Complete Testing Guide

## Purpose
This guide provides step-by-step testing scenarios to verify all features work correctly before your first live tournament.

---

## 🎯 Test Scenario 1: Complete Tournament Flow (30 minutes)

### Setup Phase
1. **Create Tournament**
   - [ ] Open `god.html`
   - [ ] Navigate to "🏆 Tournaments" tab
   - [ ] Click "Create New Tournament"
   - [ ] Fill in:
     - Tournament ID: `test-tournament-001`
     - Name: "Test LAN 2025"
     - Win Condition: 50 points
   - [ ] Click Save
   - [ ] **Expected:** Tournament appears in list with "Setup" status

2. **Add Teams**
   - [ ] Click on created tournament to load it
   - [ ] Navigate to "👥 Teams" tab
   - [ ] Add Team 1:
     - Name: "Red Dragons"
     - Color: Red (#de392c)
     - Players: Alice, Bob
   - [ ] Add Team 2:
     - Name: "Blue Phoenixes"
     - Color: Blue (#2278a3)
     - Players: Charlie, Diana
   - [ ] Add 3 more teams (for testing)
   - [ ] **Expected:** All 5 teams visible with correct colors

3. **Distribute Spells**
   - [ ] Navigate to "🔮 Spells" tab
   - [ ] Click "📥 Load Spell Definitions"
   - [ ] **Expected:** See "15 spell definitions loaded"
   - [ ] Click "🎲 Distribute Random Spells"
   - [ ] Enter: `3` spells per team
   - [ ] **Expected:** Each team has 3 random spells
   - [ ] Verify by selecting each team in dropdown

### Match Planning Phase
4. **Plan First Match**
   - [ ] Navigate to "🎮 Matches" tab
   - [ ] Scroll to "Manual Match Planning"
   - [ ] Drag Team 1 players to TEAM A
   - [ ] Drag Team 2 players to TEAM B
   - [ ] Select game: "Counter-Strike 2"
   - [ ] Select format: "2v2"
   - [ ] Click "Add to Queue"
   - [ ] **Expected:** Match appears in game queue

5. **Verify Player View**
   - [ ] Open `team.html` in new browser tab/window
   - [ ] Login as player from Team 1
   - [ ] **Expected:**
     - Team name and color shown
     - 3 spell cards visible
     - Upcoming match displayed
     - Team score = 0

### Match Execution Phase
6. **Cast Pre-Game Spell**
   - [ ] On `team.html`, find a pre-game spell (e.g., "Sabotage")
   - [ ] Click the spell card
   - [ ] **Expected:** Modal appears with spell details
   - [ ] Click "Cast Spell"
   - [ ] **Expected:**
     - Success message appears
     - Spell removed from hand
     - Spell appears in history

7. **Play External Match**
   - [ ] (Simulate) Team 1 wins CS2 match 16-14
   - [ ] Return to `god.html`
   - [ ] Navigate to "🎮 Matches" tab
   - [ ] Click on match in queue
   - [ ] Select "Team 1 Won"
   - [ ] Enter points: `10`
   - [ ] Click "Confirm Result"
   - [ ] **Expected:**
     - Team 1 points = 10
     - Match marked completed
     - Event appears in history

### Board Update Phase
8. **Place Tiles**
   - [ ] Navigate to "🎯 Board" tab
   - [ ] Select Team 1 (Red)
   - [ ] Click "Place Tile" button
   - [ ] Click on a hex on the board
   - [ ] **Expected:**
     - Red hex appears on board
     - Team 1 tile count increases

9. **Test Undo**
   - [ ] Click "Undo" button
   - [ ] **Expected:**
     - Hex removed from board
     - Points unchanged
   - [ ] Click "Redo"
   - [ ] **Expected:** Hex reappears

### Spectator View Phase
10. **Test Public Display**
    - [ ] Open `view.html?tournamentId=test-tournament-001` in new tab
    - [ ] **Expected:**
      - Tournament name displayed
      - All 5 teams shown with colors
      - Red team has 10 points
      - Match listed as completed
      - Board shows red hex
      - Firebase status = green

---

## 🔮 Test Scenario 2: Spell System (20 minutes)

### All Spell Types Test
Test each spell category to ensure mechanics work:

#### Pre-Game Spells
1. **Sabotage** (Ban spell)
   - [ ] Cast before match starts
   - [ ] Select opponent team
   - [ ] Specify banned element
   - [ ] **Expected:** Ban recorded in game state

2. **Echo of Silence** (Silence spell)
   - [ ] Cast before match
   - [ ] Select player to silence
   - [ ] **Expected:** Player marked as silenced

#### Instant Spells
3. **Mountain Purification** (Points spell)
   - [ ] Control 2 heart hexes
   - [ ] Cast spell after placing tile
   - [ ] **Expected:** Team gains 2 points (1 per heart)

4. **Victory Strike** (Permanent buff)
   - [ ] Cast spell
   - [ ] Capture a heart hex
   - [ ] **Expected:** Auto-gain 1 bonus point

#### Defensive Spells
5. **Elf Protection** (Shield spell)
   - [ ] Cast after losing a match
   - [ ] Attempt to remove team's tiles
   - [ ] **Expected:** Tiles protected (not removed)

#### Test Undo/Redo with Spells
6. **Spell Undo**
   - [ ] Cast any spell
   - [ ] Click "Undo"
   - [ ] **Expected:**
     - Spell returns to hand
     - Effects reversed
     - Points restored (if applicable)

7. **Spell Redo**
   - [ ] Click "Redo"
   - [ ] **Expected:**
     - Spell removed from hand again
     - Effects reapplied
     - Points awarded again

---

## 📊 Test Scenario 3: Multi-Device Real-Time Sync (15 minutes)

### Setup
- Device A: `god.html` (Admin)
- Device B: `team.html` (Player)
- Device C: `view.html` (Spectator)

### Tests
1. **Team Data Sync**
   - [ ] Device A: Change team name in god mode
   - [ ] Device B & C: Verify name updates immediately
   - [ ] **Expected:** < 2 second delay

2. **Spell Distribution Sync**
   - [ ] Device A: Add spell to team
   - [ ] Device B: Check spell appears in hand
   - [ ] **Expected:** New spell visible

3. **Match Result Sync**
   - [ ] Device A: Confirm match result
   - [ ] Device B: See team score update
   - [ ] Device C: See match move to "completed"
   - [ ] **Expected:** All update simultaneously

4. **Board State Sync**
   - [ ] Device A: Place tile on board
   - [ ] Device C: See tile appear on view display
   - [ ] **Expected:** Board renders correctly

---

## 🎮 Test Scenario 4: Match Queue System (15 minutes)

1. **Add Multiple Matches**
   - [ ] Plan Match 1: Team 1 vs Team 2 (CS2)
   - [ ] Plan Match 2: Team 3 vs Team 4 (Dota 2)
   - [ ] Plan Match 3: Team 1 vs Team 3 (CS2)
   - [ ] **Expected:** All 3 in queue, ordered correctly

2. **Match Editing**
   - [ ] Click "Edit" on Match 2
   - [ ] Change game to "Valorant"
   - [ ] **Expected:** Match updated in queue

3. **Match Deletion**
   - [ ] Click "Remove" on Match 3
   - [ ] Confirm deletion
   - [ ] **Expected:** Match removed from queue

4. **Match Completion Order**
   - [ ] Complete Match 1
   - [ ] **Expected:** Moves to "Completed Matches" section
   - [ ] Match 2 becomes active match

---

## 🐛 Test Scenario 5: Error Handling (10 minutes)

### Test Error Cases
1. **Network Disconnection**
   - [ ] Disconnect WiFi
   - [ ] Try to save tournament
   - [ ] **Expected:** Error message shown

2. **Invalid Data Entry**
   - [ ] Try to create team with no name
   - [ ] **Expected:** Validation error

3. **Spell Casting When Not Your Turn**
   - [ ] Try to cast spell when it's another team's turn
   - [ ] **Expected:** Error: "Cannot cast during this phase"

4. **Casting Spell You Don't Have**
   - [ ] Manually try to cast spell not in hand
   - [ ] **Expected:** Error: "Team does not have this spell"

---

## 📋 Test Scenario 6: Tournament Lifecycle (25 minutes)

### Full Tournament Test
1. **Tournament Creation**
   - [ ] Create tournament with all settings
   - [ ] Status = "Setup"

2. **Tournament Start**
   - [ ] Click "Start Tournament"
   - [ ] Status changes to "Playing"
   - [ ] Current round = 1

3. **Round Progression**
   - [ ] Complete all matches in round 1
   - [ ] System auto-advances to round 2
   - [ ] Round counter updates

4. **Win Condition Check**
   - [ ] Give Team 1 exactly 50 points (win condition)
   - [ ] **Expected:** Tournament auto-completes
   - [ ] Status = "Finished"
   - [ ] Winner announced

5. **Tournament Archive**
   - [ ] Click "Archive Tournament"
   - [ ] **Expected:** Moved to archives
   - [ ] No longer in active list

---

## ✅ Acceptance Criteria

### Critical (Must Pass)
- [ ] All Firebase operations work (create, read, update)
- [ ] Real-time updates sync across devices
- [ ] Spell system works for all 15 spells
- [ ] Undo/redo works for all action types
- [ ] Tournament workflow completes end-to-end
- [ ] No console errors during normal operations
- [ ] All team colors display correctly

### Important (Should Pass)
- [ ] Match queue system works smoothly
- [ ] Board visualization renders correctly
- [ ] Spell history tracks accurately
- [ ] User roles enforced properly
- [ ] Error messages are user-friendly

### Nice-to-Have
- [ ] Animations are smooth
- [ ] Mobile layout works reasonably
- [ ] Loading states show properly
- [ ] Tooltips display helpfully

---

## 🎯 Quick Smoke Test (5 minutes)

Before any event, run this quick test:

1. [ ] Open `god.html` → Firebase green?
2. [ ] Load test tournament → Teams visible?
3. [ ] Open `team.html` → Spells visible?
4. [ ] Open `view.html` → Display correct?
5. [ ] Cast 1 spell → Works?
6. [ ] Undo 1 action → Works?
7. [ ] Confirm 1 match → Points update?

**If all pass:** System ready for event ✅
**If any fail:** Debug before starting tournament ⚠️

---

## 📊 Test Results Template

Copy this template to track your test results:

```
DATE: __________
TESTER: __________
VERSION: v1.0-spell-system

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Tournament Flow | ⬜ Pass ⬜ Fail | |
| 2. Spell System | ⬜ Pass ⬜ Fail | |
| 3. Multi-Device Sync | ⬜ Pass ⬜ Fail | |
| 4. Match Queue | ⬜ Pass ⬜ Fail | |
| 5. Error Handling | ⬜ Pass ⬜ Fail | |
| 6. Tournament Lifecycle | ⬜ Pass ⬜ Fail | |

OVERALL: ⬜ Ready for Production ⬜ Needs Fixes

BLOCKERS:
-
-

RECOMMENDATIONS:
-
-
```

Good luck with testing! 🚀
