from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Optional

import requests
from bs4 import BeautifulSoup


FOREBET_URL_TEMPLATE = "https://www.forebet.com/en/football-tips-and-predictions-for-{slug}"


@dataclass
class ForebetProbabilities:
    home: int
    draw: int
    away: int
    over25: Optional[int] = None
    under25: Optional[int] = None
    btts_yes: Optional[int] = None
    btts_no: Optional[int] = None


def _normalize_team(name: Optional[str]) -> str:
    if not name:
        return ""
    text = unicodedata.normalize("NFD", str(name))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    return text


def _build_key(home: Optional[str], away: Optional[str]) -> str:
    return f"{_normalize_team(home)}|{_normalize_team(away)}"


def _parse_percentage(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*%", value)
    if not match:
        return None
    try:
        return max(0, min(100, round(float(match.group(1)))))
    except ValueError:
        return None


class ForebetClient:
    """Lightweight scraper for Forebet daily predictions."""

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        self._cache: Dict[str, Dict[str, ForebetProbabilities]] = {}
        self._logger = logger or logging.getLogger(__name__)

    def _get_slug(self, date: datetime) -> str:
        today = datetime.utcnow().date()
        if date.date() == today:
            return "today"
        return date.strftime("%Y-%m-%d")

    def _load_page(self, date: datetime) -> Optional[str]:
        slug = self._get_slug(date)
        url = FOREBET_URL_TEMPLATE.format(slug=slug)
        try:
            response = self._session.get(url, timeout=30)
            if response.status_code != 200:
                self._logger.warning(
                    "Forebet request failed", extra={"url": url, "status": response.status_code}
                )
                return None
            return response.text
        except Exception as exc:  # noqa: BLE001
            self._logger.warning("Unable to fetch Forebet page", extra={"error": str(exc), "url": url})
            return None

    def _parse_match_table(self, html: str) -> Dict[str, ForebetProbabilities]:
        soup = BeautifulSoup(html, "html.parser")
        tables = soup.select("table")
        results: Dict[str, ForebetProbabilities] = {}

        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all("td")
                if len(cells) < 3:
                    continue

                # Attempt to locate team names
                home_cell = row.find(class_=re.compile(r"home|tnms|team1", re.IGNORECASE))
                away_cell = row.find(class_=re.compile(r"away|tnms2|team2", re.IGNORECASE))
                home_team = home_cell.get_text(strip=True) if home_cell else None
                away_team = away_cell.get_text(strip=True) if away_cell else None

                if not home_team or not away_team:
                    # fallback: assume first text-dominant cells are teams
                    text_cells = [
                        cell.get_text(" ", strip=True)
                        for cell in cells
                        if len(cell.get_text(strip=True)) > 0
                    ]
                    if len(text_cells) >= 3:
                        home_team = home_team or text_cells[1]
                        away_team = away_team or text_cells[2]

                if not home_team or not away_team:
                    continue

                percentages: list[int] = []
                for cell in cells:
                    percent = _parse_percentage(cell.get_text(" ", strip=True))
                    if percent is not None:
                        percentages.append(percent)

                if len(percentages) < 3:
                    continue

                key = _build_key(home_team, away_team)
                if not key or key in results:
                    continue

                home_prob, draw_prob, away_prob = percentages[:3]

                # Attempt to capture Over/Under and BTTS if the row exposes more columns
                over_prob = under_prob = btts_yes = btts_no = None
                if len(percentages) >= 5:
                    over_prob = percentages[3]
                    under_prob = percentages[4]
                if len(percentages) >= 7:
                    btts_yes = percentages[5]
                    btts_no = percentages[6]

                results[key] = ForebetProbabilities(
                    home=home_prob,
                    draw=draw_prob,
                    away=away_prob,
                    over25=over_prob,
                    under25=under_prob,
                    btts_yes=btts_yes,
                    btts_no=btts_no,
                )

        return results

    def _load_predictions(self, date: datetime) -> Dict[str, ForebetProbabilities]:
        iso = date.strftime("%Y-%m-%d")
        if iso in self._cache:
            return self._cache[iso]

        html = self._load_page(date)
        if not html:
            self._cache[iso] = {}
            return {}

        parsed = self._parse_match_table(html)
        self._cache[iso] = parsed
        return parsed

    def get_probabilities(
        self, date: datetime, home_team: Optional[str], away_team: Optional[str]
    ) -> Optional[ForebetProbabilities]:
        if not home_team or not away_team:
            return None

        predictions = self._load_predictions(date)
        if not predictions:
            return None

        key = _build_key(home_team, away_team)
        data = predictions.get(key)
        if data:
            return data

        reverse = predictions.get(_build_key(away_team, home_team))
        if reverse:
            return ForebetProbabilities(
                home=reverse.away,
                draw=reverse.draw,
                away=reverse.home,
                over25=reverse.over25,
                under25=reverse.under25,
                btts_yes=reverse.btts_yes,
                btts_no=reverse.btts_no,
            )

        return None
