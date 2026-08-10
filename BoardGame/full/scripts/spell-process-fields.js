/**
 * spell-process-fields.js
 *
 * Declares the input fields each spell effect type (or standalone admin
 * action, like useChargedRemoval) needs when an admin processes a cast or
 * fires an Active Effects action. Shared by the Process modal and the
 * Active Effects action buttons (spell-process-ui.js) on admin.html.
 *
 * Built against a representative field-type slice, not all 43 cards — see
 * docs/superpowers/specs/2026-08-10-spell-admin-processing-ui-design.md's
 * scope section.
 */
(function () {
    'use strict';

    const SPELL_PROCESS_FIELDS = {
        extra_placement: {
            coords: { type: 'hexes', count: def => def.effect?.amount || 0 }
        },
        reposition: {
            moves: { type: 'hex-pairs', count: def => def.effect?.amount || 0 }
        },
        conditional_bonus: {
            conditionMet: { type: 'boolean' },
            coords: {
                type: 'hexes',
                count: def => def.effect?.bonus?.tiles || 0,
                showIf: 'conditionMet'
            }
        },
        useChargedRemoval: {
            coord: { type: 'hex' }
        }
    };

    /**
     * Resolve a field's `count` — either a plain number or a function of
     * the spell definition (e.g. `def => def.effect.amount`).
     */
    function resolveFieldCount(fieldConfig, def) {
        if (typeof fieldConfig.count === 'function') return fieldConfig.count(def) || 0;
        if (typeof fieldConfig.count === 'number') return fieldConfig.count;
        return 0;
    }

    /**
     * Whether a field should currently be shown, given the in-progress
     * form state (keyed by other field names in the same config, e.g.
     * conditional_bonus.coords is gated on conditionMet).
     */
    function shouldShowField(fieldConfig, formState) {
        if (!fieldConfig.showIf) return true;
        return !!formState[fieldConfig.showIf];
    }

    if (typeof window !== 'undefined') {
        window.SPELL_PROCESS_FIELDS = SPELL_PROCESS_FIELDS;
        window.resolveFieldCount = resolveFieldCount;
        window.shouldShowField = shouldShowField;
    }
})();
