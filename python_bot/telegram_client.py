from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, Optional

import requests

from .config import Settings


class TelegramClient:
    def __init__(self, settings: Settings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or logging.getLogger(__name__)

    @property
    def base_url(self) -> str:
        return f"https://api.telegram.org/bot{self.settings.telegram_bot_token}"

    def _post(self, method: str, payload: Dict[str, object]) -> Dict[str, object]:
        response = requests.post(f"{self.base_url}/{method}", json=payload, timeout=30)
        if response.status_code != 200:
            raise RuntimeError(f"Telegram API error: {response.status_code} {response.text}")
        return response.json()

    def _get_recent_chat_id(self) -> Optional[str]:
        try:
            response = requests.get(f"{self.base_url}/getUpdates", params={"limit": 10, "offset": -10}, timeout=30)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Unable to fetch Telegram updates", exc_info=exc)
            return None

        for update in reversed(payload.get("result", [])):
            message = update.get("message") or {}
            chat = message.get("chat") or {}
            if chat.get("type") == "private":
                return str(chat.get("id"))
        return None

    def send_message(self, message: str, chat_id: Optional[str] = None) -> Dict[str, object]:
        chat_id = chat_id or self.settings.default_chat_id or self._get_recent_chat_id()
        if not chat_id:
            raise RuntimeError("Unable to determine Telegram chat ID. Provide TELEGRAM_DEFAULT_CHAT_ID or send a message to the bot first.")

        self.logger.info("Sending message to Telegram", extra={"chatId": chat_id, "length": len(message)})
        main_result = self._post(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
        )

        results = [
            {
                "type": "private_chat",
                "success": True,
                "messageId": (main_result.get("result") or {}).get("message_id"),
                "chatId": chat_id,
            }
        ]

        if self.settings.telegram_channel_id:
            try:
                channel_result = self._post(
                    "sendMessage",
                    {
                        "chat_id": self.settings.telegram_channel_id,
                        "text": message,
                        "parse_mode": "HTML",
                        "disable_web_page_preview": True,
                    },
                )
                results.append(
                    {
                        "type": "channel",
                        "success": True,
                        "messageId": (channel_result.get("result") or {}).get("message_id"),
                        "chatId": self.settings.telegram_channel_id,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                self.logger.error("Failed to send message to Telegram channel", exc_info=exc)

        return {
            "success": True,
            "messageId": results[0].get("messageId"),
            "chatId": results[0].get("chatId"),
            "sentAt": datetime.utcnow().isoformat(),
            "results": results,
        }
