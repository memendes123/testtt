from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, Optional, Tuple
import unicodedata

import requests

from .competitions import CompetitionIndex
from .config import Settings
from .fetcher import (  # type: ignore
    _normalize_api_football_prediction,
    _summarize_head_to_head,
    _summarize_team_form,
)
from .forebet import ForebetClient

API_BASE = "https://v3.football.api-sports.io"


def _headers(settings: Settings) -> Dict[str, str]:
    return {
        "X-RapidAPI-Key": settings.football_api_key,
        "X-RapidAPI-Host": "v3.football.api-sports.io",
    }


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = " ".join(segment.strip() for segment in normalized.split())
    return normalized.lower()


def _search_team(query: str, settings: Settings, logger: logging.Logger) -> Optional[Dict[str, object]]:
    if not query:
        return None
    normalized_query = _normalize_text(query)
    try:
        response = requests.get(
            f"{API_BASE}/teams",
            params={"search": query.strip()},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao procurar equipa", extra={"query": query, "error": str(exc)})
        return None

    best_team: Optional[Dict[str, object]] = None
    best_score = -1
    for item in payload.get("response", []) or []:
        team = item.get("team") or {}
        if not isinstance(team, dict):
            continue
        name = team.get("name")
        normalized_name = _normalize_text(name) or ""
        score = 0
        if normalized_query and normalized_name == normalized_query:
            score += 200
        elif normalized_query and normalized_name.startswith(normalized_query):
            score += 140
        elif normalized_query and normalized_query in normalized_name:
            score += 100

        country = _normalize_text(team.get("country")) or ""
        if normalized_query and normalized_query == country:
            score += 160

        if team.get("national"):
            score += 60

        code = team.get("code")
        if isinstance(code, str) and normalized_query:
            if normalized_query.startswith(code.lower()):
                score += 40

        if score > best_score:
            best_team = team
            best_score = score

    if best_team:
        return best_team

    for item in payload.get("response", []) or []:
        team = item.get("team")
        if isinstance(team, dict):
            return team
    return None


def _pick_upcoming_fixture(fixtures: list[Dict[str, object]]) -> Optional[Dict[str, object]]:
    upcoming = []
    for fixture in fixtures or []:
        info = fixture.get("fixture") or {}
        timestamp = info.get("timestamp")
        status = ((info.get("status") or {}).get("short") or "").upper()
        if status in {"FT", "AET", "PEN", "POST", "CAN"}:
            continue
        upcoming.append((timestamp or 0, fixture))
    if not upcoming:
        return None
    upcoming.sort(key=lambda item: item[0] or 0)
    return upcoming[0][1]


def _fetch_next_fixture_for_team(team_id: int, settings: Settings, logger: logging.Logger) -> Optional[Dict[str, object]]:
    try:
        response = requests.get(
            f"{API_BASE}/fixtures",
            params={"team": team_id, "next": 5},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao obter próximos jogos", extra={"teamId": team_id, "error": str(exc)})
        return None

    fixture = _pick_upcoming_fixture(payload.get("response", []) or [])
    return fixture


def _fetch_fixture_between(team_a: int, team_b: int, settings: Settings, logger: logging.Logger) -> Optional[Dict[str, object]]:
    try:
        response = requests.get(
            f"{API_BASE}/fixtures/headtohead",
            params={"h2h": f"{team_a}-{team_b}", "next": 1},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Falha ao procurar confronto direto futuro",
            extra={"homeId": team_a, "awayId": team_b, "error": str(exc)},
        )
        payload = {"response": []}

    fixture = _pick_upcoming_fixture(payload.get("response", []) or [])
    if fixture:
        return fixture

    # fallback: procure entre os próximos jogos do primeiro clube
    try:
        alt = requests.get(
            f"{API_BASE}/fixtures",
            params={"team": team_a, "next": 10},
            headers=_headers(settings),
            timeout=30,
        )
        alt.raise_for_status()
        candidates = alt.json().get("response", []) or []
    except Exception:
        return None

    for candidate in candidates:
        teams = candidate.get("teams") or {}
        away = (teams.get("away") or {}).get("id")
        home = (teams.get("home") or {}).get("id")
        if away == team_b or home == team_b:
            status = ((candidate.get("fixture") or {}).get("status") or {}).get("short")
            if status and status.upper() in {"FT", "AET", "PEN", "CAN", "POST"}:
                continue
            return candidate
    return None


def _parse_odds_payload(payload: Dict[str, object]) -> list[Dict[str, object]]:
    response_items = payload.get("response") or []
    if not response_items:
        return []

    first_item = response_items[0] or {}
    bookmakers = first_item.get("bookmakers") or []

    seen_markets: dict[str, list[dict[str, object]]] = {}
    for bookmaker in bookmakers:
        for bet in bookmaker.get("bets", []):
            name = bet.get("name")
            if not isinstance(name, str):
                continue
            if name not in seen_markets or not seen_markets[name]:
                seen_markets[name] = bet.get("values") or []

    return [{"name": market, "values": values} for market, values in seen_markets.items()]


def _fetch_odds(fixture_id: int, settings: Settings, logger: logging.Logger) -> list[Dict[str, object]]:
    attempts: list[Dict[str, object]] = []
    base_params = {"fixture": fixture_id}
    if settings.bookmaker_id:
        attempts.append({**base_params, "bookmaker": settings.bookmaker_id})
    attempts.append(base_params)

    for idx, params in enumerate(attempts, start=1):
        try:
            response = requests.get(
                f"{API_BASE}/odds",
                params=params,
                headers=_headers(settings),
                timeout=30,
            )
            response.raise_for_status()
            markets = _parse_odds_payload(response.json())
            if markets:
                return markets
            logger.debug(
                "Sem odds no resultado recebido",
                extra={"fixtureId": fixture_id, "attempt": idx, "params": params},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Não foi possível obter odds para o fixture",
                extra={"fixtureId": fixture_id, "error": str(exc), "attempt": idx},
            )

    return []


def _build_match_entry(
    fixture: Dict[str, object],
    settings: Settings,
    index: CompetitionIndex,
    logger: logging.Logger,
) -> Dict[str, object]:
    fixture_info = fixture.get("fixture", {}) or {}
    fixture_id = fixture_info.get("id")
    if not fixture_id:
        raise ValueError("fixture_id ausente no payload")

    odds = _fetch_odds(int(fixture_id), settings, logger)
    api_football_prediction = _fetch_prediction(int(fixture_id), settings, logger)

    league = fixture.get("league", {}) or {}
    competition = index.identify(league)

    if competition:
        competition_info = {
            "key": competition.key,
            "name": competition.display_name,
            "region": competition.region,
            "type": competition.type,
            "country": competition.country,
        }
    else:
        competition_info = {
            "key": str(league.get("id") or "unknown"),
            "name": league.get("name") or "Competição desconhecida",
            "region": league.get("country") or "Outros",
            "type": league.get("type") or "league",
            "country": league.get("country"),
        }

    def _format_time(date_str: Optional[str]) -> str:
        if not date_str:
            return ""
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return dt.strftime("%H:%M")
        except ValueError:
            return ""

    teams = fixture.get("teams", {}) or {}
    home = teams.get("home") or {}
    away = teams.get("away") or {}

    home_id = home.get("id")
    away_id = away.get("id")

    home_form = _summarize_team_form(home_id, _fetch_recent_matches(home_id, settings, logger)) if home_id else None
    away_form = _summarize_team_form(away_id, _fetch_recent_matches(away_id, settings, logger)) if away_id else None
    head_to_head = (
        _summarize_head_to_head(home_id, away_id, _fetch_head_to_head_matches(home_id, away_id, settings, logger))
        if home_id and away_id
        else None
    )

    forebet_client = ForebetClient(logger=logger)
    forebet_prediction = forebet_client.get_probabilities(
        datetime.fromisoformat(fixture_info.get("date", "0").replace("Z", "+00:00")) if fixture_info.get("date") else datetime.utcnow(),
        home.get("name"),
        away.get("name"),
    )

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
    else:
        forebet_data = None

    return {
        "fixtureId": fixture_id,
        "date": fixture_info.get("date"),
        "time": _format_time(fixture_info.get("date")),
        "league": {
            "name": league.get("name"),
            "country": league.get("country"),
            "logo": league.get("logo"),
        },
        "competition": competition_info,
        "teams": {
            "home": {"name": home.get("name"), "logo": home.get("logo")},
            "away": {"name": away.get("name"), "logo": away.get("logo")},
        },
        "venue": ((fixture_info.get("venue") or {}) or {}).get("name") or "TBD",
        "odds": odds,
        "forebet": forebet_data,
        "apiFootballPrediction": api_football_prediction,
        "form": {
            "home": home_form,
            "away": away_form,
            "headToHead": head_to_head,
        },
    }


def _fetch_recent_matches(team_id: int, settings: Settings, logger: logging.Logger) -> list[Dict[str, object]]:
    try:
        response = requests.get(
            f"{API_BASE}/fixtures",
            params={"team": team_id, "last": 5},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("response", []) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Falha ao obter forma recente", extra={"teamId": team_id, "error": str(exc)})
        return []


def _fetch_head_to_head_matches(
    home_id: int,
    away_id: int,
    settings: Settings,
    logger: logging.Logger,
) -> list[Dict[str, object]]:
    try:
        response = requests.get(
            f"{API_BASE}/fixtures/headtohead",
            params={"h2h": f"{home_id}-{away_id}", "last": 5},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("response", []) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Falha ao obter histórico recente",
            extra={"homeId": home_id, "awayId": away_id, "error": str(exc)},
        )
        return []


def _fetch_prediction(fixture_id: int, settings: Settings, logger: logging.Logger) -> Optional[Dict[str, object]]:
    try:
        response = requests.get(
            f"{API_BASE}/predictions",
            params={"fixture": fixture_id},
            headers=_headers(settings),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Falha ao obter previsão API-FOOTBALL",
            extra={"fixtureId": fixture_id, "error": str(exc)},
        )
        return None

    entries = payload.get("response", []) or []
    if not entries:
        return None
    return _normalize_api_football_prediction(entries[0])


def locate_fixture(
    query: str,
    settings: Settings,
    index: CompetitionIndex,
    logger: logging.Logger,
) -> Tuple[Optional[Dict[str, object]], Optional[str]]:
    """Return a match entry and optional error message for the supplied query."""

    normalized = query.strip()
    if not normalized:
        return None, "Forneça o nome de uma equipa ou o confronto (ex.: city-psg)."

    separators = {"-", "x", "vs", "v", "X", "VS"}
    opponent = None
    for sep in separators:
        if sep in normalized:
            parts = [part.strip() for part in normalized.split(sep) if part.strip()]
            if len(parts) >= 2:
                normalized = parts[0]
                opponent = parts[1]
                break

    team = _search_team(normalized, settings, logger)
    if not team:
        return None, f"Não encontrei a equipa '{normalized}'."

    team_id = team.get("id")
    if not isinstance(team_id, int):
        return None, f"Resposta inesperada ao procurar '{normalized}'."

    if opponent:
        other = _search_team(opponent, settings, logger)
        if not other:
            return None, f"Não encontrei a equipa '{opponent}'."
        other_id = other.get("id")
        if not isinstance(other_id, int):
            return None, "Resposta inesperada ao procurar o adversário."
        fixture = _fetch_fixture_between(team_id, other_id, settings, logger)
        if not fixture:
            return None, "Não encontrei um confronto agendado entre as equipas."
    else:
        fixture = _fetch_next_fixture_for_team(team_id, settings, logger)
        if not fixture:
            return None, "A equipa não tem jogos agendados nos próximos dias."

    try:
        match_entry = _build_match_entry(fixture, settings, index, logger)
        return match_entry, None
    except Exception as exc:  # noqa: BLE001
        logger.error("Erro ao preparar fixture para análise", exc_info=exc)
        return None, "Não foi possível preparar os dados do jogo."
