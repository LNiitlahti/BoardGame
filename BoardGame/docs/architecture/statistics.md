# statistics.js — Logic Diagrams

> Source: `BoardGame/lightweight/scripts/statistics.js`
> Analytics engine: leaderboards, H2H matrix, streaks, charts, player detail.
> Note: `renderSummaryStats` filters out break entries (`.filter(m => !m.isBreak)`) so breaks don't inflate match counts.

## 1. Data Loading Pipeline

```mermaid
flowchart TD
    A[DOMContentLoaded] --> B[Log ready]
    B --> C[Wait for firebase-ready event]
    C --> D[updateConnectionStatus connected]
    D --> E[loadTournamentsList]
    E --> F{URL has tournamentId?}
    F -->|Yes| G["loadTournament(id)"]
    F -->|No| H[Show tournament selector only]
    G --> I[showLoadingOverlay]
    I --> J[Firestore query]
    J --> K{Document found?}
    K -->|No| L[Log error — return]
    K -->|Yes| M["gameState = doc.data()"]
    M --> N[updateMetaInfo]
    N --> O[populateFilters]
    O --> P[renderAllStatistics]
    P --> P1["playerStatsCache = calculateAllPlayerStats()"]
    P --> P2[renderStandings]
    P --> P3[renderSummaryStats]
    P --> P4[renderStreaks]
    P --> P5[renderPointsChart]
    P --> P6[renderMatches]
    P --> P7[renderHeadToHead]
    P --> P8[renderGameAnalysis]
    P --> P9[populatePlayerSelector]
    P --> P10["renderLeaderboard('wins')"]
    P --> Q[hideLoadingOverlay]
```

## 2. Player Stats Calculation

```mermaid
flowchart TD
    A[calculateAllPlayerStats] --> B[Create empty stats for every player]
    B --> C[Sort gameHistory oldest to newest]
    C --> D{For each match}

    D --> E[Process WINNERS]
    E --> F["gamesPlayed++ wins++"]
    F --> G{"currentStreak.type === 'win'?"}
    G -->|Yes| H[streak.count++]
    G -->|No| I["Reset streak: type=win count=1"]
    H --> J["bestWinStreak = max(bestWinStreak, streak.count)"]
    I --> J
    J --> K[Record by game type and format]
    K --> L{match.isChallenge?}
    L -->|Yes| M[challenges.won++]
    L -->|No| N[Skip challenge tracking]
    M --> O[Track match duration]
    N --> O
    O --> P[Store in recentMatches]
    P --> Q["For each loser: vsOpponents[loser].won++"]
    Q --> R["For each other winner: withTeammates[ally].won++"]

    D --> S[Process LOSERS — mirror logic]
    S --> T["gamesPlayed++ losses++"]
    T --> U{"currentStreak.type === 'loss'?"}
    U -->|Yes| V[streak.count++]
    U -->|No| W["Reset streak: type=loss count=1"]
    V --> X["bestLossStreak = max(bestLossStreak, streak.count)"]
    W --> X
    X --> Y[Same tracking as winners but with loss results]

    D -->|All matches done| Z[Derive final metrics]
    Z --> AA["winRate = (wins / gamesPlayed) x 100"]
    Z --> AB[recentMatches = last 10 reversed]
    Z --> AC["avgDuration = mean of matchDurations or null"]
```

## 3. Leaderboard Switch

```mermaid
flowchart TD
    A["renderLeaderboard(type)"] --> B{type?}
    B -->|wins| C[Sort all players by wins DESC]
    B -->|winrate| D["Filter: gamesPlayed >= 3"]
    B -->|games| E[Sort all players by gamesPlayed DESC]
    B -->|streak| F[Sort all players by bestWinStreak DESC]

    D --> G[Sort filtered by winRate DESC]

    C --> H[Take top 10]
    G --> H
    E --> H
    F --> H

    H --> I{For each ranked player}
    I --> J{rank?}
    J -->|1| K[Medal: gold]
    J -->|2| L[Medal: silver]
    J -->|3| M[Medal: bronze]
    J -->|4+| N[No medal]

    K --> O{Stat display by type}
    L --> O
    M --> O
    N --> O
    O -->|wins| P["Show: X wins"]
    O -->|winrate| Q["Show: X% with W-L record"]
    O -->|games| R["Show: X games"]
    O -->|streak| S["Show: X win streak"]
```

