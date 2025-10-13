import pytest
import requests

from python_bot import fetcher
from python_bot.fetcher import FetchError, _request_with_retry


class DummyResponse:
    def __init__(self, status_code, headers=None, text="", json_data=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text
        self._json_data = json_data if json_data is not None else {}

    def json(self):
        return self._json_data


def test_request_with_retry_recovers_from_network_error(monkeypatch):
    attempts = {"count": 0}

    def fake_get(url, params=None, headers=None, timeout=None):  # noqa: D401 - assinatura compatível
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise requests.ConnectionError("boom")
        return DummyResponse(200, json_data={"ok": True})

    monkeypatch.setattr(fetcher.requests, "get", fake_get)
    monkeypatch.setattr(fetcher.time, "sleep", lambda *_: None)

    response = _request_with_retry("https://example.com", max_retries=2)
    assert response.status_code == 200
    assert attempts["count"] == 2


def test_request_with_retry_raises_on_auth_failure(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return DummyResponse(401, text="Forbidden")

    monkeypatch.setattr(fetcher.requests, "get", fake_get)
    monkeypatch.setattr(fetcher.time, "sleep", lambda *_: None)

    with pytest.raises(FetchError):
        _request_with_retry("https://example.com", max_retries=1)
