# 🎮 BoardGame Tournament Management System

A complete, real-time tournament management system for LAN events with spell card mechanics, hex-grid board visualization, and multi-game support. Built with Firebase and vanilla JavaScript.

**Perfect for: 5 teams × 2 players (10 total) LAN tournaments**

## ⚡ Quick Start (10 Minutes)

1. **Configure Firebase:** Edit `scripts/firebase.js` with your Firebase credentials
2. **Upload Spells:** Open `upload-spells.html` → Upload 15 spell cards to Firebase
3. **Create Tournament:** Open `god.html` → Create tournament → Add 5 teams
4. **Distribute Spells:** God Mode → Spells tab → Distribute 2-3 spells per team
5. **Start Playing:** Players open `team.html`, spectators watch on `view.html`

📚 **Full Guide:** See [QUICK_START.md](QUICK_START.md) for detailed walkthrough

## ✨ Key Features

### 🔮 Complete Spell Card System
- **15 Unique Spells** with varied effects (offensive, defensive, utility)
- **Strategic Depth:** Pre-game buffs, instant counters, permanent effects
- **Full Integration:** Undo/redo support, spell history tracking
- **Easy Management:** God mode distribution, team casting interface
- **Reference Guide:** Complete documentation with combos and strategies

### 🎯 Tournament Management
- **God Mode Dashboard:** Comprehensive admin control panel
- **Match Queue System:** Plan, edit, and execute matches
- **Real-time Sync:** All devices update simultaneously via Firebase
- **Undo/Redo:** Full action history with reversal support
- **Multi-Game Support:** CS2, Dota 2, Valorant, StarCraft II, and more

### 👥 Team System
- **5 Teams × 2 Players:** Designed for 10-player LAN events
- **Custom Colors:** Brand colors (red, yellow, green, blue, cream)
- **Player Tracking:** Individual stats, contributions, match history
- **Team Interface:** Clean UI for players to view info and cast spells

### 🎮 Hex Grid Board
- **91-Hex Game Board:** Strategic territory control
- **Heart Hexes:** 6 special control points (1 center + 5 side hearts)
- **Visual Display:** Real-time canvas rendering
- **Tile Placement:** Admin-controlled or automated
- **Point Calculation:** Auto-tracking of territorial control

### 📊 Public Display (view.html)
- **Digital Signage:** Big-screen tournament display for spectators
- **No Authentication:** Public access for viewing
- **Real-time Updates:** Match results, scores, board state
- **Clean Design:** Night-friendly dark theme

## 📁 Project Structure

```
BoardGame/
├── Core Pages
│   ├── index.html          # Entry point with auth routing
│   ├── login.html          # User authentication
│   ├── home.html           # Role-based dashboard
│   ├── god.html            # Admin control panel
│   ├── setup.html          # Tournament setup wizard
│   ├── team.html           # Team management interface
│   ├── view.html           # Public signage display
│   └── profile.html        # User profile management
│
├── Scripts (Modular Architecture)
│   ├── firebase-loader.js      # Firebase SDK initialization
│   ├── errorHandler.js         # Toast notifications & error handling
│   ├── stateManager.js         # Pub/sub state management
│   ├── utils.js                # Shared utility functions
│   ├── god-scripts.js          # God mode functionality
│   ├── spells-god.js           # Spell management for admins
│   ├── spell-manager.js        # Core spell system logic
│   ├── tournament-manager.js   # Tournament lifecycle management
│   ├── user-management.js      # User authentication & profiles
│   ├── team-controls.js        # Team interactions & spell casting
│   ├── action-history.js       # Game action tracking & undo/redo
│   ├── match-scheduler.js      # Match scheduling logic
│   ├── board-module.js         # Hex grid game logic
│   └── board-renderer.js       # Canvas rendering engine
│
├── Data
│   └── spells.json             # 15 spell card definitions
│
├── Utilities
│   └── upload-spells.html      # Admin tool to upload spells to Firebase
│
└── Styles
    ├── css/styles.css          # Global styles
    ├── css/god_styles.css      # God mode specific styles
    └── css/brand-theme.css     # Brand colors & night-friendly theme
```

## 🎭 User Roles

### GOD/Admin
- Create and manage tournaments
- Configure teams and players
- Distribute and manage spell cards
- Schedule and confirm matches
- Control game flow and board state
- Access to `god.html` control panel with spell management

### Player
- View team information and spell inventory
- Cast spell cards during matches
- See match schedules and results
- View tournament standings
- Access team-specific features via `team.html`

### User (Default)
- Basic authenticated access
- Profile management
- View public tournament information

**Note:** Role assignment is managed through Firestore. Set `isAdmin: true` or `isSuperAdmin: true` in the user document for admin access.

## 📺 Digital Signage (view.html)

The view page is designed for **public display** on large screens or TVs at tournament venues.

**Features:**
- ✅ Real-time tournament updates
- ✅ No authentication required
- ✅ Read-only display
- ✅ Auto-refreshing board state
- ✅ Team standings and match history

**Usage:**
```
view.html?tournamentId=your-tournament-id
```

Press F11 for fullscreen mode on most browsers.

## 🏗️ Architecture

### Technology Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend:** Firebase Firestore (NoSQL database)
- **Authentication:** Firebase Authentication
- **Real-time:** Firestore real-time listeners
- **Rendering:** HTML5 Canvas for hex grid visualization
- **Architecture:** Modular ES6 design with pub/sub patterns

### Key Design Patterns

1. **Modular Scripts:** Each major feature has its own module
2. **State Management:** Centralized state with pub/sub via `stateManager.js`
3. **Error Handling:** Global error handler with user-friendly toast notifications
4. **Real-time Sync:** Firebase listeners keep all clients synchronized
5. **Role-Based Access:** Client-side routing + server-side Firestore security rules

