import logging
from datetime import datetime

import python_bot.forebet as forebet


def test_parse_forebet_html_without_bs4(monkeypatch):
    monkeypatch.setattr(forebet, "BeautifulSoup", None)

    client = forebet.ForebetClient(logger=logging.getLogger("test"))

    html = """
    <table>
        <tr>
            <td>55%</td>
            <td>25%</td>
            <td>20%</td>
            <td>62%</td>
            <td>38%</td>
            <td>68%</td>
            <td>32%</td>
            <td class="tnms">São Paulo FC</td>
            <td class="tnms2">Atlético-MG</td>
        </tr>
    </table>
    """

    results = client._parse_match_table(html)  # pylint: disable=protected-access
    key = forebet._build_key("São Paulo FC", "Atlético-MG")  # pylint: disable=protected-access

    assert key in results
    entry = results[key]
    assert entry.home == 55
    assert entry.draw == 25
    assert entry.away == 20
    assert entry.over25 == 62
    assert entry.under25 == 38
    assert entry.btts_yes == 68
    assert entry.btts_no == 32


def test_get_probabilities_reverse_lookup(monkeypatch):
    client = forebet.ForebetClient(logger=logging.getLogger("test"))

    reverse_key = forebet._build_key("Atlético-MG", "São Paulo FC")  # pylint: disable=protected-access
    sample = forebet.ForebetProbabilities(
        home=30,
        draw=30,
        away=40,
        over25=64,
        under25=36,
        btts_yes=59,
        btts_no=41,
    )

    monkeypatch.setattr(client, "_load_predictions", lambda _: {reverse_key: sample})

    result = client.get_probabilities(datetime(2024, 9, 18), "São Paulo FC", "Atlético-MG")

    assert result is not None
    assert result.home == sample.away
    assert result.away == sample.home
    assert result.over25 == sample.over25
    assert result.btts_yes == sample.btts_yes
