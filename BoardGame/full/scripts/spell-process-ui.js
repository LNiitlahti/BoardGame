/**
 * spell-process-ui.js
 *
 * Process modal (admin.html) — reads SPELL_PROCESS_FIELDS (spell-process-fields.js)
 * and drives window.spellEngine.processPendingSpellCast() via the board-takeover
 * picking mode (admin.js's startSpellHexPickMode) instead of free-text input.
 * Wired for the representative extra_placement card first (per the
 * implementation plan's scope) — other effect types render a "not yet
 * supported on admin.html — use god.html's emergency override" fallback
 * message rather than silently doing nothing.
 *
 * Overrides admin.html's window.processSpellCast to open this modal instead
 * of god.html's direct no-form processSpellCast — both pages share the same
 * renderSpellHistory() markup (onclick="processSpellCast('${entry.timestamp}')"),
 * since that's a bare global function call each page defines independently.
 * god.html is untouched by this task.
 */
(function () {
    'use strict';

    let _processEntry = null; // { timestamp, spellId, castByTeamId, def }
    let _formState = {};

    function openSpellProcessModal(timestamp) {
        const engine = window.spellEngine;
        if (!engine) return;

        const entry = (engine._gameState.spellHistory || []).find(e => e.timestamp === timestamp);
        if (!entry) return;
        const def = engine.getSpellDef(entry.spellId);
        if (!def) return;

        // spellHistory entries key the caster as entry.teamId (NOT
        // castByTeamId — that field belongs to activeEffects objects, a
        // different shape). Verified in team-controls.js's historyEntry
        // builder and spell-engine.js's processPendingSpellCast, which
        // calls executeSpellEffect(entry.spellId, entry.teamId, entry.targetData).
        _processEntry = { timestamp, spellId: entry.spellId, castByTeamId: entry.teamId, def };
        _formState = {};

        document.getElementById('spellProcessTitle').textContent = `Process: ${def.name}`;
        document.getElementById('spellProcessModal').classList.add('active');
        renderSpellProcessBody();
    }
    window.processSpellCast = openSpellProcessModal;

    function closeSpellProcessModal() {
        document.getElementById('spellProcessModal').classList.remove('active');
        _processEntry = null;
        _formState = {};
    }
    window.closeSpellProcessModal = closeSpellProcessModal;

    function renderSpellProcessBody() {
        const body = document.getElementById('spellProcessBody');
        const submitBtn = document.getElementById('spellProcessSubmitBtn');
        const effectType = _processEntry.def.effect?.type;

        // Only extra_placement is actually wired up in this modal. Other
        // entries may exist in SPELL_PROCESS_FIELDS (populated incrementally
        // by other tasks) but that doesn't mean this modal knows how to
        // render/submit them yet — gate on the effect type explicitly so we
        // don't fall through to an empty body with a live Submit button.
        if (effectType !== 'extra_placement') {
            body.innerHTML = `<p>This effect type ("${effectType}") isn't wired into the admin.html Process modal yet. Use god.html's spell UI as the emergency override for this card.</p>`;
            submitBtn.style.display = 'none';
            return;
        }
        submitBtn.style.display = '';

        {
            const fields = window.SPELL_PROCESS_FIELDS[effectType];
            const coordsField = fields.coords;
            const count = window.resolveFieldCount(coordsField, _processEntry.def);
            const picked = _formState.coords || [];

            body.innerHTML = `
                <p>Pick ${count} hex(es) for this placement. Picked so far: ${picked.length} of ${count}.</p>
                <div>${picked.map(c => `<span class="btn-small secondary">${c}</span>`).join(' ')}</div>
            `;

            if (picked.length < count) {
                const valid = window.spellEngine.getValidHexesForField(
                    'extra_placement', 'coords', _processEntry.def, _processEntry.castByTeamId, _formState
                ).filter(c => !picked.includes(c));

                document.getElementById('spellProcessModal').classList.remove('active');
                startSpellHexPickMode(valid, `Pick hex ${picked.length + 1} of ${count} for ${_processEntry.def.name}`, (coord) => {
                    _formState.coords = [...picked, coord];
                    document.getElementById('spellProcessModal').classList.add('active');
                    renderSpellProcessBody();
                }, () => {
                    // Escape/cancel: restore the modal with whatever hexes
                    // were already picked rather than discarding progress.
                    document.getElementById('spellProcessModal').classList.add('active');
                    renderSpellProcessBody();
                });
            }
        }
    }

    function submitSpellProcessModal() {
        const engine = window.spellEngine;
        if (!_processEntry || !engine) return;
        const effectType = _processEntry.def.effect?.type;
        if (effectType !== 'extra_placement') return;

        const fields = window.SPELL_PROCESS_FIELDS[effectType];
        const count = window.resolveFieldCount(fields.coords, _processEntry.def);
        if ((_formState.coords || []).length < count) {
            showStatus(`Pick all ${count} hexes before submitting`, 'warning');
            return;
        }

        // processPendingSpellCast(timestamp) takes no targetData argument —
        // it reads entry.targetData directly (spell-engine.js line ~2062:
        // `this.executeSpellEffect(entry.spellId, entry.teamId, entry.targetData)`),
        // so the picked fields must be merged into the history entry first.
        const entry = (engine._gameState.spellHistory || []).find(e => e.timestamp === _processEntry.timestamp);
        if (!entry) return;
        entry.targetData = { ...(entry.targetData || {}), ..._formState };

        // processPendingSpellCast() already surfaces success/failure via its
        // own this._ui?.showStatus() call and re-renders the history list —
        // we only need to close the modal on success here.
        engine.processPendingSpellCast(_processEntry.timestamp).then((result) => {
            if (result?.success !== false) {
                closeSpellProcessModal();
            }
        });
    }
    window.submitSpellProcessModal = submitSpellProcessModal;
})();
