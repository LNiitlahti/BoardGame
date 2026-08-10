import json
import os
import tempfile
from config import DEFAULT_CONFIG, load_config, apply_overrides


def test_load_config_with_no_path_returns_defaults():
    assert load_config(None) == DEFAULT_CONFIG


def test_load_config_merges_user_file_over_defaults():
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({'fps': 60}, f)
        path = f.name
    try:
        config = load_config(path)
        assert config['fps'] == 60
        assert config['width'] == DEFAULT_CONFIG['width']  # untouched default preserved
    finally:
        os.unlink(path)


def test_load_config_missing_file_falls_back_to_defaults():
    assert load_config('/no/such/file.json') == DEFAULT_CONFIG


def test_apply_overrides_only_replaces_non_none_values():
    base = dict(DEFAULT_CONFIG)
    merged = apply_overrides(base, {'fps': 24, 'width': None})
    assert merged['fps'] == 24
    assert merged['width'] == DEFAULT_CONFIG['width']
    assert base['fps'] == DEFAULT_CONFIG['fps']  # original untouched
