/**
 * admin-mobile-bar.js: fixed bottom bar for running the event from a phone.
 *
 * On narrow screens (<= 900px, where the admin page is one scrolling
 * column) the command bar with the guided next step scrolls away at the top.
 * This bar keeps the essentials under the thumb:
 *
 *   [phase name / next-step text]                [primary action]
 *
 * It only MIRRORS what admin-improved-adapter.js already rendered: the
 * button clicks the real button (#flowPrimaryBtn, or the first enabled
 * primary button on a match/challenge slot card), so every action still
 * goes through the normal flow code and its confirmations. No Firestore
 * reads or writes of its own; it watches the DOM.
 *
 * Tapping the text scrolls back up to the full command bar.
 */
(function () {
    'use strict';

    const MQ = window.matchMedia('(max-width: 900px)');
    let bar, phaseEl, textEl, btn, target = null, scheduled = false;

    function isShown(el) {
        if (!el || el.disabled || el.hidden) return false;
        // offsetParent is null for display:none (and fixed elements; the
        // candidates here never are)
        return el.offsetParent !== null;
    }

    /** The button the bar should press, or null. */
    function findPrimary() {
        const flowBtn = document.getElementById('flowPrimaryBtn');
        if (isShown(flowBtn)) return flowBtn;
        const slotBtns = document.querySelectorAll(
            '#matchSlotCards button.primary, #challengeSlotCards button.primary');
        for (const b of slotBtns) if (isShown(b)) return b;
        return null;
    }

    function labelOf(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function build() {
        bar = document.createElement('nav');
        bar.className = 'admin-mobile-bar';
        bar.setAttribute('aria-label', 'Next step');
        bar.innerHTML =
            '<button type="button" class="amb-info" title="Show the full command bar">' +
                '<span class="amb-phase"></span>' +
                '<span class="amb-text"></span>' +
            '</button>' +
            '<button type="button" class="btn primary amb-primary" hidden></button>';
        phaseEl = bar.querySelector('.amb-phase');
        textEl = bar.querySelector('.amb-text');
        btn = bar.querySelector('.amb-primary');

        bar.querySelector('.amb-info').addEventListener('click', () => {
            const panel = document.getElementById('flowPanel');
            (panel || document.body).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        btn.addEventListener('click', () => {
            if (target && isShown(target)) target.click();
            schedule();
        });
        document.body.appendChild(bar);
    }

    function render() {
        scheduled = false;
        const active = MQ.matches;
        const panel = document.getElementById('flowPanel');
        const panelOn = panel && panel.style.display !== 'none';
        const on = active && panelOn;
        document.body.classList.toggle('has-admin-mobile-bar', !!on);
        if (!on) { if (bar) bar.hidden = true; return; }
        if (!bar) build();
        bar.hidden = false;

        const round = document.getElementById('flowRoundBadge');
        const roundTxt = round && round.style.display !== 'none' ? labelOf(round) : '';
        const name = labelOf(document.getElementById('flowPhaseName') || document.createElement('i'));
        phaseEl.textContent = [roundTxt, name].filter(Boolean).join(' · ');
        textEl.textContent = labelOf(document.getElementById('flowGuidance') || document.createElement('i'));

        // The phase timeline scrolls sideways on phones; keep the current
        // step in view instead of the round's first step.
        const tl = document.getElementById('flowTimeline');
        const cur = tl && tl.querySelector('.flow-tl-step.active');
        if (cur && tl.scrollWidth > tl.clientWidth) {
            tl.scrollLeft = cur.offsetLeft - tl.offsetLeft - (tl.clientWidth - cur.offsetWidth) / 2;
        }

        target = findPrimary();
        if (target) {
            btn.hidden = false;
            btn.textContent = labelOf(target);
            btn.title = target.title || '';
        } else {
            btn.hidden = true;
        }
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(render);
    }

    function init() {
        const observer = new MutationObserver(schedule);
        ['flowPanel', 'shellRight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) observer.observe(el, {
                subtree: true, childList: true, characterData: true,
                attributes: true, attributeFilter: ['style', 'disabled', 'hidden', 'class'],
            });
        });
        if (MQ.addEventListener) MQ.addEventListener('change', schedule);
        else MQ.addListener(schedule);
        schedule();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
