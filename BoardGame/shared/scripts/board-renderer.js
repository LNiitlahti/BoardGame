/**
 * Board Renderer - Standalone hex grid renderer
 * Usage: const renderer = new BoardRenderer(containerElement, boardModule);
 *        renderer.render(gameData);
 */

class BoardRenderer {
    constructor(containerElement, boardModule, options = {}) {
        this.container = containerElement;
        this.boardModule = boardModule;

        // Default options
        this.options = {
            size: options.size || 800,  // Board size in pixels
            responsive: options.responsive !== false,  // Auto-scale by default
            showHeartImages: options.showHeartImages === true,  // Heart overlay images hidden by default
            hexScale: options.hexScale || 1,  // Scale factor for hex rendering (higher = better quality when scaled down)
            ...options
        };

        // Heart overlay container reference
        this.heartOverlayContainer = null;

        // Apply container styles
        this.container.style.position = 'relative';

        // Only set fixed size if responsive is false
        if (!this.options.responsive) {
            this.container.style.width = `${this.options.size}px`;
            this.container.style.height = `${this.options.size}px`;
        }

        // Inject styles ID marker
        if (!document.getElementById('board-renderer-styles')) {
            const marker = document.createElement('style');
            marker.id = 'board-renderer-styles';
            document.head.appendChild(marker);
        }

        // Inject actual hex styles
        this.injectStyles();
    }
    
    injectStyles() {
        // Remove old dynamic styles if they exist
        const oldStyle = document.getElementById('board-hex-dynamic-styles');
        if (oldStyle) oldStyle.remove();

        const style = document.createElement('style');
        style.id = 'board-hex-dynamic-styles';

        // Scale factor for higher quality rendering
        const s = this.options.hexScale;

        // Base dimensions (scaled)
        const hexW = Math.round(66 * s);
        const hexH = Math.round(58 * s);
        this._hexW = hexW;
        this._hexH = hexH;
        const hexBorder = Math.round(2 * s);
        const labelFont = Math.round(9 * s);
        const mountainHeartSize = Math.round(72 * s);
        const sideHeartSize = Math.round(60 * s);

        // Use CSS transform: scale() on the container to make everything scale together
        // This is much simpler than recalculating all positions
        style.textContent = `
            #hexBoard {
                transform-origin: center center;
            }

            .board-hex {
                position: absolute;
                width: ${hexW}px;
                height: ${hexH}px;
                background: #222;
                clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
                transform: translate(-50%, -50%);
            }

            .board-hex::before {
                content: '';
                position: absolute;
                top: ${hexBorder}px;
                left: ${hexBorder}px;
                right: ${hexBorder}px;
                bottom: ${hexBorder}px;
                background: #ddd;
                clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
            }

            /* Inner bevel/emboss overlay - sits on top of hex content */
            .board-hex .hex-bevel {
                position: absolute;
                top: ${hexBorder}px;
                left: ${hexBorder}px;
                right: ${hexBorder}px;
                bottom: ${hexBorder}px;
                clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
                pointer-events: none;
                z-index: 7;
                /* Inner bevel: light top-left, dark bottom-right */
                background: linear-gradient(
                    135deg,
                    rgba(255, 255, 255, 0.7) 0%,
                    rgba(255, 255, 255, 0.25) 20%,
                    transparent 40%,
                    transparent 60%,
                    rgba(0, 0, 0, 0.25) 80%,
                    rgba(0, 0, 0, 0.7) 100%
                );
            }

            .board-hex.starting-location::before {
                background: #aaa;
            }

            .board-hex.side-heart::before {
                background: #ff6b9d;
            }

            .board-hex.mountain-heart::before {
                background: #ff1744;
            }

            .board-hex.occupied::before {
                background: #667eea;
            }

            .hex-label {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-30deg);
                font-size: ${labelFont}px;
                font-weight: bold;
                color: #000;
                text-align: center;
                pointer-events: none;
                z-index: 10;
                text-shadow: 0 0 2px #fff;
                line-height: 1.2;
            }

            .hex-label.heart {
                color: #fff;
                text-shadow: 0 0 3px #000;
            }

            /* Heart overlay images - sits above hexes and effects */
            .heart-overlay-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 25;
            }

            .heart-overlay-container.hidden {
                display: none;
            }

            .heart-overlay-image {
                position: absolute;
                transform: translate(-50%, -50%) rotate(-30deg);
                pointer-events: none;
                image-rendering: auto;
            }

            .heart-overlay-image.mountain-heart {
                width: ${mountainHeartSize}px;
                height: ${mountainHeartSize}px;
            }

            .heart-overlay-image.side-heart {
                width: ${sideHeartSize}px;
                height: ${sideHeartSize}px;
            }
        `;
        document.head.appendChild(style);
        
        // Add resize observer to scale the board content
        if (this.options.responsive) {
            this.setupResponsiveScaling();
        }
    }
    
