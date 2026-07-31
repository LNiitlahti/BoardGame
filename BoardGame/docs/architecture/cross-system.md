# Cross-System Data Flow

> How all JS modules interact end-to-end.

## 1. Match Generation Sequence

```mermaid
sequenceDiagram
    participant User
    participant Admin as admin.js
    participant SMG as smart-match-generator.js
    participant BO as balance-optimizer.js
    participant GC as games-config.js
    participant FB as Firebase
    participant Stats as statistics.js
    participant View as full/view.html

    User->>Admin: Click Generate Match
    Admin->>SMG: generateNext()
    SMG->>SMG: Validate 5 teams x 2 players
    SMG->>GC: getGameFormat(gameId)
    GC-->>SMG: format (5v5 or 3v3+2v2)
    SMG->>BO: advanceMatch()
    SMG->>BO: selectOptimal5v5() or selectOptimal3v3_2v2()
    BO->>BO: Enumerate 60/120 partitions
    BO->>BO: Score each: pairing delta + split penalty
    BO-->>SMG: Best partition + metadata
    SMG->>BO: applyPartition(sideA, sideB)
    SMG->>BO: recordSplit(splitTeamId)
    SMG-->>Admin: Match result object
    Admin->>FB: saveGameState() merge
    FB-->>Admin: Listener fires -> updateDisplay
    FB-->>View: Listener fires -> re-render
    FB-->>Stats: On load -> calculateAllPlayerStats
```

## 2. Match Result Flow

```mermaid
sequenceDiagram
    participant User
    participant Admin as admin.js
    participant FB as Firebase
    participant Stats as statistics.js
    participant OB as onboarding.js

    User->>Admin: Click confirm result (winner)
    Admin->>Admin: Count players per team per side
    Admin->>Admin: Teams with >= 2 players get credit
    Admin->>Admin: Update gamesWon/gamesLost/gamesPlayed
    Admin->>Admin: Award +1 VP per win (team.points++) for full-credit teams
    Admin->>Admin: Move match to gameHistory
    Admin->>Admin: Push to pendingHexWins
    Admin->>FB: saveGameState() merge
    FB-->>Admin: Listener fires -> updateDisplay + renderBoard
    FB-->>Stats: On next load -> recalculate all stats
```

## 3. Onboarding Flow

```mermaid
sequenceDiagram
    participant Player
    participant OB as onboarding.js
    participant GC as games-config.js
    participant FB as Firebase
    participant AdminOB as Admin onboarding view

    Player->>OB: Open player link with secret
    OB->>OB: Hash URL secret with SHA-256
    OB->>FB: Listen to tournament doc + onboarding subcollection
    FB-->>OB: gameState (tournament) + onboardingState (subcollection)
    OB->>OB: Compare hashes from onboardingState.secretHash
    alt Hash matches
        OB->>GC: getSelectedGames()
        GC-->>OB: Game list with metadata
        OB->>OB: renderPlayerView (friends + games checklist)
        Player->>OB: Toggle friend/game checkbox
        OB->>OB: checkPlayerCompletion
        OB->>FB: savePlayerField -> subcollection update
        FB-->>OB: Onboarding listener fires -> re-render
        FB-->>AdminOB: Onboarding listener fires -> update grid
    else Hash does not match
        OB->>Player: ACCESS DENIED
    end
```

## 4. Data Dependency Graph

```mermaid
graph LR
    GC[games-config.js] -->|format lookup| SMG[smart-match-generator.js]
    GC -->|name lookup| ADM[admin.js]
    GC -->|name lookup| ST[statistics.js]
    GC -->|game list| OB[onboarding.js]

    BO[balance-optimizer.js] -->|partition selection| SMG
    MS[match-suggester.js] -->|rotation pattern| ADM

    SMG -->|match objects| ADM
    ADM -->|gameState read/write| FB[(Firebase)]
    ST -->|gameState read| FB
    OB -->|onboarding subcollection read/write| FB

    FB -->|real-time listeners| ADM
    FB -->|real-time listeners| VIEW[view pages]
    FB -->|on load| ST

    ADM -->|renders with| BR[board-renderer.js]
    VIEW -->|renders with| BR
```

## 5. State Ownership

```mermaid
graph TD
    FB[(Firebase — Source of Truth)]

    FB --> GS[gameState]
    GS --> T[teams array]
    GS --> P[players registry]
    GS --> Q[gameQueue array]
    GS --> GH[gameHistory array]
    GS --> SG[selectedGames array]
    GS --> GD[gameDefinitions object]
    GS --> B[board hex ownership]
    GS --> SMS[smartMatchState]
    FB --> OBD["onboarding/state (subcollection)"]

    ADM[admin.js] -->|reads/writes ALL| GS
    ST[statistics.js] -->|reads only| GS
    OB[onboarding.js] -->|reads/writes| OBD
    SMG[smart-match-generator.js] -->|reads teams + games| GS
    SMG -->|reads/writes| SMS
    BO[balance-optimizer.js] -->|reads/writes via SMG| SMS
    MS[match-suggester.js] -->|reads teams + queue + history| GS
    BR[board-renderer.js] -->|reads board| B
    GC[games-config.js] -->|static data — no Firebase| GC_DATA[GAMES_CONFIG object]
```
