# platforms-config.js — Logic Diagrams

> Source: `shared/scripts/platforms-config.js`
> Master catalog: 6 platforms, game-platform mappings, 8 helper methods.
> Single source of truth for gaming platform definitions.

## 1. Lookup & Filtering

```mermaid
flowchart TD
    A["getPlatform(id)"] --> B{"id exists in platforms?"}
    B -->|Yes| C[Return platform object]
    B -->|No| D[Return null]

    E[getActivePlatforms] --> F[Object.entries platforms]
    F --> G["Filter: platform.active === true"]
    G --> H["Map: add id property, spread platform"]
    H --> I[Return 4 active platform objects]

    J["getPlatformsForGame(gameId)"] --> K["platformIds = gamePlatforms[gameId]"]
    K --> L{platformIds found?}
    L -->|Yes| M["Map each to platform object, filter nulls"]
    L -->|No| N["Return empty array"]

    O["getGamesForPlatform(platformId)"] --> P["Loop gamePlatforms entries"]
    P --> Q{"platforms array includes platformId?"}
    Q -->|Yes| R[Add gameId to result]
    Q -->|No| S[Skip]
    R --> T[Return game IDs array]

    U["getActiveGameNamesForPlatform(platformId)"] --> V[getGamesForPlatform]
    V --> W["Filter: GAMES_CONFIG game.active === true"]
    W --> X["Map: GAMES_CONFIG.getGameName(id)"]
    X --> Y[Return active game names]
```

## Platform Data Reference

| ID | Name | Active | Games (current event) |
|---|---|---|---|
| steam | Steam | Yes | CS2, CoD, OW2, Predecessor, AoE4 |
| battlenet | Battle.net | Yes | Warcraft 3 |
| xbox | Xbox / Microsoft | Yes | AoE4 |
| discord | Discord | Yes | Voice chat |
| epic | Epic Games | No | — |
| riot | Riot Games | No | — |

## Game-Platform Mapping

| Game ID | Platforms |
|---|---|
| cs2 | steam |
| cod | steam |
| overwatch2 | steam |
| predecessor | steam |
| aoe4 | steam, xbox |
| wc3 | battlenet |
| spellbreak | epic |
| spacemarine2 | steam |
| dow2 | steam |
| sc2 | battlenet |
| valorant | riot |
| dota2 | steam |
| hearthstone | battlenet |
| rocketleague | epic |
| tekken8 | steam |
