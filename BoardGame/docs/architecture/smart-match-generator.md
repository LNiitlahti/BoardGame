# smart-match-generator.js — Logic Diagrams

> Source: `BoardGame/shared/scripts/smart-match-generator.js`
> Orchestrator: format routing, game rotation state machine, preview system.
> Delegates math to `balance-optimizer.js`.
> Note: `rebuildFromHistory()` excludes challenges AND breaks from match counts.

## 1. Main Generation Pipeline

```mermaid
flowchart TD
    A[generateNext] --> B{teams.length === 5?}
    B -->|No| C[Return error: Need exactly 5 teams]
    B -->|Yes| D{Every team has exactly 2 players?}
    D -->|No| E[Return error: Each team needs 2 players]
    D -->|Yes| F[getCurrentGame from rotation]
    F --> G{gameRotation.games empty?}
    G -->|Yes| H[initializeGameRotation — lazy init]
    G -->|No| I["games at currentIndex mod length"]
    H --> I
    I --> J[optimizer.advanceMatch]
    J --> K{format === 3v3+2v2?}
    K -->|Yes| L[generate3v3_2v2Match gameId]
    K -->|No| M[generate5v5Match gameId]
    L --> N[advanceGameRotation]
    M --> N
    N --> O[totalMatchesGenerated++]
    O --> P[Add rotationInfo metadata]
    P --> Q[Return result object]
```

## 2. 5v5 vs 3v3+2v2 Match Generation

```mermaid
flowchart TD
    subgraph generate5v5Match
        A1[generate5v5Match] --> B1[optimizer.selectOptimal5v5]
        B1 --> C1[Get partition: sideA sideB splitTeam]
        C1 --> D1[optimizer.applyPartition sideA sideB]
        D1 --> E1[optimizer.recordSplit splitTeam]
        E1 --> F1["totalMatches 5v5 ++"]
        F1 --> G1[convertToPlayerObjects for both sides]
        G1 --> H1[Return 1 match object]
    end

    subgraph generate3v3_2v2Match
        A2[generate3v3_2v2Match] --> B2[optimizer.selectOptimal3v3_2v2]
        B2 --> C2[Get partition: match3v3 + match2v2]
        C2 --> D2[optimizer.applyPartition 3v3 sides]
        D2 --> E2[optimizer.applyPartition 2v2 sides]
        E2 --> F2[optimizer.recordSplit splitTeam — 3v3 only]
        F2 --> G2["totalMatches 3v3++ AND 2v2++"]
        G2 --> H2[convertToPlayerObjects for all 4 sides]
        H2 --> I2[Return 2 match objects isSimultaneous=true]
    end
```

## 3. Game Rotation State Machine

```mermaid
stateDiagram-v2
    [*] --> CheckGames
    CheckGames --> LazyInit: games array empty
    CheckGames --> GetCurrent: games populated
    LazyInit --> GetCurrent: initializeGameRotation

    GetCurrent --> PlayGame: return games at currentIndex mod length

    PlayGame --> AdvanceRepeat: after match generated
    AdvanceRepeat --> CheckThreshold: currentRepeat++

    CheckThreshold --> StaySameGame: currentRepeat < targetRepeat
    CheckThreshold --> NextGame: currentRepeat >= targetRepeat

    StaySameGame --> PlayGame
    NextGame --> ResetRepeat: currentIndex++ currentRepeat=0
    ResetRepeat --> PlayGame

    state CheckThreshold {
        [*] --> CalcTarget
        CalcTarget --> CyclePosition: "floor(totalGenerated / totalGames) mod 3"
        CyclePosition --> ReturnMin: cyclePosition === 1
        CyclePosition --> ReturnMax: cyclePosition !== 1
    }
```

## 4. Format-Aware Repeat Counts

```mermaid
flowchart TD
    A[initializeGameRotation] --> B[Get selectedGames from gameState]
    B --> C{For each gameId}
    C --> D[getGameFormat gameId]
    D --> E{format === 3v3+2v2?}
    E -->|Yes — Split Format| F["repeatMin=1 repeatMax=2 repeatCount=2"]
    E -->|No — Standard| G["repeatMin=2 repeatMax=3 repeatCount=3"]
    F --> H[Store game rotation entry]
    G --> H
    H --> C
```

## 5. Player Object Conversion

```mermaid
flowchart TD
    A["convertToPlayerObjects(playerIds, splitTeamId, side)"] --> B{"For each playerId (eg 1a, 2b)"}
    B --> C["Parse: teamId = parseInt(first char)"]
    C --> D["Parse: playerIdx = charCode(second char) - 97"]
    D --> E["Find team in teams by String coercion"]
    E --> F{team found AND player at idx exists?}
    F -->|Yes| G[Use ACTUAL player data]
    G --> H["Build: id, name, originalTeamId, originalTeamName, originalTeamColor"]
    F -->|No| I[Create FALLBACK player]
    I --> J["Build: id=pid, name=Player pid, Team teamId"]
    H --> K{teamId === splitTeamId?}
    J --> K
    K -->|Yes| L[isSplit = true]
    K -->|No| M[isSplit = false]
    L --> N[Add to result array]
    M --> N
    N --> B
```

## 6. Preview System — Non-Destructive

```mermaid
flowchart TD
    A["previewNext(count=5)"] --> B["Deep copy state: JSON.parse(JSON.stringify(getState()))"]
    B --> C{"For i = 0 to count-1"}
    C --> D["result = generateNext()"]
    D --> E{result.error?}
    E -->|Yes| F[Break loop]
    E -->|No| G["Push preview: index, gameId, format, splitTeam"]
    G --> C
    F --> H[Restore ALL state from saved copy]
    C -->|Loop done| H
    H --> I[Return previews array — state unchanged]
```
