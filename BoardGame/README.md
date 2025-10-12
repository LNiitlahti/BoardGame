# BoardGame Tournament Management System

A real-time, role-based tournament management system for hex-grid board games, built with Firebase and vanilla JavaScript.

## 🚀 Quick Start

1. **Configure Firebase:** Add your Firebase configuration to `scripts/firebase.js`
2. **Login:** Open `login.html` to authenticate with email/password
3. **Access Home:** Navigate to `home.html` for your role-based dashboard
4. **Admin Access:** Admins can access `god.html` for tournament management
5. **Public Display:** Use `view.html?tournamentId=your-id` for digital signage

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
│   ├── tournament-manager.js   # Tournament lifecycle management
│   ├── user-management.js      # User authentication & profiles
│   ├── team-controls.js        # Team interactions
│   ├── action-history.js       # Game action tracking
│   ├── match-scheduler.js      # Match scheduling logic
│   ├── board-module.js         # Hex grid game logic
│   └── board-renderer.js       # Canvas rendering engine
│
└── Styles
    ├── css/styles.css          # Global styles
    └── css/god_styles.css      # God mode specific styles
```

## 🎭 User Roles

### GOD/Admin
- Create and manage tournaments
- Configure teams and players
- Schedule and confirm matches
- Control game flow and board state
- Access to `god.html` control panel

### Player
- View team information
- See match schedules
- View tournament standings
- Access team-specific features

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

## ✨ Key Features

### Tournament Management
- Create, edit, and archive tournaments
- Configure teams with custom colors
- Define game types and match formats
- Set win conditions and scoring rules
- Real-time tournament status tracking

### Match System
- Match scheduling with queue management
- Multiple game types (CS2, Dota 2, Valorant, StarCraft II, etc.)
- Flexible team formats (1v1, 2v2, 3v3, 5v5)
- Result confirmation workflow
- Automatic turn progression

### Hex Grid Board
- Axial coordinate system
- Heart hex control points
- Team territory visualization
- Canvas-based rendering
- Point calculation and win detection

### Player Features
- Team assignment and management
- Match history viewing
- Personal statistics tracking
- Tournament schedule access

## 🎮 Game Flow

```
1. Admin creates tournament (setup.html or god.html)
   ↓
2. Admin configures teams and players
   ↓
3. Admin schedules matches
   ↓
4. Matches are played (external to system)
   ↓
5. Admin confirms results in god.html
   ↓
6. System updates scores and board state
   ↓
7. Next match begins
   ↓
8. Repeat until win condition is met
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

- Migrated from legacy MVC architecture to modular design
- Removed unused controller files and pages
- Added new modular scripts (tournament-manager, user-management, etc.)
- Improved god.html with better UI and functionality
- Added comprehensive .gitignore for better security
- Simplified authentication flow
- Enhanced real-time synchronization

## 📄 License

[Add your license here]

## 👥 Contributing

[Add contribution guidelines here]

---

**Last Updated:** 2025-10-13
**Status:** Production Ready
