from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import requests


class ChatGPTClient:
    """Simple wrapper around the OpenAI Responses API (GPT-5 family by default)."""

    def __init__(self, api_key: Optional[str], model: str = "gpt-5.0", logger: Optional[logging.Logger] = None) -> None:
        self.api_key = api_key
        self.model = model
        self.logger = logger or logging.getLogger(__name__)

    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    def summarize_match(self, context: Dict[str, Any]) -> Optional[str]:
        if not self.is_configured():
            self.logger.debug(
                "OpenAI client not configured", extra={"hasKey": bool(self.api_key), "model": self.model or ""}
            )
            return None

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Você é um analista de apostas esportivas que cria insights objetivos e concisos. "
                                "Resuma os dados recebidos em português europeu, indicando onde há oportunidades e riscos."
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Use os dados JSON abaixo para elaborar um parágrafo curto com duas a quatro frases "
                                "destacando: estado atual das equipas, tendências de golos e indicações de aposta baseadas nas probabilidades.\n"
                                f"Dados: {json.dumps(context, ensure_ascii=False)}"
                            ),
                        }
                    ],
                },
            ],
            "temperature": 0.3,
            "max_output_tokens": 250,
        }

        try:
            response = requests.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
                timeout=45,
            )
            response.raise_for_status()
            data = response.json()
            output = data.get("output") or data.get("choices")
            if not output:
                return None

            if isinstance(output, list):
                for item in output:
                    content = item.get("content") if isinstance(item, dict) else None
                    if isinstance(content, list):
                        for part in content:
                            text = part.get("text") if isinstance(part, dict) else None
                            if isinstance(text, str) and text.strip():
                                return text.strip()
                    elif isinstance(content, dict):
                        text = content.get("text")
                        if isinstance(text, str) and text.strip():
                            return text.strip()
                    elif isinstance(content, str) and content.strip():
                        return content.strip()

            message = data.get("response") or data.get("content")
            if isinstance(message, str) and message.strip():
                return message.strip()
            return None
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Falha ao obter resumo do ChatGPT", exc_info=exc)
            return None
