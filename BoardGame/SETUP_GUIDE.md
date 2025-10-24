# 🎮 BoardGame Tournament System - Complete Setup Guide

## 📋 Table of Contents
1. [Quick Start](#quick-start)
2. [Firebase Configuration](#firebase-configuration)
3. [First Tournament Setup](#first-tournament-setup)
4. [Spell System Setup](#spell-system-setup)
5. [User Roles & Access](#user-roles--access)
6. [Testing Checklist](#testing-checklist)

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- Web server (Apache, Nginx, or local dev server)
- Firebase project (free tier works fine)
- Modern web browser

### Step 1: Configure Firebase
1. Open `scripts/firebase.js`
2. Replace the placeholder config with your Firebase credentials:
```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

### Step 2: Enable Authentication
1. Go to Firebase Console → Authentication
2. Enable **Email/Password** provider
3. Create your first admin user

### Step 3: Grant Admin Access
1. Firebase Console → Firestore Database
2. Find your user document in `users` collection
3. Add fields:
   ```
   isAdmin: true
   isSuperAdmin: true
   ```

### Step 4: Upload Spells
1. Open `upload-spells.html` in your browser
2. Click "Load Spells from JSON" (happens automatically)
3. Click "Upload to Firebase"
4. Wait for success message

**You're ready!** Open `god.html` to start managing tournaments.

---

## 🔥 Firebase Configuration

### Database Structure
The system uses Firestore with this structure:

```
tournaments/
  {tournamentId}/
    - gameId: string
    - name: string
    - status: "setup" | "playing" | "finished"
    - teams: array
    - gameQueue: array
    - board: object
    - spellHistory: array
    - currentRound: number
    - winCondition: number

users/
  {userId}/
    - email: string
    - displayName: string
    - teamId: number
    - isAdmin: boolean
    - isSuperAdmin: boolean

spellCards/
  {spellId}/
    - name: string
    - description: string
    - type: string
    - effect: object
```

### Security Rules
**IMPORTANT:** Deploy these security rules to Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isSignedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return isSignedIn() &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }

    // Users collection
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn();
      allow update: if isSignedIn() && request.auth.uid == userId;
      allow delete: if isAdmin();
    }

    // Tournaments collection
    match /tournaments/{tournamentId} {
      allow read: if true;  // Public read for view.html
      allow write: if isAdmin();
    }

    // Spell cards collection
    match /spellCards/{spellId} {
      allow read: if true;  // Public read
      allow write: if isAdmin();
    }
  }
}
```

---

## 🏆 First Tournament Setup

### Option 1: Using setup.html (Recommended for first time)
1. Open `setup.html`
2. Follow the wizard:
   - **Step 1:** Select games (CS2, Dota 2, etc.)
   - **Step 2:** Create 5 teams with 2 players each
   - **Step 3:** Review spell cards
   - **Step 4:** Set tournament ID and win condition
3. Click "Create Tournament"

### Option 2: Using god.html (For advanced users)
1. Open `god.html`
2. Click "🏆 Tournaments" tab
3. Click "Create New Tournament"
4. Fill in tournament details
5. Add teams manually
6. Distribute spells
7. Start the tournament

### Tournament Workflow
```
1. Create Tournament → 2. Add Teams → 3. Distribute Spells
                ↓
4. Plan Matches → 5. Players Join → 6. Play Matches
                ↓
7. Confirm Results → 8. Update Board → 9. Next Round
```

---

## 🔮 Spell System Setup

### Uploading Spells (One-time setup)
1. Navigate to `upload-spells.html`
2. Spells auto-load from `data/spells.json`
3. Review all 15 spells
4. Click "Upload to Firebase"
5. Verify upload success

### Distributing Spells to Teams

#### Method 1: Random Distribution (Quick)
1. Open `god.html` → "🔮 Spells" tab
2. Click "Load Spell Definitions"
3. Click "🎲 Distribute Random Spells"
4. Enter number of spells per team (recommended: 2-3)
5. All teams receive random spells

#### Method 2: Manual Distribution (Strategic)
1. Open `god.html` → "🔮 Spells" tab
2. Select team from dropdown
3. Select spell to add
4. Click "➕ Add Spell to Team"
5. Repeat for each team

### Spell Types Overview
| Type | When to Use | Examples |
|------|-------------|----------|
| **Pre-Game** | Before match starts | Sabotage, Echo of Silence |
| **Instant** | Immediately on demand | Mountain Purification |
| **Defensive** | After losing match | Elf Protection |
| **Aggressive** | During placement | Calculated Aggression |
| **Rare** | Strategic moments | Domination x3, Victory Strike |

---

## 👥 User Roles & Access

### Role Hierarchy
1. **Super Admin** (`isSuperAdmin: true`)
   - Full access to god.html
   - Can create/delete tournaments
   - Can manage all users
   - Can modify any game state

2. **Admin** (`isAdmin: true`)
   - Access to god.html
   - Can manage tournaments
   - Can confirm match results
   - Can distribute spells

3. **Player** (default)
   - Access to team.html
   - Can view team info
   - Can cast spells (during their turn)
   - Can vote on match results

4. **Public** (unauthenticated)
   - Access to view.html only
   - Read-only tournament display

### Granting Admin Access
**Via Firebase Console:**
1. Firestore → `users` collection
2. Find user by email/UID
3. Edit document → Add fields:
   ```
   isAdmin: true
   isSuperAdmin: true (optional)
   ```

**Via God Mode UI:**
1. Open `god.html` → "👤 Users" tab
2. Find user in list
3. Click "Make Admin"
4. Confirm changes

---

## ✅ Testing Checklist

### Pre-Event Testing (Do this before your first LAN)

#### Basic System Test
- [ ] Firebase connection works (green indicator)
- [ ] Can login with admin account
- [ ] God mode loads without errors
- [ ] Can create a test tournament
- [ ] Teams appear correctly

#### Spell System Test
- [ ] Spells uploaded to Firebase (15 spells visible)
- [ ] Can distribute spells to teams
- [ ] Teams see their spells in team.html
- [ ] Can cast a spell successfully
- [ ] Spell appears in history
- [ ] Can undo spell casting

#### Match Flow Test
- [ ] Can plan a match in god mode
- [ ] Players see upcoming match
- [ ] Can confirm match result
- [ ] Points update correctly
- [ ] Board updates properly

#### Multi-Device Test
- [ ] Open god.html on device 1
- [ ] Open team.html on device 2
- [ ] Open view.html on device 3
- [ ] Make change on device 1
- [ ] Verify real-time update on devices 2 & 3

#### Undo/Redo Test
- [ ] Place a tile → Undo → Verify removed
- [ ] Cast spell → Undo → Verify spell returned
- [ ] Confirm match → Undo → Verify points reverted
- [ ] Redo → Verify action restored

### During Event Testing

#### Tournament Start
- [ ] All players can access team.html
- [ ] Team colors display correctly
- [ ] Spell cards visible to teams
- [ ] First match appears in queue

#### Mid-Tournament
- [ ] Match results confirm properly
- [ ] Points update in real-time
- [ ] Board displays on view.html
- [ ] Spell history tracks correctly
- [ ] Turn order works properly

#### Edge Cases
- [ ] What if player disconnects?
- [ ] What if match result disputed?
- [ ] What if need to edit team mid-tournament?
- [ ] What if need to add emergency spell?

### Post-Event
- [ ] Can export tournament data
- [ ] Can archive tournament
- [ ] Statistics display correctly
- [ ] Can create new tournament

---

## 🐛 Common Issues & Solutions

### Issue: "Firebase: Connecting..." never turns green
**Solution:**
1. Check `scripts/firebase.js` has correct config
2. Verify Firebase project exists
3. Check browser console for errors
4. Ensure Firestore is enabled in Firebase Console

### Issue: "User not found" when trying to login
**Solution:**
1. Create user in Firebase Authentication
2. Wait for user document to auto-create in Firestore
3. Manually add `isAdmin: true` to user document

### Issue: Spells not appearing in team interface
**Solution:**
1. Verify spells uploaded (check god.html → Spells tab)
2. Verify spells distributed to team (check team inventory)
3. Check browser console for errors
4. Reload team.html

### Issue: Real-time updates not working
**Solution:**
1. Check Firebase security rules allow read access
2. Verify network connection
3. Check browser console for listener errors
4. Try refreshing the page

### Issue: Can't undo action
**Solution:**
1. Verify action was recorded (check action history panel)
2. Check `currentActionIndex` in gameState
3. Ensure not at beginning of history
4. Reload god.html if stuck

---

## 📞 Support

### Getting Help
- Check browser console for error messages
- Review Firebase Console for data issues
- Test with incognito mode to rule out cache issues
- Verify all files uploaded to server correctly

### Before First Event
1. Do full testing checklist
2. Have backup plan (spreadsheet for manual tracking)
3. Document your tournament ID
4. Test with at least 2 devices
5. Have admin access confirmed

---

## 🎉 You're Ready!

This system is designed for **5 teams × 2 players** at LAN events with spell card mechanics. The typical tournament flow:

1. Admin creates tournament
2. Admin distributes spells
3. Admin plans matches
4. Players join teams and cast spells
5. Matches played externally (CS2, Dota 2, etc.)
6. Admin confirms results
7. System updates board and points
8. Spectators watch on view.html

**Next Steps:**
- Read [TESTING_GUIDE.md](TESTING_GUIDE.md) for detailed scenarios
- Check [SPELL_REFERENCE.md](SPELL_REFERENCE.md) for all spell effects
- Review [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if issues arise

Good luck with your tournament! 🏆
