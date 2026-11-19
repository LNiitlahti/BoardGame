// BoardGame/full/scripts/admin-command-bar.js
/**
 * Popover menus for the admin command bar and queue header.
 * A toggle is any element with data-menu-toggle="<menu id>"; the menu is the
 * element with that id and the `hidden` attribute. Event delegation on
 * document, so it keeps working when the adapter re-clones the command bar.
 * An open menu counts as "busy" for admin-layout.js (.cb-menu:not([hidden])).
 */
(function () {
    function closeAll(except) {
        document.querySelectorAll('.cb-menu:not([hidden])').forEach(menu => {
            if (menu === except) return;
            menu.hidden = true;
            document.querySelector(`[data-menu-toggle="${menu.id}"]`)?.setAttribute('aria-expanded', 'false');
        });
    }

    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-menu-toggle]');
        if (toggle) {
            const menu = document.getElementById(toggle.dataset.menuToggle);
            if (!menu) return;
            const opening = menu.hidden;
            closeAll(menu);
            menu.hidden = !opening;
            toggle.setAttribute('aria-expanded', String(opening));
            if (opening) menu.querySelector('.cb-menu-item:not([disabled])')?.focus();
            return;
        }
        // A click on a menu item runs its onclick, then the menu closes.
        if (e.target.closest('.cb-menu-item')) { closeAll(); return; }
        if (!e.target.closest('.cb-menu')) closeAll();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
    });

    window.AdminCommandBar = { closeAll };
})();
