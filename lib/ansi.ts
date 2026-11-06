/**
 * Loads the ANSI art from `content/ansi/`.
 *
 * Files are read once per family and cached; `session_start` clears the cache so
 * that regenerated art and `/reload` are picked up.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Color, indexedColor, rgbColor, visibleWidth } from "@earendil-works/pi-tui";

/** Absolute path of the bundled `content/ansi/` directory. */
export const LOGO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "ansi");

/** Family whose art stands in when a model cannot be attributed. */
const FALLBACK_FAMILY = "default";

/** Cached art lines per family (`undefined` = no art). */
const cache = new Map<string, string[] | undefined>();

/** Cached dominant colour per family. */
const colorCache = new Map<string, Color | undefined>();

/** Drop cached art so the next render re-reads the files. */
export function clearLogoCache(): void {
    cache.clear();
    colorCache.clear();
}

/** Art lines for a family, or `undefined` when the file is missing or empty. */
function readArtFile(family: string): string[] | undefined {
    let raw: string;
    try {
        raw = readFileSync(join(LOGO_DIR, `${family}.ansi`), "utf8");
    } catch {
        return undefined;
    }
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && isBlankArtLine(lines[lines.length - 1])) lines.pop();

    // Art is padded to the fixed 20x10 cell grid, so several marks start with
    // empty rows. Those would render as blank lines above the banner (on top of
    // the spacer Pi puts over the header), so start at the first drawn row.
    // The header restores the fixed height below the text.
    while (lines.length > 0 && isBlankArtLine(lines[0])) lines.shift();
    return lines.length > 0 ? lines : undefined;
}

/** True for art lines that draw nothing: empty, spaces, or only SGR resets. */
function isBlankArtLine(line: string): boolean {
    return line.replace(/\x1b\[[0-9;]*m/g, "").trim() === "";
}

/** Art lines for a family, falling back to the Pi logo, then `undefined`. */
export function logoLines(family: string): string[] | undefined {
    const cached = cache.get(family);
    if (cached !== undefined || cache.has(family)) return cached;
    const lines = readArtFile(family) ?? (family === FALLBACK_FAMILY ? undefined : readArtFile(FALLBACK_FAMILY));
    cache.set(family, lines);
    return lines;
}

/** Widest line of a block of art, in terminal cells. */
export function artWidth(lines: readonly string[]): number {
    let width = 0;
    for (const line of lines) width = Math.max(width, visibleWidth(line));
    return width;
}

/**
 * Foreground SGR sequences the art can carry: truecolor (`38;2;r;g;b`) and the
 * xterm-256 build (`38;5;n`). Backgrounds (`48;…`) are deliberately not matched.
 */
const FOREGROUND_SGR = /\x1b\[(?:38;2;(\d{1,3});(\d{1,3});(\d{1,3})|38;5;(\d{1,3}))m/g;

/**
 * The colour the art uses most, i.e. the mark's primary brand colour.
 *
 * Most marks are one flat colour; the ones with a gradient (`google`, `mistral`, `default`)
 * have a dominant brand colour and a few ramp steps, so the most frequent
 * foreground is the right pick — an average would land between brand colours.
 * Ties keep the colour that appears first.
 */
export function dominantForegroundColor(lines: readonly string[]): Color | undefined {
    const counts = new Map<string, { color: Color; count: number }>();

    for (const line of lines) {
        for (const match of line.matchAll(FOREGROUND_SGR)) {
            const indexed = match[4];
            const key = indexed === undefined ? `${match[1]},${match[2]},${match[3]}` : `i${indexed}`;
            const color = indexed === undefined
                ? rgbColor(Number(match[1]), Number(match[2]), Number(match[3]))
                : indexedColor(Number(indexed));

            const entry = counts.get(key);
            if (entry) entry.count += 1;
            else counts.set(key, { color, count: 1 });
        }
    }

    let best: { color: Color; count: number } | undefined;
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) best = entry;
    }
    return best?.color;
}

/**
 * Primary colour of a family's art, for tinting text with the logo's own brand
 * colour. `undefined` when there is no art (or no coloured art) to sample.
 */
export function primaryColor(family: string): Color | undefined {
    if (colorCache.has(family)) return colorCache.get(family);

    const lines = logoLines(family);
    const color = lines ? dominantForegroundColor(lines) : undefined;
    colorCache.set(family, color);
    return color;
}

/** Families that have art on disk. Used by `/banner` for its status message. */
export function availableFamilies(): string[] {
    try {
        return readdirSync(LOGO_DIR)
            .filter((name: string) => name.endsWith(".ansi"))
            .map((name: string) => name.slice(0, -".ansi".length))
            .sort();
    } catch {
        return [];
    }
}
