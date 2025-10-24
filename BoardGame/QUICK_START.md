# ⚡ Quick Start Guide - BoardGame Tournament System

**Get your first tournament running in 10 minutes!**

---

## 🎯 Your First Tournament in 4 Steps

### Step 1: Setup Firebase (2 minutes)

```
1. Edit scripts/firebase.js
2. Add your Firebase config
3. Save file
```

**Test:** Open any page → Check Firebase indicator turns GREEN

---

### Step 2: Upload Spells (1 minute)

```
1. Open: upload-spells.html
2. Click: "Upload to Firebase"
3. Wait for: "Successfully uploaded 15 spells"
```

**Done!** Spells ready for use.

---

### Step 3: Create Tournament (5 minutes)

**Open:** `god.html`

```
📊 Tournaments Tab:
  → Click "Create New Tournament"
  → ID: my-first-lan
  → Name: Test Tournament 2025
  → Win Condition: 50
  → Save

👥 Teams Tab:
  → Add Team: "Red Team" (players: Alice, Bob)
  → Add Team: "Blue Team" (players: Charlie, Diana)
  → Add 3 more teams (5 teams total)

🔮 Spells Tab:
  → Click "Load Spell Definitions"
  → Click "Distribute Random Spells"
  → Enter: 3 spells per team
```

**Test:** All teams should have colors and 3 spells each

---

### Step 4: Start Playing (2 minutes)

```
🎮 Matches Tab:
  → Drag players to TEAM A and TEAM B
  → Select game: "Counter-Strike 2"
  → Click "Add to Queue"

Players:
  → Open: team.html
  → Login
  → See spells and match info

Spectators:
  → Open: view.html?tournamentId=my-first-lan
  → Watch in real-time
```

**You're playing!** 🎉

---

## 📱 Who Opens What?

| Role | Page | Purpose |
|------|------|---------|
| **Admin** | `god.html` | Create tournaments, manage everything |
| **Players** | `team.html` | View team info, cast spells |
| **Everyone** | `view.html` | Watch tournament on big screen |

---

## 🎮 Common Workflows

### Workflow: Plan a Match

```
god.html → Matches Tab
→ Drag players to teams
→ Select game
→ Add to queue
✅ Done! Match appears for players
```

### Workflow: Confirm Match Result

```
(Play match externally)
→ god.html → Matches Tab
→ Click match in queue
→ Select winner
→ Enter points
→ Confirm
✅ Team scores update!
```

### Workflow: Cast a Spell

```
team.html
→ Click spell card
→ Read description
→ Click "Cast Spell"
→ Confirm
✅ Spell effect applies!
```

### Workflow: Place Tile on Board

```
god.html → Board Tab
→ Select team color
→ Click "Place Tile"
→ Click hex on board
✅ Tile appears!
```

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| Firebase won't connect | Check firebase.js config |
| Can't login | Create user in Firebase Auth |
| No admin access | Add isAdmin: true to user doc |
| Spells not showing | Click "Load Spell Definitions" |
| Real-time not working | Check security rules in Firebase |

---

## 💡 Pro Tips

1. **Test First**: Create test tournament before real event
2. **Have Backup**: Keep spreadsheet ready just in case
3. **Network Check**: Ensure all devices on same network
4. **Admin Account**: Create admin account day before event
5. **Spell Upload**: Upload spells before tournament day

---

## 📚 Need More Help?

- **Full Setup**: Read [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **Testing**: See [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Spells**: Check [SPELL_REFERENCE.md](SPELL_REFERENCE.md)

---

## ✅ Pre-Event Checklist

```
[ ] Firebase configured
[ ] Admin account created
[ ] Spells uploaded (15 total)
[ ] Test tournament works
[ ] Team colors display correctly
[ ] Real-time updates work
[ ] View page shows on big screen
[ ] All players can login
[ ] Spell casting tested
[ ] Undo button works
```

**All checked?** You're ready for your tournament! 🏆

---

## 🎯 Remember

- **5 teams** × **2 players** = **10 players max**
- **3 spells per team** recommended for first tournament
- **Win condition**: Usually 50-100 points
- **View page**: `view.html?tournamentId=YOUR-ID`

---

**Good luck and have fun!** 🎮
