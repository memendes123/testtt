from __future__ import annotations

import logging
import re
import unicodedata
from typing import Dict, List, Optional

from .competitions import CompetitionIndex


HOME_LABELS = {"home", "1", "home team", "team 1", "1 home"}
DRAW_LABELS = {"draw", "x", "empate"}
AWAY_LABELS = {"away", "2", "away team", "team 2", "2 away"}
YES_LABELS = {"yes", "sim", "y", "s"}
NO_LABELS = {"no", "nao", "n"}


def _normalize_label(value: Optional[object]) -> str:
    if value is None:
        return ""

    text = str(value)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace(",", ".").replace("(", " ").replace(")", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def _is_over_25_label(value: Optional[object]) -> bool:
    normalized = _normalize_label(value)
    if not normalized:
        return False
    if "over" in normalized or "mais de" in normalized:
        return "2.5" in normalized or "25" in normalized
    return False


def _is_under_25_label(value: Optional[object]) -> bool:
    normalized = _normalize_label(value)
    if not normalized:
        return False
    if "under" in normalized or "menos de" in normalized:
        return "2.5" in normalized or "25" in normalized
    return False


def _calculate_probability(odd: Optional[str]) -> int:
    if not odd:
        return 0
    try:
        value = float(odd)
    except (TypeError, ValueError):
        return 0
    if value <= 0:
        return 0
    return round((1 / value) * 100)


def analyze_matches(matches: List[Dict[str, object]], index: CompetitionIndex, logger: Optional[logging.Logger] = None) -> Dict[str, object]:
    logger = logger or logging.getLogger(__name__)
    logger.info("Analyzing matches", extra={"count": len(matches)})

    analyzed: List[Dict[str, object]] = []

    for match in matches:
        entry = {
            **match,
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
            "confidence": "low",
            "analysisNotes": [],
        }

        odds = match.get("odds") or []
        if not odds:
            analyzed.append(entry)
            continue

        market_lookup = {market.get("name"): market.get("values", []) for market in odds if isinstance(market, dict)}

        match_winner = market_lookup.get("Match Winner", [])
        over_under = market_lookup.get("Goals Over/Under", [])
        btts = market_lookup.get("Both Teams Score", [])

        predictions = entry["predictions"]

        for value in match_winner:
            label = _normalize_label(value.get("value"))
            odd = value.get("odd")
            if label in HOME_LABELS:
                predictions["homeWinProbability"] = _calculate_probability(odd)
            elif label in DRAW_LABELS:
                predictions["drawProbability"] = _calculate_probability(odd)
            elif label in AWAY_LABELS:
                predictions["awayWinProbability"] = _calculate_probability(odd)

        for value in over_under:
            label = value.get("value")
            odd = value.get("odd")
            if _is_over_25_label(label):
                predictions["over25Probability"] = _calculate_probability(odd)
            elif _is_under_25_label(label):
                predictions["under25Probability"] = _calculate_probability(odd)

        for value in btts:
            label = _normalize_label(value.get("value"))
            odd = value.get("odd")
            if label in YES_LABELS:
                predictions["bttsYesProbability"] = _calculate_probability(odd)
            elif label in NO_LABELS:
                predictions["bttsNoProbability"] = _calculate_probability(odd)

        recommendations: List[str] = []
        confidence_score = 0

        max_probability = max(predictions["homeWinProbability"], predictions["awayWinProbability"], predictions["drawProbability"])
        if max_probability >= 70:
            team = match.get("teams", {}).get("home", {}).get("name")
            if predictions["awayWinProbability"] > predictions["homeWinProbability"]:
                team = match.get("teams", {}).get("away", {}).get("name")
            recommendations.append(f"🏆 Forte favorito: {team} ({max_probability}%)")
            confidence_score += 3
        elif max_probability >= 55:
            team = match.get("teams", {}).get("home", {}).get("name")
            if predictions["awayWinProbability"] > predictions["homeWinProbability"]:
                team = match.get("teams", {}).get("away", {}).get("name")
            recommendations.append(f"✅ Favorito: {team} ({max_probability}%)")
            confidence_score += 2

        if predictions["over25Probability"] >= 60:
            recommendations.append(f"⚽ Over 2.5 golos ({predictions['over25Probability']}%)")
            confidence_score += 2
        elif predictions["under25Probability"] >= 60:
            recommendations.append(f"🛡️ Under 2.5 golos ({predictions['under25Probability']}%)")
            confidence_score += 2

        if predictions["bttsYesProbability"] >= 60:
            recommendations.append(f"🥅 Ambos marcam: SIM ({predictions['bttsYesProbability']}%)")
            confidence_score += 1
        elif predictions["bttsNoProbability"] >= 60:
            recommendations.append(f"🚫 Ambos marcam: NÃO ({predictions['bttsNoProbability']}%)")
            confidence_score += 1

        notes: List[str] = []
        qualitative_boost = 0

        form_data = match.get("form") if isinstance(match, dict) else {}
        home_form = (form_data or {}).get("home") if isinstance(form_data, dict) else None
        away_form = (form_data or {}).get("away") if isinstance(form_data, dict) else None
        head_to_head = (form_data or {}).get("headToHead") if isinstance(form_data, dict) else None

        def _format_record(record: Optional[str]) -> str:
            return (record or "")[:5]

        if home_form and isinstance(home_form, dict):
            streak = home_form.get("currentStreak", {})
            if isinstance(streak, dict) and streak.get("type") == "win" and streak.get("count", 0) >= 3:
                notes.append(
                    f"Casa com {streak.get('count')} vitórias seguidas ({_format_record(home_form.get('recentRecord'))})"
                )
                qualitative_boost += 1

        if away_form and isinstance(away_form, dict):
            streak = away_form.get("currentStreak", {})
            if isinstance(streak, dict) and streak.get("type") == "loss" and streak.get("count", 0) >= 2:
                notes.append(
                    f"Visitante sem vencer há {streak.get('count')} jogos ({_format_record(away_form.get('recentRecord'))})"
                )
                qualitative_boost += 1

        avg_attack = 0.0
        if home_form and isinstance(home_form, dict):
            avg_attack += float(home_form.get("avgGoalsFor", 0.0))
        if away_form and isinstance(away_form, dict):
            avg_attack += float(away_form.get("avgGoalsFor", 0.0))

        if avg_attack >= 3.2:
            notes.append("Tendência de muitos golos (médias ofensivas altas nas últimas partidas)")
        elif avg_attack <= 2.0:
            notes.append("Tendência de poucos golos nos últimos jogos das equipas")

        if head_to_head and isinstance(head_to_head, dict):
            if int(head_to_head.get("homeWins", 0) or 0) >= 3:
                notes.append("Histórico recente favorável ao mandante no confronto direto")
                qualitative_boost += 1
            if float(head_to_head.get("avgGoalsTotal", 0.0) or 0.0) >= 3:
                notes.append("Confrontos diretos recentes com média superior a 3 golos")

        draw_rate = (
            float(home_form.get("drawRate", 0.0)) if isinstance(home_form, dict) else 0.0
        ) + (
            float(away_form.get("drawRate", 0.0)) if isinstance(away_form, dict) else 0.0
        )
        form_count = (1 if home_form else 0) + (1 if away_form else 0) or 1
        draw_rate /= form_count

        if (
            predictions["homeWinProbability"] == 0
            and predictions["awayWinProbability"] == 0
            and predictions["drawProbability"] == 0
            and (home_form or away_form)
        ):
            draw_probability = round(min(draw_rate, 0.45) * 100)

            home_score = 0.0
            away_score = 0.0
            if isinstance(home_form, dict):
                home_score += float(home_form.get("winRate", 0.0))
                home_score += max(float(home_form.get("goalDifferenceAvg", 0.0)), 0)
            if isinstance(away_form, dict):
                home_score += float(away_form.get("lossRate", 0.0)) * 0.6

            if isinstance(away_form, dict):
                away_score += float(away_form.get("winRate", 0.0))
                away_score += max(float(away_form.get("goalDifferenceAvg", 0.0)), 0)
            if isinstance(home_form, dict):
                away_score += float(home_form.get("lossRate", 0.0)) * 0.6

            total_score = home_score + away_score
            available = max(0, 100 - draw_probability)

            if total_score > 0:
                entry["predictions"]["homeWinProbability"] = round((home_score / total_score) * available)
                entry["predictions"]["awayWinProbability"] = max(
                    0,
                    available - entry["predictions"]["homeWinProbability"],
                )
            else:
                entry["predictions"]["homeWinProbability"] = round(available / 2)
                entry["predictions"]["awayWinProbability"] = available - entry["predictions"]["homeWinProbability"]

            entry["predictions"]["drawProbability"] = draw_probability

        entry["analysisNotes"] = notes[:3]
        confidence_score += qualitative_boost

        entry["recommendedBets"] = recommendations

        if confidence_score >= 5:
            entry["confidence"] = "high"
        elif confidence_score >= 3:
            entry["confidence"] = "medium"

        analyzed.append(entry)

    confidence_rank = {"high": 3, "medium": 2, "low": 1}

    def score(item: Dict[str, object]) -> int:
        return confidence_rank.get(item.get("confidence", "low"), 0) * 10 + len(item.get("recommendedBets", []))

    sorted_matches = sorted(analyzed, key=score, reverse=True)

    buckets: Dict[str, List[Dict[str, object]]] = {region: [] for region in index.region_order}
    for match in analyzed:
        region = match.get("competition", {}).get("region")
        if not isinstance(region, str):
            continue
        buckets.setdefault(region, []).append(match)

    breakdown = []
    for region in index.region_order:
        matches_for_region = buckets.get(region, [])
        breakdown.append(
            {
                "region": region,
                "label": index.region_label.get(region, region),
                "total": len(matches_for_region),
                "highConfidence": sum(1 for match in matches_for_region if match.get("confidence") == "high"),
                "mediumConfidence": sum(1 for match in matches_for_region if match.get("confidence") == "medium"),
            }
        )

    best_by_region = []
    for region in index.region_order:
        matches_for_region = buckets.get(region, [])
        ordered = sorted(matches_for_region, key=score, reverse=True)
        best_by_region.append(
            {
                "region": region,
                "label": index.region_label.get(region, region),
                "matches": ordered[:5],
            }
        )

    return {
        "totalAnalyzed": len(analyzed),
        "bestMatches": sorted_matches[:10],
        "highConfidenceCount": sum(1 for match in sorted_matches if match.get("confidence") == "high"),
        "mediumConfidenceCount": sum(1 for match in sorted_matches if match.get("confidence") == "medium"),
        "breakdownByRegion": breakdown,
        "bestMatchesByRegion": best_by_region,
    }
