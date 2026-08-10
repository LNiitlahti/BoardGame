from colors import resolve_team_color, apply_brightness, hex_to_rgb, rgb_to_hex, DEFAULT_TEAM_COLOR


def test_resolve_team_color_passes_hex_through_unchanged():
    assert resolve_team_color('#123abc') == '#123abc'


def test_resolve_team_color_maps_legacy_names_case_insensitively():
    assert resolve_team_color('red') == '#de392c'
    assert resolve_team_color('RED') == '#de392c'
    assert resolve_team_color('Blue') == '#2278a3'


def test_resolve_team_color_falls_back_to_default_for_unknown_or_missing():
    assert resolve_team_color('mystery-color') == DEFAULT_TEAM_COLOR
    assert resolve_team_color(None) == DEFAULT_TEAM_COLOR
    assert resolve_team_color('') == DEFAULT_TEAM_COLOR


def test_apply_brightness_increases_the_brightest_channel():
    orig = hex_to_rgb('#804020')
    brighter = hex_to_rgb(apply_brightness('#804020', 0.5))
    assert max(brighter) > max(orig)


def test_apply_brightness_zero_factor_is_a_no_op():
    assert apply_brightness('#804020', 0.0) == '#804020'


def test_apply_brightness_clamps_at_full_value():
    assert apply_brightness('#ffffff', 0.5) == '#ffffff'


def test_resolve_team_color_falls_back_to_default_for_malformed_hex():
    assert resolve_team_color('#12') == DEFAULT_TEAM_COLOR
    assert resolve_team_color('#zzzzzz') == DEFAULT_TEAM_COLOR


def test_apply_brightness_clamps_at_zero_for_very_negative_factor():
    assert apply_brightness('#804020', -2.0) == '#000000'


def test_hex_to_rgb_and_rgb_to_hex_round_trip():
    assert rgb_to_hex(hex_to_rgb('#a1b2c3')) == '#a1b2c3'
