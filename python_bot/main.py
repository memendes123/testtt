from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Tuple

from .analyzer import analyze_matches
from .competitions import load_index
from .config import load_settings
from .fetcher import FetchError, fetch_matches
from .llm import ChatGPTClient
from .message_builder import format_predictions_message
from .telegram_client import TelegramClient


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


_CACHE_MAX_AGE = timedelta(hours=12)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Standalone football predictions bot")
    parser.add_argument("--date", help="Date in YYYY-MM-DD format", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    parser.add_argument("--env", help="Path to .env file", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Skip sending message to Telegram")
    parser.add_argument("--chat-id", help="Override Telegram chat id", default=None)
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    parser.add_argument("--output", help="Optional path to write JSON summary", default=None)
    parser.add_argument(
        "--cache-dir",
        help="Directory used to cache the last successful fixture payload",
        default=".python_bot_cache",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable the cached-fixture fallback when fetching data fails or returns empty results",
    )
    return parser.parse_args(argv)


def _load_cached_payload(cache_file: Path, logger: logging.Logger) -> Optional[Tuple[datetime, dict]]:
    try:
        raw_text = cache_file.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        logger.warning(
            "Unable to read cached fixtures", extra={"path": str(cache_file), "error": str(exc)}
        )
        return None

    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.warning(
            "Cached fixtures corrupted", extra={"path": str(cache_file), "error": str(exc)}
        )
        return None

    if not isinstance(payload, dict):
        return None

    match_data = payload.get("matchData")
    if not isinstance(match_data, dict):
        return None

    cached_at_raw = payload.get("cachedAt")
    cached_at: Optional[datetime] = None
    if isinstance(cached_at_raw, str):
        try:
            cached_at = datetime.fromisoformat(cached_at_raw)
            if cached_at.tzinfo is None:
                cached_at = cached_at.replace(tzinfo=timezone.utc)
        except ValueError:
            cached_at = None

    if cached_at is None:
        cached_at = datetime.now(timezone.utc)

    age = datetime.now(timezone.utc) - cached_at
    if age > _CACHE_MAX_AGE:
        logger.info(
            "Cached fixtures expired", extra={"path": str(cache_file), "ageHours": round(age.total_seconds() / 3600, 2)}
        )
        return None

    return cached_at, match_data


def _store_cached_payload(cache_file: Path, match_data: dict, logger: logging.Logger) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "cachedAt": datetime.now(timezone.utc).isoformat(),
        "matchData": match_data,
    }
    try:
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        logger.warning(
            "Unable to persist fixtures cache", extra={"path": str(cache_file), "error": str(exc)}
        )


def _should_use_cache(fetched: Optional[dict], cached: Optional[Tuple[datetime, dict]]) -> bool:
    if not cached:
        return False

    cached_match_data = cached[1]
    cached_matches = cached_match_data.get("matches") if isinstance(cached_match_data, dict) else None
    if not cached_matches:
        return False

    if fetched is None:
        return True

    fetched_matches = fetched.get("matches") if isinstance(fetched, dict) else None
    if fetched_matches:
        return False

    metadata = fetched.get("metadata") if isinstance(fetched, dict) else None
    if isinstance(metadata, dict):
        processed = int(metadata.get("processedFixtures", 0) or 0)
        supported = int(metadata.get("supportedFixtures", 0) or 0)
        if processed == 0 and supported == 0:
            # Genuine zero-fixture day, do not reuse stale data.
            return False

    return True


def _load_match_data(
    date: datetime,
    settings,
    index,
    logger: logging.Logger,
    *,
    cache_dir: Optional[Path] = None,
    fetch_matches=fetch_matches,
) -> Tuple[dict, bool]:
    cache_entry: Optional[Tuple[datetime, dict]] = None
    cache_file: Optional[Path] = None
    if cache_dir:
        cache_file = cache_dir / f"fixtures_{date.strftime('%Y-%m-%d')}.json"
        cache_entry = _load_cached_payload(cache_file, logger)

    fetched_data: Optional[dict] = None
    try:
        fetched_data = fetch_matches(date, settings, index, logger=logger)
    except FetchError as exc:
        if cache_entry:
            logger.warning(
                "Fetch failed, using cached fixtures", extra={"path": str(cache_file), "error": str(exc)}
            )
            return cache_entry[1], True
        raise

    if _should_use_cache(fetched_data, cache_entry):
        if cache_file:
            logger.warning(
                "Fetched fixtures were empty, using cached payload", extra={"path": str(cache_file)}
            )
        return cache_entry[1], True

    if cache_file and isinstance(fetched_data, dict) and fetched_data.get("matches"):
        _store_cached_payload(cache_file, fetched_data, logger)

    return fetched_data, False


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    logger = logging.getLogger("python-bot")

    try:
        date = datetime.fromisoformat(args.date)
    except ValueError:
        logger.error("Invalid date provided: %s", args.date)
        return 1

    try:
        settings = load_settings(Path(args.env) if args.env else None)
    except RuntimeError as exc:
        logger.error("Configuration error: %s", exc)
        return 1

    index = load_index()

    cache_dir: Optional[Path] = None
    if not args.no_cache and args.cache_dir:
        cache_dir = Path(args.cache_dir).expanduser()

    try:
        match_data, used_cache = _load_match_data(
            date,
            settings,
            index,
            logger,
            cache_dir=cache_dir,
        )
    except FetchError as exc:
        logger.error("Failed to fetch fixtures: %s", exc)
        return 1

    analysis = analyze_matches(match_data["matches"], index, logger=logger)

    chatgpt = ChatGPTClient(settings.openai_api_key, settings.openai_model, logger=logger)
    llm_insights: list[dict] = []
    should_request_llm = (
        chatgpt.is_configured()
        and analysis.get("totalAnalyzed", 0) > 0
        and analysis.get("highConfidenceCount", 0) == 0
        and analysis.get("mediumConfidenceCount", 0) == 0
    )

    if should_request_llm:
        logger.info("No medium/high confidence picks found, requesting ChatGPT summaries")
        candidates = analysis.get("bestMatches") or analysis.get("allMatches") or []
        for match in candidates[:3]:
            context = {
                "teams": match.get("teams"),
                "competition": match.get("competition"),
                "predictions": match.get("predictions"),
                "recommendedBets": match.get("recommendedBets"),
                "analysisNotes": match.get("analysisNotes"),
                "confidence": match.get("confidence"),
                "kickoff": match.get("date"),
            }
            summary = chatgpt.summarize_match(context)
            if summary:
                llm_insights.append({"match": match, "summary": summary})

    message = format_predictions_message(match_data, analysis, llm_insights=llm_insights)

    result = {
        "success": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "matchData": match_data,
        "analysis": analysis,
        "llmInsights": llm_insights,
        "message": message,
        "usedCache": used_cache,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2, ensure_ascii=False))

    if args.dry_run:
        print(message)
    else:
        client = TelegramClient(settings, logger=logger)
        try:
            send_result = client.send_message(message, chat_id=args.chat_id)
            result["telegram"] = send_result
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to send Telegram message: %s", exc)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
