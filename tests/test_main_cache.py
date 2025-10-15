from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import logging

from python_bot.main import _load_match_data
from python_bot.fetcher import FetchError


def _make_settings():
    return SimpleNamespace()


def _make_index():
    return SimpleNamespace()


def test_load_match_data_reuses_cache_when_fetch_returns_empty(tmp_path):
    logger = logging.getLogger("test-cache")
    logger.disabled = True

    cached_payload = {
        "date": "2025-10-15",
        "matches": [{"fixtureId": 1}],
        "metadata": {"supportedFixtures": 2, "processedFixtures": 2},
    }

    fetch_results = [
        cached_payload,
        {"date": "2025-10-15", "matches": [], "metadata": {"supportedFixtures": 2, "processedFixtures": 2}},
    ]

    def fake_fetch(date, settings, index, logger=None):  # noqa: D401 - simple stub
        return fetch_results.pop(0)

    match_data, used_cache = _load_match_data(
        datetime(2025, 10, 15, tzinfo=timezone.utc),
        _make_settings(),
        _make_index(),
        logger,
        cache_dir=tmp_path,
        fetch_matches=fake_fetch,
    )
    assert not used_cache
    assert match_data["matches"] == [{"fixtureId": 1}]

    match_data, used_cache = _load_match_data(
        datetime(2025, 10, 15, tzinfo=timezone.utc),
        _make_settings(),
        _make_index(),
        logger,
        cache_dir=tmp_path,
        fetch_matches=fake_fetch,
    )
    assert used_cache
    assert match_data["matches"] == [{"fixtureId": 1}]


def test_load_match_data_uses_cache_when_fetch_fails(tmp_path):
    logger = logging.getLogger("test-cache-failure")
    logger.disabled = True

    cache_dir = tmp_path
    cache_file = cache_dir / "fixtures_2025-10-15.json"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        "{\"cachedAt\": \"2025-10-15T08:00:00+00:00\", \"matchData\": {\"date\": \"2025-10-15\", \"matches\": [{\"fixtureId\": 9}], \"metadata\": {\"supportedFixtures\": 1}}}",
        encoding="utf-8",
    )

    def failing_fetch(*_, **__):
        raise FetchError("boom")

    match_data, used_cache = _load_match_data(
        datetime(2025, 10, 15, tzinfo=timezone.utc),
        _make_settings(),
        _make_index(),
        logger,
        cache_dir=cache_dir,
        fetch_matches=failing_fetch,
    )
    assert used_cache
    assert match_data["matches"] == [{"fixtureId": 9}]

