"""Frame rendering: pure layout/color helpers (this task) plus the Pillow
drawing entry point render_frame() (added alongside, see a later task).
"""
from hexmath import (
    generate_hex_coordinates, hex_to_pixel, hex_polygon_points, rotate_point,
    is_heart_hex, BOARD_ROTATION_DEGREES,
)
from colors import resolve_team_color, apply_brightness
from PIL import Image, ImageDraw

def parse_coord(coord):
    """'q2r-1' -> (2, -1)."""
    r_index = coord.index('r', 1)
    return int(coord[1:r_index]), int(coord[r_index + 1:])


def _unit_board_extent():
    """Max |x| and |y| among every hex's corners (post-rotation) at
    hex_size=1, board center at the origin -- the board's true rendered
    footprint per unit hex_size, used to size the board as large as
    possible instead of relying on an approximate span constant.
    """
    max_x = max_y = 0.0
    for q, r in generate_hex_coordinates():
        cx, cy = hex_screen_center(q, r, 1, 0, 0)
        for px, py in hex_polygon_points(cx, cy, 0.95, rotation_degrees=BOARD_ROTATION_DEGREES):
            max_x = max(max_x, abs(px))
            max_y = max(max_y, abs(py))
    return max_x, max_y


def board_layout(width, height, margin_fraction=0.02):
    """hex_size and pixel center so the 91-hex board (rotated
    BOARD_ROTATION_DEGREES, see hex_screen_center) fits as large as
    possible within width x height, exactly touching the margin on
    whichever axis is the tighter constraint.
    """
    unit_x, unit_y = _unit_board_extent()
    usable_half_w = (width / 2) * (1 - 2 * margin_fraction)
    usable_half_h = (height / 2) * (1 - 2 * margin_fraction)
    hex_size = min(usable_half_w / unit_x, usable_half_h / unit_y)
    return hex_size, width / 2, height / 2


def hex_screen_center(q, r, hex_size, center_x, center_y):
    """Final on-screen center for hex (q, r): the base flat-top axial
    position, rotated BOARD_ROTATION_DEGREES around the board center to
    match board-renderer.js's whole-container `rotate(30deg)` (the website
    visually rotates the entire board for presentation).
    """
    cx, cy = hex_to_pixel(q, r, hex_size, center_x, center_y)
    return rotate_point(cx, cy, center_x, center_y, BOARD_ROTATION_DEGREES)


def hex_fill_color(coord, state, tile_tracker, recency_brightness_max, recency_brightness_min):
    """The fill color for `coord`: heart/ordinary gray/white if empty, else
    the occupying team's color, brightened if it was recently changed.
    """
    q, r = parse_coord(coord)
    team_id = state['board'].get(coord)
    if team_id is None:
        return '#808080' if is_heart_hex(q, r) else '#ffffff'

    team = next((t for t in state['teams'] if str(t.get('id')) == str(team_id)), None)
    base_color = resolve_team_color(team.get('color') if team else None)
    boost = tile_tracker.brightness_for(coord, recency_brightness_max, recency_brightness_min)
    return apply_brightness(base_color, boost) if boost else base_color


def render_frame(state, tile_tracker, active_toast, config):
    """Render one video frame: black background, hex board (filling the
    whole frame), and an optional fading spell-cast toast. No score bar --
    dropped on request in favor of maximizing board size.
    """
    width, height = config['width'], config['height']

    image = Image.new('RGB', (width, height), '#000000')
    draw = ImageDraw.Draw(image)

    hex_size, center_x, center_y = board_layout(width, height)
    for q, r in generate_hex_coordinates():
        coord = f"q{q}r{r}"
        cx, cy = hex_screen_center(q, r, hex_size, center_x, center_y)
        points = hex_polygon_points(cx, cy, hex_size * 0.95, rotation_degrees=BOARD_ROTATION_DEGREES)
        fill = hex_fill_color(
            coord, state, tile_tracker,
            config['recency_brightness_max'], config['recency_brightness_min'],
        )
        draw.polygon(points, fill=fill, outline='#000000', width=2)

    if active_toast:
        _draw_spell_toast(draw, active_toast, width, config['spell_toast_duration_seconds'])

    return image


def _draw_spell_toast(draw, toast, width, duration_seconds):
    elapsed = toast['elapsed']
    fade = 0.3
    if elapsed < fade:
        alpha = elapsed / fade
    elif elapsed > duration_seconds - fade:
        alpha = max(0.0, (duration_seconds - elapsed) / fade)
    else:
        alpha = 1.0
    if alpha <= 0:
        return

    text = f"{toast['teamName']} — {toast['spellName']}"
    box_gray = round(20 * alpha)
    text_gray = round(255 * alpha)
    draw.rectangle(
        [width / 2 - 220, 20, width / 2 + 220, 70],
        fill=(box_gray, box_gray, box_gray),
    )
    draw.text((width / 2 - 200, 35), text, fill=(text_gray, text_gray, text_gray))