## 🎮 Game Flow

```
1. Admin creates tournament (setup.html or god.html)
   ↓
2. Admin configures teams and players
   ↓
3. Admin distributes spell cards to teams
   ↓
4. Admin schedules matches
   ↓
5. Players cast pre-game spells (optional)
   ↓
6. Matches are played (external to system)
   ↓
7. Admin confirms results in god.html
   ↓
8. System applies spell effects and updates scores
   ↓
9. Players place tiles and cast post-game spells
   ↓
10. Next match begins
   ↓
11. Repeat until win condition is met
```

## 📊 Firestore Data Structure

### Collections

- **`tournaments`** - Tournament configurations and state
- **`users`** - User profiles and roles
- **`spellCards`** - Spell card definitions (optional game mechanic)

### Tournament Document Structure

```javascript
{
  gameId: "tournament-2025-01",
  status: "setup" | "playing" | "finished" | "archived",
  teams: [
    {
      id: 1,
      name: "Team Blue",
      color: "#3b82f6",
      players: [
        { name: "Player 1", points: 0 },
        { name: "Player 2", points: 0 }
      ],
      points: 0,
      gamesWon: 0
    }
  ],
  matches: [
    {
      id: 1,
      game: "Counter-Strike 2",
      format: "5v5",
      status: "waiting" | "playing" | "completed",
      round: 1
    }
  ],
  board: {},
  heartHexes: ["q2r-4", "q4r-2", "q2r2", "q-2r4", "q-4r2", "q-2r-2"],
  heartHexControl: {},
  winCondition: 50,
  currentRound: 0,
  gamesPlayed: 0,
  gameHistory: [],
  createdAt: "2025-01-01T00:00:00Z"
}
```

## 🔐 Security

### Client-Side (UX Layer)
- Role checks for UI visibility
- Auth state management
- Session handling
- Input validation

### Server-Side (Real Security)
- Firestore Security Rules enforce all permissions
- Role validation on every database operation
- Admin-only write operations
- Public read access for `view.html`

**Important:** All client-side security is for UX only. Real security is enforced by Firestore rules.

## 📝 Common Tasks

### Grant Admin Access

1. Open Firebase Console → Firestore
2. Navigate to `users/{user-uid}`
3. Add fields:
   - `isAdmin: true`
   - `isSuperAdmin: true` (for full access)
4. User can now access `god.html`

### Create a Tournament

1. Navigate to `setup.html` (or use god.html)
2. Follow the setup wizard:
   - Select games
   - Create teams
   - Review spell cards
   - Generate match schedule
   - Set tournament ID and win condition
3. Click "Create Tournament"
4. Tournament is saved to Firestore

### Display on Signage

1. Get tournament ID from god.html or setup
2. Open: `view.html?tournamentId=your-tournament-id`
3. Press F11 for fullscreen
4. Display updates automatically

## 🐛 Troubleshooting

### Cannot Access Admin Pages
- Check that your user document in Firestore has `isAdmin: true`
- Verify you're logged in (check `home.html` redirect)
- Clear browser cache and try again

### view.html Shows No Data
- Verify the `tournamentId` parameter in the URL is correct
- Check that the tournament exists in Firestore `tournaments` collection
- Open browser console for error messages
- Verify Firebase connection (check console logs)

### Authentication Issues
- Ensure `scripts/firebase.js` has correct Firebase config
- Check Firebase Console → Authentication is enabled
- Verify email/password provider is enabled
- Try clearing browser storage and logging in again

### Board Not Rendering
- Check browser console for canvas errors
- Verify `board-module.js` and `board-renderer.js` are loaded
- Ensure tournament has board data in Firestore
- Try refreshing the page

## 🛠️ Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd BoardGame
   ```

2. **Configure Firebase**
   - Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
   - Enable Authentication (Email/Password)
   - Create Firestore database
   - Copy your Firebase config to `scripts/firebase.js`

3. **Set up Firestore Security Rules**
   - Deploy security rules from Firebase Console
   - Ensure proper role-based access control

4. **Serve locally**
   - Use a local web server (e.g., Live Server, Python's http.server)
   - Open `index.html` in your browser

5. **Create admin user**
   - Register via `login.html`
   - Manually add `isAdmin: true` to your user document in Firestore

## 📦 Deployment

The project is a static web application that can be deployed to:
- Firebase Hosting
- GitHub Pages
- Netlify
- Vercel
- Any static hosting service

**Important:** Never commit `scripts/firebase.js` with your real API keys. Use environment variables or Firebase's built-in security.

## 🔄 Recent Changes

### v1.0-spell-system (October 2025)
- **Complete Spell Card System:** Implemented all 15 unique spell cards with full effects
- **Spell Manager:** Core spell logic with validation, casting, and effect application
- **God Mode Spells Tab:** Admin interface for spell distribution and management
- **Team Spell Interface:** Players can view and cast spells via team.html
- **Undo/Redo Integration:** Full spell reversal support in action history
- **Brand Theme:** Night-friendly dark theme with brand colors applied to all pages
- **Comprehensive Documentation:** Setup guide, testing guide, spell reference, quick start

### Previous Updates
- Migrated from legacy MVC architecture to modular design
- Removed unused controller files and pages
- Added new modular scripts (tournament-manager, user-management, etc.)
- Improved god.html with better UI and functionality
- Added comprehensive .gitignore for better security
- Simplified authentication flow
- Enhanced real-time synchronization
- Fixed team color display bug in match queue

## 📄 License

[Add your license here]

## 👥 Contributing

[Add contribution guidelines here]

---

**Last Updated:** 2025-10-24
**Status:** Active Development - Spell System Complete
