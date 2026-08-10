import pytest
from state import SpellToastQueue


def test_toast_is_active_within_its_window():
    queue = SpellToastQueue(duration_seconds=2.0)
    queue.add('Red Team', 'Fireball', requested_at=1.0)
    active = queue.active_toast_at(1.5)
    assert active['teamName'] == 'Red Team'
    assert active['spellName'] == 'Fireball'
    assert active['elapsed'] == pytest.approx(0.5)


def test_toast_is_inactive_before_and_after_its_window():
    queue = SpellToastQueue(duration_seconds=2.0)
    queue.add('Red Team', 'Fireball', requested_at=1.0)
    assert queue.active_toast_at(0.5) is None
    assert queue.active_toast_at(3.5) is None


def test_second_toast_waits_for_the_first_to_finish_instead_of_overlapping():
    queue = SpellToastQueue(duration_seconds=2.0)
    queue.add('Red Team', 'Fireball', requested_at=0.0)
    queue.add('Blue Team', 'Shield', requested_at=0.5)  # requested mid-first-toast

    still_red = queue.active_toast_at(1.0)
    assert still_red['teamName'] == 'Red Team'

    now_blue = queue.active_toast_at(2.5)
    assert now_blue['teamName'] == 'Blue Team'
    assert now_blue['elapsed'] == pytest.approx(0.5)


def test_no_toasts_queued_returns_none():
    queue = SpellToastQueue(duration_seconds=2.0)
    assert queue.active_toast_at(0.0) is None
