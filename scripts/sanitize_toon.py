#!/usr/bin/env python3
"""
Sanitize a .toon file by replacing escaped quotes (\") inside quoted fields
with an apostrophe (') — since \" represents inches (e.g. 10" → 10').

This fixes 21 corrupted product entries where the \" inside quoted fields
broke the toon parser, causing all remaining CSV columns to be merged into
the product name.

Usage:
    python scripts/sanitize_toon.py                           # uses default paths
    python scripts/sanitize_toon.py input.toon -o output.toon # custom paths
"""

import re
import sys
from pathlib import Path


def sanitize_toon(text: str) -> tuple[str, int]:
    """
    Process each line of a .toon file.
    For quoted fields containing \", replace \" with ' (inch mark).
    Returns (sanitized_text, count_of_fixed_lines).
    """
    lines = text.split("\n")
    fixed_count = 0
    result = []

    for line in lines:
        # Only process data lines that contain \"
        if '\\"' not in line:
            result.append(line)
            continue

        # Strategy: find quoted fields (text between unescaped quotes),
        # replace \" with ' inside them, then remove the wrapping quotes
        # if no commas remain inside the field value.
        sanitized = _fix_quoted_fields(line)
        if sanitized != line:
            fixed_count += 1
        result.append(sanitized)

    return "\n".join(result), fixed_count


def _fix_quoted_fields(line: str) -> str:
    """
    Find quoted fields in a toon line and replace \" with ' inside them.
    Then unwrap the quotes if the field no longer needs quoting (no commas).
    """
    # Match quoted fields: "..." where the content may have \"
    # Pattern: comma or start, then "...", then comma or end
    def replace_match(m: re.Match) -> str:
        inner = m.group(1)
        # Replace \" with ' (inch symbol)
        fixed = inner.replace('\\"', "'")
        # If the fixed content still has commas, keep it quoted
        if "," in fixed:
            return f'"{fixed}"'
        # Otherwise unwrap quotes
        return fixed

    # Match "..." fields, allowing \" escapes inside
    return re.sub(r'"((?:[^"\\]|\\.)*)"', replace_match, line)


def main():
    default_input = Path(__file__).resolve().parent.parent / "item.2026-03-02 (1).toon"
    toon_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_input

    if "-o" in sys.argv:
        out_path = Path(sys.argv[sys.argv.index("-o") + 1])
    else:
        out_path = toon_path.with_name("item.sanitized.toon")

    if not toon_path.exists():
        print(f"Error: file not found: {toon_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading: {toon_path}")
    text = toon_path.read_text(encoding="utf-8")

    sanitized, fixed_count = sanitize_toon(text)

    out_path.write_text(sanitized, encoding="utf-8")
    print(f"Fixed {fixed_count} lines with escaped quotes")
    print(f"Output: {out_path}")


if __name__ == "__main__":
    main()
