"""Reduced, board/team/spell-cast-only mirror of ReplayEngine's forward-apply
dispatch (BoardGame/full/scripts/replay-engine.js). Only ports the action
types that affect what the video draws — see the plan/spec for the full list
and rationale.
"""
import copy  # used by build_initial_state()/iter_frames_state(), added in a later task


def initial_state_from_tournament_doc(tournament_doc):
    """Seed state from the final tournament doc's team roster, points zeroed —
    mirrors ReplayEngine._createInitialState()'s team-seeding behavior.
    """
    teams = [
        {**t, 'points': 0}
        for t in (tournament_doc.get('teams') or [])
    ]
    return {'teams': teams, 'board': {}}


def _find_team(teams, team_id=None, name=None):
    if team_id is not None:
        for t in teams:
            if str(t.get('id')) == str(team_id):
                return t
    if name is not None:
        for t in teams:
            if t.get('name') == name:
                return t
    return None


def _apply_points_awarded(state, payload):
    teams = state['teams']
    awarded = payload.get('pointsAwarded') or {}
    for team_name, points in awarded.items():
        if not isinstance(points, (int, float)):
            continue
        team = _find_team(teams, team_id=team_name, name=team_name)
        if team:
            team['points'] = team.get('points', 0) + points

    amount = payload.get('amount')
    if isinstance(amount, (int, float)):
        team = _find_team(teams, team_id=payload.get('teamId'), name=payload.get('teamName'))
        if team:
            team['points'] = max(0, team.get('points', 0) + amount)


def _apply_points_corrected(state, payload):
    team = _find_team(state['teams'], team_id=payload.get('teamId'), name=payload.get('teamName'))
    if not team:
        return
    if payload.get('newPoints') is not None:
        team['points'] = payload['newPoints']
    elif payload.get('delta') is not None:
        team['points'] = team.get('points', 0) + payload['delta']


def apply_action(state, action):
    """Mutate `state` for the action types the video cares about. Returns a
    dict describing side effects the caller needs (`tile_changes`, `toast`),
    or None if the action didn't affect drawing.
    """
    action_type = action.get('actionType')
    payload = action.get('payload') or {}

    if action_type == 'plate_placed':
        coord = payload.get('hexCoord') or payload.get('coord')
        if not coord:
            return None
        state['board'][coord] = payload.get('teamId')
        return {'tile_changes': [coord]}

    if action_type == 'plate_removed':
        coord = payload.get('hexCoord') or payload.get('coord')
        if coord and coord in state['board']:
            del state['board'][coord]
            return {'tile_changes': [coord]}
        return None

    if action_type == 'spell_board_effect':
        destroyed = payload.get('destroyedTiles') or []
        changed = [c for c in destroyed if c in state['board']]
        for coord in changed:
            del state['board'][coord]
        return {'tile_changes': changed} if changed else None

    if action_type == 'points_awarded':
        _apply_points_awarded(state, payload)
        return None

    if action_type == 'points_corrected':
        _apply_points_corrected(state, payload)
        return None

    if action_type == 'team_renamed':
        team = _find_team(state['teams'], team_id=payload.get('teamId'), name=payload.get('oldName'))
        if team and payload.get('newName'):
            team['name'] = payload['newName']
        return None

    if action_type == 'team_color_changed':
        team = _find_team(state['teams'], team_id=payload.get('teamId'))
        if team and payload.get('newColor'):
            team['color'] = payload['newColor']
        return None

    if action_type == 'spell_cast':
        return {
            'toast': {
                'teamId': payload.get('teamId'),
                'teamName': payload.get('teamName'),
                'spellName': payload.get('spellName') or payload.get('spellId'),
            }
        }

    return None
