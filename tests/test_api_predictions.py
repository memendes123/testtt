import math

from python_bot.fetcher import _normalize_api_football_prediction


def test_normalize_api_football_prediction_basic():
    payload = {
        "prediction": {
            "percent": {"home": "65%", "draw": "20%", "away": "15%"},
            "advice": "Combo chance",
            "under_over": "Over 2.5",
            "win_or_draw": True,
            "goals": {"home": "2.1", "away": "0.9"},
            "winner": {"id": 1, "name": "Home", "comment": "home"},
        },
        "comparison": {
            "form": {"home": "55%", "away": "45%"},
            "att": {"home": "60%", "away": "40%"},
        },
    }

    normalized = _normalize_api_football_prediction(payload)
    assert normalized is not None
    assert normalized["homeWinProbability"] == 65
    assert normalized["drawProbability"] == 20
    assert normalized["awayWinProbability"] == 15
    assert math.isclose(normalized["predictedGoals"]["home"], 2.1, rel_tol=1e-6)
    assert math.isclose(normalized["predictedGoals"]["away"], 0.9, rel_tol=1e-6)
    assert normalized["comparison"]["form"]["home"] == 55
    assert normalized["comparison"]["att"]["away"] == 40
    assert normalized["winner"]["name"] == "Home"
    assert normalized["source"] == "API-FOOTBALL"


def test_normalize_api_football_prediction_handles_missing():
    assert _normalize_api_football_prediction(None) is None
    assert _normalize_api_football_prediction({}) is None

    payload = {"prediction": {"percent": {"home": "", "draw": None, "away": "125"}}}
    normalized = _normalize_api_football_prediction(payload)
    assert normalized is not None
    assert normalized["homeWinProbability"] is None
    assert normalized["drawProbability"] is None
    assert normalized["awayWinProbability"] == 100
