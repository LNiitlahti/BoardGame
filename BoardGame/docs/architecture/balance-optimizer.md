# balance-optimizer.js — Logic Diagrams

> Source: `BoardGame/scripts/balance-optimizer.js`
> Math engine: greedy variance minimization, W/A matrices, split fairness penalties.
> Cost function: `C = Sum[(W_ij - meanW)^2 + (A_ij - meanA)^2]` across 40 cross-team pairs.

## 1. Selection Algorithm (5v5)

```mermaid
flowchart TD
    A[selectOptimal5v5] --> B["Enumerate all 60 partitions:<br/>5 split teams x C(4,2)=6 combos x 2 player choices"]
    B --> C["Calculate means: meanW, meanA across 40 cross-team pairs"]
    C --> D{For each partition}
    D --> E[Calculate pairing delta]
    E --> E1["For each same-side pair:<br/>delta += (W+1-mean)^2 - (W-mean)^2"]
    E --> E2["For each cross-side pair:<br/>delta += (A+1-mean)^2 - (A-mean)^2"]
    D --> F[Calculate split penalty]
    F --> F1[Recency penalty]
    F --> F2[Imbalance penalty]
    F --> F3[Drought bonus]
    E1 --> G["totalDelta = pairingDelta + (splitPenalty x 10)"]
    E2 --> G
    F1 --> G
    F2 --> G
    F3 --> G
    G --> D
    D -->|All 60 scored| H[Find minimum totalDelta]
    H --> I["Collect all within epsilon (0.001) of minimum"]
    I --> J{How many tied?}
    J -->|1| K[Select that partition]
    J -->|Multiple| L[Random selection among ties]
    K --> M[Return partition + costDelta + splitPenalty + metadata]
    L --> M
```

## 2. Split Fairness Penalty

```mermaid
flowchart TD
    A["calculateSplitFairnessPenalty(splitTeamId)"] --> B["matchesSinceLastSplit = current - lastSplitMatch"]
    B --> C{"matchesSinceLastSplit <= 1?"}
    C -->|Yes| D["recencyPenalty = 100 — near impossible"]
    C -->|No| E{"matchesSinceLastSplit <= 2?"}
    E -->|Yes| F["recencyPenalty = 50 — strongly discourage"]
    E -->|No| G{"matchesSinceLastSplit <= 3?"}
    G -->|Yes| H["recencyPenalty = 20 — discourage"]
    G -->|No| I["recencyPenalty = 0 — no penalty"]

    D --> J[Calculate avgSplits across all teams]
    F --> J
    H --> J
    I --> J
    J --> K["imbalancePenalty = max(0, (thisSplitCount - avgSplits) x 5)"]

    K --> L[Find team with longest drought maxDrought]
    L --> M{splitTeamId === maxDroughtTeam AND maxDrought > 2?}
    M -->|Yes| N["droughtBonus = -30"]
    M -->|No| O["droughtBonus = 0"]

    N --> P["totalPenalty = recency + imbalance + drought"]
    O --> P
    P --> Q["Return totalPenalty x splitFairnessWeight (10)"]
```

## 3. Matrix Updates

```mermaid
flowchart TD
    A["applyPartition(sideA, sideB)"] --> B[Update W matrix — same-side pairs]
    B --> C{For each pair p1,p2 within sideA}
    C --> D["W[p1][p2]++ and W[p2][p1]++"]
    B --> E{For each pair p1,p2 within sideB}
    E --> F["W[p1][p2]++ and W[p2][p1]++"]

    A --> G[Update A matrix — opposite-side pairs]
    G --> H{For each pair p1 in sideA, p2 in sideB}
    H --> I["A[p1][p2]++ and A[p2][p1]++"]

    J["recordSplit(splitTeamId)"] --> K["splitCounts[splitTeamId]++"]
    K --> L["lastSplitMatch[splitTeamId] = currentMatchNumber"]

    M[advanceMatch] --> N[currentMatchNumber++]
```

## 4. State Restoration

```mermaid
flowchart TD
    A[restoreState] --> B{gameState.smartMatchState exists?}
    B -->|Yes — Saved State| C{saved.optimizer exists?}
    C -->|Yes| D[Restore W matrix]
    D --> E[Restore A matrix]
    E --> F[Restore splitCounts]
    F --> G[Restore lastSplitMatch]
    G --> H[Restore currentMatchNumber]
    H --> I[Restore totalMatches]
    C -->|No| J[Skip optimizer restore]
    I --> K{saved.gameRotation exists?}
    J --> K
    K -->|Yes| L[Restore full rotation object]
    K -->|No| M[initializeGameRotation — fresh]

    B -->|No — First Time| N[initializeGameRotation — fresh]
    N --> O[rebuildFromHistory]
    O --> P[Get gameQueue from gameState]
    P --> Q["Filter: status=completed AND NOT isChallenge"]
    Q --> R{For each completed match}
    R --> S[Extract sideA and sideB player IDs]
    S --> T{Both sides populated?}
    T -->|Yes| U["optimizer.applyPartition(sideA, sideB)"]
    T -->|No| V[Skip match]
    U --> W{match.splitTeamId exists?}
    W -->|Yes| X["splitCounts[teamId]++"]
    W -->|No| Y[Skip]
    X --> R
    Y --> R
    V --> R
    R -->|Done| Z[currentMatchNumber = completedMatches.length]
```

## 5. Statistics Output

```mermaid
flowchart TD
    A[getBalanceStats] --> B[Collect all cross-team pair W values]
    B --> C["Calculate: mean, variance, stdDev, min, max, range"]
    A --> D[Collect all cross-team pair A values]
    D --> E["Calculate: mean, variance, stdDev, min, max, range"]
    C --> F{"W.range <= 2 AND A.range <= 2?"}
    E --> F
    F -->|Yes| G[isBalanced = true]
    F -->|No| H[isBalanced = false]
    G --> I[Return stats object]
    H --> I

    J[getSplitStats] --> K[Collect all splitCounts values]
    K --> L["Calculate: total, mean, min, max, range"]
    L --> M{range <= 2?}
    M -->|Yes| N[isBalanced = true]
    M -->|No| O[isBalanced = false]
    N --> P[Return split stats]
    O --> P
```
