from __future__ import annotations

import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from typing import Dict, Optional, cast, Literal

import requests

try:  # pragma: no cover - optional dependency handling
    from bs4 import BeautifulSoup  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - graceful degradation when bs4 missing
    BeautifulSoup = None  # type: ignore[assignment]


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


def _decode_html_fragment(fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", fragment)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


class ForebetClient:
    """Lightweight scraper for Forebet daily predictions."""

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        self._desktop_headers = {
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
            "Referer": "https://www.forebet.com/en/football-predictions",
        }
        self._mobile_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
            "Referer": "https://m.forebet.com/en/football-predictions",
        }
        self._session = self._create_session(self._desktop_headers)
        self._cache: Dict[str, Dict[str, ForebetProbabilities]] = {}
        self._failure_timestamps: Dict[str, float] = {}
        self._failure_backoff_seconds = 180
        self._bs4_warning_emitted = False
        self._logger = logger or logging.getLogger(__name__)

    def _create_session(self, headers: Dict[str, str]) -> requests.Session:
        session = requests.Session()
        session.headers.update(headers)
        session.headers.setdefault("Accept-Encoding", "gzip, deflate, br")
        session.headers.setdefault("Upgrade-Insecure-Requests", "1")
        return session

    def _reset_session(self, *, mobile: bool = False) -> None:
        headers = self._mobile_headers if mobile else self._desktop_headers
        self._session.close()
        self._session = self._create_session(headers)

    def _warmup_session(self) -> None:
        warmup_targets = [
            ("https://www.forebet.com/en/football-predictions", self._desktop_headers),
            ("https://m.forebet.com/en/football-predictions", self._mobile_headers),
        ]

        for url, headers in warmup_targets:
            try:
                response = self._session.get(url, headers=headers, timeout=30)
                if response.status_code == 200:
                    return
            except Exception:  # noqa: BLE001 - melhor esforço
                continue

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
        except Exception as exc:  # noqa: BLE001
            self._logger.warning("Unable to fetch Forebet page", extra={"error": str(exc), "url": url})
            return None

        if response.status_code == 200:
            return response.text

        if response.status_code == 403:
            self._warmup_session()

            try:
                retry_response = self._session.get(url, timeout=30)
                if retry_response.status_code == 200:
                    self._logger.info(
                        "Forebet request recovered after warm-up",
                        extra={"url": url},
                    )
                    return retry_response.text
                response = retry_response
            except Exception:  # noqa: BLE001 - prosseguir para fallback móvel
                pass

            mobile_url = url.replace("www.forebet.com", "m.forebet.com")
            try:
                mobile_response = self._session.get(
                    mobile_url, headers=self._mobile_headers, timeout=30
                )
            except Exception:  # noqa: BLE001
                mobile_response = None

            if mobile_response and mobile_response.status_code == 200:
                self._logger.info(
                    "Forebet mobile fallback used successfully",
                    extra={"url": mobile_url},
                )
                return mobile_response.text

            self._reset_session(mobile=True)
            try:
                reset_response = self._session.get(mobile_url, timeout=30)
                if reset_response.status_code == 200:
                    self._logger.info(
                        "Forebet session reset with mobile headers",
                        extra={"url": mobile_url},
                    )
                    return reset_response.text
                response = reset_response
            except Exception as exc:  # noqa: BLE001
                self._logger.warning(
                    "Forebet mobile fallback after reset failed",
                    extra={"url": mobile_url, "error": str(exc)},
                )

        self._logger.warning(
            "Forebet request failed",
            extra={"url": url, "status": response.status_code},
        )
        return None

    def _parse_match_table(self, html: str) -> Dict[str, ForebetProbabilities]:
        if BeautifulSoup is not None:
            return self._parse_with_bs4(html)

        if not self._bs4_warning_emitted:
            self._logger.warning(
                "BeautifulSoup is not installed; falling back to regex-based Forebet parser"
            )
            self._bs4_warning_emitted = True

        return self._parse_without_bs4(html)

    def _parse_with_bs4(self, html: str) -> Dict[str, ForebetProbabilities]:
        assert BeautifulSoup is not None  # for type checkers
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

                self._add_prediction(results, home_team, away_team, [
                    _parse_percentage(cell.get_text(" ", strip=True)) for cell in cells
                ])

        return results

    def _parse_without_bs4(self, html: str) -> Dict[str, ForebetProbabilities]:
        table_pattern = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
        cell_pattern = re.compile(r"<td[^>]*>([\s\S]*?)</td>", re.IGNORECASE)
        home_pattern = re.compile(
            r'class="[^"]*(?:home|tnms|team1)[^"]*"[^>]*>([\s\S]*?)</td>',
            re.IGNORECASE,
        )
        away_pattern = re.compile(
            r'class="[^"]*(?:away|tnms2|team2)[^"]*"[^>]*>([\s\S]*?)</td>',
            re.IGNORECASE,
        )

        results: Dict[str, ForebetProbabilities] = {}

        for row_match in table_pattern.finditer(html):
            row_html = row_match.group(1)
            cells = cell_pattern.findall(row_html)
            if len(cells) < 3:
                continue

            home_match = home_pattern.search(row_html)
            away_match = away_pattern.search(row_html)
            home_team = _decode_html_fragment(home_match.group(1)) if home_match else ""
            away_team = _decode_html_fragment(away_match.group(1)) if away_match else ""

            if not home_team or not away_team:
                decoded_cells = [_decode_html_fragment(cell) for cell in cells]
                if len(decoded_cells) >= 3:
                    home_team = home_team or decoded_cells[1]
                    away_team = away_team or decoded_cells[2]

            percentages = [_parse_percentage(_decode_html_fragment(cell)) for cell in cells]
            self._add_prediction(results, home_team, away_team, percentages)

        return results

    def _add_prediction(
        self,
        results: Dict[str, ForebetProbabilities],
        home_team: Optional[str],
        away_team: Optional[str],
        percentages: list[Optional[int]],
    ) -> None:
        if not home_team or not away_team:
            return

        if len(percentages) < 3:
            return

        first_three = percentages[:3]
        if any(value is None for value in first_three):
            return

        key = _build_key(home_team, away_team)
        if not key or key in results:
            return

        home_prob = cast(int, first_three[0])
        draw_prob = cast(int, first_three[1])
        away_prob = cast(int, first_three[2])

        over_prob = under_prob = btts_yes = btts_no = None
        if len(percentages) >= 5 and percentages[3] is not None and percentages[4] is not None:
            over_prob = percentages[3]
            under_prob = percentages[4]
        if len(percentages) >= 7 and percentages[5] is not None and percentages[6] is not None:
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

    def _load_predictions(self, date: datetime) -> Dict[str, ForebetProbabilities]:
        iso = date.strftime("%Y-%m-%d")
        if iso in self._cache:
            return self._cache[iso]

        now = time.monotonic()
        last_failure = self._failure_timestamps.get(iso)
        if last_failure is not None and now - last_failure < self._failure_backoff_seconds:
            return {}

        html = self._load_page(date)
        if not html:
            self._failure_timestamps[iso] = now
            return {}

        parsed = self._parse_match_table(html)
        self._cache[iso] = parsed
        self._failure_timestamps.pop(iso, None)
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
