from __future__ import annotations

from datetime import datetime
from typing import Dict


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
            label = region.get("label")
            total = region.get("total", 0)
            high = region.get("highConfidence", 0)
            medium = region.get("mediumConfidence", 0)
            message_lines.append(f"• {label}: {total} jogos ({high} alta | {medium} média)")
        message_lines.append("")

    best_matches = analysis.get("bestMatches", [])
    if best_matches:
        top_matches = best_matches[: min(5, len(best_matches))]
        message_lines.append(f"🔥 <b>TOP GLOBAL ({len(top_matches)})</b>")
        for match in top_matches:
            confidence = match.get("confidence")
            emoji = "🔥" if confidence == "high" else "⚡" if confidence == "medium" else "💡"
            teams = match.get("teams", {})
            competition = match.get("competition", {})
            league_name = competition.get("name") or match.get("league", {}).get("name")
            message_lines.append(
                f"{emoji} <b>{teams.get('home', {}).get('name')} vs {teams.get('away', {}).get('name')}</b> — {league_name}"
            )
            if match.get("time"):
                message_lines.append(f"⏰ {match['time']} | 🏆 {league_name}")
            bets = match.get("recommendedBets", [])
            if bets:
                message_lines.append(f"🎯 {' | '.join(bets)}")
            predictions = match.get("predictions", {})
            if predictions:
                message_lines.append(
                    "📈 Prob: Casa {home}% | Empate {draw}% | Fora {away}%".format(
                        home=predictions.get("homeWinProbability", 0),
                        draw=predictions.get("drawProbability", 0),
                        away=predictions.get("awayWinProbability", 0),
                    )
                )
            message_lines.append("")
    else:
        message_lines.append("😔 <b>Não há jogos com odds interessantes hoje.</b>")
        message_lines.append("Voltamos amanhã com mais análises!")
        message_lines.append("")
        message_lines.append("📈 Tip: Verifique os jogos ao vivo durante o dia para oportunidades em tempo real.")

    return "\n".join(message_lines)