## 4. Filter Matching Logic

```mermaid
flowchart TD
    A[renderMatches] --> B[Sort by timestamp DESC]
    B --> C{currentFilters.team set?}
    C -->|Yes| D[Keep matches where team in winners OR losers]
    C -->|No| E[Skip team filter]

    D --> F{currentFilters.result set?}
    F -->|won| G[Further filter: team in WINNERS only]
    F -->|lost| H[Further filter: team in LOSERS only]
    F -->|not set| I[Keep all team matches]

    E --> J{currentFilters.game set?}
    G --> J
    H --> J
    I --> J

    J -->|Yes| K["Keep where match.game === filter.game"]
    J -->|No| L[Skip game filter]

    K --> M{currentFilters.search set?}
    L --> M

    M -->|Yes| N[Build playerNames from 6 sources]
    N --> O[Keep if any name includes search — case insensitive]
    M -->|No| P[Skip search filter]

    O --> Q[Render filtered matches]
    P --> Q

    style E fill:#ff9999,color:#000
    style F fill:#ff9999,color:#000
```

> **Known Bug**: Result filter (`won`/`lost`) is nested inside team filter check.
> If user sets result without team, it is silently ignored.

## 5. Head-to-Head Matrix

```mermaid
flowchart TD
    A[renderHeadToHead] --> B["Initialize NxN matrix: all wins=0 losses=0"]
    B --> C{For each match in history}
    C --> D{For each winner-loser pair}
    D --> E["h2h[winner][loser].wins++"]
    D --> F["h2h[loser][winner].losses++"]
    E --> C
    F --> C
    C -->|Done| G[Render table]
    G --> H{For each cell}
    H --> I{wins > losses?}
    I -->|Yes| J[Class: positive]
    I -->|No| K{wins < losses?}
    K -->|Yes| L[Class: negative]
    K -->|No| M[Class: neutral]
```

## 6. Streaks Tracking

```mermaid
flowchart TD
    A[renderStreaks] --> B[Process matches chronologically]
    B --> C{For each match}
    C --> D{For each winning team}
    D --> E{"Current streak type === 'win'?"}
    E -->|Yes| F[count++]
    E -->|No| G["Reset: type=win count=1"]
    C --> H{For each losing team}
    H --> I{"Current streak type === 'loss'?"}
    I -->|Yes| J[count++]
    I -->|No| K["Reset: type=loss count=1"]
    F --> C
    G --> C
    J --> C
    K --> C
    C -->|Done| L["Filter streaks: count >= 2"]
    L --> M[Sort by count DESC]
    M --> N[Take top 5]
    N --> O[Render streak display]
```

## 7. Points Progression Chart

```mermaid
flowchart TD
    A[renderPointsChart] --> B["Create dataset per team — start at 0"]
    B --> C{For each match in history}
    C --> D{For each team}
    D --> E{"match.teamStatsSnapshot[team] exists?"}
    E -->|Yes| F[Push snapshot.points]
    E -->|No| G[Push last known value — carry forward]
    F --> C
    G --> C
    C -->|Done| H["Add 'Current' label"]
    H --> I[Push current team.points as final point]
    I --> J[Render Chart.js line chart]
```

## 8. Win Rate Classification

Used in 8+ places throughout the file:

```mermaid
flowchart TD
    A[Determine winRateClass] --> B{winRate >= 60?}
    B -->|Yes| C["Class: high"]
    B -->|No| D{winRate >= 40?}
    D -->|Yes| E["Class: medium"]
    D -->|No| F["Class: low"]
```

## 9. Player Detail Flow

```mermaid
flowchart TD
    A[User selects player] --> B{playerId empty?}
    B -->|Yes| C[clearPlayerSections — return]
    B -->|No| D[selectedPlayerId = playerId]
    D --> E[renderPlayerDetail]
    D --> F[renderPlayerGameStats]
    D --> G[renderPlayerFormatStats]
    D --> H[renderPlayerRecentForm]
    D --> I[renderPlayerH2H]
    D --> J[renderTeammateSynergy]
    E --> K[All read from same playerStatsCache]
    F --> K
    G --> K
    H --> K
    I --> K
    J --> K
```
