from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from threading import Event

from .analyzer import analyze_matches
from .competitions import load_index
from .config import load_settings
from .fetcher import FetchError, fetch_matches
from .telegram_client import TelegramClient


CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}
MAX_ALERTS_PER_MATCH = 2


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitoriza partidas ao vivo e envia alertas de apostas")
    parser.add_argument("--env", help="Caminho para o arquivo .env", default=None)
    parser.add_argument("--chat-id", help="Chat ID opcional para envio", default=None)
    parser.add_argument(
        "--interval",
        type=int,
        default=180,
        help="Intervalo em segundos entre varreduras (padrão 180s)",
    )
    parser.add_argument(
        "--min-confidence",
        choices=("low", "medium", "high"),
        default="medium",
        help="Nível mínimo de confiança para disparar alertas",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Não envia mensagens ao Telegram, apenas imprime os alertas",
    )
    parser.add_argument("--verbose", action="store_true", help="Ativa logs detalhados")
    return parser.parse_args(argv)


def _confidence_label(confidence: Optional[str]) -> Optional[str]:
    mapping = {"high": "🔥 Alta", "medium": "⚡ Média", "low": "💡 Baixa"}
    if not confidence:
        return None
    return mapping.get(confidence, "💡 Baixa")


def _format_probabilities(predictions: Dict[str, object]) -> List[str]:
    lines: List[str] = []
    home = int(predictions.get("homeWinProbability", 0) or 0)
    draw = int(predictions.get("drawProbability", 0) or 0)
    away = int(predictions.get("awayWinProbability", 0) or 0)
    if any(value > 0 for value in (home, draw, away)):
        lines.append(f"📈 1X2: Casa {home}% | Empate {draw}% | Fora {away}%")

    over25 = int(predictions.get("over25Probability", 0) or 0)
    under25 = int(predictions.get("under25Probability", 0) or 0)
    if any(value > 0 for value in (over25, under25)):
        lines.append(f"⚽ Linhas 2.5: Over {over25}% | Under {under25}%")

    btts_yes = int(predictions.get("bttsYesProbability", 0) or 0)
    btts_no = int(predictions.get("bttsNoProbability", 0) or 0)
    if any(value > 0 for value in (btts_yes, btts_no)):
        lines.append(f"🤝 Ambos marcam: Sim {btts_yes}% | Não {btts_no}%")

    return lines


