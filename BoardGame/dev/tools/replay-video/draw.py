"""Frame rendering: pure layout/color helpers (this task) plus the Pillow
drawing entry point render_frame() (added alongside, see a later task).
"""
from hexmath import generate_hex_coordinates, hex_to_pixel, hex_polygon_points, is_heart_hex
from colors import resolve_team_color, apply_brightness
from PIL import Image, ImageDraw

BASE_HEX_SIZE = 32
BASE_HALF_SPAN = 375  # matches BoardModule's centerOffset at scale=1


def parse_coord(coord):
    """'q2r-1' -> (2, -1)."""
    r_index = coord.index('r', 1)
    return int(coord[1:r_index]), int(coord[r_index + 1:])


def board_layout(width, height, margin_fraction=0.05):
    """hex_size and pixel center so the 91-hex board fits within width x height."""
    usable = min(width, height) * (1 - 2 * margin_fraction)
    scale = usable / (BASE_HALF_SPAN * 2)
    hex_size = BASE_HEX_SIZE * scale
    return hex_size, width / 2, height / 2


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


def score_bar_rows(state):
    """Team rows for the score bar, sorted by points descending."""
    rows = [
        {
            'name': t.get('name') or f"Team {t.get('id')}",
            'color': resolve_team_color(t.get('color')),
            'points': t.get('points', 0),
        }
        for t in (state.get('teams') or [])
    ]
    return sorted(rows, key=lambda row: row['points'], reverse=True)


def render_frame(state, tile_tracker, active_toast, config):
    """Render one video frame: black background, hex board, score bar, and
    an optional fading spell-cast toast.
    """
    width, height = config['width'], config['height']
    board_height = round(height * 0.82)
    score_bar_height = height - board_height

    image = Image.new('RGB', (width, height), '#000000')
    draw = ImageDraw.Draw(image)

    hex_size, center_x, center_y = board_layout(width, board_height)
    for q, r in generate_hex_coordinates():
        coord = f"q{q}r{r}"
        cx, cy = hex_to_pixel(q, r, hex_size, center_x, center_y)
        points = hex_polygon_points(cx, cy, hex_size * 0.95)
        fill = hex_fill_color(
            coord, state, tile_tracker,
            config['recency_brightness_max'], config['recency_brightness_min'],
        )
        draw.polygon(points, fill=fill, outline='#000000', width=2)

    _draw_score_bar(draw, score_bar_rows(state), width, board_height, score_bar_height)

    if active_toast:
        _draw_spell_toast(draw, active_toast, width, config['spell_toast_duration_seconds'])

    return image


def _draw_score_bar(draw, rows, width, top, height):
    if not rows:
        return
    row_height = height / len(rows)
    for i, row in enumerate(rows):
        y = top + i * row_height
        draw.rectangle([20, y + 4, 40, y + row_height - 4], fill=row['color'])
        draw.text((50, y + row_height / 2 - 8), f"{row['name']}  {row['points']}pts", fill='#ffffff')


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
    draw.rectangle(
        [width / 2 - 220, 20, width / 2 + 220, 70],
        fill=(box_gray, box_gray, box_gray),
    )
    draw.text((width / 2 - 200, 35), text, fill='#ffffff')
