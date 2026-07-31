# firestore.rules — Security Rules Architecture

> Source: `BoardGame/firestore.rules`
> Firestore security rules controlling read/write access per collection.
> Last updated: July 2026

## 1. Role Hierarchy

```mermaid
flowchart TD
    A[Request arrives] --> B{request.auth != null?}
    B -->|No| C[Unauthenticated]
    B -->|Yes| D["getUserData() — 1 doc read, cached"]
    D --> E{isGod == true?}
    E -->|Yes| F["God (superadmin) — full access"]
    E -->|No| G{isAdmin == true?}
    G -->|Yes| H["Admin — manage tournaments, no role escalation"]
    G -->|No| I["Regular user — own profile + read tournaments"]

    C --> J["Only allowed: referralCodes get"]
    F --> K["Gods also have isAdmin: true"]

    style C fill:#ff9999
    style J fill:#ff9999
```

## 2. Users Collection — `users/{userId}`

```mermaid
flowchart TD
    subgraph READ
        R1{isOwner?} -->|Yes — free| R2[ALLOW]
        R1 -->|No| R3{isAdmin? — 1 read}
        R3 -->|Yes| R2
        R3 -->|No| R4[DENY]
    end

    subgraph CREATE
        C1{isOwner?} --> C2{isGod == false?}
        C2 --> C3{isAdmin == false?}
        C3 --> C4{isSuperAdmin == false?}
        C4 -->|All true| C5[ALLOW]
        C1 -->|No| C6[DENY]
        C2 -->|No| C6
        C3 -->|No| C6
        C4 -->|No| C6
    end

    subgraph UPDATE
        U1{isGod?} -->|Yes| U2[ALLOW anything]
        U1 -->|No| U3{isAdmin?}
        U3 -->|Yes| U4{"Touches blocked fields?<br/>isGod, isAdmin, isSuperAdmin,<br/>email, uid, createdAt, referralCode"}
        U4 -->|No| U5[ALLOW]
        U4 -->|Yes| U6[DENY]
        U3 -->|No| U7{isOwner?}
        U7 -->|Yes| U8{"Only touches safe fields?<br/>displayName, fullName,<br/>updatedAt, lastLogin, avatarUrl"}
        U8 -->|Yes| U9[ALLOW]
        U8 -->|No| U10[DENY]
        U7 -->|No| U10
    end

    subgraph DELETE
        D1{isGod?} -->|Yes| D2[ALLOW]
        D1 -->|No| D3[DENY]
    end
```

## 3. Tournaments & Subcollections

```mermaid
flowchart TD
    subgraph "tournaments/{tournamentId}"
        T_R["read: isAuthenticated"]
        T_C["create: isAdmin"]
        T_U["update: isGod OR isAdmin (not archived) OR player gameplay update"]
        T_D["delete: isGod"]
        T_NOTE["Player gameplay update: signed-in non-anonymous user,
        tournament not archived, diff touches ONLY: lobbyReady, gameQueue,
        selectedGames, spellPiles, spellPhase, spellHistory, activeEffects,
        teams, lastModified. Powers team.html: ready check, result votes,
        spell casting, team rename."]
    end

    subgraph "eventLog/{eventId}"
        E_R["read: isAuthenticated"]
        E_CUD["create/update/delete: isAdmin"]
    end

    subgraph "onboarding/{docId}"
        O_R["read: isAuthenticated"]
        O_CU["create/update: isAuthenticated"]
        O_D["delete: isAdmin"]
        O_NOTE["App-level secret validates player access.<br/>firebase-loader.js provides anonymous auth<br/>so isAuthenticated passes for public pages."]
    end

    subgraph "matches/{matchId}"
        M_ALL["read/write: isAdmin"]
        subgraph "actions/{actionId}"
            A_ALL["read/write: isAdmin"]
        end
    end

    subgraph "chatTournament/{messageId}"
        CT_R["read: isAuthenticated"]
        CT_C["create: isAuthenticated, !isAnonymous, senderId==self, senderName==auth token"]
        CT_UD["update/delete: never — immutable log"]
    end

    subgraph "chatTeams/{teamId}/messages/{messageId}"
        CTeam_R["read: isAdmin OR own assignedTeamId"]
        CTeam_C["create: isAdmin OR own assignedTeamId, !isAnonymous, senderId==self, senderName==auth token"]
        CTeam_UD["update/delete: never — immutable log"]
    end

    style O_NOTE fill:#ffffcc
```

