# BoardGame Tournament Management System

A real-time, role-based tournament management system for hex-grid board games, built with Firebase and vanilla JavaScript.

## 🚀 Quick Start

1. **Login:** Open `login.html` to authenticate
2. **Get Admin Access:** Use `make-me-admin.html` to grant yourself admin privileges
3. **Manage Tournaments:** Open `god.html` to create and manage tournaments
4. **View on Signage:** Use `view.html?gameId=tournament-id` for public displays

## 📚 Documentation

### Core Documentation

| Document | Purpose |
|----------|---------|
| [ROUTING_ARCHITECTURE.md](ROUTING_ARCHITECTURE.md) | Role-based routing and navigation system |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Authentication setup and security model |
| [VIEW_PAGE_DOCUMENTATION.md](VIEW_PAGE_DOCUMENTATION.md) | Digital signage display documentation |
| [MIGRATION_PLAN.md](MIGRATION_PLAN.md) | 4-week migration plan to modular architecture |
| [CORE_GAME_ARCHITECTURE.md](CORE_GAME_ARCHITECTURE.md) | Game engine and module design specs |

### Key Pages

| Page | Purpose | Access Level |
|------|---------|--------------|
| [index.html](index.html) | Smart router - entry point | Public |
| [login.html](login.html) | User authentication | Public |
| [home.html](home.html) | Role-based dashboard | Authenticated |
| [god.html](god.html) | Admin control panel | GOD/Admin only |
| [view.html](view.html) | **Digital signage display** | Public (read-only) |
| [setup.html](setup.html) | Tournament setup wizard | Admin |
| [team.html](team.html) | Team management | Player/Admin |
| [profile.html](profile.html) | User profile | User |

## 🎭 User Roles

### GOD (Superadmin)
- Complete system control
- Tournament CRUD operations
- User management
- Access all features

**How to become GOD:**
1. Use `make-me-admin.html` tool, OR
2. Add UID to `GOD_UIDS` array in `index.html`, OR
3. Set `isSuperAdmin: true` in Firestore user document

### Admin
- Manage current tournaments
- Confirm match results
- Assign players to teams

### Player
- View own team information
- See match schedule
- View available spell cards

### User
- Basic profile access
- Wait for role assignment

## 📺 Digital Signage (view.html)

**SPECIAL NOTE:** `view.html` is designed for **public display only** - no user interaction required.

- ✅ Read-only display for spectators
- ✅ Real-time game updates
- ✅ No authentication needed
- ✅ No sensitive data shown
- ✅ Optimized for large screens/TVs

**Usage:**
```
view.html?gameId=your-tournament-id
```

See [VIEW_PAGE_DOCUMENTATION.md](VIEW_PAGE_DOCUMENTATION.md) for details.

## 🏗️ Architecture

### Current Implementation (Phase 1 Complete)

```
BoardGame/
├── Core Pages
│   ├── index.html          # Smart router
│   ├── login.html          # Authentication
│   ├── home.html           # Role-based dashboard
│   ├── god.html            # Admin panel
│   └── view.html           # Public signage display
│
├── Scripts (Modules)
│   ├── errorHandler.js     # Toast notifications & error handling
│   ├── stateManager.js     # Pub/sub state management
│   ├── utils.js            # 40+ utility functions
│   ├── firebase-loader.js  # Firebase initialization
│   ├── board-module.js     # Hex grid logic
│   ├── board-renderer.js   # Canvas rendering
│   └── god-scripts.js      # God mode functionality
│
├── Styles
│   └── css/styles.css      # Unified stylesheet
│
├── Security
│   ├── firestore.rules     # Server-side security rules
│   └── .gitignore          # Protect secrets
│
└── Documentation
    ├── README.md                      # This file
    ├── ROUTING_ARCHITECTURE.md        # Navigation system
    ├── AUTHENTICATION.md              # Security & auth
    ├── VIEW_PAGE_DOCUMENTATION.md     # Signage display docs
    ├── MIGRATION_PLAN.md              # Architecture roadmap
    └── CORE_GAME_ARCHITECTURE.md      # Module specs
```

### Technology Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend:** Firebase (Firestore, Authentication)
- **Real-time:** Firebase Realtime Listeners
- **Rendering:** HTML5 Canvas (hex grid)
- **Security:** Firestore Security Rules
- **Architecture:** Modular ES6 modules

## 🔐 Security Model

### Client-Side (UX Only)
- Role-based UI visibility
- Auth state checks
- Session management

### Server-Side (Real Security)
- Firestore Security Rules enforce all permissions
- Role validation on every database operation
- Admin verification for write operations

**Important:** Client-side checks are for UX only. Real security is enforced by Firestore rules.

See [AUTHENTICATION.md](AUTHENTICATION.md) for details.

## ✨ Key Features

