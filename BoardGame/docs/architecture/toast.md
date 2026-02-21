# toast.js — Logic Diagrams

> Source: `BoardGame/shared/scripts/toast.js`
> Non-blocking toast notifications, connection banner, and button loading states. Replaces browser `alert()` calls across all lightweight pages.

## 1. Toast Notification Lifecycle

```mermaid
flowchart TD
    A["showToast(message, type, duration)"] --> B[ensureContainer — create .toast-container if missing]
    B --> C[Create toast DOM element]
    C --> D{duration > 0?}
    D -->|Yes| E[Add progress bar element]
    D -->|No| F[No auto-dismiss — manual close only]
    E --> G[Append to container]
    F --> G
    G --> H["requestAnimationFrame — add .visible class"]
    H --> I{duration > 0?}
    I -->|Yes| J[setTimeout → removeToast after duration]
    I -->|No| K[Wait for user click or close button]
    J --> L[removeToast]
    K --> L
    L --> M["Add .removing class — start exit animation"]
    M --> N["setTimeout 300ms — remove from DOM"]

    G --> O{More than 5 toasts visible?}
    O -->|Yes| P[removeToast oldest]
    O -->|No| Q[Done]
```

## 2. Connection Banner State Machine

```mermaid
stateDiagram-v2
    [*] --> Online: Page load

    Online --> Offline: window 'offline' event
    Offline --> Online: window 'online' event

    state Online {
        [*] --> HideBanner
        HideBanner: hideConnectionBanner()
        HideBanner: window._isOffline = false
    }

    state Offline {
        [*] --> ShowBanner
        ShowBanner: showConnectionBanner()
        ShowBanner: window._isOffline = true
    }

    note right of Offline
        saveGameState checks window._isOffline
        and shows warning toast if true
    end note
```

## 3. Button Loading State

```mermaid
flowchart TD
    A["btnLoading(btn)"] --> B[Save original text + disabled state]
    B --> C["btn.disabled = true"]
    C --> D["Add .btn-loading class — shows spinner, hides text"]
    D --> E[Return stopLoading function]
    E --> F["Caller invokes stopLoading()"]
    F --> G[Restore original disabled state]
    G --> H[Remove .btn-loading class]
    H --> I[Restore original text]
```
