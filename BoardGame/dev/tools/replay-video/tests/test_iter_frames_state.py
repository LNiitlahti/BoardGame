import json
import os
from state import build_initial_state, iter_frames_state

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'sample-bundle.json')


def load_fixture():
    with open(FIXTURE_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def test_build_initial_state_with_no_backups_uses_tournament_doc_baseline():
    bundle = load_fixture()
    state = build_initial_state(bundle)
    assert state['board'] == {}
    assert [t['points'] for t in state['teams']] == [0, 0]


def test_build_initial_state_uses_nearest_backup_at_or_before_first_action():
    bundle = load_fixture()
    bundle['backups'] = [{
        'mappedSeq': 1,
        'snapshot': {
            'teams': [{'id': 1, 'name': 'Red Team', 'color': 'red', 'points': 10}],
            'board': {'q0r0': 1},
        },
    }]
    state = build_initial_state(bundle)
    assert state['board'] == {'q0r0': 1}
    assert state['teams'][0]['points'] == 10


def test_iter_frames_state_yields_one_entry_per_action_in_order():
    bundle = load_fixture()
    results = list(iter_frames_state(bundle))
    assert len(results) == len(bundle['actions'])
    assert [action['sequenceNumber'] for action, _, _ in results] == list(range(1, 11))


def test_iter_frames_state_reflects_cumulative_board_changes():
    bundle = load_fixture()
    results = list(iter_frames_state(bundle))
    # After action 2 (plate_placed q1r0), before action 5 destroys it:
    _, state_after_2, _ = results[1]
    assert state_after_2['board']['q1r0'] == 2
    # After action 5 (spell_board_effect destroys q1r0):
    _, state_after_5, effect_5 = results[4]
    assert 'q1r0' not in state_after_5['board']
    assert effect_5 == {'tile_changes': ['q1r0']}


def test_iter_frames_state_reports_spell_cast_toasts():
    bundle = load_fixture()
    results = list(iter_frames_state(bundle))
    _, _, effect_4 = results[3]  # action 4 is the Fireball spell_cast
    assert effect_4['toast']['teamName'] == 'Red Team'
    assert effect_4['toast']['spellName'] == 'Fireball'


def test_iter_frames_state_skips_mutation_for_undone_actions_but_still_yields():
    bundle = load_fixture()
    bundle['actions'][0]['undone'] = True  # undo the first plate_placed
    results = list(iter_frames_state(bundle))
    _, state_after_1, effect_1 = results[0]
    assert state_after_1['board'] == {}
    assert effect_1 is None