### Tournament Management (god.html)
- ✅ Create, edit, duplicate, archive, delete tournaments
- ✅ Real-time tournament list with search & filtering
- ✅ Match queue manager with drag-and-drop
- ✅ Turn-by-turn game management
- ✅ Board state visualization
- ✅ Heart hex control tracking
- ✅ Game history logging

### Match Scheduling
- ✅ Manual match planning
- ✅ Game queue system
- ✅ Result confirmation
- ✅ Winner selection
- ✅ Automatic turn progression

### Board Management
- ✅ Hex grid with axial coordinates
- ✅ Heart hex system
- ✅ Team position tracking
- ✅ Control point scoring
- ✅ Visual board state rendering

### Player Features
- ✅ Team assignment
- ✅ Spell card system
- ✅ Personal statistics
- ✅ Match schedule viewing

## 🎮 Game Flow

```
1. GOD creates tournament (god.html)
   ↓
2. GOD adds teams and players
   ↓
3. GOD plans matches in queue
   ↓
4. Matches are played
   ↓
5. GOD confirms results
   ↓
6. System updates scores & board
   ↓
7. Next turn begins
   ↓
8. Repeat until win condition met
```

## 📊 Data Structure

### Tournament Document (Firestore: `games/{gameId}`)

```javascript
{
  gameId: "game-2025-10-12",
  status: "setup" | "playing" | "finished" | "archived",
  winCondition: 50,
  teams: [...],
  selectedGames: [
    {
      game: 1,
      sides: [
        { players: [{name: "...", color: "blue"}] },
        { players: [{name: "...", color: "red"}] }
      ],
      status: "waiting" | "playing" | "completed"
    }
  ],
  gameHistory: [
    {
      gameNumber: 1,
      winner: "Team Blue",
      loser: "Team Red",
      timestamp: "2025-10-12T..."
    }
  ],
  board: {
    "q0r0": { owner: "blue", type: "normal" },
    "q1r-1": { owner: null, type: "heart" }
  },
  heartHexControl: {
    "q2r-4": "blue",
    "q4r-2": "red"
  },
  currentRound: 1,
  gamesPlayed: 5,
  currentTurn: {
    game: 1,
    startedAt: "2025-10-12T..."
  }
}
```

## 🛠️ Development Tools

### make-me-admin.html
**DO NOT DEPLOY TO PRODUCTION**

Quick tool to grant yourself admin privileges during development.

**Usage:**
1. Log in to your account
2. Open `make-me-admin.html`
3. Click "Make Me Admin"
4. Access `god.html` with full privileges

**Security:** This file is in `.gitignore` and should never be deployed.

## 🚧 Migration Roadmap

Current status: **Phase 1 Complete** ✅

- [x] Phase 1: Foundation (errorHandler, stateManager, utils, Firestore rules)
- [ ] Phase 2: Module Extraction (GameEngine, TurnManager, MatchManager)
- [ ] Phase 3: Orchestration Layer (GameOrchestrator, EventBus)
- [ ] Phase 4: Testing & Polish (Unit tests, integration tests)

See [MIGRATION_PLAN.md](MIGRATION_PLAN.md) for complete roadmap.

## 📝 Common Tasks

### Make Yourself Admin
```bash
# Option 1: Use helper tool
Open: make-me-admin.html

# Option 2: Firebase Console
1. Firestore → users/{your-uid}
2. Add: isAdmin: true, isSuperAdmin: true
```

### Create a Tournament
```bash
1. Open god.html
2. Click "➕ Create New Tournament"
3. Enter tournament ID (e.g., "game-2025-10-12")
4. Click "Quick Create" or "Full Wizard"
5. Tournament appears in list
```

### Plan Matches
```bash
1. Load tournament in god.html
2. Go to "Plan Game" tab
3. Select game type (1v1, 2v2, 3v3, etc.)
4. Drag teams to sides
5. Click "➕ Add to Queue"
6. Match appears in queue
```

### Display on Signage
```bash
1. Get tournament ID from god.html
2. Open: view.html?gameId=your-tournament-id
3. Press F11 for fullscreen
4. Display updates automatically in real-time
```

## 🐛 Troubleshooting

### Can't Access god.html
- Use `make-me-admin.html` to grant admin privileges
- Check Firestore user document has `isAdmin: true`
- Verify Firebase connection (check console)

### view.html Shows No Data
- Verify gameId parameter is correct
- Check Firebase connection indicator (top-right)
- Open browser console for debug logs
- Ensure tournament exists in Firestore

### Authentication Errors
- Clear browser cache and session storage
- Check `scripts/firebase.js` configuration
- Verify Firestore rules are deployed
- Try logging out and back in

## 📄 License

[Add your license here]

## 👥 Contributors

[Add contributors here]

## 🔗 Related Links

- [Firebase Console](https://console.firebase.google.com)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Authentication](https://firebase.google.com/docs/auth)

---

**Last Updated:** 2025-10-12
**Version:** 1.0.0 (Phase 1 Complete)
