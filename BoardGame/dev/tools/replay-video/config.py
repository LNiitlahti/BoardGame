"""Rendering configuration: built-in defaults, loaded from config.json, with
CLI-flag overrides applied on top (see render_replay.py).
"""
import json
import os

DEFAULT_CONFIG = {
    'fps': 30,
    'width': 1920,
    'height': 1080,
    'seconds_per_action': 0.75,
    'recency_tile_count': 10,
    'recency_brightness_max': 0.5,
    'recency_brightness_min': 0.1,
    'spell_toast_duration_seconds': 2.0,
    'output_format': 'mp4',
}


def load_config(config_path):
    config = dict(DEFAULT_CONFIG)
    if config_path and os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            config.update(json.load(f))
    return config


def apply_overrides(config, overrides):
    """Return a new config dict with non-None values from `overrides` applied."""
    merged = dict(config)
    for key, value in overrides.items():
        if value is not None:
            merged[key] = value
    return merged