class LiveMonitor:
    def __init__(
        self,
        settings,
        index,
        *,
        chat_id: Optional[str],
        interval: int,
        min_confidence: str,
        dry_run: bool,
        logger: logging.Logger,
        stop_event: Optional[Event],
    ) -> None:
        self.settings = settings
        self.index = index
        self.chat_id = chat_id
        self.interval = max(30, interval)
        self.min_confidence_label = min_confidence
        self.min_rank = CONFIDENCE_RANK.get(min_confidence, 1)
        self.dry_run = dry_run
        self.logger = logger
        self.client = None if dry_run else TelegramClient(settings, logger=logger)
        self._sent_flags: Dict[int, Set[str]] = {}
        self._score_cache: Dict[int, Tuple[int, int]] = {}
        self._analysis_counts: Dict[int, int] = {}
        self.max_alerts_per_match = MAX_ALERTS_PER_MATCH
        self.message_interval = max(0, settings.telegram_message_interval_seconds)
        self._last_sent_at: Optional[float] = None
        self.stop_event = stop_event

    def _should_stop(self) -> bool:
        return bool(self.stop_event and self.stop_event.is_set())

    def _wait(self, seconds: float) -> bool:
        if self.stop_event:
            return self.stop_event.wait(seconds)
        time.sleep(seconds)
        return False

    def _cleanup_finished(self, matches: List[Dict[str, object]]) -> None:
        active_ids: Set[int] = set()
        for match in matches:
            fixture_id = match.get("fixtureId")
            try:
                fixture_key = int(fixture_id)
            except (TypeError, ValueError):  # noqa: PERF203 - valores inesperados
                continue
            active_ids.add(fixture_key)

        finished_status = {"FT", "AET", "PEN", "CANC", "ABD", "PST"}
        for match in matches:
            fixture_id = match.get("fixtureId")
            try:
                fixture_key = int(fixture_id)
            except (TypeError, ValueError):
                continue

            status_short = str(((match.get("status") or {}) or {}).get("short") or "")
            if status_short in finished_status and fixture_key in self._sent_flags:
                self.logger.debug("Removendo cache de alerta para jogo finalizado", extra={"fixtureId": fixture_key})
                self._sent_flags.pop(fixture_key, None)
                self._score_cache.pop(fixture_key, None)
                self._analysis_counts.pop(fixture_key, None)
        # Garanta que não guardamos jogos antigos sem status
        for fixture_key in list(self._sent_flags):
            if fixture_key not in active_ids:
                self._sent_flags.pop(fixture_key, None)
                self._score_cache.pop(fixture_key, None)
                self._analysis_counts.pop(fixture_key, None)

    @staticmethod
    def _coerce_score(value: Optional[object]) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):  # noqa: PERF203 - valores inesperados
            return None

    def _detect_goal(
        self,
        fixture_key: int,
        match: Dict[str, object],
        sent_flags: Set[str],
    ) -> Tuple[Set[str], List[Dict[str, object]]]:
        score = match.get("score") or {}
        home = self._coerce_score((score or {}).get("home"))
        away = self._coerce_score((score or {}).get("away"))

        if home is None or away is None:
            self._score_cache.pop(fixture_key, None)
            return set(), []

        previous = self._score_cache.get(fixture_key)
        self._score_cache[fixture_key] = (home, away)

        if previous is None or previous == (home, away):
            return set(), []

        flag_value = f"goal:{home}-{away}"
        if flag_value in sent_flags:
            return set(), []

        diff_home = home - previous[0]
        diff_away = away - previous[1]

        scorer: Optional[str] = None
        teams = match.get("teams") or {}
        if diff_home > diff_away and diff_home > 0:
            scorer = (teams.get("home") or {}).get("name")
        elif diff_away > diff_home and diff_away > 0:
            scorer = (teams.get("away") or {}).get("name")

        event = {
            "type": "goal",
            "home": home,
            "away": away,
            "scorer": scorer,
        }

        return {flag_value}, [event]

    def _should_alert(
        self,
        match: Dict[str, object],
    ) -> Optional[Tuple[int, List[str], Set[str], List[Dict[str, object]]]]:
        confidence = str(match.get("confidence") or "low")
        rank = CONFIDENCE_RANK.get(confidence, 0)
        meets_threshold = rank >= self.min_rank

        fixture_id = match.get("fixtureId")
        if fixture_id is None:
            return None

        try:
            fixture_key = int(fixture_id)
        except (TypeError, ValueError):
            return None

        sent_flags = self._sent_flags.setdefault(fixture_key, set())
        recommendations = [str(item) for item in (match.get("recommendedBets") or [])]

        new_flags: Set[str] = set()
        events: List[Dict[str, object]] = []
        if meets_threshold:
            new_recommendations = [item for item in recommendations if item not in sent_flags]

            if new_recommendations:
                new_flags.update(new_recommendations)
            elif rank >= CONFIDENCE_RANK["high"] and "__high__" not in sent_flags:
                new_flags.add("__high__")
                events.append({"type": "confidence", "level": confidence})

        goal_flags, goal_events = self._detect_goal(fixture_key, match, sent_flags)
        if goal_flags:
            new_flags.update(goal_flags)
            events.extend(goal_events)

        if not new_flags:
            return None

        return fixture_key, recommendations, new_flags, events

    def _format_message(
        self,
        match: Dict[str, object],
        recommendations: List[str],
        new_flags: Set[str],
        events: List[Dict[str, object]],
    ) -> str:
        teams = match.get("teams", {})
        home = escape(str((teams.get("home") or {}).get("name") or "Casa"))
        away = escape(str((teams.get("away") or {}).get("name") or "Fora"))
        competition = match.get("competition", {}) or {}
        league = competition.get("name") or match.get("league", {}).get("name")
        league_label = escape(str(league or "Competição"))

        score = match.get("score") or {}
        home_goals = score.get("home")
        away_goals = score.get("away")
        score_line = f"{home_goals if home_goals is not None else '?'}-{away_goals if away_goals is not None else '?'}"

        status = match.get("status") or {}
        elapsed = status.get("elapsed")
        short = status.get("short") or "LIVE"

        lines = ["🚨 <b>ALERTA AO VIVO</b>"]
        lines.append(f"{home} {score_line} {away} — {league_label}")
        if elapsed is not None:
            lines.append(f"⏱️ {elapsed}' ({escape(str(short))})")
        else:
            lines.append(f"⏱️ Status: {escape(str(short))}")

        confidence_text = _confidence_label(match.get("confidence"))
        if confidence_text:
            lines.append(f"Confiança atual: {confidence_text}")

        goal_events = [event for event in events if event.get("type") == "goal"]
        for event in goal_events:
            scorer = event.get("scorer")
            scorer_text = f" de {escape(str(scorer))}" if scorer else ""
            lines.append(
                f"⚽ Golo{scorer_text}! Placar atualizado: {event.get('home')}-{event.get('away')}"
            )

        if any(event.get("type") == "confidence" for event in events):
            lines.append("🚀 Confiança elevada — oportunidades reforçadas!")

        if new_flags:
            actionable = [
                flag
                for flag in new_flags
                if flag not in {"__high__"} and not flag.startswith("goal:")
            ]
            if actionable:
                lines.append(
                    f"🎯 Novas recomendações: {' | '.join(escape(entry) for entry in actionable)}"
                )
            elif recommendations:
                lines.append(f"🎯 Recomendações: {' | '.join(escape(item) for item in recommendations)}")

        predictions = match.get("predictions") or {}
        if isinstance(predictions, dict):
            lines.extend(_format_probabilities(predictions))

        notes = match.get("analysisNotes") or []
        if notes:
            lines.append(f"📝 {' • '.join(escape(str(note)) for note in notes[:2])}")

        return "\n".join(lines)

    def _send(self, message: str) -> bool:
        if self._respect_message_delay():
            return False

        if self.dry_run:
            print(message)
            print("-" * 80)
            self._last_sent_at = time.monotonic()
            return True

        if not self.client:
            return False

        self.client.send_message(message, chat_id=self.chat_id)
        self._last_sent_at = time.monotonic()
        return True

    def _respect_message_delay(self) -> bool:
        if self.message_interval <= 0:
            return False

        if self._last_sent_at is None:
            return False

        elapsed = time.monotonic() - self._last_sent_at
        remaining = self.message_interval - elapsed
        if remaining <= 0:
            return False

        self.logger.debug(
            "Aguardando %ss antes do próximo alerta", round(remaining, 1)
        )

        return self._wait(remaining)

    def run(self) -> None:
        self.logger.info(
            "Monitor live iniciado (intervalo=%ss, min_confidence=%s, atraso=%ss, max_alerts=%s)",
            self.interval,
            self.min_confidence_label,
            self.message_interval,
            self.max_alerts_per_match,
        )

        while not self._should_stop():
            try:
                match_data = fetch_matches(
                    datetime.now(timezone.utc),
                    self.settings,
                    self.index,
                    logger=self.logger,
                    status="LIVE",
                )
            except FetchError as exc:
                self.logger.error("Falha ao buscar jogos ao vivo: %s", exc)
                if self._wait(self.interval):
                    break
                continue

            matches = match_data.get("matches", []) or []
            self._cleanup_finished(matches)

            if not matches:
                self.logger.debug("Nenhum jogo ao vivo nas competições monitorizadas")
                if self._wait(self.interval):
                    break
                continue

            analysis = analyze_matches(matches, self.index, logger=self.logger)
            analyzed_matches = analysis.get("allMatches", []) or []

            for match in analyzed_matches:
                result = self._should_alert(match)
                if not result:
                    continue

                fixture_id, recommendations, new_flags, events = result
                message = self._format_message(match, recommendations, new_flags, events)
                current_count = self._analysis_counts.get(fixture_id, 0)
                if current_count >= self.max_alerts_per_match:
                    self.logger.debug(
                        "Limite de análises atingido para jogo", extra={"fixtureId": fixture_id}
                    )
                    self._sent_flags.setdefault(fixture_id, set()).update(new_flags)
                    continue
                try:
                    sent = self._send(message)
                    self._sent_flags.setdefault(fixture_id, set()).update(new_flags)
                    if sent:
                        self._analysis_counts[fixture_id] = current_count + 1
                        self.logger.info(
                            "Alerta enviado", extra={"fixtureId": fixture_id, "flags": list(new_flags)}
                        )
                except Exception as exc:  # noqa: BLE001
                    self.logger.error("Falha ao enviar alerta ao vivo", exc_info=exc)

            if self._wait(self.interval):
                break

        self.logger.info("Monitor live encerrado")


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("python-bot.live-monitor")

    try:
        settings = load_settings(Path(args.env) if args.env else None)
    except Exception as exc:  # noqa: BLE001
        logger.error("Não foi possível carregar configurações: %s", exc)
        return 1

    index = load_index()

    monitor = LiveMonitor(
        settings,
        index,
        chat_id=args.chat_id,
        interval=args.interval,
        min_confidence=args.min_confidence,
        dry_run=args.dry_run,
        logger=logger,
        stop_event=None,
    )

    monitor.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

