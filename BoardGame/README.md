# 🎮 BoardGame Tournament Management System

A complete, real-time tournament management system for LAN events with spell card mechanics, hex-grid board visualization, and multi-game support. Built with Firebase and vanilla JavaScript.

**Perfect for: 5 teams × 2 players (10 total) LAN tournaments**

## 📅 Project Timeline & Status

### **Current Status: Active Development**
**Phase:** Enhanced Team Management & User Interface
**Last Updated:** October 24, 2025

### Timeline

**Phase 1: Foundation (Completed)**
- ✅ Core tournament structure and database design
- ✅ Firebase authentication and real-time sync
- ✅ Basic team and player management
- ✅ Initial game board (91-hex grid) implementation
- ✅ Role-based access control (God/Admin/Player/User)

**Phase 2: Spell System (Completed)**
- ✅ Complete spell card system with 15 unique spells
- ✅ Spell manager with validation and effect application
- ✅ God mode spell distribution interface
- ✅ Team spell casting interface
- ✅ Undo/redo integration for spell effects
- ✅ Comprehensive spell documentation and testing guide

**Phase 3: Enhanced Team Management (Current - October 2025)**
- ✅ Drag-and-drop user assignment to teams
- ✅ User search and filtering in team management
- ✅ Team color indicators throughout interface
- ✅ Improved team.html with better match displays
- ✅ Multi-team match support (2v2v2, 2v2v2v2)
- ✅ Responsive scaling for player lists and long names
- ✅ Dynamic match status tracking (current/next/upcoming)
- 🔄 Comprehensive logging and debugging tools

**Phase 4: Match Management & Automation (In Progress)**
- 🔄 Automated match queue progression
- 🔄 Player voting system for match results (90% consensus)
- 🔄 Enhanced match scheduling with time slots
- ⏳ Match statistics and analytics
- ⏳ Tournament bracket visualization

**Phase 5: Polish & Advanced Features (Planned)**
- ⏳ Mobile-optimized views for all pages
- ⏳ Advanced spell combo suggestions
- ⏳ Tournament templates and presets
- ⏳ Export tournament data and statistics
- ⏳ Spectator mode with live commentary overlay
- ⏳ Integration with external game APIs (Steam, Riot, etc.)
- ⏳ Tournament replay system

### Recent Milestones (October 2025)

**Week 4 (Current)**
- Enhanced team management with drag-and-drop user assignment
- Improved team.html match display scaling for multi-team formats
- Added team color indicators and visual feedback
- Fixed navigation between home.html and team controls
- Implemented flexible layout for 2v2, 2v2v2, 2v2v2v2 matches

**Week 3**
- Completed spell card system implementation
- Added comprehensive spell documentation
- Integrated undo/redo for spell effects
- Brand theme applied to all pages

**Week 2**
- Migrated to modular architecture
- Enhanced god mode control panel
- Improved real-time synchronization
- Added match queue system

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
- **God Mode Dashboard:** Comprehensive admin control panel with tabbed interface
- **Match Queue System:** Plan, edit, and execute matches
- **Real-time Sync:** All devices update simultaneously via Firebase
- **Undo/Redo:** Full action history with reversal support
- **Multi-Game Support:** CS2, Dota 2, Valorant, StarCraft II, and more
- **User Assignment:** Drag-and-drop registered users to tournament teams

### 👥 Team System
- **5 Teams × 2 Players:** Designed for 10-player LAN events
- **Custom Colors:** Brand colors (red, yellow, green, blue, cream)
- **Player Tracking:** Individual stats, contributions, match history
- **Team Interface:** Clean UI for players to view info and cast spells
- **Dynamic Match Display:** Supports any format (1v1, 2v2, 3v3, 4v4, 5v5, 2v2v2, 2v2v2v2, etc.)
- **Color Indicators:** Team colors shown throughout interface for clarity

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
│   ├── god.html            # Admin control panel (tabbed interface)
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
│   ├── user-management.js      # User authentication & team assignment
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
- Assign registered users to teams via drag-and-drop
- Distribute and manage spell cards
- Schedule and confirm matches
- Control game flow and board state
- Access to `god.html` control panel with Teams, Matches, Spells, Users, and History tabs

