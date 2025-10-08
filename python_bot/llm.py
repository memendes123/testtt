from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import requests


class ChatGPTClient:
    """Simple wrapper around the OpenAI Chat Completions API."""

    def __init__(self, api_key: Optional[str], model: str = "gpt-4o-mini", logger: Optional[logging.Logger] = None) -> None:
        self.api_key = api_key
        self.model = model
        self.logger = logger or logging.getLogger(__name__)

    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    def summarize_match(self, context: Dict[str, Any]) -> Optional[str]:
        if not self.is_configured():
            return None

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Você é um analista de apostas esportivas que cria insights objetivos e concisos. "
                        "Resuma os dados recebidos em português europeu, indicando onde há oportunidades e riscos."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Use os dados JSON abaixo para elaborar um parágrafo curto com duas a quatro frases "
                        "destacando: estado atual das equipas, tendências de golos e indicações de aposta baseadas nas probabilidades.\n"
                        f"Dados: {json.dumps(context, ensure_ascii=False)}"
                    ),
                },
            ],
            "temperature": 0.3,
            "max_tokens": 250,
        }

        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=45,
            )
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                return None
            message = choices[0].get("message") or {}
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()
            return None
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Falha ao obter resumo do ChatGPT", exc_info=exc)
            return None
