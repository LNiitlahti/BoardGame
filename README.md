# BoardGame — Tournament Management System

> Turn your LAN party into a competitive event with a strategic board game layer.

BoardGame is a real-time tournament management system that adds a hex-grid territory control meta-game on top of competitive matches. Teams play games like CS2, Dota 2, or Valorant — and each victory earns the winning team a hex tile on a shared game board. Claim territory, control strategic heart hexes, and outscore your rivals.

Designed for LAN events. Runs in any browser. Syncs across every screen in real time.

<!--
==========================================================================
  SCREENSHOT INSTRUCTIONS

  Take these screenshots and save them in BoardGame/docs/images/:

  1. hero-board.png     — The hex board view (view.html) during a tournament
                          with several tiles claimed by different teams.
                          This is the money shot — make it look exciting.
                          Ideal: 1920x1080 full screen capture.

  2. admin-panel.png    — The admin dashboard with a tournament loaded.
                          Show the match queue, team cards, and board visible.
                          Crop to highlight the key controls.

  3. stats-page.png     — The statistics page with charts populated.
                          Show win rates, match history, or player leaderboards.

  4. onboarding.png     — The onboarding screen showing players being
                          assigned to seats/teams.

  After taking screenshots, uncomment the image lines below and update paths.
==========================================================================
-->

![Hero screenshot of the hex board during a live tournament](BoardGame/docs/images/hero-board.png)

## The Concept

At a LAN tournament, an admin queues matches from a central dashboard. Teams play their game externally (CS2, Dota 2, Valorant, Age of Empires IV, Overwatch 2, Rocket League, and more) and the admin confirms the result. The winning team then places a hex tile on a shared 91-hex game board — expanding their territory and competing for 7 strategic "heart" hexes that generate victory points. Everything updates live on every connected device.

**The board becomes the scoreboard.** Instead of a plain win/loss table, spectators watch territory shift in real time on a TV display.

## Key Features

**Tournament Control** — Create tournaments, manage teams and players, queue matches, confirm results. One admin runs the entire event from a single tabbed dashboard.

**Smart Match Scheduling** — A built-in algorithm generates balanced matchups by minimizing variance in how often players are paired together or against each other. No manual scheduling needed.

**Hex Board Meta-Game** — A 91-hex board with 7 strategic heart hexes (6 side hearts worth 1 VP each, 1 mountain heart worth 2 VP). Winning matches lets teams expand territory and fight for control of high-value positions.

**Real-Time Sync** — Firebase-powered live updates. The admin panel, spectator board, and statistics page all reflect changes instantly across devices.

**Flexible Match Formats** — Primary formats are 5v5 and 3v3+2v2 with team-splitting mechanics, but the system supports creating matches in any format (1v1, 2v2, 2v2v2, and beyond).

**Multi-Game Support** — CS2, Dota 2, Valorant, Age of Empires IV, Overwatch 2, Rocket League, StarCraft II, and custom games. Define your own game types per tournament.

**Statistics & Export** — Win rates, player leaderboards, match history charts, and JSON export for post-event analysis.

## How a Tournament Works

```
 Setup       →  Create tournament, add teams and players, assign seating
                ↓
 Match Loop  →  Admin queues a match (manually or via auto-scheduler)
                Teams play externally (CS2, Dota 2, Valorant, etc.)
                Admin confirms the result
                Winning team places a hex tile on the board
                Victory points update automatically
                ↓
 Repeat      →  Continue until a winner emerges or all rounds are complete
                ↓
 Post-Event  →  View statistics, export data, review match history
```

## Screenshots

<!-- Replace these with actual screenshots once taken -->

| Admin Dashboard | Spectator Board | Statistics |
|:-:|:-:|:-:|
| ![Admin panel](BoardGame/docs/images/admin-panel.png) | ![Hex board](BoardGame/docs/images/hero-board.png) | ![Stats](BoardGame/docs/images/stats-page.png) |
| Manage matches, teams, and the board | Live TV display (1920x1080) | Charts, leaderboards, and export |

| Player Onboarding | Room Layout |
|:-:|:-:|
| ![Onboarding](BoardGame/docs/images/onboarding.png) | ![Room layout](BoardGame/docs/images/room-layout.png) |
| Players join and get assigned | Seating arrangement overview |

## Use Cases

