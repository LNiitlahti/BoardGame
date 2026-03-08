# Replay & Analytics — Logic Diagrams

> Source: `BoardGame/full/scripts/replay-engine.js`, `summary-generator.js`, `action-export.js`
> Page: `BoardGame/full/replay.html`
> Last updated: March 2026

## 1. Module Overview

| Module | File | Role | Dependencies |
|---|---|---|---|
| ReplayEngine | `full/scripts/replay-engine.js` | Backup-anchored forward replay, state reconstruction, playback controls | None (leaf — reads Firestore directly) |
| SummaryGenerator | `full/scripts/summary-generator.js` | Post-tournament analytics: overview, team stats, key moments, hex analysis | BoardModule (optional, for hex type lookups) |
| ActionExport | `full/scripts/action-export.js` | JSON/CSV export of action log entries | ActionLogger (static describeAction) |

## 2. Architecture

```mermaid
graph TD
    subgraph replay.html
        RP[replay.html page]
        RE[ReplayEngine]
        SG[SummaryGenerator]
        AE[ActionExport]
    end

    subgraph Shared
        BM[BoardModule]
        BR[BoardRenderer]
        AL[ActionLogger — static methods]
    end

    subgraph Firestore Read-Only
        TD[(Tournament Doc)]
        BK[(Backups subcollection)]
        LOG[(ActionLog subcollection)]
    end

    RP --> RE
    RP --> SG
    RP --> AE
    RP --> BM
    RP --> BR

    RE -->|loads| TD
    RE -->|loads| BK
    RE -->|loads| LOG
    RE -->|reconstructed state| BR

    SG -->|reads actions from| RE
    AE -->|loads or reuses| LOG
    AE -->|descriptions via| AL
end
```

## 3. State Reconstruction Algorithm

```mermaid
flowchart TD
    A["seekToAction(targetSeq)"] --> B["_seqToIndex(targetSeq)"]
    B --> C["_getStateAtIndex(targetIndex)"]
    C --> D{Cached?}
    D -->|Yes| E["Return deep clone from cache"]
    D -->|No| F["_findBaseState(targetIndex)"]

    F --> G{Best source?}
    G -->|Cached state closer| H["Deep clone cached state"]
    G -->|Backup closer| I["Deep clone backup.snapshot"]
    G -->|No backup| J["_createInitialState()"]

    H --> K["Forward-apply actions from startIndex+1 to targetIndex"]
    I --> K
    J --> K

    K --> L["For each action: _applyAction(state, action)"]
    L --> M["_cacheState(targetIndex, state)"]
    M --> N["onStateChanged(state, action, progress)"]
```

## 4. Forward-Apply Dispatch

```mermaid
flowchart TD
    A["_applyAction(state, action)"] --> B{action.actionType}

    B -->|plate_placed| C["state.board[coord] = teamId"]
    B -->|plate_removed| D["delete state.board[coord]"]
    B -->|match_result_confirmed| E["Mark queue completed, push history, update team stats"]
    B -->|match_started| F["Set queue entry status = ongoing"]
    B -->|match_created| G["Push to gameQueue"]
    B -->|match_removed| H["Filter from gameQueue"]
    B -->|points_awarded| I["Add points to teams, push pointsHistory"]
    B -->|points_corrected| J["Set team.points to new value"]
    B -->|phase_advanced| K["Update currentPhase, status, lobbyReady"]
    B -->|team_renamed| L["Update team.name"]
    B -->|spell_board_effect| M["Remove destroyed tiles from board"]
    B -->|others| N["No-op — descriptive only"]
```

## 5. Playback Controls

```mermaid
stateDiagram-v2
    [*] --> Paused : loadTournamentData()
    Paused --> Playing : play()
    Playing --> Paused : pause()
    Playing --> Playing : stepForward() [auto-scheduled]
    Playing --> Paused : reached end
    Paused --> Paused : stepForward() / stepBackward()
    Paused --> Paused : seekToAction() / seekToRound()
    Playing --> Playing : setSpeed(n)
```

**Playback timing:** 1x = 1500ms/action, 2x = 750ms, 5x = 300ms, 10x = 150ms

## 6. Data Flow — replay.html

```mermaid
sequenceDiagram
    participant User
    participant Page as replay.html
    participant RE as ReplayEngine
    participant FB as Firestore
    participant BR as BoardRenderer

    Page->>FB: Load tournament doc
    Page->>FB: Load backups subcollection
    Page->>FB: Load actionLog subcollection (paginated)
    FB-->>RE: All data loaded
    RE->>RE: _buildTimeline()

    User->>Page: Click Play / drag slider
    Page->>RE: seekToAction(seq) or play()
    RE->>RE: _getStateAtIndex(idx)
    RE->>RE: _findBaseState() + _forwardApply()
    RE-->>Page: onStateChanged(state, action, progress)
    Page->>BR: render(state)
    Page->>Page: Update standings, action feed, info panel
```

## 7. SummaryGenerator Stats

```mermaid
flowchart TD
    A["generate()"] --> B["_computeOverview()"]
    A --> C["_computeTeamStats()"]
    A --> D["_computeKeyMoments()"]
    A --> E["_computeRoundSummaries()"]
    A --> F["_computeHexAnalysis()"]

    B --> B1["Total rounds, matches, teams, duration, winner"]
    C --> C1["Per-team: win rate, points, hexes, hearts, spells"]
    D --> D1["Heart captures, big point swings ≥3, spell effects, corrections"]
    E --> E1["Per-round: matches, hexes placed, spells, points"]
    F --> F1["Per-hex: ownership changes, most contested top 10"]
```

## 8. Script Loading Order (replay.html)

```
1. Shared deps
   ├── firebase-loader.js
   ├── firebase.js
   ├── board-module.js
   ├── board-renderer.js
   ├── games-config.js

2. Reused modules (static methods only)
   ├── action-logger.js    ← describeAction(), categoryBadgeClass()

3. Phase 4 modules
   ├── replay-engine.js
   ├── summary-generator.js
   └── action-export.js

4. Inline <script>
   └── Init BoardModule/Renderer, create ReplayEngine, wire callbacks
```

## 9. god.html Integration

```
GodApp._wireGlobalFunctions():
  window.openReplayWindow     → opens replay.html?tournamentId=XXX
  window.exportActionLogJSON  → ActionExport.exportJSON()
  window.exportActionLogCSV   → ActionExport.exportCSV()

god.html UI:
  Activity Log tab → "Replay" / "Action Log JSON/CSV" / "Tournament JSON/CSV" buttons
```
