#!/usr/bin/env python3
"""Preview generated Braille logo art as text, without a terminal that can draw it.

Each ANSI cell holds one Braille pattern character, i.e. a 2x4 dot sub-grid, so a
`cols x rows` art file decodes to a `2*cols x 4*rows` dot grid. Two views per file:

  dots     one character per dot: `#` lit, `.` empty — the actual shape
  colour   one letter per dot, keyed to the palette used in that file

Handy when tuning `icons/*.svg` or the renderer: you can see the silhouette, the
dithered fringe, and which flat colour lands where without squinting at a
20-column terminal.

Usage:
    preview-logos.py [content/ansi/*.ansi ...]     # default: every file in content/ansi/
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ESCAPE = re.compile(r"\x1b\[([0-9;]*)m")

# Braille bit per dot, indexed [dot_row][dot_col].
DOT_BITS = (
    (0x01, 0x08),
    (0x02, 0x10),
    (0x04, 0x20),
    (0x40, 0x80),
)

# xterm-256 cube, for `--colors 256` art.
STEPS = (0, 95, 135, 175, 215, 255)


def cube_color(index: int) -> tuple[int, int, int]:
    if index < 16:
        return (128, 128, 128)
    if index >= 232:
        level = 8 + (index - 232) * 10
        return (level, level, level)
    value = index - 16
    return (STEPS[value // 36], STEPS[(value // 6) % 6], STEPS[value % 6])


def parse_line(line: str) -> list[tuple[str, tuple[int, int, int] | None]]:
    """Return [(glyph, fg), ...] for one rendered line."""
    cells: list[tuple[str, tuple[int, int, int] | None]] = []
    fg: tuple[int, int, int] | None = None
    position = 0
    while position < len(line):
        match = ESCAPE.match(line, position)
        if match:
            codes = [code for code in match.group(1).split(";") if code]
            if codes[:2] == ["38", "2"] and len(codes) >= 5:
                fg = (int(codes[2]), int(codes[3]), int(codes[4]))
            elif codes[:2] == ["38", "5"] and len(codes) >= 3:
                fg = cube_color(int(codes[2]))
            elif codes and codes[0] in ("0", "39"):
                fg = None
            position = match.end()
            continue
        cells.append((line[position], fg))
        position += 1
    return cells


def decode(cells: list[tuple[str, tuple[int, int, int] | None]]) -> tuple[
    list[list[bool]], list[list[tuple[int, int, int] | None]]
]:
    """Turn one line of cells into a 4-tall x 2*len dot grid."""
    rows: list[list[bool]] = [[False] * (len(cells) * 2) for _ in range(4)]
    colors: list[list[tuple[int, int, int] | None]] = [[None] * (len(cells) * 2) for _ in range(4)]

    for cell_x, (glyph, fg) in enumerate(cells):
        code = ord(glyph)
        mask = (code - 0x2800) if 0x2800 <= code <= 0x28FF else 0
        for dot_y in range(4):
            for dot_x in range(2):
                bit = DOT_BITS[dot_y][dot_x]
                x = cell_x * 2 + dot_x
                if mask & bit:
                    rows[dot_y][x] = True
                    colors[dot_y][x] = fg
    return rows, colors


def preview(path: pathlib.Path) -> None:
    lines = path.read_text(encoding="utf-8").rstrip("\n").split("\n")
    parsed = [parse_line(line) for line in lines]
    decoded = [decode(cells) for cells in parsed]

    colors: dict[tuple[int, int, int], str] = {}
    alphabet = "abcdefghijklmnopqrstuvwxyz"

    def letter(color: tuple[int, int, int] | None) -> str:
        if color is None:
            return " "
        if color not in colors:
            colors[color] = alphabet[len(colors) % len(alphabet)]
        return colors[color]

    width = max((len(cells) for cells in parsed), default=0)
    print(f"== {path.name}  ({len(lines)} rows x {width} cells = {width * 2}x{len(lines) * 4} dots)")

    dot = 0
    print("   dots:")
    for mask_rows, _ in decoded:
        for row in mask_rows:
            print(f"     {dot:>2} |" + "".join("#" if dot else "." for dot in row).rstrip(".") + "|")
            dot += 1

    print("   colour:")
    dot = 0
    for _, color_rows in decoded:
        for row in color_rows:
            print(f"     {dot:>2} |" + "".join(letter(color) for color in row).rstrip() + "|")
            dot += 1

    legend = ", ".join(f"{letter(color)}={('#%02x%02x%02x' % color)}" for color in colors)
    print(f"   palette: {legend}\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="art files (default: content/ansi/*.ansi)")
    args = parser.parse_args(argv)

    root = pathlib.Path(__file__).resolve().parent.parent
    files = [pathlib.Path(name) for name in args.files] or sorted(
        (root / "content" / "ansi").glob("*.ansi")
    )
    if not files:
        print("no art files found", file=sys.stderr)
        return 1

    for path in files:
        preview(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
