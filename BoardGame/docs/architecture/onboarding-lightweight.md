# onboarding-lightweight.js — Logic Diagrams

> Source: `BoardGame/lightweight/scripts/onboarding.js`
> Player checklist (friends + games) and admin progress dashboard.
> SHA-256 secret validation, platform ID management.
>
> **Data location:** `tournaments/{id}/onboarding/state` (Firestore subcollection).
> Onboarding data was migrated from the main tournament document to avoid
> triggering re-renders on unrelated pages (e.g., view_v2.html TV display).

## 1. View Routing & Secret Validation

```mermaid
flowchart TD
    A[DOMContentLoaded] --> B[Parse URL params]
    B --> C{tournamentId exists?}
    C -->|No| D[FATAL ERROR — blocks all views]
    C -->|Yes| E{"view === 'admin'?"}
    E -->|Yes| F[isAdminView = true]
    E -->|No| G{player param valid 1-10?}
    G -->|No| H[FATAL ERROR — invalid player]
    G -->|Yes| I[currentPlayerNumber = player]
    F --> J[Wait for firebase-ready]
    I --> J
    J --> K[setupTournamentListener]
    K --> L["On snapshot: gameState = data"]
    L --> L2["First load: migrateOnboardingToSubcollection"]
    L2 --> L3["setupOnboardingListener — subcollection"]
    L3 --> L4["onboardingState = subcollection data"]
    L4 --> M["renderCurrentView — waits for both listeners"]
    M --> M2["validateSecretAccess"]
    M2 --> N{isAdminView?}
    N -->|Yes| O[renderAdminView]
    N -->|No| P{secretHash or legacy secret?}
    P -->|No| Q[renderPlayerView]
    P -->|Yes| R[Hash URL secret with SHA-256]
    R --> S{hash matches?}
    S -->|Yes| T[renderPlayerView]
    S -->|No| U[ACCESS DENIED]
```

## 2. Player Completion Algorithm

```mermaid
flowchart TD
    A[toggleFriendStatus or toggleGameStatus] --> B[Toggle local state]
    B --> C[Update lastUpdated timestamp]
    C --> D[checkPlayerCompletion]
    D --> E["Count friendsComplete: loop 1-10, skip self"]
    D --> F["Count gamesComplete: loop selectedGames"]
    E --> G{"friendsComplete >= 9 AND gamesComplete >= totalGames?"}
    F --> G
    G -->|Yes| H["completedAt = now — mark DONE"]
    G -->|No| I["completedAt = null — mark incomplete"]
    H --> J["savePlayerField -> subcollection update"]
    I --> J
    J --> K["Onboarding listener fires -> re-render"]
```

## 3. Admin Progress Grid

```mermaid
flowchart TD
    A[renderSummaryGrid] --> B{"For each player (1-10)"}
    B --> C["Count friends added (0-9)"]
    B --> D["Count games tested (0-N)"]
    C --> E["percent = (friends + games) / (9 + totalGames) x 100"]
    D --> E
    E --> F{percent === 100?}
    F -->|Yes| G["statusClass=complete text=DONE"]
    F -->|No| H{percent > 0?}
    H -->|Yes| I["statusClass=in-progress text=X%"]
    H -->|No| J["statusClass=not-started text=Not Started"]
    G --> K[Render card with team color + stats + badge]
    I --> K
    J --> K
    K --> B
```

## 4. Secret Management

```mermaid
flowchart TD
    A[openSecretModal] --> B{secretHash exists?}
    B -->|Yes| C{plainSecret in memory?}
    C -->|Yes| D["Show: Secret known — ready for links"]
    C -->|No| E["Show: Secret set but not available — verify needed"]
    B -->|No| F["Show: No secret set"]

    G["saveSecret(newSecret)"] --> H[Hash with SHA-256]
    H --> I[Store hash in Firebase]
    I --> J[Store plain in memory only]
    J --> K[Delete legacy .secret field]
    K --> L["showToast: secret shown ONCE, no auto-dismiss"]
    L --> M[Re-render admin view]

    N["verifySecret(enteredSecret)"] --> O{enteredSecret empty?}
    O -->|Yes| P["showToast warning: enter a secret"]
    O -->|No| Q[Hash entered secret]
    Q --> R{hash matches stored hash?}
    R -->|Yes| S[Store plain in memory]
    S --> T["Close modal — re-render — links now work"]
    R -->|No| U["showToast error: Secret does not match"]
```

## 5. Platform ID Profile URLs

```mermaid
flowchart TD
    A["getProfileUrl(platformKey, id)"] --> B{platform?}
    B -->|steam| C{"id starts with 'http'?"}
    C -->|Yes| D[Return id as-is]
    C -->|No| E{id is all digits?}
    E -->|Yes| F["Return steamcommunity.com/profiles/{id}"]
    E -->|No| G["Return steamcommunity.com/id/{id}"]
    B -->|xbox| H["Return xbox.com/play/user/{encodedId}"]
    B -->|discord battlenet epic riot| I["Return null — no profile URL"]
```

## 6. Game Resolution for Checklist

```mermaid
flowchart TD
    A[getSelectedGames] --> B{For each gameId in gameState.selectedGames}
    B --> C{GAMES_CONFIG exists globally?}
    C -->|Yes| D["Try GAMES_CONFIG.getGame(gameId)"]
    D --> E{Found?}
    E -->|Yes| F["Return {id, ...game metadata}"]
    E -->|No| G[Fall through]
    C -->|No| G
    G --> H{"gameState.gameDefinitions[gameId] exists?"}
    H -->|Yes| I["Return {id, ...custom definition}"]
    H -->|No| J["Return {id, name: gameId, icon: game emoji}"]
```