    setupResponsiveScaling() {
        const applyScaling = () => {
            const wrapper = this.container.parentElement;
            if (!wrapper) return;

            if (this.isCompactViewport()) {
                this.applyCompactScaling(wrapper);
                return;
            }

            this._compactBase = null; // desktop: no pinch-zoom layer
            const wrapperWidth = wrapper.clientWidth;
            const wrapperHeight = wrapper.clientHeight;

            // Board native size comes from the layout (750 for Legacy, 1000
            // for Version 2) and scales with the hexScale option
            const boardSize = this.nativeBoardSize();

            // Account for rotation - rotated square has larger bounding box
            // For 30deg rotation: bounding box ≈ size * (cos(30) + sin(30)) ≈ size * 1.366
            const rotatedBoundingSize = boardSize * 1.366;

            // Scale to fit within wrapper
            const availableSize = Math.min(wrapperWidth, wrapperHeight);
            let scale = availableSize / rotatedBoundingSize;

            // Make the board larger (adjust for visual preference)
            scale = scale * 1.68;

            // Cap the scale
            scale = Math.min(scale, 2.2);

            // Use relative positioning - let flexbox handle centering
            // Container size matches the scaled board
            this.container.style.width = `${boardSize}px`;
            this.container.style.height = `${boardSize}px`;
            this.container.style.position = 'relative';
            // Clear any absolute positioning remnants
            this.container.style.left = '';
            this.container.style.top = '';
            this.container.style.right = '';
            this.container.style.bottom = '';
            // Scale, rotate, and add manual offset for visual centering
            // Adjust these values to fine-tune centering: translateX(+right/-left) translateY(+down/-up)
            this.container.style.transform = `translate(-0px, -0px) scale(${scale}) rotate(30deg)`;
            this.container.style.transformOrigin = 'center center';
            // Keep the layout footprint at the Legacy size whatever the board
            // size: a symmetric (negative for Version 2) margin shrinks the
            // margin box back to LEGACY_FOOTPRINT, and since the transform is
            // about the centre the board stays centred. 0 for Legacy.
            const footprintMargin = (BoardRenderer.LEGACY_FOOTPRINT * this.options.hexScale - boardSize) / 2;
            this.container.style.margin = `${footprintMargin}px`;
            this.container.style.flexShrink = '0';
        };

        // Kept so refreshLayout() can re-fit after the board switches layout
        this._applyScaling = applyScaling;

        const resizeObserver = new ResizeObserver(applyScaling);
        resizeObserver.observe(this.container.parentElement);

        // Initial scale
        setTimeout(applyScaling, 100);
    }
    
    /**
     * Phones and small tablets (<= 900px, the shared navbar/admin breakpoint).
     * There the board fits the wrapper's WIDTH and its layout box is sized to
     * what is actually drawn. Wider screens keep the fixed Legacy footprint
     * that desktop/TV layouts were tuned around.
     */
    isCompactViewport() {
        if (this.options.compactFit === false) return false;
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
            window.matchMedia('(max-width: 900px)').matches;
    }

    applyCompactScaling(wrapper) {
        const boardSize = this.nativeBoardSize();
        const centers = this.boardModule.generateHexCoordinates()
            .map(([q, r]) => this.boardModule.hexToPixel(q, r));
        const extent = BoardRenderer.computeVisualExtent(
            centers, this._hexW || 66, this._hexH || 58, boardSize, BoardRenderer.ROTATION_DEG);

        const cs = getComputedStyle(wrapper);
        const availWidth = wrapper.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
        if (availWidth <= 0) return;
        // Landscape phone: don't let a width-fitted board run past the screen height.
        const maxHeight = window.innerHeight * 0.9;
        const fit = BoardRenderer.compactFit(extent, availWidth, boardSize, 2.2, maxHeight);

        const st = this.container.style;
        st.width = `${boardSize}px`;
        st.height = `${boardSize}px`;
        st.position = 'relative';
        st.left = st.top = st.right = st.bottom = '';
        this._compactBase = `translate(${fit.translateX}px, ${fit.translateY}px) scale(${fit.scale}) rotate(${BoardRenderer.ROTATION_DEG}deg)`;
        this._compactDrawn = { width: extent.width * fit.scale, height: extent.height * fit.scale };
        this._applyCompactTransform();
        st.transformOrigin = 'center center';
        st.margin = `${fit.marginY}px ${fit.marginX}px`;
        st.flexShrink = '0';
    }

    /**
     * Pinch-zoom on phones (board-zoom.js). The zoom is applied in screen
     * px around the drawn board's centre, on top of the compact fit, so the
     * renderer stays the only writer of the container's transform.
     * @param {number} scale - 1 = fitted
     * @param {number} x - pan in screen px
     * @param {number} y
     */
    setUserZoom(scale, x, y) {
        this._userZoom = { scale, x, y };
        if (this._compactBase) this._applyCompactTransform();
    }

