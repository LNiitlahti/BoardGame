"""Team color resolution and recency-glow brightness, ported from replay.html."""
import colorsys

LEGACY_TEAM_COLOR_MAP = {
    'red': '#de392c', 'blue': '#2278a3', 'green': '#2e9158',
    'orange': '#f7ba32', 'yellow': '#f7ba32', 'amber': '#f7ba32',
    'purple': '#a855f7', 'pink': '#ec4899', 'teal': '#14b8a6',
    'cyan': '#06b6d4', 'lime': '#84cc16', 'indigo': '#6366f1',
}

DEFAULT_TEAM_COLOR = '#888888'


def resolve_team_color(color):
    """Resolve a team's stored `color` field (hex string or legacy name) to a hex string."""
    if not color:
        return DEFAULT_TEAM_COLOR
    if color.startswith('#'):
        return color
    return LEGACY_TEAM_COLOR_MAP.get(color.lower(), DEFAULT_TEAM_COLOR)


def hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return '#%02x%02x%02x' % rgb


def apply_brightness(hex_color, factor):
    """Scale a hex color's brightness up by `factor` (e.g. 0.5 = +50%) in HSV
    value space, clamped so it never exceeds full brightness.
    """
    r, g, b = hex_to_rgb(hex_color)
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    v = min(1.0, v * (1 + factor))
    r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
    return rgb_to_hex((round(r2 * 255), round(g2 * 255), round(b2 * 255)))
