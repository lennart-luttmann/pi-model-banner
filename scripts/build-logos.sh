#!/usr/bin/env bash
#
# Regenerate content/ansi/<family>.ansi from icons/<family>.svg.
#
# Pipeline: SVG --(rsvg-convert)--> PNG (one subpixel block per Braille dot)
#                 --(renderer)----> ANSI Braille dot art
#
# The bundled renderer (scripts/png-to-ansi.py) is the only renderer: it emits
# Unicode Braille patterns (U+2800..U+28FF), i.e. 2x4 dots per terminal cell,
# with ordered (Bayer) dithering on both dot coverage and colour choice. There is
# deliberately no chafa path: chafa cannot draw Braille dot art, and its block
# output is exactly what made the logos look like blobs.
#
# Modes. `icons/` holds the vendors' real marks, and every one of them is a
# filled silhouette. `fill` dithers that silhouette directly, which is what every
# shipped family uses: at 40x40 dots the dots' own gaps supply the texture, and
# the steep coverage ramp below keeps thin strokes from breaking up. `edge` is
# the alternative: the renderer samples a stroke band around the mark's alpha
# contour and dithers that, so a thick fill renders as its outline. It is worth
# trying on a mark with thin, widely spaced contours, but on the marks bundled
# here it double-draws every 2-3 dot stroke and reads as a wireframe, so
# EDGE_FAMILIES is empty. Add a family to that list to give it the contour
# render; MODE / MODE_<family> override either way.
#
# Tuning. A mark whose features sit 2-3 dots apart needs a steeper coverage ramp
# than the mode default: a gentle gain dithers the rims into speckle and the
# mark reads as a dot field. Nine families need more than the defaults and are
# listed in the `tuning` table below.
#
# Every family is rendered at exactly COLS x ROWS terminal cells so the header
# does not jump when the model changes. A cell is 2 dots wide and 4 dots tall and
# a dot is square, so the source is rasterised at COLS*2*S x ROWS*4*S pixels
# (a square image for the default 20x10 cells).
#
# Knobs are resolved lowest priority first, per family:
#   mode             tuning table, then MODE, then EDGE_FAMILIES (else fill),
#                    then MODE_<family>
#   band/gain/floor  tuning table, then EDGE_WIDTH / COVERAGE_GAIN /
#                    COVERAGE_FLOOR, then EDGE_WIDTH_<family> /
#                    COVERAGE_GAIN_<family> / COVERAGE_FLOOR_<family>
#   supersample      the supersample() table, then SUPERSAMPLE, then
#                    SUPERSAMPLE_<family>
#   dither           the dither_for() table, then DITHER, then DITHER_<family>
# So an explicit per-family variable always wins, and a built-in table entry beats
# the global default but not a per-family override.
#
# Usage:
#   ./scripts/build-logos.sh                        # 20x10 cells, truecolor, bayer
#   COLORS=256 ./scripts/build-logos.sh             # xterm-256 palette
#   COLS=24 ROWS=12 ./scripts/build-logos.sh        # bigger art (keep ROWS = COLS/2)
#   DITHER=none ./scripts/build-logos.sh            # hard threshold instead
#   DITHER_minimax=bayer ./scripts/build-logos.sh   # one family's dithering
#   SUPERSAMPLE=6 ./scripts/build-logos.sh          # more samples per dot
#   SUPERSAMPLE_minimax=12 ./scripts/build-logos.sh # one family's sampling
#   PALETTE_SIZE=4 ./scripts/build-logos.sh         # fewer flat colours
#   MODE=edge ./scripts/build-logos.sh              # contours instead of interior
#   MODE=edge MODE_mistral=fill ./scripts/build-logos.sh   # one family only
#   EDGE_WIDTH=2.4 ./scripts/build-logos.sh         # thicker contour band
#   COVERAGE_GAIN=2 ./scripts/build-logos.sh        # keep thin contours solid
#   COVERAGE_FLOOR_anthropic=0.4 ./scripts/build-logos.sh   # one family's ramp
#
# Adding a family:
#
#   1. icons/<family>.svg -- the vendor's own mark, not a redrawn approximation.
#      Vendors publish these as filled silhouettes (fill-rule="evenodd" contours,
#      no strokes), which is what the renderer expects: it recovers the contours
#      from the raster, so the mark's holes, cut-outs and ragged edges survive the
#      40x40 dot budget. Keep the file self-contained (no external images, fonts
#      or <use href>), wrap the vendor geometry in a <g transform="..."> that
#      scales the mark's ink box into viewBox="0 0 20 20" (two dots per unit) with
#      a small margin, strip any background rect, and record the source URL plus a
#      licence/attribution line in an SVG comment so the build stays offline. Keep
#      the brand colours: a #000000 mark is usually tinted grey and vanishes on a
#      dark terminal. If the mark is made of axis-aligned rectangles, snap the
#      transform so its edges land on dot boundaries -- multiples of 0.5 units,
#      see icons/default.svg -- because an edge on a boundary is fully in or fully
#      out and renders crisp, while an edge at ~50% coverage dithers row to row
#      into a ragged staircase.
#   2. Add the name to FAMILIES and a label to FAMILY_LABELS in content/,
#      plus the matching keywords to MODEL_KEYWORDS / PROVIDER_KEYWORDS.
#   3. Pick a mode (see Modes above; fill unless the mark has thin, widely spaced
#      contours). A mark whose features sit 2-3 dots apart usually needs a steeper
#      ramp: add it to the `tuning` table and compare against the source mark.
#   4. Re-run this script and look at the art -- npm run preview:logos prints the
#      dot grid and colour map, no terminal needed -- then run npm test.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${here}/.." && pwd)"

