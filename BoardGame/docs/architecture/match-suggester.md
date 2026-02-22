# match-suggester.js — Logic Diagrams

> Source: `BoardGame/shared/scripts/match-suggester.js`
> 10-match rotation pattern with fairness guarantees.
> Each team split exactly 2 times per 10-match cycle.

## 1. Rotation Pattern & Match Generation

```mermaid
flowchart TD
    A[generateSuggestion] --> B{teams.length < 5?}
    B -->|Yes| C[Error: Need exactly 5 teams]
    B -->|No| D{Any team missing 2 players?}
    D -->|Yes| E[Error: Each team needs 2 players]
    D -->|No| F[getRotationPosition]

    F --> G[Count non-challenge matches in gameQueue]
    G --> H[Get stored rotationPosition fallback]
    H --> I["position = MAX(queueCount, storedPosition)"]
    I --> J["position = position mod 10"]

    J --> K["Get ROTATION_PATTERN at position"]
    K --> L{pattern.split in sideA OR sideB?}
    L -->|Yes| M[Error: Invalid rotation pattern]
    L -->|No| N[Get split team players]

    N --> O["Build Side A: 2 full teams from pattern.sideA"]
    O --> P{splitTeamPlayers.length >= 1?}
    P -->|Yes| Q[Add 1st split player to Side A with isSplit=true]
    P -->|No| R[Skip — Side A has 4 players]

    Q --> S["Build Side B: 2 full teams from pattern.sideB"]
    R --> S
    S --> T{splitTeamPlayers.length >= 2?}
    T -->|Yes| U[Add 2nd split player to Side B with isSplit=true]
    T -->|No| V["Skip — Side B has 4 players — UNBALANCED"]

    U --> W[Build descriptions + fairnessNote]
    V --> W
    W --> X[Return match object]

    style V fill:#ff9999
```

## 2. Fairness Note Calculation

```mermaid
flowchart TD
    A["getFairnessNote(splitTeamId)"] --> B[splitCount = 0]
    B --> C{For each match in gameHistory}
    C --> D{"splitTeamId matches AND NOT isChallenge?"}
    D -->|Yes| E[splitCount++]
    D -->|No| F[Skip]
    E --> C
    F --> C
    C -->|Done| G{For each match in gameQueue}
    G --> H{"splitTeamId matches AND status !== completed AND NOT isChallenge?"}
    H -->|Yes| I[splitCount++]
    H -->|No| J[Skip]
    I --> G
    J --> G
    G -->|Done| K{splitCount === 0?}
    K -->|Yes| L["Message: has not been split yet"]
    K -->|No| M{splitCount === 1?}
    M -->|Yes| N["Message: has been split 1 time (expectation: 2 per 10)"]
    M -->|No| O["Message: has been split N times"]
```

## 3. Rotation Status Report

```mermaid
flowchart TD
    A[getRotationStatus] --> B["Filter history: exclude challenges"]
    B --> C["Filter queue: exclude challenges"]
    C --> D{"For each team (1-5)"}
    D --> E["Count splits in history where splitTeamId === teamId"]
    D --> F["Count splits in queue where splitTeamId === teamId"]
    E --> G["splitCount = historyCount + queueCount"]
    F --> G
    G --> H["expectedSplits = floor((normalHistory + normalQueue) / 5)"]
    H --> I["Store: teamName, splitCount, expectedSplits"]
    I --> D
    D -->|All teams done| J[Return status object for all 5 teams]
```
