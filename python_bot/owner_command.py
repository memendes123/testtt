from __future__ import annotations

import argparse
import logging
import time
from typing import Optional

import requests

from .analyzer import analyze_matches
from .competitions import load_index
from .config import load_settings
from .llm import ChatGPTClient
from .manual_fetcher import locate_fixture
from .telegram_client import TelegramClient

COMMAND_ALIASES = {"/insight", "/insights", "/analise", "/analisar"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Listener de comandos privados para o owner")
    parser.add_argument("--env", help="Caminho opcional para ficheiro .env", default=None)
    parser.add_argument("--verbose", action="store_true", help="Ativa logs detalhados")
    parser.add_argument("--poll-interval", type=int, default=5, help="Pausa (s) entre chamadas em caso de erro")
    return parser.parse_args()


def extract_command(text: Optional[str]) -> Optional[tuple[str, str]]:
    if not text:
        return None
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None
    first_token = stripped.split()[0]
    command = first_token.split("@", 1)[0].lower()
    if command not in COMMAND_ALIASES:
        return None
    query = stripped[len(first_token) :].strip()
    return command, query


def build_response_message(match: dict, analysis: dict, gpt_summary: Optional[str]) -> str:
    teams = match.get("teams", {}) or {}
    home = (teams.get("home") or {}).get("name", "Casa")
    away = (teams.get("away") or {}).get("name", "Fora")
    competition = match.get("competition", {}) or {}
    league_name = competition.get("name") or (match.get("league") or {}).get("name")
    region = competition.get("region") or competition.get("country") or ""
    kickoff_date = match.get("date") or ""
    kickoff_time = match.get("time") or ""

    predictions = analysis.get("predictions", {})
    recs = analysis.get("recommendedBets", []) or []
    notes = analysis.get("analysisNotes", []) or []
    confidence = analysis.get("confidence", "low")

    lines = [
        "🔒 <b>Pedido do owner</b>",
        f"🏟️ {home} vs {away}",
    ]
    competition_line = league_name or "Competição desconhecida"
    if region:
        competition_line += f" · {region}"
    lines.append(f"🏆 {competition_line}")
    if kickoff_date or kickoff_time:
        display_time = kickoff_time or "--:--"
        lines.append(f"🗓️ {kickoff_date} · {display_time}")

    lines.append("")
    lines.append("📊 Probabilidades estimadas")
    lines.append(f"• Casa: {predictions.get('homeWinProbability', 0)}%")
    lines.append(f"• Empate: {predictions.get('drawProbability', 0)}%")
    lines.append(f"• Fora: {predictions.get('awayWinProbability', 0)}%")
    lines.append(f"• Over 2.5: {predictions.get('over25Probability', 0)}% | Under 2.5: {predictions.get('under25Probability', 0)}%")
    lines.append(
        f"• BTTS Sim: {predictions.get('bttsYesProbability', 0)}% | BTTS Não: {predictions.get('bttsNoProbability', 0)}%"
    )

    lines.append("")
    confidence_label = {"high": "Alta", "medium": "Média"}.get(confidence, "Baixa")
    lines.append(f"🔥 Confiança geral: {confidence_label}")

    if recs:
        lines.append("")
        lines.append("🎯 Sugestões do modelo:")
        for rec in recs:
            lines.append(f"• {rec}")

    if notes:
        lines.append("")
        lines.append("🧠 PKs em destaque:")
        for note in notes:
            lines.append(f"• {note}")

    if gpt_summary:
        lines.append("")
        lines.append("🤖 <b>Resumo GPT</b>")
        lines.append(gpt_summary)

    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger("owner-command")

    try:
        settings = load_settings(args.env)
    except RuntimeError as exc:
        logger.error("Erro ao carregar configuração: %s", exc)
        return 1

    if not settings.telegram_owner_id:
        logger.error("Configure TELEGRAM_OWNER_ID para usar o comando exclusivo do owner.")
        return 1

    index = load_index()
    telegram = TelegramClient(settings, logger=logger)
    chatgpt = ChatGPTClient(settings.openai_api_key, settings.openai_model, logger=logger)

    offset: Optional[int] = None

    logger.info("Iniciando listener de comandos do owner")

    while True:
        try:
            params = {"timeout": 55}
            if offset is not None:
                params["offset"] = offset
            response = requests.get(f"{telegram.base_url}/getUpdates", params=params, timeout=60)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # noqa: BLE001
            logger.error("Falha ao obter updates do Telegram: %s", exc)
            time.sleep(max(1, args.poll_interval))
            continue

        for update in payload.get("result", []) or []:
            offset = max(offset or 0, update.get("update_id", 0) + 1)
            message = update.get("message") or update.get("edited_message") or {}
            chat = message.get("chat") or {}
            chat_id = chat.get("id")
            if not chat_id:
                continue

            command = extract_command(message.get("text"))
            if not command:
                continue

            if str(message.get("from", {}).get("id")) != str(settings.telegram_owner_id):
                telegram.send_message("Este comando é reservado ao owner.", chat_id=str(chat_id))
                logger.info("Comando ignorado por utilizador não autorizado", extra={"chatId": chat_id})
                continue

            _, query = command
            match, error = locate_fixture(query, settings, index, logger)
            if error:
                telegram.send_message(error, chat_id=str(chat_id))
                continue
            if not match:
                telegram.send_message("Não foi possível localizar jogo para análise.", chat_id=str(chat_id))
                continue

            analysis = analyze_matches([match], index, logger=logger)
            best_matches = analysis.get("bestMatches", []) or []
            if best_matches:
                match_analysis = best_matches[0]
            else:
                match_analysis = {
                    "predictions": {
                        "homeWinProbability": 0,
                        "drawProbability": 0,
                        "awayWinProbability": 0,
                        "over25Probability": 0,
                        "under25Probability": 0,
                        "bttsYesProbability": 0,
                        "bttsNoProbability": 0,
                    },
                    "recommendedBets": [],
                    "analysisNotes": [],
                    "confidence": "low",
                }

            gpt_context = {
                "teams": match.get("teams"),
                "competition": match.get("competition"),
                "predictions": match_analysis.get("predictions", {}),
                "recommendedBets": match_analysis.get("recommendedBets", []),
                "analysisNotes": match_analysis.get("analysisNotes", []),
                "confidence": match_analysis.get("confidence"),
                "kickoff": match.get("date"),
            }
            gpt_summary = chatgpt.summarize_match(gpt_context)

            message_text = build_response_message(match, match_analysis, gpt_summary)
            telegram.send_message(message_text, chat_id=str(chat_id))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
