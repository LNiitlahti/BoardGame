import json
import os
from PIL import Image
from config import DEFAULT_CONFIG
from draw import render_frame
from state import build_initial_state, iter_frames_state, TileChangeTracker, SpellToastQueue

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'sample-bundle.json')


def load_fixture():
    with open(FIXTURE_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def test_render_frame_returns_correctly_sized_rgb_image():
    bundle = load_fixture()
    state = build_initial_state(bundle)
    tracker = TileChangeTracker(capacity=10)
    image = render_frame(state, tracker, None, DEFAULT_CONFIG)
    assert isinstance(image, Image.Image)
    assert image.size == (DEFAULT_CONFIG['width'], DEFAULT_CONFIG['height'])
    assert image.mode == 'RGB'


def test_render_frame_handles_every_reconstructed_state_without_raising():
    bundle = load_fixture()
    tracker = TileChangeTracker(capacity=10)
    toasts = SpellToastQueue(duration_seconds=2.0)
    for action, state, effect in iter_frames_state(bundle):
        if effect and effect.get('tile_changes'):
            tracker.record_many(effect['tile_changes'])
        active = toasts.active_toast_at(0.0)
        image = render_frame(state, tracker, active, DEFAULT_CONFIG)
        assert image.size == (DEFAULT_CONFIG['width'], DEFAULT_CONFIG['height'])


def test_render_frame_with_an_active_toast_does_not_raise():
    bundle = load_fixture()
    state = build_initial_state(bundle)
    tracker = TileChangeTracker(capacity=10)
    toast = {'teamName': 'Red Team', 'spellName': 'Fireball', 'elapsed': 0.5}
    image = render_frame(state, tracker, toast, DEFAULT_CONFIG)
    assert image.size == (DEFAULT_CONFIG['width'], DEFAULT_CONFIG['height'])


def test_render_frame_does_not_crash_with_many_teams_at_small_resolution():
    small_config = dict(DEFAULT_CONFIG)
    small_config['width'] = 640
    small_config['height'] = 360
    state = {
        'board': {},
        'teams': [{'id': i, 'name': f'Team {i}', 'color': '#888888', 'points': i} for i in range(20)],
    }
    tracker = TileChangeTracker(capacity=10)
    image = render_frame(state, tracker, None, small_config)
    assert image.size == (640, 360)