icons="${root}/icons"
out="${root}/content/ansi"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

COLS="${COLS:-20}"
ROWS="${ROWS:-10}"
COLORS="${COLORS:-truecolor}"
SUPERSAMPLE="${SUPERSAMPLE:-4}"
PALETTE_SIZE="${PALETTE_SIZE:-8}"
DITHER="${DITHER:-bayer}"
MODE="${MODE:-}"
EDGE_WIDTH="${EDGE_WIDTH:-}"
COVERAGE_GAIN="${COVERAGE_GAIN:-}"
COVERAGE_FLOOR="${COVERAGE_FLOOR:-}"

# Families that get the contour (edge) render instead of the fill. Empty: every
# bundled mark is a fill, because an outline of a 2-3 dot stroke double-draws it
# and reads as a wireframe. Listed per name so one can be switched over for
# comparison without rebuilding the rest.
EDGE_FAMILIES=""

# A cell background is never painted: the renderer emits foreground dots only, so
# every mark sits on the terminal background and a gradient is carried by the dots
# themselves rather than by a coloured slab.
# Per-family tuning, printed as "<mode> <edge-width> <gain> <floor>".
#
# The mode defaults are 1.8 dots / gain 2.4 / floor 0.15 for a contour and
# 1.8 / 1.8 / 0.2 for a fill, which suit a mark whose contours are a comfortable
# distance apart (moonshot, minimax, default). A mark
# whose features sit 2-3 dots from each other needs a steeper ramp: with a wide
# band the gap between two nearby contours is ~40-60% covered, so a gentle gain
# turns it into a dithered speckle trail that breaks the contours into dashes.
# floor 0.5 / gain 3.0 turns the ramp into a soft threshold (dots below ~0.5 go
# out, dots above ~0.67 come on), so only the genuinely antialiased boundary
# dithers: the contour stays continuous and its interior stays hollow.
#
#   xai, anthropic, openai, google, meta, deepseek
#                                  fill 1.8 / 3.0 / 0.4
#     Solid marks whose detail *is* the silhouette: the angular X, the twelve-ray
#     spark, the knot, the gradient sparkle, the infinity loop, the whale (eye and
#     fin included). Their strokes are only 2-3 dots wide, so an outline
#     double-draws every stroke and reads as a wireframe; the fill keeps the
#     shape, and the steep ramp stops the thin ray tips, strand ends, slash bar
#     and fin edges dissolving into a dithered fringe.
#   minimax                        fill 1.8 / 1.8 / 0.2 (the fill defaults),
#                                  supersample 8, no dithering
#     A constant-width stroke with rounded caps rather than a solid slab. Its
#     stroke is only ~2.5 dots wide, so ~46% of its lit dots sit mid-ramp: there
#     is no clean boundary for ordered dithering to dissolve, and Bayer instead
#     dashes one edge of every stroke and speckles the rest. A plain threshold
#     decides each dot the same way every time, which keeps the strokes solid
#     and the gaps between them open. The extra supersamples matter because
#     where a 2.5-dot stroke's edges land decides whether its caps read as round.
#   mistral, qwen, zai             fill 1.8 / 3.0 / 0.4
#     Flat slabs, colour bands and flat facets: the fill *is* the mark, so edge
#     mode turns it into a hollow wireframe and loses the very thing that makes
#     it legible (qwen's faces and notch, mistral's colour bands, zai's bars).
#     The steep ramp is what stops an antialiased seam from punching a dithered
#     line through a solid band: two abutting rects each cover half of the seam
#     pixel, so the composite alpha there is 0.75 and not 1.0, which the gentler
#     fill ramp renders as a dotted line. With 0.4 / 3.0 the bands and bars come
#     out solid and only the boundary between two colours dithers.
# Per-family supersampling, for a mark too fine for the global setting. Empty
# means "use SUPERSAMPLE". A constant-width stroke whose edges land a fraction of
# a dot apart renders differently at 4 samples and at 8.
supersample() {
    case "$1" in
    minimax) echo 8 ;;
    *) echo "" ;;
    esac
}