## 4. Referral Codes — `referralCodes/{code}`

```mermaid
flowchart TD
    subgraph GET
        G1["allow get: true — anyone can look up a specific code by ID"]
    end

    subgraph LIST
        L1["allow list: isGod — prevents collection enumeration"]
    end

    subgraph CREATE_DELETE
        CD1["create/delete: isGod only"]
    end

    subgraph UPDATE
        U1{isGod?} -->|Yes| U2[ALLOW anything]
        U1 -->|No| U3{isAuthenticated?}
        U3 -->|Yes| U4{"Registration update?"}
        U4 --> U5["used: false → true"]
        U4 --> U6["assignedTo == request.auth.uid"]
        U4 --> U7["Only 'used' and 'assignedTo' changed"]
        U5 & U6 & U7 -->|All pass| U8[ALLOW]
        U3 -->|No| U9[DENY]
    end

    style G1 fill:#ffffcc
```

## 5. Global Action Log — `actionLog/{logId}`

```mermaid
flowchart TD
    AL_R["read: isAdmin"]
    AL_CU["create/update: isAdmin"]
    AL_D["delete: isGod"]
```

## 6. Permission Matrix Summary

```
Collection              | Unauth | Anon Auth | User (owner) | Admin | God
------------------------|--------|-----------|--------------|-------|----
users (own doc)         |   -    |     -     |   R C U      | R U   | CRUD
users (other doc)       |   -    |     -     |    -         | R U*  | CRUD
tournaments             |   -    |    R      |    R U‡      | CRU   | CRUD
  eventLog              |   -    |    R      |    R         | CRUD  | CRUD
  onboarding            |   -    |   CRU     |   CRU        | CRUD  | CRUD
  matches               |   -    |     -     |    -         | CRUD  | CRUD
    actions             |   -    |     -     |    -         | CRUD  | CRUD
  chatTournament          |   -    |    R      |    R         | CR    | CR
  chatTeams (own team)    |   -    |     -     |    R C       | R C†  | R C
referralCodes (get)     |  R**   |    R      |    R         | R     | CRUD
referralCodes (list)    |   -    |     -     |    -         |  -    | R
referralCodes (update)  |   -    |   U***    |   U***       | -     | CRUD
actionLog               |   -    |     -     |    -         | CRU   | CRUD

*   Admin blocked from: isGod, isAdmin, isSuperAdmin, email, uid, createdAt, referralCode
**  Get only (single doc by ID) — list denied
*** Registration update only: used false→true, assignedTo==self, no extra fields
†   Admin/God bypass the assignedTeamId check and can read/post in any team's chat.
‡   Gameplay fields only (lobbyReady, gameQueue, selectedGames, spellPiles,
    spellPhase, spellHistory, activeEffects, teams, lastModified), and only
    while the tournament is not archived. Non-anonymous auth required.
```

## 7. Known Trade-offs

| Issue | Severity | Rationale |
|---|---|---|
| Players can write gameplay fields of any tournament | Low | Field-level whitelisting is the limit of Firestore rules for a single doc — per-team ownership inside `lobbyReady`/`gameQueue`/`spellPiles` can't be expressed. Team membership is enforced client-side; the admin confirms all match results, and votes are advisory until admin approval. Acceptable for a friendly-scale tournament. |
| Onboarding writable by any authenticated user | Low | Firestore rules are document-level — can't restrict per-player fields. URL secret + anonymous auth provides app-level control. |
| User create requires explicit `false` for role fields | Minor | `null == false` is `false` in rules. Client must set all three role flags explicitly. Defense-in-depth. |
| Referral codes readable by ID without auth | Accepted | Registration flow validates code before Firebase Auth user exists. 8-char entropy (~2.8 trillion) makes guessing impractical. Collection listing is blocked. |

## 8. Billing Cost Notes

- `isAuthenticated()` and `isOwner()` — free (no doc reads)
- `isAdmin()` and `isGod()` — 1 doc read each (cached within single evaluation)
- Firestore caches `get()` results, so multiple calls to `getUserData()` in one rule evaluation cost only 1 read
- Rules are ordered cheap checks first (`isOwner` before `isAdmin`) to minimize reads
