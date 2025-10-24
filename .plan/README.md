# BoardGame - Gameplay Documentation

Welcome to the BoardGame gameplay documentation! This folder contains detailed visualizations and explanations of the complete game system.

## 📚 Documentation Index

### 🎮 Complete Overview
**[Complete Gameplay Loop](complete-gameplay-loop.md)**
- Full tournament lifecycle from start to finish
- High-level overview of all phases
- Integration between systems
- **Start here for the big picture!**

---

### 📋 Phase-by-Phase Breakdown

#### [Phase 1: Tournament Setup](phase-1-tournament-setup.md)
- Creating a new tournament
- Configuring teams and players
- Setting win conditions
- Initial data structure

#### [Phase 2: Match Cycle](phase-2-match-cycle.md)
- Planning matches (automatic vs manual)
- Game queue system
- Confirming match results
- Multi-team winner support

#### [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md) ⭐ **NEW FEATURE**
- Multi-team turn queue system
- Placement validation rules
- Heart hex capture mechanics
- Turn advancement logic

#### [Phase 4: Point Calculation](phase-4-point-calculation.md)
- Base points (adjacency clusters)
- Bonus points (heart hexes)
- Scoring formulas and examples
- Strategic implications

#### [Phase 5: Win Condition Check](phase-5-win-condition.md)
- Win detection logic
- Tournament completion
- Victory displays
- Archiving system

---

### 💾 Technical Documentation

#### [Firebase Data Structure](firebase-data-structure.md)
- Complete data model
- Field descriptions
- Data flow diagrams
- Backup strategies
- Security rules

---

## 🎯 Quick Navigation by Role

### For Game Designers
1. [Complete Gameplay Loop](complete-gameplay-loop.md) - Understand the full game
2. [Phase 4: Point Calculation](phase-4-point-calculation.md) - Scoring mechanics
3. [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md) - Board strategy

### For Developers
1. [Firebase Data Structure](firebase-data-structure.md) - Data model
2. [Complete Gameplay Loop](complete-gameplay-loop.md) - System integration
3. Individual phase docs for implementation details

### For Administrators
1. [Phase 1: Tournament Setup](phase-1-tournament-setup.md) - Creating tournaments
2. [Phase 2: Match Cycle](phase-2-match-cycle.md) - Running matches
3. [Phase 5: Win Condition Check](phase-5-win-condition.md) - Finishing tournaments

---

## 🆕 Recent Updates

### Multi-Team Turn System (Latest)
**What's New:**
- Multiple teams can win a match as allies
- Each winning team gets their own turn to place a plate
- Turn queue manages sequential placements
- UI shows waiting teams

**Impact:**
- More strategic depth (alliances matter!)
- Fairer reward distribution
- Better balance for team-based matches

**See:** [Phase 3: Hex Board Placement](phase-3-hex-board-placement.md)

### Color Configuration System
**What's New:**
- Centralized color config in `scripts/config.js`
- Team colors stored in Firebase
- Consistent colors across all pages

**See:** `BoardGame/scripts/config.js`

---

## 🎲 Game Concept Summary

**BoardGame** is a hybrid competitive system that combines:

1. **Esports Matches** (CS2, Dota 2, Valorant, etc.)
   - Teams compete in external matches
   - Results recorded in the system

2. **Hex Board Strategy Game**
   - Winners place plates on a hex grid
   - Form clusters for exponential points
   - Capture heart hexes for passive bonuses
   - First to X points wins tournament

**Think:** Esports tournament + Catan-style territory control

---

## 📊 Typical Tournament Flow

```
1. Admin creates tournament          [5 minutes]
2. Configure teams & games           [10 minutes]
3. Start tournament                  [instant]

--- GAME LOOP BEGINS ---
4. Plan match                        [2 minutes]
5. Teams play match                  [20-45 minutes]
6. Confirm result                    [1 minute]
7. Winner(s) place plates           [1 minute per team]
8. Points calculated                [instant]
9. Check winner                     [instant]
10. Repeat steps 4-9                [until win condition]
--- GAME LOOP ENDS ---

11. Declare champion                [instant]
12. Archive tournament              [1 minute]

Total time: 3-10 hours (depending on number of matches)
```

---

## 🔑 Key Terms

| Term | Definition |
|------|------------|
| **Tournament** | A complete game session with teams, matches, and board |
| **Match/Game** | External esports match (CS2, Dota, etc.) |
| **Plate** | A team's marker placed on the hex board |
| **Heart Hex** | Special hex that gives bonus points per turn |
| **Mountain Heart** | Center hex worth 2x normal heart |
| **Turn Queue** | List of teams waiting to place plates |
| **Cluster** | Connected group of plates (worth n²) |
| **Win Condition** | Points needed to win (default: 50) |

---

## 📁 File Structure

```
.plan/
├── README.md                          ← You are here
├── complete-gameplay-loop.md          ← Full overview
├── phase-1-tournament-setup.md        ← Setup phase
├── phase-2-match-cycle.md             ← Match planning
├── phase-3-hex-board-placement.md     ← Board placement
├── phase-4-point-calculation.md       ← Scoring system
├── phase-5-win-condition.md           ← Victory conditions
└── firebase-data-structure.md         ← Data model
```

---

## 🛠️ Related Code Files

### Core Scripts
- `BoardGame/scripts/config.js` - Color configuration
- `BoardGame/scripts/god-scripts.js` - Main game logic
- `BoardGame/scripts/board-module.js` - Board validation
- `BoardGame/scripts/board-renderer.js` - Visual rendering
- `BoardGame/scripts/tournament-manager.js` - Tournament CRUD
- `BoardGame/scripts/match-scheduler.js` - AI match planning

### Pages
- `BoardGame/setup.html` - Tournament creation wizard
- `BoardGame/god.html` - Admin control panel
- `BoardGame/view.html` - Live scoreboard display

### Styles
- `BoardGame/css/styles.css` - Main styles (includes team colors)
- `BoardGame/css/god_styles.css` - Admin panel styles

---

## 🤝 Contributing

When updating gameplay mechanics:
1. Update the relevant phase documentation
2. Update [Complete Gameplay Loop](complete-gameplay-loop.md) if cycle changes
3. Update [Firebase Data Structure](firebase-data-structure.md) if data model changes
4. Add version notes to this README

---

## 📞 Support

For questions or clarifications:
- Check the relevant phase documentation
- Review code comments in related files
- Consult [Firebase Data Structure](firebase-data-structure.md) for data questions

---

## 🎮 Enjoy the Game!

This documentation provides a complete understanding of how BoardGame works. Whether you're setting up a tournament, developing new features, or just curious about the mechanics, you'll find everything you need here.

**Happy gaming! 🏆**
