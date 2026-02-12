# BoardGame Tournament System — Architecture & Logic Map

> **Auto-generated from codebase analysis.**
> When you change a JS file, update the matching diagram file below.

## System Overview

```mermaid
graph TB
    subgraph Pages
        ADMIN[lightweight/admin.html]
        SETUP[lightweight/setup.html]
        ONBOARD[lightweight/onboarding.html]
        VIEW[lightweight/view.html]
        STATS[lightweight/statistics.html]
    end

    subgraph Core_JS
        ADM_JS[admin.js]
        SMG[smart-match-generator.js]
        BO[balance-optimizer.js]
        MS[match-suggester.js]
        GC[games-config.js]
        BR[board-renderer.js]
        ST[statistics.js]
        OB[onboarding-lightweight.js]
    end

    subgraph Firebase
        FB[(Firestore DB)]
        AUTH[Firebase Auth]
    end

    ADMIN --> ADM_JS
    STATS --> ST
    ONBOARD --> OB
    VIEW --> BR

    ADM_JS -->|creates matches via| SMG
    ADM_JS -->|creates matches via| MS
    SMG -->|delegates math to| BO
    SMG -->|looks up formats| GC
    MS -->|looks up games| GC
    ADM_JS -->|renders board| BR
    ADM_JS -->|looks up names| GC
    ST -->|looks up names| GC
    OB -->|looks up games| GC

    ADM_JS -->|read/write| FB
    ST -->|read| FB
    OB -->|read/write| FB
    ADM_JS -->|auth gate| AUTH
    OB -->|secret validation| FB
```

## File Index

| Diagram File | Source JS | Diagrams | Description |
|---|---|---|---|
| [admin-lightweight.md](admin-lightweight.md) | `lightweight/scripts/admin.js` | 8 | Auth, match results, challenges, player formats, game names, queue colors |
| [smart-match-generator.md](smart-match-generator.md) | `scripts/smart-match-generator.js` | 5 | Main pipeline, 5v5 vs 3v3+2v2, rotation state machine, repeat counts |
| [balance-optimizer.md](balance-optimizer.md) | `scripts/balance-optimizer.js` | 5 | Selection algorithm, split penalty, matrix updates, state restore, stats |
| [match-suggester.md](match-suggester.md) | `scripts/match-suggester.js` | 2 | 10-match rotation pattern, fairness note |
| [games-config.md](games-config.md) | `scripts/games-config.js` | 2 | Resolution chain, filtering & export |
| [statistics.md](statistics.md) | `scripts/statistics.js` | 8 | Data pipeline, player stats, leaderboards, filters, H2H, streaks, charts |
| [onboarding-lightweight.md](onboarding-lightweight.md) | `scripts/onboarding-lightweight.js` | 5 | View routing, completion, progress grid, secret management, platform IDs |
| [board-renderer.md](board-renderer.md) | `scripts/board-renderer.js` | 3 | Render pipeline, responsive scaling, incremental updates |
| [cross-system.md](cross-system.md) | All files | 1 | End-to-end data flow sequence diagram |

## How to Update

1. Change a JS file
2. Open the matching `.md` file from the table above
3. Update only the affected diagram(s)
4. Each diagram is a standalone ```` ```mermaid ```` block — edit in place

## Conventions

- Decision nodes use `{question?}` diamond syntax
- Guard clauses that return early are labeled with `RETURN`
- Firebase operations are marked explicitly
- Known bugs/issues are highlighted with `fill:#ff9999` where applicable
- State machines use `stateDiagram-v2` syntax
- Cross-file interactions use `sequenceDiagram` syntax
