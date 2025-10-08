from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import requests

from .competitions import CompetitionIndex
from .config import Settings


class FetchError(RuntimeError):
    pass


def _extract_score(fixture: Dict[str, object]) -> Tuple[int, int]:
    goals = fixture.get("goals") or {}
    score = fixture.get("score") or {}
    full_time = score.get("fulltime") or {}
    extra_time = score.get("extratime") or {}
    penalties = score.get("penalty") or {}

    home = goals.get("home")
    away = goals.get("away")

    if home is None:
        home = full_time.get("home") or extra_time.get("home") or penalties.get("home") or 0
    if away is None:
        away = full_time.get("away") or extra_time.get("away") or penalties.get("away") or 0

    try:
        return int(home), int(away)
    except (TypeError, ValueError):
        return 0, 0


def _summarize_team_form(team_id: Optional[int], fixtures: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not team_id or not fixtures:
        return None

    ordered = sorted(fixtures, key=lambda item: (item.get("fixture", {}) or {}).get("timestamp", 0) or 0, reverse=True)

    matches: List[Dict[str, object]] = []
    wins = draws = losses = goals_for = goals_against = clean_sheets = failed_to_score = 0

    for fixture in ordered:
        home_goals, away_goals = _extract_score(fixture)
        teams = fixture.get("teams", {}) or {}
        home_team = (teams.get("home") or {}).get("id")
        away_team = (teams.get("away") or {}).get("id")
        is_home = home_team == team_id
        opponent = teams.get("away") if is_home else teams.get("home")

        winner = None
        home_winner = (teams.get("home") or {}).get("winner")
        away_winner = (teams.get("away") or {}).get("winner")
        if home_winner is True and away_winner is False:
            winner = "home"
        elif home_winner is False and away_winner is True:
            winner = "away"
        elif home_goals > away_goals:
            winner = "home"
        elif away_goals > home_goals:
            winner = "away"
        else:
            winner = "draw"

        result_code = "E" if winner == "draw" else ("V" if winner == ("home" if is_home else "away") else "D")

        matches.append(
            {
                "fixtureId": (fixture.get("fixture") or {}).get("id"),
                "date": (fixture.get("fixture") or {}).get("date"),
                "opponent": (opponent or {}).get("name"),
                "competition": (fixture.get("league") or {}).get("name"),
                "score": f"{home_goals}-{away_goals}",
                "result": result_code,
            }
        )

        goals_for_match = home_goals if is_home else away_goals
        goals_against_match = away_goals if is_home else home_goals

        goals_for += goals_for_match
        goals_against += goals_against_match

        if result_code == "V":
            wins += 1
        elif result_code == "E":
            draws += 1
        else:
            losses += 1

        if goals_against_match == 0:
            clean_sheets += 1
        if goals_for_match == 0:
            failed_to_score += 1

    total = len(matches)
    if total == 0:
        return None

    recent_record = "".join(match["result"] for match in matches)
    first_result = matches[0]["result"]
    streak_count = 0
    for match in matches:
        if match["result"] == first_result:
            streak_count += 1
        else:
            break

    streak_type = "draw"
    if first_result == "V":
        streak_type = "win"
    elif first_result == "D":
        streak_type = "loss"

    avg_goals_for = round(goals_for / total, 2)
    avg_goals_against = round(goals_against / total, 2)

    return {
        "sampleSize": total,
        "matches": matches,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "winRate": wins / total if total else 0,
        "drawRate": draws / total if total else 0,
        "lossRate": losses / total if total else 0,
        "formPoints": wins * 3 + draws,
        "avgGoalsFor": avg_goals_for,
        "avgGoalsAgainst": avg_goals_against,
        "avgGoalsTotal": round((goals_for + goals_against) / total, 2),
        "goalDifferenceAvg": round(avg_goals_for - avg_goals_against, 2),
        "cleanSheets": clean_sheets,
        "failedToScore": failed_to_score,
        "recentRecord": recent_record,
        "currentStreak": {"type": streak_type, "count": streak_count},
    }


def _summarize_head_to_head(home_id: Optional[int], away_id: Optional[int], fixtures: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not home_id or not away_id or not fixtures:
        return None

    ordered = sorted(fixtures, key=lambda item: (item.get("fixture", {}) or {}).get("timestamp", 0) or 0, reverse=True)

    matches: List[Dict[str, object]] = []
    home_wins = away_wins = draws = 0
    total_goals = 0

    for fixture in ordered:
        home_goals, away_goals = _extract_score(fixture)
        teams = fixture.get("teams", {}) or {}
        fixture_home = (teams.get("home") or {}).get("id")
        upcoming_home_was_home = fixture_home == home_id

        home_winner = (teams.get("home") or {}).get("winner")
        away_winner = (teams.get("away") or {}).get("winner")

        upcoming_home_won: Optional[bool]
        if home_winner is True and away_winner is False:
            upcoming_home_won = upcoming_home_was_home
        elif home_winner is False and away_winner is True:
            upcoming_home_won = not upcoming_home_was_home
        elif home_goals > away_goals:
            upcoming_home_won = upcoming_home_was_home
        elif away_goals > home_goals:
            upcoming_home_won = not upcoming_home_was_home
        else:
            upcoming_home_won = None

        if upcoming_home_won is None:
            result_code = "E"
            draws += 1
        elif upcoming_home_won:
            result_code = "V"
            home_wins += 1
        else:
            result_code = "D"
            away_wins += 1

        matches.append(
            {
                "fixtureId": (fixture.get("fixture") or {}).get("id"),
                "date": (fixture.get("fixture") or {}).get("date"),
                "venue": ((fixture.get("fixture") or {}).get("venue") or {}).get("name"),
                "score": f"{home_goals}-{away_goals}",
                "result": result_code,
            }
        )

        total_goals += home_goals + away_goals

    sample_size = len(matches)
    if sample_size == 0:
        return None

    return {
        "sampleSize": sample_size,
        "matches": matches,
        "homeWins": home_wins,
        "awayWins": away_wins,
        "draws": draws,
        "avgGoalsTotal": round(total_goals / sample_size, 2),
    }


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

    team_form_cache: Dict[int, Optional[Dict[str, object]]] = {}
    head_to_head_cache: Dict[Tuple[int, int], Optional[Dict[str, object]]] = {}

    def get_team_form(team_id: Optional[int]) -> Optional[Dict[str, object]]:
        if not team_id:
            return None
        if team_id in team_form_cache:
            return team_form_cache[team_id]

        try:
            response = requests.get(
                "https://v3.football.api-sports.io/fixtures",
                params={"team": team_id, "last": 5},
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            fixtures = payload.get("response", [])
            summary = _summarize_team_form(team_id, fixtures)
            team_form_cache[team_id] = summary
            time.sleep(0.15)
            return summary
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to fetch team form", extra={"teamId": team_id, "error": str(exc)})
            team_form_cache[team_id] = None
            return None

    def get_head_to_head(home_id: Optional[int], away_id: Optional[int]) -> Optional[Dict[str, object]]:
        if not home_id or not away_id:
            return None
        key = (home_id, away_id)
        if key in head_to_head_cache:
            return head_to_head_cache[key]

        try:
            response = requests.get(
                "https://v3.football.api-sports.io/fixtures/headtohead",
                params={"h2h": f"{home_id}-{away_id}", "last": 5},
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            fixtures = payload.get("response", [])
            summary = _summarize_head_to_head(home_id, away_id, fixtures)
            head_to_head_cache[key] = summary
            time.sleep(0.15)
            return summary
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Failed to fetch head-to-head",
                extra={"homeId": home_id, "awayId": away_id, "error": str(exc)},
            )
            head_to_head_cache[key] = None
            return None

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

        home_team = fixture.get("teams", {}).get("home", {})
        away_team = fixture.get("teams", {}).get("away", {})

        home_form = get_team_form(home_team.get("id"))
        away_form = get_team_form(away_team.get("id"))
        head_to_head = get_head_to_head(home_team.get("id"), away_team.get("id"))

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
                    "name": home_team.get("name"),
                    "logo": home_team.get("logo"),
                },
                "away": {
                    "name": away_team.get("name"),
                    "logo": away_team.get("logo"),
                },
            },
            "venue": fixture_info.get("venue", {}).get("name") or "TBD",
            "odds": odds_data,
            "form": {
                "home": home_form,
                "away": away_form,
                "headToHead": head_to_head,
            },
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