### Player
- View team information and spell inventory
- Cast spell cards during matches
- See match schedules and results (current/next/upcoming)
- View tournament standings
- Access team-specific features via `team.html`
- See team colors and side assignments clearly

### User (Default)
- Basic authenticated access
- Profile management
- View public tournament information
- Can be assigned to teams by admins

**Note:** Role assignment is managed through Firestore. Set `isAdmin: true` or `isSuperAdmin: true` in the user document for admin access.

## 📺 Digital Signage (view.html)

The view page is designed for **public display** on large screens or TVs at tournament venues.

**Features:**
- ✅ Real-time tournament updates
- ✅ No authentication required
- ✅ Read-only display
- ✅ Auto-refreshing board state
- ✅ Team standings and match history
- ✅ Color-coded team displays

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

### Tournament Setup Phase

```
1. Admin creates tournament (setup.html or god.html → Plan tab)
   └─ Set tournament ID, team count, win condition

2. Admin creates teams (god.html → Plan tab)
   └─ Assign names and colors to 5 teams

3. Admin assigns users to teams (god.html → Teams tab)
   ├─ Load registered users
   ├─ Drag-and-drop users to team slots
   └─ Save assignments to Firestore

4. Admin distributes spell cards (god.html → Spells tab)
   └─ Give 2-3 spell cards per team

5. Admin creates match queue (god.html → Matches tab)
   └─ Schedule matches with game types and player assignments
```

### Active Tournament Phase

```
6. Players access their team page (team.html)
   ├─ View current/next match
   ├─ See team info, colors, and spell cards
   └─ Real-time updates via Firebase

7. [OPTIONAL] Players cast pre-game spells
   └─ Strategic spells that affect upcoming match

8. Match is played (external to system - physical/online game)
   └─ Players compete in CS2, Dota, Valorant, etc.

9. Result confirmation (god.html → Matches tab)
   ├─ CURRENT: Admin manually confirms winner
   └─ PLANNED: 90% consensus voting system for players

10. System updates tournament state
    ├─ Award points to winning team
    ├─ Update team standings
    ├─ Apply spell effects
    └─ Log to game history

11. [OPTIONAL] Winner places tile on board (god.html → Board tab)
    └─ Place tile at hex coordinate → capture territory

12. [OPTIONAL] Players cast post-game spells
    └─ Tactical spells that affect board state

13. Next match begins
    └─ Admin selects next match from queue
```

### Tournament End Phase

```
14. Tournament ends when:
    ├─ A team reaches win condition (default: 50 points)
    ├─ All matches completed
    └─ Admin manually ends tournament

15. Final standings displayed
    └─ view.html shows final results and statistics
```

### Key Points

- **Parallel Operations**: Multiple matches can be scheduled; admin controls active match
- **Real-time Updates**: All connected clients see changes instantly via Firestore
- **Undo/Redo**: Admin can reverse actions using History tab
- **Flexible Flow**: Steps 7, 11, 12 are optional based on tournament rules

## 📊 Firestore Data Structure

### Collections

- **`tournaments`** - Tournament configurations and state
- **`users`** - User profiles, roles, and team assignments
- **`spellCards`** - Spell card definitions (15 unique cards)

### Tournament Document Structure

