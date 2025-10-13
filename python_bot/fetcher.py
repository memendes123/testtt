from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from time import monotonic
from typing import Dict, List, Optional, Tuple

import requests

from .competitions import CompetitionIndex
from .config import Settings
from .forebet import ForebetClient


class FetchError(RuntimeError):
    pass


_CACHE_LOCK = threading.Lock()
_TEAM_FORM_CACHE: Dict[int, Tuple[float, Optional[Dict[str, object]]]] = {}
_HEAD_TO_HEAD_CACHE: Dict[Tuple[int, int], Tuple[float, Optional[Dict[str, object]]]] = {}
_ODDS_CACHE: Dict[int, Tuple[float, List[Dict[str, object]]]] = {}

_TEAM_FORM_TTL = 60 * 10  # 10 minutos
_HEAD_TO_HEAD_TTL = 60 * 15  # 15 minutos
_ODDS_TTL = 60 * 5  # 5 minutos


def _prune_cache(cache: Dict[object, Tuple[float, object]], *, now: Optional[float] = None) -> None:
    current = monotonic() if now is None else now
    expired_keys = [key for key, (expires, _) in cache.items() if expires <= current]
    for key in expired_keys:
        cache.pop(key, None)


def _cache_get(
    cache: Dict[object, Tuple[float, object]],
    key: object,
    ttl: int,
    fetcher,
) -> object:
    now = monotonic()
    with _CACHE_LOCK:
        entry = cache.get(key)
        if entry:
            expires_at, value = entry
            if expires_at > now:
                return value
            cache.pop(key, None)

    value = fetcher()
    expires_at = monotonic() + ttl

    with _CACHE_LOCK:
        cache[key] = (expires_at, value)
        if len(cache) > 512:
            _prune_cache(cache, now=now)

    return value


