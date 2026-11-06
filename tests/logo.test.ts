/**
 * Tests for the art helpers that do not need a TUI: the dominant foreground
 * colour sampler and the per-family cache around it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { indexedColor, rgbColor } from "@earendil-works/pi-tui";

import { dominantForegroundColor, availableFamilies, logoLines, primaryColor } from "../lib/ansi.ts";

const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const RESET = "\x1b[0m";

test("the most frequent foreground colour wins", () => {
    const lines = [
        `${fg(217, 119, 87)}⣿${fg(255, 255, 255)}⣿${RESET}`,
        `${fg(217, 119, 87)}⣿⣿${RESET}`,
        `${fg(255, 255, 255)}⣿${RESET}`,
    ];

    assert.deepEqual(dominantForegroundColor(lines), rgbColor(217, 119, 87));
});

test("ties keep the colour that appears first", () => {
    const lines = [`${fg(10, 20, 30)}⣿${fg(40, 50, 60)}⣿${RESET}`];

    assert.deepEqual(dominantForegroundColor(lines), rgbColor(10, 20, 30));
});

test("a 256-colour build is sampled as an indexed colour", () => {
    const lines = [`\x1b[38;5;208m⣿\x1b[38;5;208m⣿\x1b[38;5;21m⣿${RESET}`];

    assert.deepEqual(dominantForegroundColor(lines), indexedColor(208));
});

test("backgrounds are not mistaken for the mark's colour", () => {
    const lines = [`\x1b[48;2;1;2;3m${fg(217, 119, 87)}⣿${RESET}`];

    assert.deepEqual(dominantForegroundColor(lines), rgbColor(217, 119, 87));
});

test("art without colour has no primary colour", () => {
    assert.equal(dominantForegroundColor(["⣿⣿", ""]), undefined);
    assert.equal(dominantForegroundColor([]), undefined);
});

test("primaryColor samples the bundled art", () => {
    const anthropic = primaryColor("anthropic");

    assert.ok(anthropic !== undefined, "anthropic.ansi should carry a colour");
    assert.equal(anthropic.kind, "rgb");
    // Anthropic's brand orange, as rendered from the vendor mark.
    assert.deepEqual(anthropic, rgbColor(217, 119, 87));
    assert.deepEqual(primaryColor("anthropic"), anthropic, "the result is cached");
});

test("art never starts or ends with a blank line", () => {
    const blank = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").trim() === "";

    for (const family of availableFamilies()) {
        const lines = logoLines(family);
        assert.ok(lines && lines.length > 0, `${family}: has art`);
        assert.ok(!blank(lines[0]), `${family}: no blank row above the mark`);
        assert.ok(!blank(lines[lines.length - 1]), `${family}: no blank row below the mark`);
    }
});

test("an unknown family falls back to the Pi logo's colour", () => {
    const fallback = primaryColor("no-such-family");

    assert.ok(fallback !== undefined);
    assert.deepEqual(fallback, primaryColor("default"));
});
