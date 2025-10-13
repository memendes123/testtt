from __future__ import annotations

import logging
import re
import statistics
import unicodedata
from typing import Dict, List, Optional

from .competitions import CompetitionIndex


HOME_LABELS = {"home", "1", "home team", "team 1", "1 home"}
DRAW_LABELS = {"draw", "x", "empate"}
AWAY_LABELS = {"away", "2", "away team", "team 2", "2 away"}
YES_LABELS = {"yes", "sim", "y", "s"}
NO_LABELS = {"no", "nao", "n"}

MARKET_ALIASES = {
    "match_winner": {
        "match winner",
        "1x2",
        "full time result",
        "match result",
        "result",
        "win-draw-win",
    },
    "goals_over_under": {
        "goals over/under",
        "over/under",
        "goals",
        "goals o/u",
        "total goals",
    },
    "both_teams_score": {
        "both teams score",
        "both teams to score",
        "btts",
        "gg/ng",
        "goal goal",
    },
}


def _normalize_market_name(value: Optional[object]) -> str:
    normalized = _normalize_label(value)
    if not normalized:
        return ""
    for canonical, aliases in MARKET_ALIASES.items():
        if normalized in aliases:
            return canonical
    return normalized


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


def _normalize_odd_value(odd: Optional[object]) -> Optional[float]:
    if odd is None:
        return None

    if isinstance(odd, (int, float)):
        value = float(odd)
        return value if value > 0 else None

    text = str(odd).strip()
    if not text:
        return None

    text = text.lower()

    # Support fractional odds such as "3/2".
    if "/" in text:
        parts = text.split("/")
        if len(parts) == 2:
            try:
                numerator = float(parts[0].strip().replace(",", "."))
                denominator = float(parts[1].strip().replace(",", "."))
            except ValueError:
                return None
            if denominator > 0:
                decimal_value = 1 + (numerator / denominator)
                return decimal_value if decimal_value > 0 else None

    cleaned = text.replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    if not match:
        return None

    try:
        value = float(match.group(0))
    except ValueError:
        return None

    return value if value > 0 else None


