from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .analyzer import analyze_matches
from .competitions import load_index
from .config import load_settings
from .fetcher import FetchError, fetch_matches
from .message_builder import format_predictions_message
from .telegram_client import TelegramClient


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Standalone football predictions bot")
    parser.add_argument("--date", help="Date in YYYY-MM-DD format", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    parser.add_argument("--env", help="Path to .env file", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Skip sending message to Telegram")
    parser.add_argument("--chat-id", help="Override Telegram chat id", default=None)
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    parser.add_argument("--output", help="Optional path to write JSON summary", default=None)
    return parser.parse_args(argv)


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

    try:
        match_data = fetch_matches(date, settings, index, logger=logger)
    except FetchError as exc:
        logger.error("Failed to fetch fixtures: %s", exc)
        return 1

    analysis = analyze_matches(match_data["matches"], index, logger=logger)
    message = format_predictions_message(match_data, analysis)

    result = {
        "success": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "matchData": match_data,
        "analysis": analysis,
        "message": message,
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
