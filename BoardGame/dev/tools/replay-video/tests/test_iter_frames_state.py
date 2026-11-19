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


def test_build_initial_state_prefers_tournament_doc_color_over_a_stale_backup():
    # Team colors are assigned by a raw Firestore write at tournament setup
    # (setup.html's addTeam()), not a logged action -- team_color_changed is
    # only ever logged for a later admin recolor. So if a backup's snapshot
    # captured a team before/without that write (or some other unlogged
    # color edit happened), its color is stale and there's no action in the
    # log that will ever correct it during forward-replay. The final
    # tournamentDoc holds the color that was actually true for this team's
    # whole game, so it should win whenever no team_color_changed action
    # exists for that team.
    bundle = load_fixture()
    bundle['tournamentDoc']['teams'][0]['color'] = '#123456'  # the real, final color
    bundle['backups'] = [{
        'mappedSeq': 1,
        'snapshot': {
            'teams': [{'id': 1, 'name': 'Red Team', 'color': 'red', 'points': 10}],
            'board': {'q0r0': 1},
        },
    }]
    state = build_initial_state(bundle)
    assert state['teams'][0]['color'] == '#123456'


def test_build_initial_state_keeps_backup_color_when_a_team_color_changed_action_exists():
    # If team_color_changed IS logged for this team, the backup's color is
    # its real historical starting value and forward-replay is what's
    # responsible for transitioning it -- overriding it here would make the
    # video show the final color from frame 1, before the logged change
    # actually happens.
    bundle = load_fixture()
    bundle['tournamentDoc']['teams'][0]['color'] = '#123456'
    bundle['backups'] = [{
        'mappedSeq': 1,
        'snapshot': {
            'teams': [{'id': 1, 'name': 'Red Team', 'color': 'red', 'points': 10}],
            'board': {'q0r0': 1},
        },
    }]
    # Inserted at index 1 (not 0) so bundle['actions'][0] -- and therefore
    # first_seq / the backup-selection this test isn't exercising -- stays
    # exactly as in the unmodified fixture.
    bundle['actions'].insert(1, {
        'sequenceNumber': 2, 'actionType': 'team_color_changed',
        'payload': {'teamId': 1, 'newColor': '#123456'},
    })
    state = build_initial_state(bundle)
    assert state['teams'][0]['color'] == 'red'


def test_iter_frames_state_resyncs_points_from_a_backup_crossed_mid_timeline():
    # Real-world finding: at least one tournament's territory/heart-income
    # points were NEVER logged as a points_awarded (or any other) action at
    # all -- team.points still jumped by dozens between backup snapshots
    # with no corresponding action in between to explain it. Without
    # resyncing against backups as the timeline crosses them, forward-replay
    # has no way to see that jump and just stays wrong (frozen at whatever
    # the last logged points action set) for the rest of the video.
    bundle = load_fixture()
    bundle['backups'] = [{
        'mappedSeq': 5,  # lands exactly at action 5 (sequenceNumber 5)
        'snapshot': {
            'teams': [
                {'id': 1, 'name': 'Red Team', 'color': 'red', 'points': 40},
                {'id': 2, 'name': 'Blue Team', 'color': '#2278a3', 'points': 25},
            ],
            'board': {},
        },
    }]
    results = list(iter_frames_state(bundle))

    # Before the backup's mappedSeq: unaffected (action 3's points_awarded
    # already gave Red Team +3; nothing has given Blue Team any points yet).
    _, state_before, _ = results[3]  # action 4, sequenceNumber 4
    assert [t['points'] for t in state_before['teams']] == [3, 0]

    # At the backup's mappedSeq: resynced to the backup's values, then
    # action 5's own effect (spell_board_effect, doesn't touch points)
    # applies on top as normal.
    _, state_at, _ = results[4]  # action 5, sequenceNumber 5
    assert [t['points'] for t in state_at['teams']] == [40, 25]

    # Stays resynced afterward until the next points-changing event.
    _, state_after, _ = results[5]  # action 6
    assert [t['points'] for t in state_after['teams']] == [40, 25]


def test_iter_frames_state_backup_resync_does_not_touch_team_color():
    # The color-resolution fix in build_initial_state() must keep winning --
    # a later backup crossed mid-timeline should only correct points, not
    # silently reintroduce a stale backup color over the already-resolved
    # tournamentDoc color.
    bundle = load_fixture()
    bundle['tournamentDoc']['teams'][0]['color'] = '#123456'
    bundle['backups'] = [{
        'mappedSeq': 5,
        'snapshot': {
            'teams': [{'id': 1, 'name': 'Red Team', 'color': 'red', 'points': 40}],
            'board': {},
        },
    }]
    results = list(iter_frames_state(bundle))
    _, state_at, _ = results[4]
    red = next(t for t in state_at['teams'] if t['id'] == 1)
    assert red['color'] == '#123456'
    assert red['points'] == 40


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