```javascript
{
  // Basic Info
  gameId: "tournament-2025-01",               // Unique tournament identifier
  name: "LAN Party 2025",                     // Display name (optional)
  status: "setup" | "playing" | "finished" | "archived",
  createdAt: "2025-01-01T00:00:00Z",
  winCondition: 50,                           // Points needed to win

  // Teams Configuration
  teams: [
    {
      id: 1,                                   // Team ID (1-5)
      name: "Team Blue",                       // Team name
      color: "#3b82f6",                        // Hex color code
      points: 0,                               // Total team points
      gamesWon: 0,                            // Number of games won

      // Active Players
      players: [
        {
          name: "Player 1",                    // Display name
          uid: "firebase-uid",                 // Firebase user ID
          email: "player@example.com",         // User email
          points: 0,                           // Individual points
          pointsContributed: 0                 // Points while on team
        }
      ],

      // Spell Cards (two possible formats)
      spellCards: ["spell-id-1", "spell-id-2"], // Array of spell IDs
      hand: ["spell-id-1"],                     // Alternative format

      // Former Players (tracking)
      formerPlayers: [
        {
          name: "Former Player",
          pointsContributed: 10,
          leftAt: "2025-01-15T10:00:00Z"
        }
      ]
    }
  ],

  // Match Queue (multiple formats supported)
  gameQueue: [                                 // Primary format (god-scripts.js)
    {
      id: 1,                                   // Unique match ID
      game: 1,                                 // Game number
      gameNumber: 1,                           // Alternative field
      gameType: "Counter-Strike 2",            // Game name
      playType: "2v2",                         // Format (1v1, 2v2, 2v2v2, etc.)
      status: "pending" | "active" | "completed",

      // Match Sides
      sides: [
        {
          name: "Side A",                      // Optional side name
          players: [
            {
              name: "Alice",
              uid: "uid-1",
              email: "player@example.com",
              color: "#3b82f6",                // Original team color
              teamColor: "#3b82f6",            // Alternative field
              originalTeamColor: "#3b82f6"     // Alternative field
            }
          ]
        }
      ],

      // Optional Fields
      notes: "Best of 3",                      // Match notes
      round: 1,                                // Round number

      // Voting System (in development)
      votes: [
        {
          uid: "voter-uid",
          playerName: "Voter Name",
          result: "side_0_won" | "side_1_won" | "draw",
          votedAt: "2025-01-01T12:00:00Z"
        }
      ],
      voteConsensus: {
        result: "side_0_won",
        percentage: 100,
        passedThreshold: true,
        submittedToAdmin: true,
        submittedAt: "2025-01-01T12:05:00Z"
      },
      adminConfirmed: false
    }
  ],

  // Alternative Match Formats (legacy/setup)
  selectedGames: [],                           // Used by setup wizard
  matches: [],                                 // Match templates

  // Current Turn System
  currentTurn: {
    teamId: 1,                                 // Active team ID
    game: 5,                                   // Associated match number
    needsPlacement: true,                      // Tile placement required
    startedAt: "2025-01-01T12:00:00Z"
  } | null,

  // Board State (Hex Grid)
  board: {
    "q0r0": { teamId: 1, type: "normal" },    // Hex coordinates
    "q1r-1": { teamId: 2, type: "normal" }
  },
  heartHexes: ["q2r-4", "q4r-2", "q2r2", "q-2r4", "q-4r2", "q-2r-2"],
  heartHexControl: {
    "q2r-4": 1,                                // teamId controlling heart
    "q0r0": 2
  },

  // Game Progress Tracking
  currentRound: 0,                             // Current round number
  gamesPlayed: 0,                              // Total games completed
  gameHistory: [
    {
      gameNumber: 1,
      game: 1,
      winner: ["Team Blue"] | "Team Blue",     // Can be array or string
      loser: ["Team Red"] | "Team Red",
      timestamp: "2025-01-01T10:00:00Z",
      pointsAwarded: 3
    }
  ],

  // Action History (for undo/redo)
  actionHistory: [
    {
      type: "spell_cast" | "match_result" | "tile_placed",
      timestamp: "2025-01-01T10:00:00Z",
      data: {},                                // Action-specific data
      undoData: {}                             // Data needed to undo
    }
  ]
}
```

