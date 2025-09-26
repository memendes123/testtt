from __future__ import annotations

import logging
from typing import Dict, List, Optional

from .competitions import CompetitionIndex


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
            label = value.get("value")
            odd = value.get("odd")
            if label == "Home":
                predictions["homeWinProbability"] = _calculate_probability(odd)
            elif label == "Draw":
                predictions["drawProbability"] = _calculate_probability(odd)
            elif label == "Away":
                predictions["awayWinProbability"] = _calculate_probability(odd)

        for value in over_under:
            label = value.get("value")
            odd = value.get("odd")
            if label == "Over 2.5":
                predictions["over25Probability"] = _calculate_probability(odd)
            elif label == "Under 2.5":
                predictions["under25Probability"] = _calculate_probability(odd)

        for value in btts:
            label = value.get("value")
            odd = value.get("odd")
            if label == "Yes":
                predictions["bttsYesProbability"] = _calculate_probability(odd)
            elif label == "No":
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
