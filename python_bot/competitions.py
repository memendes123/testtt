from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import unicodedata
from typing import Dict, List, Optional


@dataclass
class Competition:
    key: str
    display_name: str
    region: str
    type: str
    country: str
    aliases: List[str]
    api_football_ids: List[int]


@dataclass
class CompetitionIndex:
    competitions: List[Competition]
    region_order: List[str]
    region_label: Dict[str, str]

    _aliases: List[tuple[set[str], Competition]]
    _ids: Dict[int, Competition]

    @staticmethod
    def normalize(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = unicodedata.normalize("NFD", value)
        normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
        normalized = " ".join(filter(None, [segment.strip() for segment in normalized.split()]))
        return normalized.lower()

    @classmethod
    def from_json(cls, path: Path) -> "CompetitionIndex":
        payload = json.loads(path.read_text())
        competitions: List[Competition] = []
        alias_index: List[tuple[set[str], Competition]] = []
        id_index: Dict[int, Competition] = {}

        for item in payload["competitions"]:
            competition = Competition(
                key=item["key"],
                display_name=item["displayName"],
                region=item["region"],
                type=item["type"],
                country=item["country"],
                aliases=item.get("aliases", []),
                api_football_ids=item.get("apiFootballIds", []),
            )
            competitions.append(competition)

            names: List[str] = [competition.display_name, competition.country, f"{competition.country} {competition.display_name}"]
            for alias in competition.aliases:
                names.append(alias)
                names.append(f"{competition.country} {alias}")

            normalized_aliases = {alias for alias in (cls.normalize(name) for name in names) if alias}
            alias_index.append((normalized_aliases, competition))

            for identifier in competition.api_football_ids:
                id_index[identifier] = competition

        return cls(
            competitions=competitions,
            region_order=payload["regionOrder"],
            region_label=payload["regionLabel"],
            _aliases=alias_index,
            _ids=id_index,
        )

    def identify(self, league: Optional[Dict[str, object]]) -> Optional[Competition]:
        if not league:
            return None

        identifier = league.get("id")
        if isinstance(identifier, int) and identifier in self._ids:
            return self._ids[identifier]

        name = self.normalize(league.get("name") if isinstance(league.get("name"), str) else None)
        country = self.normalize(league.get("country") if isinstance(league.get("country"), str) else None)

        if not name:
            return None

        for aliases, competition in self._aliases:
            if name in aliases:
                return competition
            if country and f"{country} {name}" in aliases:
                return competition

        return None

    def is_supported(self, league: Optional[Dict[str, object]]) -> bool:
        return self.identify(league) is not None


@lru_cache(maxsize=1)
def load_index(base_path: Optional[Path] = None) -> CompetitionIndex:
    if base_path is None:
        base_path = Path(__file__).resolve().parent.parent / "shared"
    data_path = base_path / "competitions.json"
    return CompetitionIndex.from_json(data_path)
