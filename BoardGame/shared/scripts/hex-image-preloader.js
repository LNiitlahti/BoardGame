// Warms the browser's HTTP cache for the 91 hex-terrain tiles and 2 heart
// images. These are only ever requested later via CSS background-image
// rules on team.html/god.html/view.html (see ui-manager.js/team-controls.js
// applyHexImages()), which fire all 91 requests at once on first board
// render. Preloading them here, on whichever page a visitor lands on first,
// means that burst resolves from cache instead of the network.
//
// Runs after the current page has finished loading and at low fetch
// priority, so it never competes with that page's own resources.
(function () {
    function hexImageUrls() {
        const base = (window.BOARDGAME_BASE || '.') + '/shared/images/hexes/';
        const urls = [base + 'mountain_heart_v3.png', base + 'side_heart_v3.png'];

        // Same axial-coordinate generation as BoardModule.generateHexCoordinates()
        // in board-module.js — duplicated here so this script has no dependency
        // on board-module.js being loaded (it isn't, on most pages).
        for (let q = -5; q <= 5; q++) {
            const r1 = Math.max(-5, -q - 5);
            const r2 = Math.min(5, -q + 5);
            for (let r = r1; r <= r2; r++) {
                urls.push(`${base}coords/q${q}r${r}.png`);
            }
        }
        return urls;
    }

    function warm() {
        hexImageUrls().forEach(url => {
            const img = new Image();
            img.fetchPriority = 'low';
            img.src = url;
        });
    }

    function schedule() {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(warm, { timeout: 5000 });
        } else {
            setTimeout(warm, 2000);
        }
    }

    if (document.readyState === 'complete') {
        schedule();
    } else {
        window.addEventListener('load', schedule);
    }
})();
