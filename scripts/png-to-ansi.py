#!/usr/bin/env python3
"""Render a PNG (with alpha) as Braille dot art on a fixed cell grid.

Each terminal cell becomes one Braille pattern character (U+2800..U+28FF), which
is a 2 dot wide x 4 dot tall sub-grid. Dots are tiny and have gaps between them,
so strokes read as strokes and curves as curves instead of turning into a
staircase of solid cells.

Geometry. A terminal cell is roughly twice as tall as it is wide, so a Braille
dot is square: (cell_w/2) x (cell_h/4) = cell_w/2 x cell_w/2. A `cols x rows`
cell grid is therefore a `2*cols x 4*rows` **square** dot grid (40x40 dots for the
default 20x10 cells), and the square SVG is rasterised straight onto it.

Pipeline:

1. The source is rasterised at `dots * supersample` pixels (160x160 for 40x40
   dots at S=4), so every dot owns an `S x S` block of subpixels.
2. **Area sampling only.** A dot's colour is the alpha-weighted mean RGB of its
   block; its coverage is the mean alpha of the block in `fill` mode and the
   mean of the contour band in `edge` mode (see below). No LANCZOS, no
   interpolation, no blur.
3. **Ordered dithering.** A dot is lit when `coverage > bayer(x, y)` with a Bayer
   8x8 matrix normalised to 0..1, so antialiased edges dissolve into a dithered
   fringe instead of a hard staircase. `--coverage-floor` drops the faintest
   coverage and `--coverage-gain` lifts the rest, because a diagonal stroke never
   covers a whole dot. After that, any dot with no lit neighbour at all is
   dropped: a corner sliver of the mark can clear the floor on a single dot that
   belongs to no contour, and it would just speckle the negative space. A dot
   with one neighbour is kept, because that is the tip of a real stroke. The
   build (scripts/build-logos.sh) passes floor 0.2 / gain 1.8 for `fill` and
   0.15 / 2.4 for `edge`: a contour band is thinner than a fill, so it needs more
   lift to stay a line.
4. **Colour per cell.** Palette colours are the icon's own flat colours. Each dot
   picks between its two nearest palette entries with the same Bayer threshold,
   so gradients break up instead of banding. A cell carries exactly one colour,
   the majority colour of its lit dots, and is always drawn as Braille dots:

       no dots on                    -> " " (transparent, inherits the terminal background)
       dots on, one colour           -> that colour as fg, off dots stay transparent
       all 8 dots on, two colours    -> the majority colour, all 8 dots
       some dots on, two colours     -> the majority colour, minority dropped

A cell background is never painted, so the art always sits on your terminal
background instead of inside a coloured box, and a filled cell still reads as a
dot field because Braille dots leave gaps inside the cell.

Edge mode (`--mode edge`) exists because every vendor ships these marks as
filled silhouettes, not as outlines. A solid fill area-sampled at 40x40 dots is
an undifferentiated field of dots, so instead of the alpha itself the renderer
samples a **stroke band around the alpha contour**: a chamfer distance transform
of the alpha mask gives every subpixel its signed distance to the nearest edge,
and the band `|distance| < edge_width/2` becomes the coverage that gets dithered.
Thick fills therefore render as their contours, holes and cut-outs included,
while a shape thinner than the band (a 2-dot line-art stroke) is covered whole
and still renders solid. The dot colour is still the alpha-weighted mean of the
icon, so multi-colour marks stay multi-colour and each contour takes the colour
of the fill it belongs to.

Usage:
    png-to-ansi.py in.png out.ansi [--cols 20] [--rows 10] [--colors truecolor|256]
                   [--supersample 4] [--dither bayer|none] [--palette-size 8]
                   [--palette-floor 0.04] [--coverage-gain 1.4] [--coverage-floor 0.2]
                   [--mode fill|edge] [--edge-width 1.8]
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image

RESET = "\x1b[0m"

# Braille bit per dot, indexed [dot_row][dot_col]. Codepoint = 0x2800 | mask.
DOT_BITS = np.array(
    [
        [0x01, 0x08],
        [0x02, 0x10],
        [0x04, 0x20],
        [0x40, 0x80],
    ],
    dtype=np.int32,
)


def bayer_matrix(size: int) -> np.ndarray:
    """Recursive Bayer matrix, values 0..size^2-1."""
    matrix = np.zeros((1, 1), dtype=np.int32)
    current = 1
    while current < size:
        matrix = np.block(
            [
                [4 * matrix + 0, 4 * matrix + 2],
                [4 * matrix + 3, 4 * matrix + 1],
            ]
        )
        current *= 2
    return matrix


def xterm256(rgb: tuple[int, int, int]) -> int:
    """Map an RGB triple to the nearest index of the xterm-256 colour cube."""
    steps = (0, 95, 135, 175, 215, 255)

    def nearest(value: int) -> int:
        return min(range(len(steps)), key=lambda i: abs(steps[i] - value))

    return 16 + 36 * nearest(rgb[0]) + 6 * nearest(rgb[1]) + nearest(rgb[2])


def fg(rgb: tuple[int, int, int], colors: str) -> str:
    if colors == "256":
        return f"\x1b[38;5;{xterm256(rgb)}m"
    return f"\x1b[38;2;{rgb[0]};{rgb[1]};{rgb[2]}m"


def load(
    path: str, dot_w: int, dot_h: int, supersample: int
) -> tuple[np.ndarray, np.ndarray]:
    """Return (rgb, alpha) at exactly dot_w*S x dot_h*S pixels, area-sampled."""
    image = Image.open(path).convert("RGBA")
    width, height = dot_w * supersample, dot_h * supersample
    if image.size != (width, height):
        # BOX is an area filter: it averages when shrinking and duplicates when
        # growing. Nothing here interpolates, so edges stay where they were.
        image = image.resize((width, height), Image.BOX)

    pixels = np.asarray(image).astype(np.float32) / 255.0
    return pixels[..., :3], pixels[..., 3]


def block_mean(
    values: np.ndarray, dot_h: int, dot_w: int, supersample: int
) -> np.ndarray:
    """Average every S x S subpixel block into one dot value."""
    trailing = values.shape[2:]
    shaped = values.reshape(dot_h, supersample, dot_w, supersample, *trailing)
    return shaped.mean(axis=(1, 3))


def sample_dots(
    rgb: np.ndarray, alpha: np.ndarray, dot_w: int, dot_h: int, supersample: int
) -> tuple[np.ndarray, np.ndarray]:
    """Return (coverage, colour) per dot; colour is the alpha-weighted mean RGB."""
    coverage = block_mean(alpha, dot_h, dot_w, supersample)
    weighted = block_mean(alpha[..., None] * rgb, dot_h, dot_w, supersample)
    with np.errstate(invalid="ignore", divide="ignore"):
        colour = weighted / np.maximum(coverage[..., None], 1e-6)
    colour = np.where(coverage[..., None] > 0.0, colour, 0.0)
    return coverage.astype(np.float32), colour.astype(np.float32)


def chamfer_distance(source: np.ndarray) -> np.ndarray:
    """Distance in pixels from every True pixel to the nearest False pixel.

    Two-pass 3-4 chamfer transform (weights 1 and sqrt 2). Each row is propagated
    horizontally with a running minimum instead of a per-pixel loop, so the whole
    thing is vectorised: `min over x' <= x of d[x'] + (x - x')` is
    `x + minimum.accumulate(d - x)`. Pixels with no False neighbour stay at the
    large sentinel and are clipped away by the caller.
    """
    height, width = source.shape
    sentinel = 1e6
    distance = np.where(source, sentinel, 0.0).astype(np.float64)
    xs = np.arange(width, dtype=np.float64)
    diagonal = 2.0**0.5

    for y in range(height):
        if y > 0:
            previous = distance[y - 1]
            row = distance[y]
            row = np.minimum(row, previous + 1.0)
            row[1:] = np.minimum(row[1:], previous[:-1] + diagonal)
            row[:-1] = np.minimum(row[:-1], previous[1:] + diagonal)
            distance[y] = row
        distance[y] = np.minimum.accumulate(distance[y] - xs) + xs

    for y in range(height - 1, -1, -1):
        if y < height - 1:
            following = distance[y + 1]
            row = distance[y]
            row = np.minimum(row, following + 1.0)
            row[1:] = np.minimum(row[1:], following[:-1] + diagonal)
            row[:-1] = np.minimum(row[:-1], following[1:] + diagonal)
            distance[y] = row
        distance[y] = np.minimum.accumulate((distance[y] + xs)[::-1])[::-1] - xs

    return distance


def contour_band(alpha: np.ndarray, supersample: int, edge_width: float) -> np.ndarray:
    """Coverage of a `edge_width`-dot stroke band centred on the alpha contour.

    The mask is thresholded at half alpha, so antialiased pixels do not shift the
    contour by a subpixel. Inside pixels get a positive signed distance, outside
    pixels a negative one, and the band fades out over one pixel at its rim so
    area sampling still sees a fractional edge. A shape thinner than the band has
    no interior left over and comes out solid, which is what keeps line-art
    sources legible in edge mode.
    """
    mask = alpha > 0.5
    if not mask.any():
        return np.zeros_like(alpha)
    if mask.all():
        return np.ones_like(alpha)

    inside = chamfer_distance(mask) - 0.5
    outside = chamfer_distance(~mask) - 0.5
    signed = np.where(mask, inside, -outside)

    half = max(float(edge_width), 1.0) * supersample / 2.0
    return np.clip(half + 0.5 - np.abs(signed), 0.0, 1.0)


def extract_palette(
    rgb: np.ndarray,
    alpha: np.ndarray,
    size: int,
    separation: float = 24.0,
    floor: float = 0.04,
) -> np.ndarray:
    """Pick up to `size` flat colours, merging shades closer than `separation`.

    Antialiased fringes and gradient steps collapse into the nearest kept colour,
    so dots end up painted with the icon's real colours instead of averages.
    Colours covering less than `floor` of the *most frequent* colour are blends
    along a colour boundary, not brand colours, so they are dropped: dithering
    between the two real colours looks better than a third muddy one. A relative
    floor keeps every shade of a real gradient, which is evenly spread and so has
    no dominant colour at all.
    """
    mask = alpha > 0.05
    if not mask.any():
        return np.zeros((0, 3), dtype=np.float32)

    pixels = np.round(rgb[mask] * 255.0).astype(np.uint8)
    weights = alpha[mask]
    flat = (
        pixels[:, 0].astype(np.int64) * 65536
        + pixels[:, 1].astype(np.int64) * 256
        + pixels[:, 2]
    )
    keys, inverse = np.unique(flat, return_inverse=True)
    counts = np.bincount(inverse, weights=weights, minlength=len(keys))
    colors = np.stack(
        [(keys >> 16) & 0xFF, (keys >> 8) & 0xFF, keys & 0xFF], axis=-1
    ).astype(np.float32)

    minimum = float(counts.max()) * floor
    candidates = np.argsort(-counts)
    candidates = candidates[counts[candidates] >= minimum]
    if candidates.size == 0:
        candidates = np.array([int(np.argmax(counts))])

    pool = colors[candidates]
    weights = counts[candidates]
    kept = [pool[int(np.argmax(weights))]]
    while len(kept) < size:
        # Farthest-point selection weighted by area: the next colour is the one
        # that is both far from everything kept so far and covers real area.
        # For a flat icon that just finds the brand colours; for a gradient it
        # spreads the palette across the whole ramp instead of banding next to
        # the most frequent shade.
        distance = np.linalg.norm(
            pool[:, None, :] - np.array(kept)[None, :, :], axis=-1
        ).min(axis=1)
        score = distance * np.sqrt(weights)
        best = int(np.argmax(score))
        if distance[best] < separation:
            break
        kept.append(pool[best])

    return np.array(kept, dtype=np.float32) / 255.0


def snap_colours(
    colour: np.ndarray, palette: np.ndarray, dither: np.ndarray
) -> np.ndarray:
    """Assign every dot a palette index, dithering between the two nearest ones.

    `dither` holds the Bayer threshold in 0..1 per dot. When a dot's colour lies
    between two palette entries, the projection onto that segment decides how
    often each of the two is used, which is what breaks up gradients and
    antialiased boundary pixels.
    """
    palette_px = palette * 255.0
    pixels = colour * 255.0
    distance = ((pixels[..., None, :] - palette_px[None, None, :, :]) ** 2).sum(axis=-1)

    nearest = distance.argmin(axis=-1).astype(np.int32)
    if len(palette) < 2:
        return nearest

    order = np.argsort(distance, axis=-1)
    first = order[..., 0]
    second = order[..., 1]

    c0 = palette_px[first]
    c1 = palette_px[second]
    axis = c1 - c0
    length = (axis**2).sum(axis=-1)
    with np.errstate(invalid="ignore", divide="ignore"):
        position = ((pixels - c0) * axis).sum(axis=-1) / np.maximum(length, 1e-6)
    position = np.clip(position, 0.0, 1.0)

    # position is how far the colour sits between c0 and c1; use the second
    # colour for that fraction of the dots, spread out by the Bayer matrix.
    return np.where(position > dither, second, first).astype(np.int32)


def render(
    path: str,
    cols: int,
    rows: int,
    colors: str,
    supersample: int,
    palette_size: int,
    dither: str,
    palette_floor: float = 0.04,
    coverage_gain: float = 1.4,
    coverage_floor: float = 0.2,
    mode: str = "fill",
    edge_width: float = 1.8,
) -> list[str]:
    dot_w, dot_h = cols * 2, rows * 4
    rgb, alpha = load(path, dot_w, dot_h, supersample)
    coverage, colour = sample_dots(rgb, alpha, dot_w, dot_h, supersample)
    if mode == "edge":
        band = contour_band(alpha, supersample, edge_width)
        coverage = block_mean(band, dot_h, dot_w, supersample).astype(np.float32)
    palette = extract_palette(rgb, alpha, palette_size, floor=palette_floor)

    # `none` is not "no dithering" but "no matrix": a plain 0.5 threshold decides
    # every dot the same way. That is what a mark narrower than a dot needs -- a
    # 2.5-dot stroke has ~46% of its lit dots mid-ramp, so Bayer has no clean
    # boundary to dissolve and instead dashes one edge of every stroke.
    if dither == "bayer":
        matrix = bayer_matrix(8)
        size = matrix.shape[0]
        ys = np.arange(dot_h)[:, None] % size
        xs = np.arange(dot_w)[None, :] % size
        threshold = (matrix[ys, xs] + 0.5) / float(size * size)
    else:
        threshold = np.full((dot_h, dot_w), 0.5, dtype=np.float64)

    # A diagonal stroke covers at most ~0.9 of a dot, so raw ordered dithering
    # would punch holes into every diagonal core; and a 0.2-coverage sliver turns
    # into isolated speckles a dot away from the shape. Floor the faintest
    # coverage away and lift the rest, so cores stay solid and only the real
    # antialiased fringe dithers. A high floor with a high gain (0.4 / 3.0, see the
    # `tuning` table in scripts/build-logos.sh) turns the ramp into a soft
    # threshold -- dots below ~0.5 go out, dots above ~0.67 come on -- which is
    # what a mark whose features sit 2-3 dots apart needs: the gaps between them
    # are only 40-60% covered, so a gentle gain dithers those rims into speckle
    # and the mark reads as a dot field instead of a shape.
    lifted = np.clip(
        (coverage - coverage_floor) / (1.0 - coverage_floor) * coverage_gain, 0.0, 1.0
    )
    on = lifted > threshold
    if len(palette) == 0:
        on[:] = False
        index = np.zeros((dot_h, dot_w), dtype=np.int32)
    else:
        index = snap_colours(colour, palette, threshold)
        on &= coverage > 0.0

    # Debris. A corner sliver of the mark can clear the coverage floor on one dot
    # that has no lit neighbour at all; it is not part of any contour, it just
    # speckles the negative space. Only fully isolated dots go: a dot with one
    # neighbour is the tip of a real stroke.
    padded = np.pad(on.astype(np.int32), 1)
    neighbours = sum(
        padded[1 + dy : 1 + dy + dot_h, 1 + dx : 1 + dx + dot_w]
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
        if (dy, dx) != (0, 0)
    )
    on &= neighbours > 0

    # Fold the dot grid into cells: (rows, 4, cols, 2).
    on_cells = on.reshape(rows, 4, cols, 2)
    index_cells = np.where(on_cells, index.reshape(rows, 4, cols, 2), 0)

    mask = (on_cells * DOT_BITS[None, :, None, :]).sum(axis=(1, 3)).astype(np.int32)

    entries = max(len(palette), 1)
    # Only lit dots vote for the cell colour; empty dots must not pull the cell
    # towards palette entry 0.
    onehot = (
        (index_cells[..., None] == np.arange(entries)) & on_cells[..., None]
    ).astype(np.int32)
    counts = onehot.sum(axis=(1, 3))  # (rows, cols, entries)
    majority = counts.argmax(axis=-1)

    # One colour per cell, always drawn as dots: there is no cell background, so
    # a cell's minority colour has nowhere to go and the glyph is every lit dot.
    def colour_of(value: int) -> tuple[int, int, int]:
        entry = palette[value]
        return (
            int(round(float(entry[0]) * 255)),
            int(round(float(entry[1]) * 255)),
            int(round(float(entry[2]) * 255)),
        )

    lines: list[str] = []
    for row in range(rows):
        parts: list[str] = []
        for col in range(cols):
            cell_mask = int(mask[row, col])
            if cell_mask == 0:
                parts.append(" ")
                continue

            parts.append(fg(colour_of(int(majority[row, col])), colors))
            parts.append(chr(0x2800 | cell_mask))

        # Trailing empty cells carry no colour, so dropping them is lossless.
        while parts and parts[-1] == " ":
            parts.pop()
        lines.append("".join(parts) + RESET if parts else "")

    return lines


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--cols", type=int, default=20, help="cells wide (default: 20)")
    parser.add_argument("--rows", type=int, default=10, help="cells tall (default: 10)")
    parser.add_argument("--colors", choices=("truecolor", "256"), default="truecolor")
    parser.add_argument(
        "--supersample",
        type=int,
        default=4,
        help="source samples per dot side; the SVG is rendered at 2*cols*S x 4*rows*S (default: 4)",
    )
    parser.add_argument(
        "--palette-size",
        type=int,
        default=8,
        help="flat colours kept per icon (default: 8)",
    )
    parser.add_argument(
        "--coverage-gain",
        type=float,
        default=1.4,
        help="coverage multiplier before dithering; >1 keeps thin strokes solid (default: 1.4)",
    )
    parser.add_argument(
        "--coverage-floor",
        type=float,
        default=0.2,
        help="coverage below this counts as empty, dropping speckle fringes (default: 0.2)",
    )
    parser.add_argument(
        "--palette-floor",
        type=float,
        default=0.04,
        help="drop palette colours covering less than this fraction of the most frequent one (default: 0.04)",
    )
    parser.add_argument(
        "--dither",
        choices=("bayer", "none"),
        default="bayer",
        help="ordered dithering for dot coverage and colour selection (default: bayer)",
    )
    parser.add_argument(
        "--mode",
        choices=("fill", "edge"),
        default="fill",
        help="fill: dither the alpha itself; edge: dither a stroke band around the alpha contour (default: fill)",
    )
    parser.add_argument(
        "--edge-width",
        type=float,
        default=1.8,
        help="width of the contour band in dots in edge mode; 2.4 covers a 2-dot stroke (default: 1.8)",
    )
    args = parser.parse_args(argv)

    lines = render(
        args.input,
        args.cols,
        args.rows,
        args.colors,
        args.supersample,
        args.palette_size,
        args.dither,
        args.palette_floor,
        args.coverage_gain,
        args.coverage_floor,
        args.mode,
        args.edge_width,
    )
    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
