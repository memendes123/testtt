from __future__ import annotations

from python_bot.owner_command import build_response_message, extract_command


def test_extract_command_variants():
    assert extract_command("/insight Benfica vs Porto") == ("/insight", "Benfica vs Porto")
    assert extract_command("/analise@bot something") == ("/analise", "something")
    assert extract_command("/unknown cmd") is None
    assert extract_command("text without slash") is None


def test_build_response_message_includes_sections():
    match = {
        "teams": {"home": {"name": "Benfica"}, "away": {"name": "Porto"}},
        "competition": {"name": "Primeira Liga", "region": "Portugal"},
        "date": "2025-10-14",
        "time": "20:00",
    }
    analysis = {
        "predictions": {
            "homeWinProbability": 55,
            "drawProbability": 25,
            "awayWinProbability": 20,
            "over25Probability": 60,
            "under25Probability": 40,
            "bttsYesProbability": 58,
            "bttsNoProbability": 42,
        },
        "recommendedBets": ["Casa -1.0"],
        "analysisNotes": ["Equipa em boa forma"],
        "confidence": "high",
    }
    summary = "Resumo produzido pelo GPT"

    message = build_response_message(match, analysis, summary)

    for fragment in (
        "Benfica vs Porto",
        "Primeira Liga",
        "Casa: 55%",
        "Over 2.5",
        "Sugestões do modelo",
        "Resumo GPT",
    ):
        assert fragment in message
