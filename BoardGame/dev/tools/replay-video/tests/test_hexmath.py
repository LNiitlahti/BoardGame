import math
import pytest
from hexmath import (
    generate_hex_coordinates, hex_to_pixel, hex_polygon_points,
    is_heart_hex, SIDE_HEART_LOCATIONS, MOUNTAIN_HEART_LOCATION,
)


def test_generate_hex_coordinates_has_91_entries_and_covers_the_board():
    coords = generate_hex_coordinates()
    assert len(coords) == 91
    assert (0, 0) in coords
    assert (5, 0) in coords
    assert (-5, 5) in coords
    assert (6, 0) not in coords
    assert (5, 1) not in coords  # q+r=6, outside the -5..5 range


def test_hex_to_pixel_center_hex_maps_to_center_offset():
    x, y = hex_to_pixel(0, 0, 32, 375, 375)
    assert x == 375
    assert y == 375


def test_hex_to_pixel_matches_flat_top_axial_formula():
    x, y = hex_to_pixel(2, -1, 32, 0, 0)
    assert x == pytest.approx(32 * 1.5 * 2)
    assert y == pytest.approx(32 * math.sqrt(3) * (-1 + 2 / 2))


def test_hex_polygon_points_returns_six_points_at_hex_size_radius():
    points = hex_polygon_points(100, 100, 32)
    assert len(points) == 6
    for (x, y) in points:
        dist = math.hypot(x - 100, y - 100)
        assert dist == pytest.approx(32, rel=1e-6)


def test_is_heart_hex_identifies_all_seven_heart_hexes():
    for (q, r) in SIDE_HEART_LOCATIONS:
        assert is_heart_hex(q, r)
    assert is_heart_hex(*MOUNTAIN_HEART_LOCATION)


def test_is_heart_hex_rejects_ordinary_hexes():
    assert not is_heart_hex(1, 1)
    assert not is_heart_hex(5, 0)