    /** Drawn board size in screen px at zoom 1, or null off the compact path. */
    compactDrawnSize() {
        return this.isCompactViewport() && this._compactDrawn ? this._compactDrawn : null;
    }

    _applyCompactTransform() {
        const z = this._userZoom;
        const zoom = z && z.scale !== 1 ? `translate(${z.x}px, ${z.y}px) scale(${z.scale}) ` : '';
        this.container.style.transform = zoom + this._compactBase;
    }

    static get ROTATION_DEG() { return 30; }

    /**
     * Bounding box of the drawn hexes after the board's rotation, in
     * unscaled container px. Hexes are flat-top, centred on their point.
     * @param {Array<[number,number]>} centers - hex centres in container px
     * @returns {{width:number, height:number, offsetX:number, offsetY:number}}
     *   offsetX/Y: bbox centre relative to the container centre (the
     *   transform origin), after rotation
     */
    static computeVisualExtent(centers, hexW, hexH, boardSize, rotationDeg) {
        const a = rotationDeg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
        const c = boardSize / 2;
        const corners = [[-hexW / 2, 0], [-hexW / 4, -hexH / 2], [hexW / 4, -hexH / 2],
            [hexW / 2, 0], [hexW / 4, hexH / 2], [-hexW / 4, hexH / 2]];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of centers) {
            for (const [dx, dy] of corners) {
                const px = x + dx - c, py = y + dy - c;
                const rx = px * cos - py * sin, ry = px * sin + py * cos;
                if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
                if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
            }
        }
        return { width: maxX - minX, height: maxY - minY, offsetX: (minX + maxX) / 2, offsetY: (minY + maxY) / 2 };
    }

    /**
     * Scale/margins/translate so the board fills availWidth and its margin
     * box equals what is drawn (no empty bands, no overflow).
     * @param {number} [maxHeight] - optional cap on the drawn height
     */
    static compactFit(extent, availWidth, boardSize, maxScale, maxHeight) {
        let scale = availWidth / extent.width;
        if (maxHeight) scale = Math.min(scale, maxHeight / extent.height);
        scale = Math.min(scale, maxScale);
        return {
            scale,
            marginX: (extent.width * scale - boardSize) / 2,
            marginY: (extent.height * scale - boardSize) / 2,
            translateX: -extent.offsetX * scale,
            translateY: -extent.offsetY * scale,
        };
    }

    /**
     * Native (unscaled) board box in px: twice the layout's half-extent,
     * times the hexScale option. 750 * hexScale for Legacy, as before.
     */
    nativeBoardSize() {
        const half = this.boardModule?.layout?.nativeHalf ?? 375;
        return 2 * half * this.options.hexScale;
    }

    /**
     * Layout footprint (px, before hexScale) the container always occupies,
     * whatever nativeBoardSize() is. Pages size their board wrappers from
     * the container's content height and applyScaling then scales by that
     * wrapper, so a bigger box for Version 2 would grow the wrapper and draw
     * the board too large and clipped. Legacy's 750 box keeps every page as
     * it was.
     */
    static get LEGACY_FOOTPRINT() { return 750; }

    /**
     * Re-fit the container after boardModule.setLayout(). The caller still
     * has to call render() to rebuild the hexes.
     */
    refreshLayout() {
        if (this._applyScaling) this._applyScaling();
    }

    render(gameData = {}) {
        // Clear existing hexes
        this.container.innerHTML = '';

        if (!this.boardModule) {
            console.error('Board module not provided');
            return;
        }

        // Render heart overlay images first (so they appear below hexes)
        this.renderHeartOverlay();

        // Generate all hex coordinates
        const coordinates = this.boardModule.generateHexCoordinates();
        
        coordinates.forEach(([q, r]) => {
            const hex = document.createElement('div');
            const coord = `q${q}r${r}`;
            
            // Build class list
            let hexClass = 'board-hex';
            const hexType = this.boardModule.getHexType(q, r);
            if (hexType !== 'normal') {
                hexClass += ` ${hexType}`;
            }
            
            // Check if occupied from game data
            const teamId = gameData.board && gameData.board[coord];
            if (teamId) {
                hexClass += ' occupied';
            }

            // Check if this hex is a room (from gameData.rooms OR boardModule.roomHexes)
            const isRoom = (gameData.rooms && gameData.rooms.includes(coord)) ||
                           (this.boardModule.roomHexes && this.boardModule.roomHexes.includes(coord));
            if (isRoom) {
                hexClass += ' room';
                // Add room border element
                const roomBorder = document.createElement('div');
                roomBorder.className = 'room-border';
                hex.appendChild(roomBorder);
            }

            // Add inner bevel overlay for 3D emboss effect
            const bevel = document.createElement('div');
            bevel.className = 'hex-bevel';
            hex.appendChild(bevel);

            hex.className = hexClass;
            hex.dataset.coord = coord;
            if (teamId) {
                hex.dataset.team = teamId;
            }

            // Position the hex
            const [x, y] = this.boardModule.hexToPixel(q, r);
            hex.style.left = `${x}px`;
            hex.style.top = `${y}px`;

            // Add label showing coordinates and type
            const label = document.createElement('div');
            label.className = 'hex-label';

            let labelText = `q${q}r${r}`;

            // Add special markers
            if (hexType === 'mountain-heart') {
                labelText = `❤️❤️\n${labelText}`;
                label.classList.add('heart');
            } else if (hexType === 'side-heart') {
                labelText = `❤️\n${labelText}`;
                label.classList.add('heart');
            } else if (hexType === 'starting-location') {
                labelText = `⭐\n${labelText}`;
            }

            label.innerHTML = labelText.replace(/\n/g, '<br>');
            hex.appendChild(label);

            this.container.appendChild(hex);
        });
    }

    /**
     * Render heart overlay images (mountain heart and side hearts)
     * These appear above the background but below hexes and effects
     */
    renderHeartOverlay() {
        // Create container for heart images
        this.heartOverlayContainer = document.createElement('div');
        this.heartOverlayContainer.className = 'heart-overlay-container';

        // Hide if option is disabled
        if (!this.options.showHeartImages) {
            this.heartOverlayContainer.classList.add('hidden');
        }

        // Render mountain heart (center)
        const mountainHeartCoord = this.boardModule.mountainHeartLocation;
        const [mq, mr] = mountainHeartCoord.match(/-?\d+/g).map(Number);
        const [mx, my] = this.boardModule.hexToPixel(mq, mr);

        const mountainHeartImg = document.createElement('img');
        mountainHeartImg.src = (window.BOARDGAME_BASE || '.') + '/shared/images/hexes/mountain_heart_v3.png';
        mountainHeartImg.className = 'heart-overlay-image mountain-heart';
        mountainHeartImg.style.left = `${mx}px`;
        mountainHeartImg.style.top = `${my}px`;
        mountainHeartImg.alt = 'Mountain Heart';
        this.heartOverlayContainer.appendChild(mountainHeartImg);

        // Render side hearts
        this.boardModule.sideHeartLocations.forEach(coord => {
            const [q, r] = coord.match(/-?\d+/g).map(Number);
            const [x, y] = this.boardModule.hexToPixel(q, r);

            const sideHeartImg = document.createElement('img');
            sideHeartImg.src = (window.BOARDGAME_BASE || '.') + '/shared/images/hexes/side_heart_v3.png';
            sideHeartImg.className = 'heart-overlay-image side-heart';
            sideHeartImg.style.left = `${x}px`;
            sideHeartImg.style.top = `${y}px`;
            sideHeartImg.alt = 'Side Heart';
            sideHeartImg.dataset.coord = coord;
            this.heartOverlayContainer.appendChild(sideHeartImg);
        });

        // Insert at the beginning of container (below hexes)
        this.container.insertBefore(this.heartOverlayContainer, this.container.firstChild);
    }

    /**
     * Toggle heart overlay images visibility
     * @param {boolean} [show] - Force show (true) or hide (false). If omitted, toggles current state.
     * @returns {boolean} New visibility state
     */
    toggleHeartImages(show) {
        if (!this.heartOverlayContainer) return this.options.showHeartImages;

        // Determine new state
        if (typeof show === 'boolean') {
            this.options.showHeartImages = show;
        } else {
            this.options.showHeartImages = !this.options.showHeartImages;
        }

        // Apply visibility
        if (this.options.showHeartImages) {
            this.heartOverlayContainer.classList.remove('hidden');
        } else {
            this.heartOverlayContainer.classList.add('hidden');
        }

        return this.options.showHeartImages;
    }

    /**
     * Get current heart images visibility state
     * @returns {boolean}
     */
    areHeartImagesVisible() {
        return this.options.showHeartImages;
    }

    /**
     * Update specific hex without re-rendering entire board
     */
    updateHex(q, r, teamId) {
        const coord = `q${q}r${r}`;
        const hex = this.container.querySelector(`[data-coord="${coord}"]`);
        if (hex) {
            if (teamId) {
                hex.classList.add('occupied');
            } else {
                hex.classList.remove('occupied');
            }
        }
    }
    
    /**
     * Clear all occupied hexes
     */
    clearOccupied() {
        const occupiedHexes = this.container.querySelectorAll('.occupied');
        occupiedHexes.forEach(hex => hex.classList.remove('occupied'));
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.BoardRenderer = BoardRenderer;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardRenderer;
}