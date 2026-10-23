# board-renderer.js — Logic Diagrams

> Source: `BoardGame/shared/scripts/board-renderer.js`
> Hex grid visualization with responsive scaling, heart overlays, and incremental updates.
> Pure rendering layer — delegates coordinate math to external `boardModule`.

## 1. Render Pipeline

```mermaid
flowchart TD
    A["render(gameData)"] --> B["Clear DOM — innerHTML = ''"]
    B --> C{boardModule exists?}
    C -->|No| D[Log error — RETURN]
    C -->|Yes| E[renderHeartOverlay]
    E --> F{showHeartImages?}
    F -->|Yes| G[Create heart container]
    F -->|No| H[Create hidden heart container]
    G --> I[Place mountain heart image at mountainHeartLocation]
    H --> I
    I --> J[Place side heart images at sideHeartLocations]
    J --> K{For each hex coordinate}
    K --> L["Get hexType from boardModule.getHexType(q, r)"]
    L --> M["Start class string: 'board-hex'"]
    M --> N{hexType !== normal?}
    N -->|Yes| O[Add hexType class]
    N -->|No| P[Skip]
    O --> Q{"gameData.board[coord] has team?"}
    P --> Q
    Q -->|Yes| R["Add 'occupied' class + data-team attribute"]
    Q -->|No| S[Skip]
    R --> T{coord in rooms or boardModule.roomHexes?}
    S --> T
    T -->|Yes| U["Add 'room' class"]
    T -->|No| V[Skip]
    U --> W[Create label]
    V --> W
    W --> X{hexType?}
    X -->|mountain-heart| Y["Label: heart heart + coord"]
    X -->|side-heart| Z["Label: heart + coord"]
    X -->|starting-location| AA["Label: star + coord"]
    X -->|normal or other| AB[Label: coord only]
    Y --> AC["Position hex via inline left, top from hexToPixel"]
    Z --> AC
    AA --> AC
    AB --> AC
    AC --> AD[Append hex + bevel + label to container]
    AD --> K
    K -->|Done| AE[Apply responsive scaling]
```

## 2. Responsive Scaling

```mermaid
flowchart TD
    A[setupResponsiveScaling] --> B[Create ResizeObserver on parent]
    B --> C[100ms timeout then applyScaling]
    C --> D{Parent element exists?}
    D -->|No| E[RETURN — no scaling]
    D -->|Yes| F["nativeSize = 2 x layout.nativeHalf x hexScale (750 Legacy / 1000 Version 2)"]
    F --> G["rotatedSize = nativeSize x 1.366 (30deg bounding box)"]
    G --> H["availableSpace = min(parentWidth, parentHeight)"]
    H --> I["scale = availableSpace / rotatedSize"]
    I --> J["scale = scale x 1.68 (aesthetic boost)"]
    J --> K{scale > 2.2?}
    K -->|Yes| L[Cap at 2.2]
    K -->|No| M[Use calculated scale]
    L --> N["Apply transform: scale(X) rotate(30deg)"]
    M --> N
```

## 3. Incremental Updates

```mermaid
flowchart TD
    A["updateHex(q, r, teamId)"] --> B[Build coord string]
    B --> C[Query DOM for hex element]
    C --> D{Element found?}
    D -->|No| E[Silent fail — no action]
    D -->|Yes| F{teamId is truthy?}
    F -->|Yes| G["Add 'occupied' class"]
    F -->|No| H["Remove 'occupied' class"]

    I[clearOccupied] --> J["Query all '.occupied' hexes"]
    J --> K[Remove occupied class from each]

    L["toggleHeartImages(show)"] --> M{Heart container exists?}
    M -->|No| N[Return stored state]
    M -->|Yes| O{show parameter?}
    O -->|true| P["Remove 'hidden' class"]
    O -->|false| Q["Add 'hidden' class"]
    O -->|undefined| R["Toggle 'hidden' class"]
    P --> S[Update options.showHeartImages]
    Q --> S
    R --> S
```

## Board versions

The board's size is not hardcoded. `shared/scripts/board-layouts.js` defines Legacy (version 1, 91 hexes) and Version 2 (169 hexes). A tournament stores `boardVersion`; a missing field means Legacy. `BoardModule` takes a layout (default Legacy) and `BoardLayouts.sync(boardModule, boardRenderer, tournamentDoc)` switches a page's existing board to the tournament's layout when the doc loads. Version 2 reuses the 91 existing tile images: inner hexes show their own tile, and the outer two rings MIRROR the inner tiles (each side of the radius-5 hexagon acts as a mirror; `BoardLayouts.mirrorIntoArt` / `artCoordFor`). The art of the Legacy side-heart hexes moves to the new Version 2 side hearts, and the six old heart spots show their inward neighbour's tile (the frozen `artSwaps` table on the layout). Real art later just means adding the tiles and raising `artRadius` to 7; mirroring then stops by itself. Each board version has its own default-rooms doc: `config/defaultRooms` (Legacy) and `config/defaultRoomsV2` (Version 2), selected by `layout.defaultRoomsDocId`. `LOCAL_DEFAULT_ROOMS` is Legacy; `LOCAL_DEFAULT_ROOMS_V2` is intentionally empty.
