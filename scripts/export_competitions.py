"""Export competition metadata from the TypeScript source into JSON.

This helper mirrors the inline script used during the conversion so the
shared competition catalogue can be regenerated without the Mastra build
toolchain.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TS_FILE = ROOT / "src/mastra/constants/competitions.ts"
OUTPUT = ROOT / "shared/competitions.json"


def extract_competitions() -> dict:
    source = TS_FILE.read_text(encoding="utf-8")

    def extract(pattern: str) -> str:
        match = re.search(pattern, source, re.S)
        if not match:
            raise RuntimeError(f"Pattern not found: {pattern}")
        return match.group(1)

    competitions_raw = extract(r"SUPPORTED_COMPETITIONS: CompetitionMetadata\[] = \[(.*?)]\s*;")
    competitions_text = "[" + competitions_raw + "]"
    competitions_text = re.sub(r"//.*", "", competitions_text)
    competitions_text = re.sub(r"(\s*)([A-Za-z0-9_]+):", lambda match: f"{match.group(1)}\"{match.group(2)}\":", competitions_text)
    competitions_text = re.sub(r",(\s*[}\]])", r"\1", competitions_text)
    competitions = json.loads(competitions_text)

    region_order_raw = extract(r"export const REGION_ORDER: CompetitionRegion\[] = \[(.*?)]\s*;")
    region_order_text = "[" + region_order_raw + "]"
    region_order_text = re.sub(r"//.*", "", region_order_text)
    region_order_text = re.sub(r",(\s*[}\]])", r"\1", region_order_text)
    region_order = json.loads(region_order_text)

    region_label_raw = extract(r"export const REGION_LABEL: Record<CompetitionRegion, string> = \{(.*?)\}\s*;")
    region_label_text = "{" + region_label_raw + "}"
    region_label_text = re.sub(r"//.*", "", region_label_text)
    region_label_text = re.sub(r"(\s*)([A-Za-z0-9_]+):", lambda match: f"{match.group(1)}\"{match.group(2)}\":", region_label_text)
    region_label_text = re.sub(r",(\s*[}\]])", r"\1", region_label_text)
    region_label = json.loads(region_label_text)

    return {
        "competitions": competitions,
        "regionOrder": region_order,
        "regionLabel": region_label,
    }


def main() -> None:
    data = extract_competitions()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(data['competitions'])} competitions to {OUTPUT}")


if __name__ == "__main__":
    main()
