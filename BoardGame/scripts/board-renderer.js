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
            ...options
        };
        
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
        
        // Use CSS transform: scale() on the container to make everything scale together
        // This is much simpler than recalculating all positions
        style.textContent = `
            #hexBoard {
                transform-origin: center center;
            }
            
            .board-hex {
                position: absolute;
                width: 66px;
                height: 58px;
                background: #000;
                clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
                transform: translate(-50%, -50%);
            }

            .board-hex::before {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                right: 2px;
                bottom: 2px;
                background: #ddd;
                clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
            }

            .board-hex.starting-location::before {
                background: #aaa;
            }

            .board-hex.high-value::before {
                background: #999;
            }

            .board-hex.center::before {
                background: #777;
            }

            .board-hex.occupied::before {
                background: #667eea;
            }
        `;
        document.head.appendChild(style);
        
        // Add resize observer to scale the board content
        if (this.options.responsive) {
            this.setupResponsiveScaling();
        }
    }
    
    setupResponsiveScaling() {
        const resizeObserver = new ResizeObserver(() => {
            const wrapper = this.container.parentElement;
            if (!wrapper) return;
            
            const wrapperWidth = wrapper.clientWidth;
            const wrapperHeight = wrapper.clientHeight;
            
            // Board native size is 750px
            const boardSize = 750;
            const scale = Math.min(wrapperWidth / boardSize, wrapperHeight / boardSize, 2);
            
            // Set container to board size and center it within wrapper
            this.container.style.width = `${boardSize}px`;
            this.container.style.height = `${boardSize}px`;
            this.container.style.transform = `scale(${scale})`;
            this.container.style.transformOrigin = 'center center';
            this.container.style.position = 'absolute';
            this.container.style.left = '50%';
            this.container.style.top = '50%';
            this.container.style.marginLeft = `${-boardSize / 2}px`;
            this.container.style.marginTop = `${-boardSize / 2}px`;
        });
        
        resizeObserver.observe(this.container.parentElement);
        
        // Initial scale
        setTimeout(() => {
            const wrapper = this.container.parentElement;
            if (wrapper) {
                const wrapperWidth = wrapper.clientWidth;
                const wrapperHeight = wrapper.clientHeight;
                const boardSize = 750;
                const scale = Math.min(wrapperWidth / boardSize, wrapperHeight / boardSize, 2);
                
                this.container.style.width = `${boardSize}px`;
                this.container.style.height = `${boardSize}px`;
                this.container.style.transform = `scale(${scale})`;
                this.container.style.transformOrigin = 'center center';
                this.container.style.position = 'absolute';
                this.container.style.left = '50%';
                this.container.style.top = '50%';
                this.container.style.marginLeft = `${-boardSize / 2}px`;
                this.container.style.marginTop = `${-boardSize / 2}px`;
            }
        }, 100);
    }
    
    render(gameData = {}) {
        // Clear existing hexes
        this.container.innerHTML = '';
        
        if (!this.boardModule) {
            console.error('Board module not provided');
            return;
        }
        
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
            if (gameData.board && gameData.board[coord]) {
                hexClass += ' occupied';
            }
            
            hex.className = hexClass;
            hex.dataset.coord = coord;
            
            // Position the hex
            const [x, y] = this.boardModule.hexToPixel(q, r);
            hex.style.left = `${x}px`;
            hex.style.top = `${y}px`;
            
            this.container.appendChild(hex);
        });
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