from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from python_bot.live_monitor import LiveMonitor


def _make_monitor(**overrides):
    settings = SimpleNamespace(telegram_message_interval_seconds=overrides.pop("message_interval", 60))
    index = SimpleNamespace()
    logger = logging.getLogger("live-monitor-test")
    monitor = LiveMonitor(
        settings,
        index,
        chat_id=None,
        interval=overrides.pop("interval", 120),
        min_confidence=overrides.pop("min_confidence", "medium"),
        dry_run=True,
        logger=logger,
        stop_event=None,
    )
    return monitor


def test_should_alert_flags_new_recommendations():
    monitor = _make_monitor()
    match = {
        "fixtureId": 101,
        "confidence": "medium",
        "recommendedBets": ["Over 2.5"],
    }

    result = monitor._should_alert(match)  # pylint: disable=protected-access
    assert result is not None
    fixture_id, recommendations, new_flags, events = result

    assert fixture_id == 101
    assert recommendations == ["Over 2.5"]
    assert new_flags == {"Over 2.5"}
    assert events == []

    # calling again should not produce a new alert because the recommendation was already sent
    monitor._sent_flags.setdefault(101, set()).update(new_flags)  # pylint: disable=protected-access
    assert monitor._should_alert(match) is None  # pylint: disable=protected-access


def test_detect_goal_emits_event_on_score_change():
    monitor = _make_monitor(message_interval=0)
    fixture_id = 202

    initial = {
        "fixtureId": fixture_id,
        "score": {"home": 1, "away": 0},
        "events": [
            {"type": "Goal", "team": {"name": "Home"}, "player": {"name": "Striker"}},
        ],
    }

    # first call seeds the cache without triggering events
    flags, events = monitor._detect_goal(fixture_id, initial, set())  # pylint: disable=protected-access
    assert not flags
    assert not events

    updated = {
        "fixtureId": fixture_id,
        "score": {"home": 2, "away": 0},
        "events": initial["events"],
    }

    flags, events = monitor._detect_goal(fixture_id, updated, set())  # pylint: disable=protected-access
    assert flags == {"goal:2-0"}
    assert events and events[0]["type"] == "goal"


@pytest.mark.parametrize(
    "confidence,expected",
    [
        ("medium", False),  # below minimum rank
        ("high", True),
    ],
)
def test_should_alert_respects_min_confidence(confidence, expected):
    monitor = _make_monitor(min_confidence="high")
    match = {
        "fixtureId": 303,
        "confidence": confidence,
        "recommendedBets": ["Lay draw"],
    }

    result = monitor._should_alert(match)  # pylint: disable=protected-access
    assert (result is not None) == expected
