import math
import pytest
from draw import board_layout, hex_fill_color, parse_coord, hex_screen_center, hex_polygon_points
from hexmath import BOARD_ROTATION_DEGREES, generate_hex_coordinates
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


def _rendered_board_extent(hex_size, cx, cy):
    """Max |x - cx| and |y - cy| among every hex's corners, as actually
    drawn (post-rotation) -- the board's true rendered bounding box.
    """
    max_x = max_y = 0.0
    for q, r in generate_hex_coordinates():
        hcx, hcy = hex_screen_center(q, r, hex_size, cx, cy)
        for px, py in hex_polygon_points(hcx, hcy, hex_size * 0.95, rotation_degrees=BOARD_ROTATION_DEGREES):
            max_x = max(max_x, abs(px - cx))
            max_y = max(max_y, abs(py - cy))
    return max_x, max_y


def test_board_layout_maximizes_hex_size_to_exactly_fill_the_frame():
    # board_layout should size the board as large as possible: the rendered
    # bounding box (post-rotation) must fit within the margin on both axes,
    # and exactly touch it on whichever axis is the tighter constraint --
    # not stop short due to an approximate sizing constant.
    width, height, margin_fraction = 1000, 1000, 0.02
    hex_size, cx, cy = board_layout(width, height, margin_fraction)
    max_x, max_y = _rendered_board_extent(hex_size, cx, cy)

    usable_half_w = (width / 2) * (1 - 2 * margin_fraction)
    usable_half_h = (height / 2) * (1 - 2 * margin_fraction)
    assert max_x <= usable_half_w + 1e-6
    assert max_y <= usable_half_h + 1e-6
    assert max_x == pytest.approx(usable_half_w) or max_y == pytest.approx(usable_half_h)


def test_board_layout_fills_a_non_square_frame_on_the_tighter_axis():
    width, height, margin_fraction = 1920, 1080, 0.02
    hex_size, cx, cy = board_layout(width, height, margin_fraction)
    max_x, max_y = _rendered_board_extent(hex_size, cx, cy)

    usable_half_w = (width / 2) * (1 - 2 * margin_fraction)
    usable_half_h = (height / 2) * (1 - 2 * margin_fraction)
    assert max_x <= usable_half_w + 1e-6
    assert max_y <= usable_half_h + 1e-6
    # height is the tighter axis for a wide frame
    assert max_y == pytest.approx(usable_half_h)


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


def test_hex_screen_center_applies_the_board_rotation():
    # The center hex (0,0) sits exactly on the board center, so rotating it
    # is a no-op -- confirms rotation pivots around the board center itself.
    cx, cy = hex_screen_center(0, 0, 32, 375, 375)
    assert (cx, cy) == pytest.approx((375, 375))


def test_hex_screen_center_matches_manual_rotate_of_the_base_position():
    hex_size, center_x, center_y = 32, 375, 375
    cx, cy = hex_screen_center(2, -1, hex_size, center_x, center_y)

    # Manually reproduce: base flat-top position, then rotate around center.
    base_x = center_x + hex_size * 1.5 * 2
    base_y = center_y + hex_size * math.sqrt(3) * (-1 + 2 / 2)
    rad = math.radians(BOARD_ROTATION_DEGREES)
    dx, dy = base_x - center_x, base_y - center_y
    expected_x = center_x + dx * math.cos(rad) - dy * math.sin(rad)
    expected_y = center_y + dx * math.sin(rad) + dy * math.cos(rad)

    assert (cx, cy) == pytest.approx((expected_x, expected_y))