**LAN Parties & Esports Events** — Add a strategic meta-game layer that keeps every team invested between matches. The hex board creates drama and strategy beyond just winning individual games.

**Gaming Communities & Leagues** — Run recurring tournaments with built-in scheduling, statistics tracking, and fair matchmaking. Export data for season standings.

**Event Organizers** — The spectator display is designed for large screens and projectors. Real-time updates keep the audience engaged without manual scoreboard management.

## Technology

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES6+), HTML5 Canvas |
| Database | Firebase Firestore (real-time NoSQL) |
| Auth | Firebase Authentication |
| Hosting | Any static file server |

No build tools, no frameworks, no dependencies to install. Clone, configure Firebase, and serve.

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/lniitlahti/boardgame.git
   ```

2. **Set up Firebase**
   - Create a [Firebase project](https://console.firebase.google.com/) with Authentication and Firestore enabled
   - Copy `BoardGame/shared/scripts/firebase.example.js` to `firebase.js`
   - Paste your Firebase credentials into the config

3. **Serve locally**
   ```bash
   cd BoardGame
   python3 -m http.server 8080
   ```

4. **Create your first tournament**
   - Open `http://localhost:8080/login.html` and register an account
   - In Firestore, set `isAdmin: true` on your user document
   - Open the admin panel and create a tournament

For detailed instructions, see the [Setup Guide](BoardGame/docs/guides/SETUP_GUIDE.md).

## User Roles

| Role | What they can do |
|------|-----------------|
| **Admin** | Full tournament control — manage teams, queue matches, confirm results, place tiles |
| **Player** | View their team dashboard and participate in matches |
| **Spectator** | Watch the live hex board and statistics (anonymous access) |

## Project Status

This project is in **active development** and is being deployed at its first live LAN event in February 2026.

The current focus is the **lightweight version** — a streamlined interface optimized for running tournaments from a single admin screen with a separate TV display for spectators. A full-featured version with richer UI, animations, and mobile support is planned as the next phase.

| Version | Status |
|---------|--------|
| Lightweight | In development — core features working, first live event deployment |
| Full | Planned |

## License

Free to use for non-profit purposes. For commercial use, contact the maintainer.

---

<details>
<summary><strong>Project Structure (for contributors)</strong></summary>

```
BoardGame/
├── lightweight/           # Current focus
│   ├── admin.html         # Tournament admin dashboard
│   ├── setup.html         # Tournament creation wizard
│   ├── view.html          # Spectator display (1920×1080)
│   ├── statistics.html    # Analytics & data export
│   ├── onboarding.html    # Player onboarding flow
│   ├── match-queue.html   # Match queue TV display
│   ├── css/               # Lightweight-specific styles
│   └── scripts/           # Lightweight-specific logic
│
├── full/                  # Planned full version
│   ├── app.html           # SPA router
│   ├── modules/           # Feature modules (undo/redo, spells, etc.)
│   ├── css/
│   └── scripts/
│
├── shared/                # Shared across both versions
│   ├── scripts/           # Firebase, board engine, match scheduling, utilities
│   ├── css/               # Theme, navbar, toast notifications
│   └── images/            # Favicons, game logos, hex tiles
│
├── docs/                  # Documentation
│   ├── architecture/      # System design diagrams
│   └── guides/            # Setup, testing, and reference guides
│
├── dev/                   # Dev tools & test pages
├── tools/                 # Utility tools
├── index.html             # Entry point (auth redirect)
├── login.html             # Authentication page
└── rulebook.html          # Game rules reference
```

</details>

<details>
<summary><strong>Security</strong></summary>

- Firebase credentials are excluded from version control via `.gitignore`
- Firestore Security Rules enforce all permissions server-side
- Role-based access control via user document fields
- Spectator pages use anonymous authentication (no account required to watch)
- Input sanitization via `escapeHtml()` on user-generated content

</details>

<details>
<summary><strong>Match Scheduling Algorithm</strong></summary>

The system includes two scheduling approaches:

**Rotation Pattern** — A proven 10-match cycle for 5v5 format where each team is split exactly twice per cycle, ensuring fair distribution across all team combinations.

**Balance Optimizer** — A greedy variance-minimization algorithm that tracks "with" and "against" matrices for all player pairs and selects matchups that minimize the cost function across the tournament. Supports 5v5, 3v3, and 2v2 formats.

Both approaches ensure that no team is unfairly over- or under-matched throughout the event.

</details>
