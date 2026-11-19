"""Hex-grid geometry, ported from BoardGame/shared/scripts/board-module.js."""
import math

SIDE_HEART_LOCATIONS = {(-4, 2), (-2, -2), (2, -4), (4, -2), (2, 2), (-2, 4)}
MOUNTAIN_HEART_LOCATION = (0, 0)

# board-renderer.js rotates its whole board container 30 degrees for visual
# presentation (board-renderer.js:225, `rotate(30deg)`) -- purely cosmetic,
# not part of the underlying q/r coordinate system, so it's applied as a
# separate step (rotate_point() + hex_polygon_points()'s rotation_degrees)
# rather than baked into hex_to_pixel()'s base axial-to-pixel formula.
BOARD_ROTATION_DEGREES = 30


def rotate_point(x, y, cx, cy, degrees):
    """Rotate (x, y) around (cx, cy) by `degrees`. Matches CSS's rotate():
    in screen coordinates (y grows downward), a positive angle turns
    clockwise.
    """
    rad = math.radians(degrees)
    dx, dy = x - cx, y - cy
    rx = dx * math.cos(rad) - dy * math.sin(rad)
    ry = dx * math.sin(rad) + dy * math.cos(rad)
    return (cx + rx, cy + ry)


def generate_hex_coordinates():
    """All (q, r) axial coordinates for the 91-hex board."""
    coords = []
    for q in range(-5, 6):
        r1 = max(-5, -q - 5)
        r2 = min(5, -q + 5)
        for r in range(r1, r2 + 1):
            coords.append((q, r))
    return coords


def hex_to_pixel(q, r, hex_size, center_x, center_y):
    """Flat-top axial hex -> pixel position."""
    x = hex_size * 1.5 * q
    y = hex_size * math.sqrt(3) * (r + q / 2)
    return (x + center_x, y + center_y)


def hex_polygon_points(cx, cy, hex_size, rotation_degrees=0):
    """The 6 corner points of a flat-top hexagon centered at (cx, cy),
    optionally advanced by `rotation_degrees` (see BOARD_ROTATION_DEGREES).
    """
    points = []
    for i in range(6):
        angle = math.radians(60 * i + rotation_degrees)
        points.append((cx + hex_size * math.cos(angle), cy + hex_size * math.sin(angle)))
    return points


def is_heart_hex(q, r):
    return (q, r) in SIDE_HEART_LOCATIONS or (q, r) == MOUNTAIN_HEART_LOCATION