def _request_with_retry(
    url: str,
    *,
    params: Optional[Dict[str, object]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30,
    logger: Optional[logging.Logger] = None,
    max_retries: int = 2,
) -> requests.Response:
    attempt = 0
    wait_seconds = 30

    while True:
        response = requests.get(url, params=params, headers=headers, timeout=timeout)

        if response.status_code == 429:
            retry_after_raw = response.headers.get("Retry-After")
            try:
                retry_after = int(float(retry_after_raw)) if retry_after_raw else wait_seconds
            except (TypeError, ValueError):  # noqa: PERF203 - dados inesperados do header
                retry_after = wait_seconds

            retry_after = max(1, min(retry_after, 300))
            if logger:
                logger.warning(
                    "Rate limit atingido. A aguardar %ss antes de tentar novamente.",
                    retry_after,
                )
            time.sleep(retry_after)
            attempt += 1
            if attempt > max_retries:
                raise FetchError("Limite de pedidos da API atingido (HTTP 429)")
            wait_seconds *= 2
            continue

        if response.status_code >= 500 and attempt < max_retries:
            backoff = min(wait_seconds, 120)
            if logger:
                logger.warning(
                    "Erro %s do servidor ao chamar %s. A aguardar %ss para retry.",
                    response.status_code,
                    url,
                    backoff,
                )
            time.sleep(backoff)
            attempt += 1
            wait_seconds *= 2
            continue

        return response


def _remember_failure(cache: Dict[object, Tuple[float, object]], key: object, ttl: int = 60) -> None:
    with _CACHE_LOCK:
        cache[key] = (monotonic() + ttl, None)


def _fetch_team_form(
    team_id: int,
    headers: Dict[str, str],
    logger: Optional[logging.Logger],
) -> Optional[Dict[str, object]]:
    response = _request_with_retry(
        "https://v3.football.api-sports.io/fixtures",
        params={"team": team_id, "last": 5},
        headers=headers,
        logger=logger,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    fixtures = payload.get("response", [])
    summary = _summarize_team_form(team_id, fixtures)
    time.sleep(0.15)
    return summary


def _fetch_head_to_head(
    home_id: int,
    away_id: int,
    headers: Dict[str, str],
    logger: Optional[logging.Logger],
) -> Optional[Dict[str, object]]:
    response = _request_with_retry(
        "https://v3.football.api-sports.io/fixtures/headtohead",
        params={"h2h": f"{home_id}-{away_id}", "last": 5},
        headers=headers,
        logger=logger,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    fixtures = payload.get("response", [])
    summary = _summarize_head_to_head(home_id, away_id, fixtures)
    time.sleep(0.15)
    return summary


def _fetch_odds(
    fixture_id: int,
    headers: Dict[str, str],
    logger: Optional[logging.Logger],
) -> List[Dict[str, object]]:
    response = _request_with_retry(
        "https://v3.football.api-sports.io/odds",
        params={"fixture": fixture_id},
        headers=headers,
        logger=logger,
    )
    if response.status_code == 404:
        return []
    response.raise_for_status()
    odds_payload = response.json()
    try:
        bookmakers = odds_payload["response"][0]["bookmakers"]
    except (KeyError, IndexError, TypeError):
        bookmakers = []

    seen_markets: Dict[str, List[Dict[str, object]]] = {}
    for bookmaker in bookmakers or []:
        bets = bookmaker.get("bets") or []
        for bet in bets:
            name = bet.get("name")
            if not isinstance(name, str):
                continue
            if name not in seen_markets or not seen_markets[name]:
                seen_markets[name] = bet.get("values") or []

    time.sleep(0.1)

    return [
        {"name": market_name, "values": values}
        for market_name, values in seen_markets.items()
    ]


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
    date: Optional[datetime],
    settings: Settings,
    index: CompetitionIndex,
    logger: Optional[logging.Logger] = None,
    status: str = "NS",
) -> Dict[str, object]:
    """Fetch fixtures and odds for the given date."""
    target_date = date or datetime.now(timezone.utc)
    iso_date = target_date.strftime("%Y-%m-%d")
    headers = {
        "X-RapidAPI-Key": settings.football_api_key,
        "X-RapidAPI-Host": "v3.football.api-sports.io",
    }

    logger = logger or logging.getLogger(__name__)
    normalized_status = (status or "NS").upper()
    params: Dict[str, object]
    if normalized_status == "LIVE":
        params = {"live": "all"}
        logger.info("Fetching live fixtures", extra={"status": normalized_status})
    else:
        params = {"date": iso_date, "status": normalized_status}
        logger.info("Fetching fixtures", extra={"date": iso_date, "status": normalized_status})

    fixtures_response = _request_with_retry(
        "https://v3.football.api-sports.io/fixtures",
        params=params,
        headers=headers,
        logger=logger,
    )
    if fixtures_response.status_code != 200:
        raise FetchError(
            f"Failed to fetch fixtures: {fixtures_response.status_code} {fixtures_response.text}"
        )

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

    forebet_client = ForebetClient(logger=logger)


    def get_team_form(team_id: Optional[int]) -> Optional[Dict[str, object]]:
        if not team_id:
            return None
        try:
            return _cache_get(
                _TEAM_FORM_CACHE,
                team_id,
                _TEAM_FORM_TTL,
                lambda: _fetch_team_form(team_id, headers, logger),
            )
        except FetchError as exc:
            logger.warning(
                "Rate limit while fetching team form",
                extra={"teamId": team_id, "error": str(exc)},
            )
            _remember_failure(_TEAM_FORM_CACHE, team_id, ttl=120)
            return None
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Failed to fetch team form",
                extra={"teamId": team_id, "error": str(exc)},
            )
            _remember_failure(_TEAM_FORM_CACHE, team_id)
            return None

    def get_head_to_head(home_id: Optional[int], away_id: Optional[int]) -> Optional[Dict[str, object]]:
        if not home_id or not away_id:
            return None
        key = (home_id, away_id)
        try:
            return _cache_get(
                _HEAD_TO_HEAD_CACHE,
                key,
                _HEAD_TO_HEAD_TTL,
                lambda: _fetch_head_to_head(home_id, away_id, headers, logger),
            )
        except FetchError as exc:
            logger.warning(
                "Rate limit while fetching head-to-head",
                extra={
                    "homeId": home_id,
                    "awayId": away_id,
                    "error": str(exc),
                },
            )
            _remember_failure(_HEAD_TO_HEAD_CACHE, key, ttl=120)
            return None
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Failed to fetch head-to-head",
                extra={"homeId": home_id, "awayId": away_id, "error": str(exc)},
            )
            _remember_failure(_HEAD_TO_HEAD_CACHE, key)
            return None

    for fixture in fixtures_to_process:
        competition = index.identify(fixture.get("league"))
        if not competition:
            continue

        fixture_info = fixture.get("fixture", {})
        fixture_id = fixture_info.get("id")
        if not fixture_id:
            continue

        try:
            odds_data = _cache_get(
                _ODDS_CACHE,
                fixture_id,
                _ODDS_TTL,
                lambda: _fetch_odds(fixture_id, headers, logger),
            )
        except FetchError as exc:
            logger.warning(
                "Rate limit while fetching odds",
                extra={"fixtureId": fixture_id, "error": str(exc)},
            )
            _remember_failure(_ODDS_CACHE, fixture_id, ttl=120)
            odds_data = []
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Failed to fetch odds",
                extra={"fixtureId": fixture_id, "error": str(exc)},
            )
            _remember_failure(_ODDS_CACHE, fixture_id)
            odds_data = []

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

        forebet_prediction = forebet_client.get_probabilities(
            target_date,
            home_team.get("name"),
            away_team.get("name"),
        )

        forebet_data = None
        if forebet_prediction:
            forebet_data = {
                "source": "Forebet",
                "homeWinProbability": forebet_prediction.home,
                "drawProbability": forebet_prediction.draw,
                "awayWinProbability": forebet_prediction.away,
                "over25Probability": forebet_prediction.over25,
                "under25Probability": forebet_prediction.under25,
                "bttsYesProbability": forebet_prediction.btts_yes,
                "bttsNoProbability": forebet_prediction.btts_no,
            }

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
            "forebet": forebet_data,
            "status": fixture_info.get("status"),
            "score": {
                "home": (fixture.get("goals") or {}).get("home"),
                "away": (fixture.get("goals") or {}).get("away"),
            },

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