def _calculate_probability(odd: Optional[object]) -> int:
    value = _normalize_odd_value(odd)
    if value is None or value <= 0:
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

        market_lookup: Dict[str, List[Dict[str, object]]] = {}
        for market in odds:
            if not isinstance(market, dict):
                continue
            name = _normalize_market_name(market.get("name"))
            if not name:
                continue
            if name not in market_lookup or not market_lookup[name]:
                values = market.get("values")
                if isinstance(values, list):
                    market_lookup[name] = values

        match_winner = market_lookup.get("match_winner", [])
        over_under = market_lookup.get("goals_over_under", [])
        btts = market_lookup.get("both_teams_score", [])

        forebet = match.get("forebet") if isinstance(match, dict) else None
        api_prediction = match.get("apiFootballPrediction") if isinstance(match, dict) else None
        forebet_used = False
        api_prediction_used = False

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

        if isinstance(forebet, dict):
            def _apply_forebet(source_key: str, target_key: str) -> None:
                nonlocal forebet_used
                value = forebet.get(source_key)
                if value is None:
                    return
                try:
                    number = int(round(float(value)))
                except (TypeError, ValueError):
                    return
                if predictions[target_key] == 0 and number > 0:
                    predictions[target_key] = max(0, min(100, number))
                    forebet_used = True

            _apply_forebet("homeWinProbability", "homeWinProbability")
            _apply_forebet("drawProbability", "drawProbability")
            _apply_forebet("awayWinProbability", "awayWinProbability")
            _apply_forebet("over25Probability", "over25Probability")
            _apply_forebet("under25Probability", "under25Probability")
            _apply_forebet("bttsYesProbability", "bttsYesProbability")
            _apply_forebet("bttsNoProbability", "bttsNoProbability")

        if isinstance(api_prediction, dict):
            def _apply_api_prediction(source_key: str, target_key: str) -> None:
                nonlocal api_prediction_used
                value = api_prediction.get(source_key)
                if value is None:
                    return
                try:
                    number = int(round(float(value)))
                except (TypeError, ValueError):
                    return
                if predictions[target_key] == 0 and number > 0:
                    predictions[target_key] = max(0, min(100, number))
                    api_prediction_used = True

            _apply_api_prediction("homeWinProbability", "homeWinProbability")
            _apply_api_prediction("drawProbability", "drawProbability")
            _apply_api_prediction("awayWinProbability", "awayWinProbability")

            predicted_goals = api_prediction.get("predictedGoals")
            if (
                isinstance(predicted_goals, dict)
                and predicted_goals.get("home") is not None
                and predicted_goals.get("away") is not None
            ):
                try:
                    total_goals = float(predicted_goals.get("home") or 0) + float(
                        predicted_goals.get("away") or 0
                    )
                except (TypeError, ValueError):
                    total_goals = 0.0

                if total_goals >= 3 and predictions["over25Probability"] == 0:
                    predictions["over25Probability"] = max(60, min(85, int(round(55 + (total_goals - 2.5) * 18))))
                elif total_goals <= 2 and predictions["under25Probability"] == 0:
                    predictions["under25Probability"] = max(60, min(85, int(round(58 + (2 - total_goals) * 18))))

            under_over_hint = api_prediction.get("underOver")
            normalized_hint = _normalize_label(under_over_hint)
            if normalized_hint:
                if _is_over_25_label(normalized_hint) and predictions["over25Probability"] == 0:
                    predictions["over25Probability"] = 62
                elif _is_under_25_label(normalized_hint) and predictions["under25Probability"] == 0:
                    predictions["under25Probability"] = 62

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

        avg_attack_samples = []
        if home_form and isinstance(home_form, dict):
            avg_attack_samples.append(float(home_form.get("avgGoalsFor", 0.0)))
        if away_form and isinstance(away_form, dict):
            avg_attack_samples.append(float(away_form.get("avgGoalsFor", 0.0)))

        if avg_attack_samples:
            avg_attack = statistics.mean(avg_attack_samples)
            if avg_attack >= 1.6:
                notes.append("Tendência de muitos golos (médias ofensivas altas nas últimas partidas)")
            elif avg_attack <= 1.0:
                notes.append("Tendência de poucos golos nos últimos jogos das equipas")

        if head_to_head and isinstance(head_to_head, dict):
            if int(head_to_head.get("homeWins", 0) or 0) >= 3:
                notes.append("Histórico recente favorável ao mandante no confronto direto")
                qualitative_boost += 1
            if float(head_to_head.get("avgGoalsTotal", 0.0) or 0.0) >= 3:
                notes.append("Confrontos diretos recentes com média superior a 3 golos")

        if forebet_used:
            notes.append("Probabilidades 1X2 complementadas com dados da Forebet")

        if api_prediction_used:
            notes.append("Probabilidades complementadas com previsões oficiais da API-FOOTBALL")


        def _form_strength(form: Optional[Dict[str, object]]) -> Optional[float]:
            if not isinstance(form, dict) or not form:
                return None

            win_rate = float(form.get("winRate", 0.0) or 0.0)
            draw_rate = float(form.get("drawRate", 0.0) or 0.0)
            loss_rate = float(form.get("lossRate", 0.0) or 0.0)
            goal_diff = float(form.get("goalDifferenceAvg", 0.0) or 0.0)
            avg_for = float(form.get("avgGoalsFor", 0.0) or 0.0)
            avg_against = float(form.get("avgGoalsAgainst", 0.0) or 0.0)
            form_points = float(form.get("formPoints", 0.0) or 0.0)
            sample_size = max(int(form.get("sampleSize", 0) or len(form.get("matches") or [])), 1)
            streak = form.get("currentStreak") if isinstance(form.get("currentStreak"), dict) else {}
            streak_bonus = 0.0
            if streak.get("type") == "win":
                streak_bonus = min(int(streak.get("count", 0) or 0), 5) * 0.08
            elif streak.get("type") == "loss":
                streak_bonus = -min(int(streak.get("count", 0) or 0), 5) * 0.08

            momentum = min(form_points / (sample_size * 3), 1.0)
            defence_quality = max(0.0, 3.0 - min(max(avg_against, 0.0), 3.0)) / 3.0
            attack_quality = min(max(avg_for, 0.0), 4.0) / 4.0

            rating = 1.0
            rating += win_rate * 1.8
            rating += (1.0 - loss_rate) * 0.6
            rating += draw_rate * 0.3
            rating += max(min(goal_diff, 3.5), -3.5) * 0.12
            rating += momentum * 0.4
            rating += attack_quality * 0.25
            rating += defence_quality * 0.2
            rating += streak_bonus

            return max(0.35, rating)

        def _estimate_draw_component(
            home_data: Optional[Dict[str, object]], away_data: Optional[Dict[str, object]]
        ) -> float:
            base = 0.9
            total_samples = 0
            draw_bias = 0.0
            for data in (home_data, away_data):
                if not isinstance(data, dict) or not data:
                    continue
                total_samples += 1
                draw_bias += float(data.get("drawRate", 0.0) or 0.0) * 1.2
                avg_total = float(data.get("avgGoalsTotal", 0.0) or 0.0)
                draw_bias += max(0.0, 2.2 - avg_total) * 0.2
            if total_samples:
                base += draw_bias / total_samples
            return max(0.5, min(base, 1.8))

        if (
            predictions["homeWinProbability"] == 0
            and predictions["awayWinProbability"] == 0
            and predictions["drawProbability"] == 0
        ):
            home_strength = _form_strength(home_form)
            away_strength = _form_strength(away_form)

            if home_strength is None and away_strength is None:
                predictions["homeWinProbability"] = 38
                predictions["drawProbability"] = 24
                predictions["awayWinProbability"] = 38
            else:
                home_strength = home_strength or 0.85
                away_strength = away_strength or 0.85
                draw_component = _estimate_draw_component(home_form, away_form)

                total = home_strength + away_strength + draw_component
                if total <= 0:
                    predictions["homeWinProbability"] = 38
                    predictions["drawProbability"] = 24
                    predictions["awayWinProbability"] = 38
                else:
                    home_pct = round((home_strength / total) * 100)
                    draw_pct = round((draw_component / total) * 100)
                    away_pct = max(0, 100 - home_pct - draw_pct)

                    predictions["homeWinProbability"] = max(0, min(100, home_pct))
                    predictions["drawProbability"] = max(0, min(100, draw_pct))
                    predictions["awayWinProbability"] = max(0, min(100, away_pct))

        goal_samples: List[float] = []
        for form in (home_form, away_form):
            if isinstance(form, dict) and form:
                goal_samples.append(float(form.get("avgGoalsTotal", 0.0) or 0.0))

        if (
            predictions["over25Probability"] == 0
            and predictions["under25Probability"] == 0
            and goal_samples
        ):
            avg_goals = statistics.mean(goal_samples)
            if avg_goals >= 3.2:
                over_prob = min(78, round(62 + (avg_goals - 3.2) * 12))
                under_prob = max(100 - over_prob, 18)
            elif avg_goals <= 1.8:
                under_prob = min(80, round(64 + (1.8 - avg_goals) * 18))
                over_prob = max(100 - under_prob, 18)
            else:
                tilt = (avg_goals - 2.5) * 18
                over_prob = max(40, min(60, round(52 + tilt)))
                under_prob = max(40, min(60, 100 - over_prob))

            predictions["over25Probability"] = over_prob
            predictions["under25Probability"] = max(0, min(100, under_prob))

        if (
            predictions["bttsYesProbability"] == 0
            and predictions["bttsNoProbability"] == 0
            and goal_samples
        ):
            total_matches = 0
            clean_sheets = 0
            failures = 0
            for form in (home_form, away_form):
                if not isinstance(form, dict) or not form:
                    continue
                sample = max(int(form.get("sampleSize", 0) or len(form.get("matches") or [])), 1)
                total_matches += sample
                clean_sheets += int(form.get("cleanSheets", 0) or 0)
                failures += int(form.get("failedToScore", 0) or 0)

            shutout_rate = clean_sheets / total_matches if total_matches else 0.0
            fail_rate = failures / total_matches if total_matches else 0.0
            avg_goals = statistics.mean(goal_samples)

            yes_score = (1 - shutout_rate) * 0.5 + (1 - fail_rate) * 0.3 + max(0.0, avg_goals - 2.3) * 0.25
            no_score = shutout_rate * 0.5 + fail_rate * 0.3 + max(0.0, 2.3 - avg_goals) * 0.25

            if yes_score >= no_score:
                yes_prob = max(35, min(80, round(yes_score * 100)))
                predictions["bttsYesProbability"] = yes_prob
                predictions["bttsNoProbability"] = max(0, min(100, 100 - yes_prob))
            else:
                no_prob = max(35, min(80, round(no_score * 100)))
                predictions["bttsNoProbability"] = no_prob
                predictions["bttsYesProbability"] = max(0, min(100, 100 - no_prob))

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
        predictions = item.get("predictions", {}) if isinstance(item, dict) else {}
        max_probability = max(
            int((predictions or {}).get("homeWinProbability", 0) or 0),
            int((predictions or {}).get("drawProbability", 0) or 0),
            int((predictions or {}).get("awayWinProbability", 0) or 0),
        )
        confidence_component = confidence_rank.get(item.get("confidence", "low"), 0) * 1000
        bet_component = len(item.get("recommendedBets", [])) * 10
        return confidence_component + bet_component + max_probability

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
                "matches": ordered,
                "topMatches": ordered[:5],
            }
        )

    return {
        "totalAnalyzed": len(analyzed),
        "bestMatches": sorted_matches[:10],
        "allMatches": sorted_matches,
        "highConfidenceCount": sum(1 for match in sorted_matches if match.get("confidence") == "high"),
        "mediumConfidenceCount": sum(1 for match in sorted_matches if match.get("confidence") == "medium"),
        "breakdownByRegion": breakdown,
        "bestMatchesByRegion": best_by_region,
    }
