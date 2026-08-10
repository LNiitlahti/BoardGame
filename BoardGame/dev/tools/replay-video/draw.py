"""Frame rendering: pure layout/color helpers (this task) plus the Pillow
drawing entry point render_frame() (added alongside, see a later task).
"""
from hexmath import generate_hex_coordinates, hex_to_pixel, hex_polygon_points, is_heart_hex
from colors import resolve_team_color, apply_brightness

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
