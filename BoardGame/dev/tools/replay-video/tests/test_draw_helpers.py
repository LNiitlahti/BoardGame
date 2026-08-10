import pytest
from draw import board_layout, hex_fill_color, score_bar_rows, parse_coord
from state import TileChangeTracker


def test_parse_coord_handles_positive_and_negative_values():
    assert parse_coord('q2r-1') == (2, -1)
    assert parse_coord('q-3r4') == (-3, 4)
    assert parse_coord('q0r0') == (0, 0)


def test_board_layout_returns_hex_size_and_centered_offsets():
    hex_size, cx, cy = board_layout(1000, 800)
    assert hex_size > 0
    assert cx == 500
    assert cy == 400


def test_hex_fill_color_empty_heart_hex_is_gray():
    state = {'board': {}, 'teams': []}
    tracker = TileChangeTracker(capacity=10)
    assert hex_fill_color('q0r0', state, tracker, 0.5, 0.1) == '#808080'


def test_hex_fill_color_empty_ordinary_hex_is_white():
    state = {'board': {}, 'teams': []}
    tracker = TileChangeTracker(capacity=10)
    assert hex_fill_color('q5r0', state, tracker, 0.5, 0.1) == '#ffffff'


def test_hex_fill_color_occupied_hex_uses_team_color_with_no_recency_boost():
    state = {'board': {'q5r0': 1}, 'teams': [{'id': 1, 'name': 'Red', 'color': 'red'}]}
    tracker = TileChangeTracker(capacity=10)
    assert hex_fill_color('q5r0', state, tracker, 0.5, 0.1) == '#de392c'


def test_hex_fill_color_occupied_hex_brightens_when_recently_changed():
    state = {'board': {'q5r0': 1}, 'teams': [{'id': 1, 'name': 'Red', 'color': 'red'}]}
    tracker = TileChangeTracker(capacity=10)
    tracker.record('q5r0')
    boosted = hex_fill_color('q5r0', state, tracker, 0.5, 0.1)
    assert boosted != '#de392c'


def test_score_bar_rows_sorted_by_points_descending_with_name_fallback():
    state = {'teams': [
        {'id': 1, 'name': 'Red', 'color': 'red', 'points': 3},
        {'id': 2, 'color': 'blue', 'points': 9},
    ]}
    rows = score_bar_rows(state)
    assert [r['points'] for r in rows] == [9, 3]
    assert rows[0]['name'] == 'Team 2'
