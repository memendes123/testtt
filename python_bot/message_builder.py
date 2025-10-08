from __future__ import annotations

from datetime import datetime
from html import escape
from typing import Dict, Iterable, List, Optional


def _confidence_label(confidence: Optional[str]) -> Optional[str]:
    mapping = {"high": "🔥 Alta", "medium": "⚡ Média", "low": "💡 Baixa"}
    if not confidence:
        return None
    return mapping.get(confidence, "💡 Baixa")


def _format_probability_lines(predictions: Dict[str, object]) -> List[str]:
    lines: List[str] = []

    home = int(predictions.get("homeWinProbability", 0) or 0)
    draw = int(predictions.get("drawProbability", 0) or 0)
    away = int(predictions.get("awayWinProbability", 0) or 0)

    if any(value > 0 for value in (home, draw, away)):
        lines.append(
            f"↳ 📈 1X2: Casa {home}% | Empate {draw}% | Fora {away}%"
        )

    over25 = int(predictions.get("over25Probability", 0) or 0)
    under25 = int(predictions.get("under25Probability", 0) or 0)
    if any(value > 0 for value in (over25, under25)):
        lines.append(f"↳ ⚽ Linhas 2.5: Over {over25}% | Under {under25}%")

    btts_yes = int(predictions.get("bttsYesProbability", 0) or 0)
    btts_no = int(predictions.get("bttsNoProbability", 0) or 0)
    if any(value > 0 for value in (btts_yes, btts_no)):
        lines.append(f"↳ 🤝 Ambos marcam: Sim {btts_yes}% | Não {btts_no}%")

    return lines


def _escape_join(values: Iterable[object], separator: str = " | ") -> str:
    escaped = [escape(str(value)) for value in values if value is not None]
    return separator.join(escaped)


def _format_match_details(match: Dict[str, object], *, prefix: str) -> List[str]:
    teams = match.get("teams", {})
    home = escape(str((teams.get("home") or {}).get("name") or "Casa"))
    away = escape(str((teams.get("away") or {}).get("name") or "Fora"))
    competition = match.get("competition", {}) or {}
    league = competition.get("name") or match.get("league", {}).get("name")
    league_label = escape(str(league)) if league else ""
    time_label = escape(str(match.get("time") or "TBD"))

    header_parts = [prefix, f"<b>{home} vs {away}</b>"]
    if time_label and time_label != "TBD":
        header_parts.append(f"({time_label})")
    if league_label:
        header_parts.append(f"— {league_label}")

    lines: List[str] = [" ".join(part for part in header_parts if part)]

    confidence = _confidence_label(match.get("confidence"))
    if confidence:
        lines.append(f"↳ Confiança: {confidence}")

    bets = match.get("recommendedBets") or []
    if bets:
        lines.append(f"↳ 🎯 {_escape_join(bets)}")
    else:
        lines.append("↳ 🎯 Sem recomendação automática — avaliar manualmente")

    predictions = match.get("predictions") or {}
    if isinstance(predictions, dict):
        lines.extend(_format_probability_lines(predictions))

    notes = match.get("analysisNotes") or []
    if notes:
        lines.append(f"↳ 📝 {_escape_join(notes[:2], ' • ')}")

    return lines


def format_predictions_message(match_data: Dict[str, object], analysis: Dict[str, object]) -> str:
    date_str = match_data.get("date")
    try:
        formatted_date = datetime.fromisoformat(str(date_str)).strftime("%d/%m/%Y")
    except Exception:
        formatted_date = str(date_str)

    message_lines = [f"🏆 <b>PREVISÕES FUTEBOL - {formatted_date}</b>", ""]

    summary = [
        "📊 <b>Resumo Global:</b>",
        f"• {match_data.get('totalMatches', 0)} jogos elegíveis nas competições suportadas",
        f"• {analysis.get('totalAnalyzed', 0)} jogos com odds válidas analisados",
        f"• {analysis.get('highConfidenceCount', 0)} jogos de alta confiança | {analysis.get('mediumConfidenceCount', 0)} de média confiança",
    ]
    message_lines.extend(summary)
    message_lines.append("")

    breakdown = analysis.get("breakdownByRegion", [])
    active_regions = [region for region in breakdown if region.get("total", 0) > 0]
    if active_regions:
        message_lines.append("🌍 <b>Distribuição por Região:</b>")
        for region in active_regions:
            label = escape(str(region.get("label") or region.get("region") or ""))
            total = region.get("total", 0)
            high = region.get("highConfidence", 0)
            medium = region.get("mediumConfidence", 0)
            message_lines.append(f"• {label}: {total} jogos ({high} alta | {medium} média)")
        message_lines.append("")

    best_matches = analysis.get("bestMatches", []) or []
    if best_matches:
        top_matches = best_matches[: min(5, len(best_matches))]
        message_lines.append(f"🔥 <b>TOP GLOBAL ({len(top_matches)})</b>")
        for match in top_matches:
            confidence = match.get("confidence")
            emoji = "🔥" if confidence == "high" else "⚡" if confidence == "medium" else "💡"
            lines = _format_match_details(match, prefix=emoji)
            time_value = match.get("time")
            competition = match.get("competition", {}) or {}
            league_label = competition.get("name") or match.get("league", {}).get("name")
            if time_value:
                lines.insert(1, f"↳ ⏰ {escape(str(time_value))} | 🏆 {escape(str(league_label or 'Horário a definir'))}")
            message_lines.extend(lines)
            message_lines.append("")
    else:
        message_lines.append("😔 <b>Não há jogos com odds interessantes hoje.</b>")
        message_lines.append("Voltamos amanhã com mais análises!")
        message_lines.append("")
        message_lines.append("📈 Tip: Verifique os jogos ao vivo durante o dia para oportunidades em tempo real.")

    regional_matches = analysis.get("bestMatchesByRegion", []) or []
    detailed_regions = [region for region in regional_matches if region.get("matches")]
    if detailed_regions:
        message_lines.append("🗺️ <b>Lista completa por região/competição:</b>")
        for region in detailed_regions:
            label = escape(str(region.get("label") or region.get("region") or ""))
            message_lines.append(f"📍 <b>{label}</b>")
            for match in region.get("matches", []) or []:
                message_lines.extend(_format_match_details(match, prefix="•"))
                message_lines.append("")
        if message_lines[-1] == "":
            message_lines.pop()

    message_lines.extend(
        [
            "",
            "💡 <b>Lembre-se:</b>",
            "• Aposte com responsabilidade",
            "• Nunca aposte mais do que pode perder",
            "• Estas são apenas previsões baseadas em probabilidades",
            "",
            "🔴 Lives: o bot monitoriza jogos em tempo real e envia alertas quentes via fluxo <i>live-betting</i>.",
            "⚽ Boa sorte com as suas apostas!",
            "🤖 Bot de Previsões Futebol",
        ]
    )

    return "\n".join(message_lines)
