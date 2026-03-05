#!/usr/bin/env python3
"""
Extract POS item data from an exported HTML table and write a .toon CSV file.

The .toon format is a plain-text CSV with a descriptive header line:
    items[COUNT,]{category,name,code,price,cost,supplier,unit}:
    category,name,code,price,cost,supplier,unit
    ...

Usage:
    python scripts/extract_items.py
    python scripts/extract_items.py path/to/file.html
    python scripts/extract_items.py path/to/file.html -o output.toon
"""

import re
import sys
import random
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Column CSS classes → JSON field names (in table order)
COLUMNS = [
    ("itm_cat", "category"),
    ("itm_name", "name"),
    ("itm_code", "code"),
    ("itm_type", "type"),
    ("itm_unit", "unit"),
    ("itm_cur", "currency"),
    ("itm_price", "price"),
    ("itm_cost", "cost"),
    ("itm_image", "image"),
    ("itm_descr", "description"),
    ("itm_sup", "supplier"),
    ("itm_highlight", "highlight"),
    ("itm_pAco", "purchase_account"),
    ("itm_sAco", "sale_account"),
]

FIELD_NAMES = [f for _, f in COLUMNS]

# Only these fields are included in the output JSON
OUTPUT_FIELDS = ["category", "name", "code", "price", "cost", "supplier", "unit"]


class ItemTableParser(HTMLParser):
    """Streaming HTML parser that extracts rows from the POS items table."""

    def __init__(self):
        super().__init__()
        self.items: List[Dict] = []
        self._seen_codes = set()
        self._in_tbody = False
        self._in_row = False
        self._in_cell = False
        self._skip_header = True
        self._cells: list[str] = []
        self._cell_text = ""
        # Track <x> tags (currency labels like <x>usd</x>) to skip them
        self._in_x_tag = False

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]):
        tag = tag.lower()
        if tag == "tbody":
            self._in_tbody = True
        elif tag == "tr" and self._in_tbody:
            self._in_row = True
            self._cells = []
        elif tag == "td" and self._in_row:
            self._in_cell = True
            self._cell_text = ""
        elif tag == "x":
            self._in_x_tag = True

    def handle_endtag(self, tag: str):
        tag = tag.lower()
        if tag == "tbody":
            self._in_tbody = False
        elif tag == "tr" and self._in_row:
            self._in_row = False
            if self._cells:
                self._emit_row()
        elif tag == "td" and self._in_cell:
            self._in_cell = False
            self._cells.append(self._cell_text.strip())
        elif tag == "x":
            self._in_x_tag = False

    def handle_data(self, data: str):
        if self._in_cell and not self._in_x_tag:
            self._cell_text += data

    def _emit_row(self):
        # Pad or truncate to expected column count
        row = self._cells[: len(FIELD_NAMES)]
        while len(row) < len(FIELD_NAMES):
            row.append("")

        # Normalize whitespace (HTML has newlines + indentation in multi-line cells)
        row = [re.sub(r"\s+", " ", v).strip() for v in row]

        item: Dict = {}
        for field, value in zip(FIELD_NAMES, row):
            value = value.strip()

            if field in ("price", "cost"):
                # Parse numeric value, stripping currency text
                num = parse_number(value)
                item[field] = num
            elif field == "unit":
                unit_num = parse_number(value)
                if unit_num is None:
                    item[field] = 0
                elif float(unit_num).is_integer():
                    item[field] = int(unit_num)
                else:
                    item[field] = unit_num
            elif field == "highlight":
                item[field] = value.upper() == "YES"
            else:
                item[field] = value if value else None

        # Skip the placeholder "_undefined" row
        if item.get("name") == "_undefined":
            return

        # Normalize code: remove all spaces; generate code when missing
        code_value = item.get("code")
        if isinstance(code_value, str):
            code_value = code_value.replace(" ", "")
        if not code_value:
            code_value = self._generate_random_code()
        code_text = str(code_value)
        self._seen_codes.add(code_text)
        item["code"] = int(code_text) if code_text.isdigit() else code_text

        # Keep only the desired output fields
        self.items.append({k: item[k] for k in OUTPUT_FIELDS})

    def _generate_random_code(self) -> str:
        while True:
            generated = str(random.randint(10**11, 10**12 - 1))
            if generated not in self._seen_codes:
                return generated


def parse_number(text: str) -> Optional[float]:
    """Extract a numeric value from text like '9.5' or '3,500.00'."""
    if not text:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_items(html_path: "str | Path") -> List[Dict]:
    """Parse the HTML file and return a list of item dicts."""
    path = Path(html_path)
    html = path.read_text(encoding="utf-8", errors="replace")
    parser = ItemTableParser()
    parser.feed(html)
    return parser.items


def encode_toon(items: List[Dict]) -> str:
    """
    Encode items list as a plain-text .toon CSV file.

    Format:
        items[COUNT,]{category,name,code,price,cost,supplier,unit}:
        category,name,code,price,cost,supplier,unit
        ...

    Values are comma-separated. If a value contains commas, it is wrapped
    in double quotes. Any literal double-quote characters inside the value
    (e.g. inch marks like 10") are escaped as \\" before wrapping.
    """
    def escape(value) -> str:
        if value is None:
            return ""
        s = str(value)
        has_quote = '"' in s
        # Escape literal double-quote characters (e.g. inch marks)
        s = s.replace('"', '\\"')
        # Wrap in quotes if the value contains commas or had quote chars
        if "," in s or has_quote:
            return f'"{s}"'
        return s

    lines: List[str] = []
    lines.append(f"items[{len(items)},]{{category,name,code,price,cost,supplier,unit}}:")
    for item in items:
        row = [
            escape(item.get("category", "")),
            escape(item.get("name", "")),
            escape(item.get("code", "")),
            escape(item.get("price", "")),
            escape(item.get("cost", "")),
            escape(item.get("supplier", "")),
            escape(item.get("unit", "")),
        ]
        lines.append(",".join(row))
    return "\n".join(lines) + "\n"


def main():
    # Defaults — look for any .html file in workspace root
    default_input = Path(__file__).resolve().parent.parent / "item.2026-03-02 (1).html"
    html_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_input

    # Output path: -o flag or same name with .toon extension
    if "-o" in sys.argv:
        out_path = Path(sys.argv[sys.argv.index("-o") + 1])
    else:
        out_path = html_path.with_suffix(".toon")

    if not html_path.exists():
        print(f"Error: file not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading: {html_path}")
    items = extract_items(html_path)

    toon_output = encode_toon(items)
    out_path.write_text(toon_output, encoding="utf-8")
    print(f"Extracted {len(items)} items → {out_path}")


if __name__ == "__main__":
    main()
