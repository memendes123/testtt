from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


@dataclass
class Settings:
    football_api_key: str
    telegram_bot_token: str
    telegram_channel_id: Optional[str]
    default_chat_id: Optional[str]
    bookmaker_id: int = 6
    max_fixtures: int = 120
    telegram_owner_id: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4.1-mini"


def load_settings(env_file: Optional[Path] = None) -> Settings:
    """Load settings from environment variables."""
    load_dotenv(dotenv_path=env_file)

    api_key = os.getenv("FOOTBALL_API_KEY")
    if not api_key:
        raise RuntimeError("FOOTBALL_API_KEY environment variable is required")

    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not telegram_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN environment variable is required")

    channel_id = os.getenv("TELEGRAM_CHANNEL_ID")
    default_chat = os.getenv("TELEGRAM_DEFAULT_CHAT_ID")
    owner_id = os.getenv("TELEGRAM_OWNER_ID")
    bookmaker = int(os.getenv("FOOTBALL_API_BOOKMAKER", "6"))
    max_fixtures = int(os.getenv("FOOTBALL_MAX_FIXTURES", "120"))
    openai_api_key = os.getenv("OPENAI_API_KEY")
    openai_model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    return Settings(
        football_api_key=api_key,
        telegram_bot_token=telegram_token,
        telegram_channel_id=channel_id,
        default_chat_id=default_chat,
        bookmaker_id=bookmaker,
        max_fixtures=max_fixtures,
        telegram_owner_id=owner_id,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
    )
