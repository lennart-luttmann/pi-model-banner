#!/usr/bin/env python3
"""Validate the generated logo art in content/ansi/.

Checks that every family listed in content/families.ts has an art file, that each file
fits the fixed cell grid (so a header line can never wrap), and that the files
contain actual ANSI escapes rather than plain text.

The grid is the same for every family on purpose: the header must not change size
when the model changes, so a file that grows past --cols cells on a line or
--rows lines is a failure, not something to render around.

Usage:
    check-logos.py [--cols 20] [--rows 10] [ansi-dir]
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# Block-drawing characters (U+2580..U+259F). The art is Braille dot art now;
# a block character in an art file means an old renderer slipped back in.
BLOCKS = re.compile(r"[\u2580-\u259f]")
FAMILIES = re.compile(r"export const FAMILIES = \[(.*?)\] as const;", re.DOTALL)


def shipped_families(root: pathlib.Path) -> list[str]:
    source = (root / "content" / "families.ts").read_text(encoding="utf-8")
    match = FAMILIES.search(source)
    if not match:
        raise SystemExit("error: could not read FAMILIES from content/families.ts")
    return re.findall(r'"([a-z0-9-]+)"', match.group(1))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    _ = parser.add_argument("directory", nargs="?", default=None, help="ansi directory")
    _ = parser.add_argument("--cols", type=int, default=20)
    _ = parser.add_argument("--rows", type=int, default=10)
    args = parser.parse_args(argv)

    root = pathlib.Path(__file__).resolve().parent.parent
    directory = (
        pathlib.Path(args.directory) if args.directory else root / "content" / "ansi"
    )

    problems: list[str] = []
    for family in shipped_families(root):
        path = directory / f"{family}.ansi"
        if not path.is_file():
            problems.append(f"{path.name}: missing")
            continue

        raw = path.read_text(encoding="utf-8")
        lines = raw.rstrip("\n").split("\n") if raw.strip() else []
        if not lines:
            problems.append(f"{path.name}: empty")
            continue
        if len(lines) > args.rows:
            problems.append(f"{path.name}: {len(lines)} lines > {args.rows}")
        if "\x1b[" not in raw:
            problems.append(f"{path.name}: no ANSI escapes (art must be coloured)")
        blocks = BLOCKS.findall(raw)
        if blocks:
            problems.append(
                f"{path.name}: {len(blocks)} block characters (use Braille U+2800..U+28FF)"
            )
        if "\u2800" in raw:
            problems.append(f"{path.name}: blank Braille U+2800 (use a space)")
        for number, line in enumerate(lines, start=1):
            width = len(ANSI.sub("", line))
            if width > args.cols:
                # Fixed grid: widening the art would push the header out of shape
                # (or wrap it) instead of shrinking it, so this fails the build.
                problems.append(f"{path.name}:{number}: {width} cells > {args.cols}")
        print(
            f"  ok {path.name:<18} {len(lines)} lines, widest {max(len(ANSI.sub('', l)) for l in lines)} cells"
        )

    if problems:
        print("\nlogo check failed:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    print(
        f"logo check passed ({len(shipped_families(root))} families, max {args.cols}x{args.rows} cells)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
