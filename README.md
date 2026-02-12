# BoardGame Tournament Management System

A real-time tournament management system for LAN events with hex-grid board visualization and multi-game support. Built with Firebase and vanilla JavaScript.

**Perfect for:** 5 teams × 2 players (10 total) LAN tournaments

## Project Status

**Current Phase:** Lightweight-First Development
**Last Updated:** January 2026

### Development Strategy

We're building the **lightweight version first** before the full-featured release:

| Version | Status | Description |
|---------|--------|-------------|
| Lightweight | In Development | Simplified UI, essential features, optimized for 1920x1080 |
| Full Version | Planned | Rich UI, animations, mobile support |

### Recent Updates (January 2026)

- Normalized player data structure with unique IDs
- Statistics page with charts and JSON export
- Lightweight admin interface (`admin-lightweight.html`)
- Digital signage display (`view-lightweight.html`)
- Match suggester for automated scheduling

## Quick Start

1. **Configure Firebase:** Copy `shared/scripts/firebase.example.js` to `shared/scripts/firebase.js` and add your credentials
2. **Create Tournament:** Open `lightweight/admin.html` → Create tournament → Add teams
3. **Start Playing:** Players use `full/team.html`, spectators watch on `lightweight/view.html`

## Key Features

### Tournament Management
- **God Mode Dashboard:** Admin control panel with tabbed interface
- **Match Queue System:** Plan, edit, and execute matches
- **Real-time Sync:** All devices update via Firebase
- **Undo/Redo:** Full action history with reversal support
- **Multi-Game Support:** CS2, Dota 2, Valorant, and more

### Hex Grid Board
- **91-Hex Game Board:** Strategic territory control
- **Heart Hexes:** 6 special control points (1 center + 5 side hearts)
- **Point Calculation:** Cluster-based scoring (n² formula)

### Team System
- **5 Teams × 2 Players:** Designed for 10-player LAN events
- **Player Registry:** Normalized player IDs across matches
- **Dynamic Match Display:** Supports 1v1 through 2v2v2v2 formats

## Project Structure

```
BoardGame/
├── lightweight/                    # Lightweight App (Current Focus)
│   ├── admin.html                  # Tournament admin panel
│   ├── setup.html                  # Tournament creation wizard
│   ├── view.html                   # Digital signage (1920x1080)
│   ├── statistics.html             # Analytics & export
│   ├── onboarding.html             # Player onboarding
│   ├── css/                        # Lightweight-only styles
│   └── scripts/                    # Lightweight-only scripts
│
├── full/                           # Full Version (Planned)
│   ├── app.html                    # SPA router
│   ├── home.html, god.html, ...    # Full version pages
│   ├── modules/                    # Dynamically loaded modules
│   ├── css/                        # Full-only styles
│   └── scripts/                    # Full-only scripts
│
├── shared/                         # Shared between both apps
│   ├── scripts/                    # Firebase, board, games-config, etc.
│   ├── css/                        # Brand theme, navbar, etc.
│   └── images/                     # Favicons, game logos, hex tiles
│
├── index.html                      # Auth entry point
├── login.html                      # Authentication
├── development-landing-page.html   # Navigation hub
├── dev/                            # Dev tools
└── tools/                          # Utility tools
```

## User Roles

| Role | Access |
|------|--------|
| **God/Admin** | Full tournament control, user management, match confirmation |
| **Player** | Team page, spell casting, match viewing |
| **User** | Basic access, can be assigned to teams |

## Technology Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend:** Firebase Firestore (NoSQL)
- **Authentication:** Firebase Authentication
- **Real-time:** Firestore listeners
- **Rendering:** HTML5 Canvas for hex grid

## Game Flow

```
1. Create tournament & teams      [lightweight/admin.html]
2. Assign players to teams
3. Queue matches

--- MATCH LOOP ---
4. Teams play external match      (CS2, Dota, etc.)
5. Confirm result                 [admin panel]
6. Winner places hex tile         [board]
7. Points calculated              [automatic]
8. Check win condition            [automatic]
--- REPEAT ---

9. View statistics                [lightweight/statistics.html]
```

## Security

- **Firebase config** is excluded from git (use `firebase.example.js` as template)
- **Firestore Security Rules** enforce all permissions server-side
- **Role-based access** via user document fields (`isAdmin`, `isSuperAdmin`)

## Development Setup

1. Clone the repository
2. Create Firebase project with Authentication and Firestore
3. Copy `shared/scripts/firebase.example.js` to `shared/scripts/firebase.js`
4. Add your Firebase credentials
5. Serve locally (Live Server, Python http.server, etc.)
6. Register a user and set `isAdmin: true` in Firestore

## License

Free to use for **non-profit purposes only**. For commercial use, contact the maintainer.

---

**Status:** Active Development | **Phase:** Lightweight-First | **Updated:** January 2026
