import type { Theme } from "@earendil-works/pi-coding-agent";
import { VERSION, keyHint, keyText, rawKeyHint } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { type Color, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Family } from "../content/families.ts";
import { FAMILY_LABELS } from "../content/labels.ts";
import { artWidth, logoLines, primaryColor } from "./ansi.ts";

/**
 * State the banner renders.
 */
export interface BannerState {

    /** Logo family resolved for the current model. */
    family: Family;

    /** Display name of the model (`Claude Sonnet 4.5`). */
    modelName: string;

    /** Raw model id (`claude-sonnet-4-5-20250929`). */
    modelId: string;

    /** Provider id (`anthropic`, `openrouter`, …). */
    provider: string;

    /** Thinking level, when the model supports reasoning. */
    thinking: string | undefined;

    /** Every thinking level the model supports, in display order (`off` first). */
    thinkingLevels: readonly string[];
}

/** Blank columns between the art and the text block. */
const ANSI_RHGAP = 2;

/**
 * Height of the banner whenever art is drawn: the art grid of
 * `scripts/build-logos.sh`. The art is trimmed to its drawn rows, so without a
 * fixed height the header would change size when the model changes.
 */
const ART_ROWS = 10;

/**
 * Minimum columns needed for the text header itself.
 * Should the terminal be too narrow, the ansi art is dropped.
 */
const MIN_TEXT_WIDTH = 28;

/**
 * Capitalizes the first letter of a given text.
 * @param text Text to capitalize.
 * @returns Capitalized text.
 */
