from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Dict, List, Optional

import requests

from .competitions import CompetitionIndex
from .config import Settings


class FetchError(RuntimeError):
    pass


def fetch_matches(
    date: datetime,
    settings: Settings,
    index: CompetitionIndex,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, object]:
    """Fetch fixtures and odds for the given date."""
    iso_date = date.strftime("%Y-%m-%d")
    headers = {
        "X-RapidAPI-Key": settings.football_api_key,
        "X-RapidAPI-Host": "v3.football.api-sports.io",
    }

    logger = logger or logging.getLogger(__name__)
    logger.info("Fetching fixtures", extra={"date": iso_date})

    fixtures_response = requests.get(
        "https://v3.football.api-sports.io/fixtures",
        params={"date": iso_date, "status": "NS"},
        headers=headers,
        timeout=30,
    )
    if fixtures_response.status_code != 200:
        raise FetchError(f"Failed to fetch fixtures: {fixtures_response.status_code} {fixtures_response.text}")

    payload = fixtures_response.json()
    fixtures: List[Dict[str, object]] = payload.get("response", [])

    supported_fixtures = [fixture for fixture in fixtures if index.is_supported(fixture.get("league"))]
    fixtures_to_process = sorted(
        supported_fixtures,
        key=lambda fixture: fixture.get("fixture", {}).get("timestamp", 0) or 0,
    )[: settings.max_fixtures]

    logger.info(
        "Processing fixtures",
        extra={
            "total": len(fixtures),
            "supported": len(supported_fixtures),
            "processing": len(fixtures_to_process),
        },
    )

    region_counters = {region: 0 for region in index.region_order}
    matches: List[Dict[str, object]] = []

    for fixture in fixtures_to_process:
        competition = index.identify(fixture.get("league"))
        if not competition:
            continue

        fixture_info = fixture.get("fixture", {})
        fixture_id = fixture_info.get("id")
        if not fixture_id:
            continue

        odds_data = None
        odds_response = requests.get(
            "https://v3.football.api-sports.io/odds",
            params={"fixture": fixture_id, "bookmaker": settings.bookmaker_id},
            headers=headers,
            timeout=30,
        )
        if odds_response.status_code == 200:
            odds_payload = odds_response.json()
            try:
                odds_data = odds_payload["response"][0]["bookmakers"][0]["bets"]
            except (KeyError, IndexError, TypeError):
                odds_data = []
        else:
            logger.warning(
                "Failed to fetch odds",
                extra={"fixtureId": fixture_id, "status": odds_response.status_code},
            )

        date_str = fixture_info.get("date")
        time_str = ""
        if isinstance(date_str, str):
            try:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                time_str = dt.strftime("%H:%M")
            except ValueError:
                time_str = date_str

        match_entry = {
            "fixtureId": fixture_id,
            "date": date_str,
            "time": time_str,
            "league": {
                "name": fixture.get("league", {}).get("name"),
                "country": fixture.get("league", {}).get("country"),
                "logo": fixture.get("league", {}).get("logo"),
            },
            "competition": {
                "key": competition.key,
                "name": competition.display_name,
                "region": competition.region,
                "type": competition.type,
                "country": competition.country,
            },
            "teams": {
                "home": {
                    "name": fixture.get("teams", {}).get("home", {}).get("name"),
                    "logo": fixture.get("teams", {}).get("home", {}).get("logo"),
                },
                "away": {
                    "name": fixture.get("teams", {}).get("away", {}).get("name"),
                    "logo": fixture.get("teams", {}).get("away", {}).get("logo"),
                },
            },
            "venue": fixture_info.get("venue", {}).get("name") or "TBD",
            "odds": odds_data,
        }

        matches.append(match_entry)
        region_counters[competition.region] = region_counters.get(competition.region, 0) + 1

        time.sleep(0.1)

    metadata = {
        "totalFixtures": len(fixtures),
        "supportedFixtures": len(supported_fixtures),
        "processedFixtures": len(fixtures_to_process),
        "perRegion": [
            {
                "region": region,
                "label": index.region_label.get(region, region),
                "total": region_counters.get(region, 0),
            }
            for region in index.region_order
        ],
    }

    return {
        "date": iso_date,
        "totalMatches": len(matches),
        "matches": matches,
        "metadata": metadata,
    }
