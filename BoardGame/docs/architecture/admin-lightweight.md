# admin.js — Logic Diagrams

> Source: `BoardGame/lightweight/scripts/admin.js`
> The command center. Auth, tournament management, match queue, scoring, board control.

## 1. Authentication & Initialization

```mermaid
flowchart TD
    A[Page Load] --> B{firebase.auth.onAuthStateChanged}
    B -->|user is null| C[Redirect to login.html]
    B -->|user exists| D[Fetch userDoc from Firestore]
    D --> E{userData.isGod OR userData.isAdmin?}
    E -->|No| F[alert Access Denied then Redirect home.html]
    E -->|Yes| G[Load Tournament UI]
    G --> H{URL has tournamentId param?}
    H -->|Yes| I[loadTournament id]
    H -->|No| J[Show tournament selector]
    I --> K{activeListener exists?}
    K -->|Yes| L[Unsubscribe old listener]
    K -->|No| M[Skip cleanup]
    L --> N[Create NEW Firestore listener]
    M --> N
    N --> O[On snapshot: gameState = doc.data]
    O --> P[updateDisplay]
    P --> Q[updateGameTypeDropdown]
    P --> R[renderTeamsList]
    P --> S[renderBoard]
    P --> T[renderMatchQueue]
    P --> U[renderMatchCreationZones]
    N --> V[On error: updateConnectionStatus disconnected]
```

## 2. Match Result Confirmation & Scoring

```mermaid
flowchart TD
    A[confirmResult winnerIndex] --> B[Identify winningTeam and losingTeams]
    B --> C[Count players per original team on winning side]
    C --> D{For each team on winning side}
    D --> E{playerCount >= 2?}
    E -->|Yes| F[Add to teamsWithFullCredit]
    E -->|No| G[Skip — split team gets no credit]
    F --> H[Count players per original team on losing side]
    G --> H
    H --> I{For each team on losing side}
    I --> J{playerCount >= 2?}
    J -->|Yes| K[Add to teamsWithFullLoss]
    J -->|No| L[Skip — split team gets no loss]
    K --> M[Update team stats]
    L --> M
    M --> N["teamsWithFullCredit: gamesWon++ gamesPlayed++"]
    M --> O["teamsWithFullLoss: gamesLost++ gamesPlayed++"]
    N --> P[Push to pendingHexWins]
    O --> P
    P --> Q[Move match from queue to gameHistory]
    Q --> R[Set match status = completed]
    R --> S[saveGameState to Firebase merge]
    S --> T[Listener fires then updateDisplay]
```

## 3. Challenge Match Validation

```mermaid
flowchart TD
    A[confirmChallengeSetup] --> B[Filter empty team selections]
    B --> C{sideATeams.length === 0 OR sideBTeams.length === 0?}
    C -->|Yes| D[WARN: Each side needs at least 1 team — RETURN]
    C -->|No| E{sideATeams overlaps sideBTeams?}
    E -->|Yes| F[WARN: Team cannot be on both sides — RETURN]
    E -->|No| G{sideA has 2 teams AND both same?}
    G -->|Yes| H[WARN: Cannot select same team twice — RETURN]
    G -->|No| I{sideB has 2 teams AND both same?}
    I -->|Yes| J[WARN: Cannot select same team twice — RETURN]
    I -->|No| K[Create queueEntry]
    K --> L[isChallenge = true]
    K --> M[disputingSideA = sideATeams]
    K --> N[disputingSideB = sideBTeams]
    L --> O[Insert into gameQueue after ongoing + first pending]
    M --> O
    N --> O
    O --> P[saveGameState]
```

## 4. Player Data Format Resolution

```mermaid
flowchart TD
    A[getMatchTeamPlayers matchTeam] --> B{matchTeam.playerIds exists AND is Array?}
    B -->|Yes — NEW FORMAT| C{window.PlayerUtils available?}
    C -->|Yes| D[PlayerUtils.getPlayerDisplayInfo for each ID]
    C -->|No| E[Manual lookup in gameState.players]
    D --> F[Return player objects with id name teamId teamColor]
    E --> F
    B -->|No| G{matchTeam.players exists AND is Array?}
    G -->|Yes — OLD FORMAT| H[For each player object]
    H --> I[Try resolve current name from team roster]
    I --> J{Found in roster?}
    J -->|Yes| K[Use roster name]
    J -->|No| L[Use stored p.name as fallback]
    K --> F
    L --> F
    G -->|No| M[Return empty array]
```

## 5. Game Display Name Resolution

```mermaid
flowchart TD
    A[getGameDisplayName gameId] --> B{gameState.gameDefinitions has gameId?}
    B -->|Yes| C[Return gameDefinitions.name — Priority 1]
    B -->|No| D{typeof GAMES_CONFIG !== undefined?}
    D -->|Yes| E[Return GAMES_CONFIG.getGameName — Priority 2]
    D -->|No| F{GAME_NAME_MAP has gameId?}
    F -->|Yes| G[Return GAME_NAME_MAP value — Priority 3]
    F -->|No| H[Return gameId as-is — Priority 4]
```

## 6. Player Format Detection

```mermaid
flowchart TD
    A[getCalculatedPlayType] --> B[Count players on sideA sideB sideC]
    B --> C{sideC > 0?}
    C -->|Yes| D["Return XvYvZ — 3-way match"]
    C -->|No| E["Return XvY — standard 2-side"]
```

## 7. Match Queue Color Logic

```mermaid
flowchart TD
    A[renderMatchQueue] --> B{For each match team}
    B --> C[Get players via getMatchTeamPlayers]
    C --> D[Count players per original team]
    D --> E{How many different teams?}
    E -->|1 team| F[Solid color border]
    E -->|Multiple teams| G[Calculate proportional gradient]
    G --> H["Build linear-gradient 135deg with percent stops"]
    F --> I[Apply border-color style]
    H --> J[Apply border-image gradient style]
```

## 8. Firebase Save Pattern

```mermaid
flowchart TD
    A[saveGameState] --> B[Create cleanData copy]
    B --> C[Remove tournamentId field]
    C --> D[Remove undefined fields]
    D --> E["tournamentRef.set cleanData with merge: true"]
    E --> F[Firebase listener detects change]
    F --> G[gameState = updated data from Firebase]
    G --> H["updateDisplay — full re-render of all UI"]
```