function capitalizeFirst(text: string): string {
    return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * The startup banner: art on the left, model facts on the right.
 */
export class BannerHeader implements Component {
    /** Last rendered lines and the state they were built from. */
    private cache: { key: string; lines: string[] } | undefined;
    /** The TUI, for repaints. */
    private readonly tui: TUI;
    /** Theme for the text block. */
    private readonly theme: Theme;
    /** The model facts to render. */
    private state: BannerState;

    /** Bind the TUI, theme and initial state. */
    constructor(tui: TUI, theme: Theme, state: BannerState) {
        this.tui = tui;
        this.theme = theme;
        this.state = state;
    }

    /** Swap in new model facts and repaint. */
    setState(state: BannerState): void {
        this.state = state;
        this.invalidate();
        this.tui.requestRender();
    }

    /** Drop the cached lines. */
    invalidate(): void {
        this.cache = undefined;
    }

    /** Banner lines at `width`, rebuilt when the state or width changes. */
    render(width: number): string[] {
        const key = [
            width,
            this.state.family,
            this.state.modelName,
            this.state.modelId,
            this.state.provider,
            this.state.thinking ?? "",
            this.state.thinkingLevels.join(","),
        ].join("\u0000");

        if (this.cache?.key === key) return this.cache.lines;

        const lines = this.build(width);
        this.cache = { key, lines };
        return lines;
    }

    /** Compose the banner, dropping art when it does not fit beside the text. */
    private build(width: number): string[] {
        const art = logoLines(this.state.family);
        const info = this.infoLines();

        if (width <= 0) return [];

        const artCells = art ? artWidth(art) : 0;
        // Never wrap art: only draw it when the text block still fits beside it.
        const showArt = art !== undefined && artCells > 0 && artCells + ANSI_RHGAP + MIN_TEXT_WIDTH <= width;

        if (!showArt) {
            return info.map((line) => truncateToWidth(line, width));
        }

        const rows = Math.max(ART_ROWS, art.length, info.length);
        const lines: string[] = [];

        // The text starts on the first line; the art is centred in the fixed
        // height, so a short mark sits where it did in its 20x10 grid.
        const artTop = Math.floor((rows - art.length) / 2);

        for (let row = 0; row < rows; row += 1) {
            const left = art[row - artTop] ?? "";
            const padding = " ".repeat(Math.max(0, artCells - visibleWidth(left)));
            const right = info[row] ?? "";
            const line = truncateToWidth(left + padding + " ".repeat(ANSI_RHGAP) + right, width);
            lines.push(line.replace(/[ \t]+$/, ""));
        }
        return lines;
    }

    /**
     * The facts block, one labelled line per fact, then the version and the key
     * hints:
     *
     *     Model: Claude Sonnet 4.5 (ctrl+p)
     *     Vendor: Anthropic
     *     Provider: Anthropic
     *     Thinking:  off · minimal ·[low]· medium · high  (shift+tab)
     *
     *     pi v1.5.0
     *     / commands · ! bash · ctrl+o more
     */
    private infoLines(): string[] {
        const { theme, state } = this;
        const name = state.modelName || state.modelId || "no model";

        const lines = [
            `${theme.fg("dim", "Model: ")}${theme.style(name, { fg: this.nameColor(), bold: true })}${this.hotkey(
                "app.model.cycleForward",
                " ",
            )}`,
            this.fact("Vendor", this.vendorLabel()),
            this.fact("Provider", capitalizeFirst(state.provider || "unknown")),
        ];

        // Models without reasoning have no thinking level to report or switch.
        if (state.thinking) {
            lines.push(this.thinkingLine(state.thinking));
        }

        lines.push("");
        lines.push(theme.fg("dim", `pi v${VERSION}`));
        lines.push(this.hints());
        return lines;
    }

    /**
     * The thinking line lists every level the model supports, so the whole
     * cycle is visible at a glance. Levels are separated by ` · `, with two
     * plain spaces before the first and after the last. The selected level is
     * wrapped in brackets using the banner's default active colour; each
     * bracket replaces the adjacent space, so selecting a level never changes
     * the line's width. Unselected levels stay dim.
     */
    private thinkingLine(selected: string): string {
        const { theme, state } = this;
        const levels = state.thinkingLevels.length > 0 ? state.thinkingLevels : [selected];
        const selectedIndex = levels.indexOf(selected);
        const gaps = Array.from({ length: levels.length + 1 }, (_, index) =>
            index === 0 || index === levels.length ? "  " : " · ",
        );

        if (selectedIndex >= 0) {
            // The bracket takes the space next to the selected level, keeping the dot and the line width intact.
            gaps[selectedIndex] = gaps[selectedIndex].slice(0, -1) as ("  " | " · ");
            gaps[selectedIndex + 1] = gaps[selectedIndex + 1].slice(1) as ("  " | " · ");
        }

        // Gaps are built as plain text first so brackets can replace a space;
        // only then is the dot styled, so no escape sequence gets split.
        const styleGap = (gap: string) => gap.replace("·", theme.fg("dim", "·"));
        let body = styleGap(gaps[0]);
        for (let index = 0; index < levels.length; index += 1) {
            if (index > 0) body += styleGap(gaps[index]);
            const level = levels[index];
            body +=
                index === selectedIndex
                    ? theme.fg("muted", `[${level}]`)
                    : theme.fg("dim", level);
        }
        body += styleGap(gaps[levels.length]);

        const hotkey = this.hotkey("app.thinking.cycle");
        // Without a hotkey the closing padding would only leave trailing spaces.
        return `${theme.fg("dim", "Thinking:")}${hotkey ? body + hotkey : body.trimEnd()}`;
    }

    /**
     * `(key)` for a keybinding, dimmed and preceded by `prefix`, or an empty
     * string when the user has no key bound to it.
     */
    private hotkey(keybinding: Parameters<typeof keyText>[0], prefix = ""): string {
        const key = keyText(keybinding);
        return key ? this.theme.fg("dim", `${prefix}(${key})`) : "";
    }

    /**
     * The model name's colour: the logo's primary brand colour, or the theme
     * accent when there is no art to sample.
     */
    private nameColor(): Color | "accent" {
        return primaryColor(this.state.family) ?? "accent";
    }

    /** `Label: value`, label dim and value muted. */
    private fact(label: string, value: string): string {
        return `${this.theme.fg("dim", `${label}: `)}${this.theme.fg("muted", value)}`;
    }

    /**
     * The lab behind the model, i.e. the family label. `default` is Pi's own
     * logo for a model we cannot attribute, so it has no vendor name.
     */
    private vendorLabel(): string {
        if (this.state.family === "default") return "Unknown";
        return FAMILY_LABELS[this.state.family];
    }

    /**
     * A cheap subset of the built-in header's key hints, using the user's
     * keybindings. The model and thinking hotkeys live on their own lines above.
     */
    private hints(): string {
        const separator = this.theme.fg("dim", " · ");
        return [
            rawKeyHint("/", "commands"),
            rawKeyHint("!", "bash"),
            keyHint("app.tools.expand", "more"),
        ].join(separator);
    }
}
