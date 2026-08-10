from state import initial_state_from_tournament_doc, apply_action


TOURNAMENT_DOC = {
    'teams': [
        {'id': 1, 'name': 'Red Team', 'color': 'red'},
        {'id': 2, 'name': 'Blue Team', 'color': '#2278a3'},
    ]
}


def make_state():
    return initial_state_from_tournament_doc(TOURNAMENT_DOC)


def test_initial_state_seeds_teams_with_zero_points_and_empty_board():
    state = make_state()
    assert state['board'] == {}
    assert [t['points'] for t in state['teams']] == [0, 0]
    assert [t['name'] for t in state['teams']] == ['Red Team', 'Blue Team']


def test_plate_placed_adds_to_board_and_reports_tile_change():
    state = make_state()
    effect = apply_action(state, {
        'actionType': 'plate_placed',
        'payload': {'hexCoord': 'q0r0', 'teamId': 1},
    })
    assert state['board']['q0r0'] == 1
    assert effect == {'tile_changes': ['q0r0']}


def test_plate_removed_deletes_from_board_and_reports_tile_change():
    state = make_state()
    state['board']['q0r0'] = 1
    effect = apply_action(state, {'actionType': 'plate_removed', 'payload': {'hexCoord': 'q0r0'}})
    assert 'q0r0' not in state['board']
    assert effect == {'tile_changes': ['q0r0']}


def test_plate_removed_on_unoccupied_hex_is_a_no_op():
    state = make_state()
    effect = apply_action(state, {'actionType': 'plate_removed', 'payload': {'hexCoord': 'q0r0'}})
    assert effect is None


def test_spell_board_effect_removes_destroyed_tiles():
    state = make_state()
    state['board']['q1r0'] = 2
    effect = apply_action(state, {
        'actionType': 'spell_board_effect',
        'payload': {'destroyedTiles': ['q1r0']},
    })
    assert 'q1r0' not in state['board']
    assert effect == {'tile_changes': ['q1r0']}


def test_points_awarded_bulk_shape_adds_to_named_team():
    state = make_state()
    apply_action(state, {
        'actionType': 'points_awarded',
        'payload': {'pointsAwarded': {'Red Team': 3}},
    })
    red = next(t for t in state['teams'] if t['id'] == 1)
    assert red['points'] == 3


def test_points_awarded_single_team_shape_adds_amount_by_id():
    state = make_state()
    apply_action(state, {
        'actionType': 'points_awarded',
        'payload': {'teamId': 2, 'amount': 4},
    })
    blue = next(t for t in state['teams'] if t['id'] == 2)
    assert blue['points'] == 4


def test_points_corrected_sets_absolute_value():
    state = make_state()
    apply_action(state, {'actionType': 'points_corrected', 'payload': {'teamId': 2, 'newPoints': 5}})
    blue = next(t for t in state['teams'] if t['id'] == 2)
    assert blue['points'] == 5


def test_team_renamed_updates_name():
    state = make_state()
    apply_action(state, {
        'actionType': 'team_renamed',
        'payload': {'teamId': 2, 'oldName': 'Blue Team', 'newName': 'Blue Squad'},
    })
    blue = next(t for t in state['teams'] if t['id'] == 2)
    assert blue['name'] == 'Blue Squad'


def test_team_color_changed_updates_color():
    state = make_state()
    apply_action(state, {'actionType': 'team_color_changed', 'payload': {'teamId': 1, 'newColor': '#000000'}})
    red = next(t for t in state['teams'] if t['id'] == 1)
    assert red['color'] == '#000000'


def test_spell_cast_returns_a_toast_effect_without_mutating_board():
    state = make_state()
    effect = apply_action(state, {
        'actionType': 'spell_cast',
        'payload': {'teamId': 1, 'teamName': 'Red Team', 'spellId': 'fireball', 'spellName': 'Fireball'},
    })
    assert state['board'] == {}
    assert effect == {'toast': {'teamId': 1, 'teamName': 'Red Team', 'spellName': 'Fireball'}}


def test_points_awarded_for_unknown_team_is_silently_ignored():
    state = make_state()
    apply_action(state, {
        'actionType': 'points_awarded',
        'payload': {'pointsAwarded': {'Nonexistent Team': 5}},
    })
    assert [t['points'] for t in state['teams']] == [0, 0]


def test_team_renamed_for_unknown_team_is_silently_ignored():
    state = make_state()
    apply_action(state, {
        'actionType': 'team_renamed',
        'payload': {'teamId': 999, 'oldName': 'Nobody', 'newName': 'New Name'},
    })
    assert [t['name'] for t in state['teams']] == ['Red Team', 'Blue Team']


def test_team_color_changed_for_unknown_team_is_silently_ignored():
    state = make_state()
    apply_action(state, {'actionType': 'team_color_changed', 'payload': {'teamId': 999, 'newColor': '#000000'}})
    assert [t['color'] for t in state['teams']] == ['red', '#2278a3']


def test_points_awarded_bulk_shape_ignores_non_numeric_values():
    state = make_state()
    apply_action(state, {
        'actionType': 'points_awarded',
        'payload': {'pointsAwarded': {'Red Team': 'not-a-number'}},
    })
    red = next(t for t in state['teams'] if t['id'] == 1)
    assert red['points'] == 0


def test_unhandled_action_types_are_a_no_op():
    state = make_state()
    effect = apply_action(state, {'actionType': 'match_created', 'payload': {}})
    assert effect is None
