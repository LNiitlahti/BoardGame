# games-config.js — Logic Diagrams

> Source: `BoardGame/shared/scripts/games-config.js`
> Master catalog: 18 games, 48+ aliases, 10 helper methods.
> Single source of truth for game definitions.

## 1. Resolution & Lookup Chain

```mermaid
flowchart TD
    A["resolveGameId(id)"] --> B{id is falsy?}
    B -->|Yes| C[Return null]
    B -->|No| D{id exists as key in games dict?}
    D -->|Yes| E[Return id — already canonical]
    D -->|No| F{id exists as key in aliases dict?}
    F -->|Yes| G["Return aliases[id] — mapped to canonical"]
    F -->|No| H[Return id unchanged — graceful passthrough]

    I["getGame(id)"] --> J["canonicalId = resolveGameId(id)"]
    J --> K{canonicalId in games?}
    K -->|Yes| L[Return game object]
    K -->|No| M[Return null]

    N["getGameName(id)"] --> O["game = getGame(id)"]
    O --> P{game AND game.name?}
    P -->|Yes| Q[Return game.name]
    P -->|No| R[Return id as fallback]

    S["getShortName(id)"] --> T["game = getGame(id)"]
    T --> U{game.shortName?}
    U -->|Yes| V[Return shortName]
    U -->|No| W{game.name?}
    W -->|Yes| X[Return name]
    W -->|No| Y[Return id]

    Z["getFormat(id)"] --> AA["game = getGame(id)"]
    AA --> AB{game AND game.format?}
    AB -->|Yes| AC[Return game.format]
    AB -->|No| AD["Return 5v5 — default"]

    AE["isSplitFormat(id)"] --> AF["game = getGame(id)"]
    AF --> AG{"game.splitFormat === true (strict)?"}
    AG -->|Yes| AH[Return true]
    AG -->|No| AI[Return false]
```

## 2. Filtering & Export

```mermaid
flowchart TD
    A[getActiveGames] --> B[Object.entries games]
    B --> C["Filter: game.active === true"]
    C --> D["Map: add id property, spread game"]
    D --> E[Return 6 active game objects]

    F[getAllGames] --> G[Object.entries games]
    G --> H["Map: add id property, spread game"]
    H --> I[Return all 18 game objects]

    J["getGamesForSelect(activeOnly)"] --> K{activeOnly === true?}
    K -->|Yes| L["games = getActiveGames() — 6"]
    K -->|No| M["games = getAllGames() — 18"]
    L --> N["Map to {value, label, format}"]
    M --> N
    N --> O[Return select-ready array]

    P[buildNameMap] --> Q["Loop 1: games entries -> map[id] = name"]
    Q --> R[Loop 2: aliases entries]
    R --> S{"games[aliasTarget] has name?"}
    S -->|Yes| T["map[alias] = game.name"]
    S -->|No| U["map[alias] = aliasTarget id"]
    T --> V["Return flat name map — 48+ entries"]
    U --> V
```

## Game Data Reference

| ID | Name | Format | Split | Active |
|---|---|---|---|---|
| predecessor | Predecessor | 5v5 | No | Yes |
| aoe4 | Age of Empires IV | 3v3+2v2 | Yes | Yes |
| overwatch2 | Overwatch 2 | 5v5 | No | Yes |
| cs2 | Counter-Strike 2 | 5v5 | No | Yes |
| wc3 | Warcraft 3 | 3v3+2v2 | Yes | Yes |
| cod | Call of Duty | 5v5 | No | Yes |
| spellbreak | Spellbreak | 5v5 | No | No |
| spacemarine2 | Space Marine 2 | 5v5 | No | No |
| dow2 | Dawn of War 2 | 3v3+2v2 | Yes | No |
| sc2 | StarCraft II | 3v3+2v2 | Yes | No |
| valorant | Valorant | 5v5 | No | No |
| dota2 | Dota 2 | 5v5 | No | No |
| hearthstone | Hearthstone | 1v1 | No | No |
| rocketleague | Rocket League | 3v3 | No | No |
| tekken8 | Tekken 8 | 1v1 | No | No |
| beerdrinking | Beer Drinking | FFA | No | No |