### User Document Structure

```javascript
{
  uid: "firebase-auth-uid",                    // Firebase Auth UID (document ID)
  email: "user@example.com",                   // User email
  displayName: "John Doe",                     // Display name

  // Role & Permissions
  role: "user" | "player" | "admin" | "god",
  isAdmin: true | false,                       // Admin access flag
  isSuperAdmin: true | false,                  // Super admin flag

  // Tournament Assignment
  assignedGameId: "tournament-2025-01",        // Current tournament
  assignedTeamId: 1,                           // Current team ID (1-5)
  assignedTeamName: "Team Blue",               // Team name (synced)

  // Metadata
  createdAt: "2025-01-01T00:00:00Z",
  lastLogin: "2025-01-15T10:00:00Z",

  // Optional Fields
  photoURL: "https://...",                     // Profile photo
  disabled: false                              // Account status
}
```

### Spell Card Document Structure

```javascript
{
  id: "spell-id-1",                            // Unique spell ID
  name: "Lightning Strike",                    // Spell name
  description: "Deal damage to opponent",      // Description
  type: "offensive" | "defensive" | "utility" | "instant",
  rarity: "common" | "rare" | "epic",

  // Spell Effects
  effect: {
    type: "damage" | "heal" | "buff" | "debuff",
    value: 5,                                  // Effect magnitude
    target: "opponent" | "self" | "all",
    duration: "instant" | "permanent"
  },

  // Targeting
  targetType: "opponent-team" | "opponent-player" | "self" | "board",

  // Usage
  timing: "pre-game" | "post-game" | "anytime",
  usesRemaining: 1,                            // Uses per tournament

  // Metadata
  imageUrl: "https://...",                     // Card image (optional)
  createdAt: "2025-01-01T00:00:00Z"
}
```

### Data Relationships

```
Tournament (1)
  ├── Teams (1-5)
  │   ├── Players (2 each)
  │   │   └── User Document (references uid)
  │   └── Spell Cards (2-3 per team)
  │       └── Spell Card Document (references spell ID)
  ├── Game Queue (matches)
  │   └── Sides
  │       └── Players (references from teams)
  └── Board State (hex tiles)
      └── Heart Hex Control (team ownership)
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

### Assign Users to Teams

1. Navigate to `god.html` → Teams tab
2. Load your tournament
3. Search for users in the "Unassigned Users" panel
4. Drag users to team slots
5. Click "Save All Appointments"

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

### Team Controls Button Shows "Coming Soon"
- Fixed in latest version - should redirect to team.html
- Clear cache if issue persists

### Match Sides Show "No Sides Configured"
- Check console logs for data structure issues
- Verify match has `sides` or `teams` array in Firestore
- Ensure players have required fields (name, uid, color)

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

### October 24, 2025
- **Enhanced Team Management:** Drag-and-drop user assignment with search filtering
- **Improved Match Display:** Better scaling for multi-team formats (2v2v2, 2v2v2v2)
- **Team Color Indicators:** Visual team colors throughout team.html interface
- **Dynamic Layout:** Flexible match display that adapts to number of teams
- **Better UX:** Text truncation for long names, scrollable player lists
- **Bug Fixes:** Team controls navigation, match sides rendering

### October 2025 (Spell System Release)
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
- Improved god.html with tabbed interface
- Added comprehensive .gitignore for better security
- Simplified authentication flow
- Enhanced real-time synchronization
- Fixed team color display bug in match queue

## 📄 License

This project is currently unlicensed but is free to use for **non-profit purposes only**.

For commercial use, please contact the project maintainer.

## 👥 Contributing

This is currently a **solo project** (as of October 2025). Contributions may be accepted in the future.

For bug reports or feature requests, please open an issue on the repository.

---

**Status:** Active Development
**Current Phase:** Enhanced Team Management & User Interface
**Last Updated:** October 24, 2025
