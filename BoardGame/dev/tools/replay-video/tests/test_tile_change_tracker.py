import pytest
from state import TileChangeTracker


def test_most_recent_change_gets_max_brightness():
    tracker = TileChangeTracker(capacity=10)
    for coord in ['q0r0', 'q1r0', 'q2r0']:
        tracker.record(coord)
    assert tracker.brightness_for('q2r0', 0.5, 0.1) == pytest.approx(0.5)


def test_oldest_tracked_slot_gets_min_brightness_at_full_capacity():
    tracker = TileChangeTracker(capacity=3)
    for coord in ['a', 'b', 'c']:
        tracker.record(coord)
    assert tracker.brightness_for('a', 0.5, 0.1) == pytest.approx(0.1)


def test_untracked_coord_has_zero_brightness():
    tracker = TileChangeTracker(capacity=10)
    tracker.record('q0r0')
    assert tracker.brightness_for('q9r9', 0.5, 0.1) == 0.0


def test_changes_beyond_capacity_are_evicted():
    tracker = TileChangeTracker(capacity=2)
    tracker.record('a')
    tracker.record('b')
    tracker.record('c')
    assert tracker.brightness_for('a', 0.5, 0.1) == 0.0
    assert tracker.brightness_for('c', 0.5, 0.1) == pytest.approx(0.5)


def test_re_recording_a_tracked_coord_refreshes_it_to_most_recent():
    tracker = TileChangeTracker(capacity=3)
    tracker.record('a')
    tracker.record('b')
    tracker.record('c')
    tracker.record('a')
    assert tracker.brightness_for('a', 0.5, 0.1) == pytest.approx(0.5)


def test_record_many_records_each_coord_in_order():
    tracker = TileChangeTracker(capacity=10)
    tracker.record_many(['a', 'b'])
    assert tracker.brightness_for('b', 0.5, 0.1) == pytest.approx(0.5)