# Per-family dithering. Ordered dithering dissolves an antialiased boundary, but
# a mark whose strokes are narrower than a dot needs the opposite: half of its
# lit dots sit mid-ramp, so Bayer has nothing to dissolve and instead turns one
# edge of every stroke into a dashed line. A plain threshold decides each dot the
# same way every time, which keeps the strokes solid and their edges straight.
# Empty means "use DITHER".
dither_for() {
    case "$1" in
    minimax) echo "none" ;;
    *) echo "" ;;
    esac
}

tuning() {
    case "$1" in
    xai | anthropic | openai | google | meta | deepseek | mistral | qwen | zai)
        echo "fill 1.8 3.0 0.4"
        ;;
    *) echo "" ;;
    esac
}

# Dots: 2 per cell horizontally, 4 per cell vertically. A dot is square, so the
# rasterised SVG is square for a square logo.
DOTS_W=$((COLS * 2))
DOTS_H=$((ROWS * 4))

if ! command -v rsvg-convert >/dev/null 2>&1; then
    echo "error: rsvg-convert is required (librsvg2-bin / librsvg)." >&2
    echo "       macOS: brew install librsvg" >&2
    exit 1
fi

if ! python3 -c "import PIL, numpy" >/dev/null 2>&1; then
    echo "error: the Braille renderer needs python3 + Pillow + numpy." >&2
    echo "       pip install pillow numpy" >&2
    exit 1
fi

mkdir -p "${out}"
echo "renderer: braille  geometry: ${COLS}x${ROWS} cells = ${DOTS_W}x${DOTS_H} dots  colours: ${COLORS}  dither: ${DITHER}"

for svg in "${icons}"/*.svg; do
    name="$(basename "${svg}" .svg)"
    png="${tmp}/${name}.png"

    # Per-family mode: the tuning table, then MODE, then MODE_<family>.
    read -r tuned_mode tuned_width tuned_gain tuned_floor <<<"$(tuning "${name}")"
    mode="${MODE:-${tuned_mode}}"
    if [ -z "${mode}" ]; then
        case "${EDGE_FAMILIES}" in
        *" ${name} "*) mode=edge ;;
        *) mode=fill ;;
        esac
    fi
    override_var="MODE_${name//-/_}"
    override="${!override_var:-}"
    [ -n "${override}" ] && mode="${override}"

    # Band, gain and floor: the tuning table, then the global variables, then the
    # per-family ones. A contour band is thinner than a fill, so it needs more
    # gain to stay solid.
    width="${tuned_width:-1.8}"
    if [ "${mode}" = edge ]; then
        gain="${tuned_gain:-2.4}"
        floor="${tuned_floor:-0.15}"
    else
        gain="${tuned_gain:-1.8}"
        floor="${tuned_floor:-0.2}"
    fi
    width_var="EDGE_WIDTH_${name//-/_}"
    gain_var="COVERAGE_GAIN_${name//-/_}"
    floor_var="COVERAGE_FLOOR_${name//-/_}"
    width="${!width_var:-${EDGE_WIDTH:-${width}}}"
    gain="${!gain_var:-${COVERAGE_GAIN:-${gain}}}"
    floor="${!floor_var:-${COVERAGE_FLOOR:-${floor}}}"

    ss="$(supersample "${name}")"
    if [ -z "${ss}" ]; then ss="${SUPERSAMPLE}"; fi
    ss_var="SUPERSAMPLE_${name//-/_}"
    ss="${!ss_var:-${ss}}"
    px_w=$((DOTS_W * ss))
    px_h=$((DOTS_H * ss))

    dither="$(dither_for "${name}")"
    if [ -z "${dither}" ]; then dither="${DITHER}"; fi
    dither_var="DITHER_${name//-/_}"
    dither="${!dither_var:-${dither}}"

    rsvg-convert --width "${px_w}" --height "${px_h}" --keep-aspect-ratio \
        --background-color none --output "${png}" "${svg}"

    python3 "${here}/png-to-ansi.py" "${png}" "${out}/${name}.ansi" \
        --cols "${COLS}" --rows "${ROWS}" --colors "${COLORS}" \
        --supersample "${ss}" --palette-size "${PALETTE_SIZE}" \
        --dither "${dither}" --mode "${mode}" --edge-width "${width}" \
        --coverage-gain "${gain}" --coverage-floor "${floor}"

    printf '  %-12s -> %s  (%s %.1f/%.1f/%.2f, %s)\n' \
        "${name}" "content/ansi/${name}.ansi" "${mode}" "${width}" "${gain}" "${floor}" "${dither}"
done

python3 "${here}/check-logos.py" --cols "${COLS}" --rows "${ROWS}" "${out}"
