from python_bot.message_builder import format_predictions_message


def test_message_includes_llm_insights_when_no_top_matches():
    match = {
        "teams": {"home": {"name": "Team A"}, "away": {"name": "Team B"}},
        "competition": {"name": "Primeira Liga"},
        "time": "18:00",
        "recommendedBets": [],
        "analysisNotes": [],
        "predictions": {
            "homeWinProbability": 40,
            "drawProbability": 30,
            "awayWinProbability": 30,
        },
    }

    match_data = {"date": "2025-10-10", "totalMatches": 1, "matches": [match]}
    analysis = {
        "totalAnalyzed": 1,
        "bestMatches": [],
        "allMatches": [match],
        "highConfidenceCount": 0,
        "mediumConfidenceCount": 0,
        "breakdownByRegion": [],
        "bestMatchesByRegion": [],
    }

    llm_insights = [{"match": match, "summary": "Equilíbrio esperado, tendência para poucos golos."}]

    message = format_predictions_message(match_data, analysis, llm_insights=llm_insights)

    assert "🤖 <b>Insights gerados pelo ChatGPT para jogos equilibrados</b>" in message
    assert "Team A vs Team B" in message
    assert "Equilíbrio esperado" in message
    assert "Não há jogos com odds interessantes" not in message


def test_message_appends_llm_insights_alongside_top_matches():
    base_match = {
        "teams": {"home": {"name": "Alpha"}, "away": {"name": "Beta"}},
        "competition": {"name": "Taça"},
        "time": "20:00",
        "recommendedBets": ["✅ Favorito: Alpha (60%)"],
        "analysisNotes": ["Boa fase recente"],
        "predictions": {
            "homeWinProbability": 60,
            "drawProbability": 25,
            "awayWinProbability": 15,
        },
        "confidence": "low",
    }

    match_data = {"date": "2025-10-11", "totalMatches": 1, "matches": [base_match]}
    analysis = {
        "totalAnalyzed": 1,
        "bestMatches": [base_match],
        "allMatches": [base_match],
        "highConfidenceCount": 0,
        "mediumConfidenceCount": 0,
        "breakdownByRegion": [],
        "bestMatchesByRegion": [],
    }

    llm_insights = [{"match": base_match, "summary": "Alpha chega em boa forma ofensiva."}]

    message = format_predictions_message(match_data, analysis, llm_insights=llm_insights)

    assert "🔥 <b>TOP GLOBAL (1)</b>" in message
    assert "Alpha vs Beta" in message
    assert "Alpha chega em boa forma ofensiva" in message


def test_summary_falls_back_to_match_list_counts():
    match = {
        "teams": {"home": {"name": "Casa"}, "away": {"name": "Fora"}},
        "competition": {"name": "Liga"},
    }

    match_data = {"date": "2025-10-12", "totalMatches": 0, "matches": [match, match]}
    analysis = {
        "totalAnalyzed": 0,
        "bestMatches": [],
        "allMatches": [
            {**match, "confidence": "low"},
            {**match, "confidence": "high"},
        ],
        "highConfidenceCount": 0,
        "mediumConfidenceCount": 0,
        "breakdownByRegion": [],
        "bestMatchesByRegion": [],
    }

    message = format_predictions_message(match_data, analysis)

    assert "• 2 jogos elegíveis nas competições suportadas" in message
    assert "• 2 jogos com odds válidas analisados" in message
    assert "• 1 jogos de alta confiança | 0 de média confiança" in message


def test_best_matches_fallbacks_to_all_matches_when_missing():
    match = {
        "teams": {"home": {"name": "Clube A"}, "away": {"name": "Clube B"}},
        "competition": {"name": "Taça"},
        "time": "15:00",
        "confidence": "low",
        "recommendedBets": ["Sem sugestões"],
        "predictions": {"homeWinProbability": 40, "drawProbability": 30, "awayWinProbability": 30},
    }

    match_data = {"date": "2025-10-13", "matches": [match]}
    analysis = {
        "totalAnalyzed": 1,
        "bestMatches": [],
        "allMatches": [match],
        "highConfidenceCount": 0,
        "mediumConfidenceCount": 0,
        "breakdownByRegion": [],
        "bestMatchesByRegion": [],
    }

    message = format_predictions_message(match_data, analysis)

    assert "🔥 <b>TOP GLOBAL (1)</b>" in message
    assert "Clube A vs Clube B" in message
