/**
 * Layout tests for the banner header.
 *
 * These do not start a TUI: the component only needs a theme (for styling) and
 * a `requestRender()` sink. `initTheme` primes Pi's global theme/keybindings so
 * the key hints render like they do in a session.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { initTheme, keyText } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, setKeybindings, visibleWidth } from "@earendil-works/pi-tui";

import type { BannerState } from "../lib/header.ts";
import { BannerHeader } from "../lib/header.ts";
import { availableFamilies, primaryColor } from "../lib/ansi.ts";

initTheme("dark", false);
// The header renders hotkeys through `keyText()`, which needs a keybindings
// manager. Interactive mode installs one at startup; here we install the
// defaults for the three keys the banner shows.
setKeybindings(
    new KeybindingsManager({
        "app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle to next model" },
        "app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
        "app.tools.expand": { defaultKeys: "ctrl+o", description: "Expand tools" },
    }),
);
const MODEL_KEY = keyText("app.model.cycleForward");
const THINKING_KEY = keyText("app.thinking.cycle");

/** Styling-free theme: keeps assertions about visible width honest. */
const theme = {
    fg: (_color: string, text: string) => text,
    style: (text: string) => text,
} as unknown as ConstructorParameters<typeof BannerHeader>[1];

function makeHeader(state: Partial<BannerState> = {}) {
    let renders = 0;
    const tui = { requestRender: () => { renders += 1; } } as unknown as ConstructorParameters<typeof BannerHeader>[0];
    const header = new BannerHeader(tui, theme, {
        family: "anthropic",
        modelName: "Claude Sonnet 4.5",
        modelId: "claude-sonnet-4-5-20250929",
        provider: "anthropic",
        thinking: "high",
        thinkingLevels: ["off", "minimal", "low", "medium", "high"],
        ...state,
    });
    return { header, renders: () => renders };
}

const BLOCK = /[\u2800-\u28ff]/;

test("no line ever exceeds the available width", () => {
    for (const width of [200, 120, 100, 80, 70, 60, 50, 40, 30, 20, 10, 1]) {
        const { header } = makeHeader();
        for (const line of header.render(width)) {
            assert.ok(
                visibleWidth(line) <= width,
                `width ${width}: line is ${visibleWidth(line)} cells: ${JSON.stringify(line)}`,
            );
            assert.ok(!line.includes("\n"), `width ${width}: line contains a newline`);
        }
    }
});

test("the logo is drawn beside the model facts when there is room", () => {
    const { header } = makeHeader();
    const lines = header.render(100);

    assert.ok(lines.some((line) => BLOCK.test(line)), "expected Braille dot art");
    assert.ok(lines[0].includes("Model: Claude Sonnet 4.5"), "the model name is on the first line");
    assert.equal(MODEL_KEY, "ctrl+p");
    assert.ok(lines[0].includes(`(${MODEL_KEY})`), "the model hotkey is on the model line");
    assert.ok(lines.some((line) => line.includes("Vendor: Anthropic")), "the vendor is shown");
    assert.ok(lines.some((line) => line.includes("Provider: Anthropic")), "the provider is shown, capitalized");
    assert.ok(lines.some((line) => line.includes("Thinking: ")), "thinking levels are shown");
    assert.ok(lines.some((line) => line.includes(`(${THINKING_KEY})`)), "the thinking hotkey is on the thinking line");
    assert.ok(lines.some((line) => line.includes("pi v")), "version is shown");
});

test("the facts follow the documented line order", () => {
    // 30 columns: text-only, so the info lines are contiguous and in order.
    const { header } = makeHeader();
    const lines = header.render(30).map((line) => line.replace(/[\u2800-\u28ff]/g, ""));

    const order = ["Model: ", "Vendor: ", "Provider: ", "Thinking: ", "pi v", "commands"];
    const indices = order.map((label) => lines.findIndex((line) => line.includes(label)));

    for (const [i, index] of indices.entries()) {
        assert.ok(index >= 0, `missing line for ${order[i]}`);
    }
    for (let i = 1; i < indices.length; i += 1) {
        assert.ok(indices[i] > indices[i - 1], `${order[i]} should follow ${order[i - 1]}`);
    }

    // A blank buffer line separates the facts from the version + hotkeys.
    assert.equal(lines[indices[4] - 1].trim(), "", "blank line before the version");
});

test("the thinking line lists every level and highlights the selected one", () => {
    const calls: Array<{ kind: "fg" | "style"; color?: string; text: string; options?: unknown }> = [];
    const recording = {
        fg: (color: string, text: string) => {
            calls.push({ kind: "fg", color, text });
            return text;
        },
        style: (text: string, options: unknown) => {
            calls.push({ kind: "style", text, options });
            return text;
        },
    } as unknown as ConstructorParameters<typeof BannerHeader>[1];

    const header = new BannerHeader(
        { requestRender: () => {} } as unknown as ConstructorParameters<typeof BannerHeader>[0],
        recording,
        {
            family: "anthropic",
            modelName: "Claude Sonnet 4.5",
            modelId: "claude-sonnet-4-5-20250929",
            provider: "anthropic",
            thinking: "medium",
            thinkingLevels: ["off", "minimal", "low", "medium", "high"],
        },
    );
    const line = header.render(100).find((entry) => entry.includes("Thinking: "));

    assert.ok(line, "the thinking line is rendered");
    const thinking = line.slice(line.indexOf("Thinking:"));
    assert.equal(
        thinking,
        "Thinking:  off · minimal · low ·[medium]· high  (shift+tab)",
        "levels are separated by dots and the selected level is bracketed",
    );
    assert.ok(
        calls.some((call) => call.kind === "fg" && call.color === "muted" && call.text === "[medium]"),
        "the selected level and its brackets use the default active colour",
    );

    for (const level of ["off", "minimal", "low", "high"]) {
        assert.ok(
            calls.some((call) => call.kind === "fg" && call.color === "dim" && call.text === level),
            `${level} is dimmed`,
        );
    }
    assert.ok(
        calls.some((call) => call.kind === "fg" && call.color === "dim" && call.text === "·"),
        "the gap dots are dimmed",
    );
});

test("selecting a thinking level never changes the line width", () => {
    const levels = ["off", "minimal", "low", "medium", "high"];
    const lines = levels.map((thinking) => {
        const { header } = makeHeader({ thinking, thinkingLevels: levels });
        const line = header.render(100).find((entry) => entry.includes("Thinking: "));
        assert.ok(line, `the thinking line is rendered for ${thinking}`);
        return line.slice(line.indexOf("Thinking:"));
    });

    assert.equal(new Set(lines.map((line) => line.length)).size, 1, "the line width is stable across selections");
    assert.equal(
        lines[0],
        "Thinking: [off]· minimal · low · medium · high  (shift+tab)",
        "a leading selection keeps the end padding",
    );
    assert.equal(
        lines[lines.length - 1],
        "Thinking:  off · minimal · low · medium ·[high] (shift+tab)",
        "a trailing selection keeps the start padding",
    );
});

test("no blank line above the banner", () => {
    // The art is padded to the fixed 20x10 grid, so several marks start with
    // empty rows. Those are trimmed instead of rendered above the header.
    for (const family of ["google", "meta", "deepseek", "anthropic"] as const) {
        const { header } = makeHeader({ family });
        const lines = header.render(100);

        assert.ok(lines[0].trim() !== "", `${family}: the first line draws something`);
    }
});

test("the banner keeps one height across families and thinking states", () => {
    const heights = new Set<number>();
    for (const family of availableFamilies()) {
        for (const thinking of ["high", undefined]) {
            const { header } = makeHeader({ family: family as BannerState["family"], thinking });
            heights.add(header.render(100).length);
        }
    }

    assert.equal(heights.size, 1, `heights: ${[...heights].join(", ")}`);
});

test("unbound hotkeys leave no empty brackets", () => {
    setKeybindings(
        new KeybindingsManager({
            "app.model.cycleForward": { defaultKeys: [], description: "Cycle to next model" },
            "app.thinking.cycle": { defaultKeys: [], description: "Cycle thinking level" },
            "app.tools.expand": { defaultKeys: "ctrl+o", description: "Expand tools" },
        }),
    );
    try {
        const { header } = makeHeader({ thinking: "high" });
        const lines = header.render(100);

        assert.ok(lines[0].endsWith("Model: Claude Sonnet 4.5"), "nothing follows the model name");
        assert.ok(
            lines.some((line) => line.endsWith("Thinking:  off · minimal · low · medium ·[high]")),
            "the thinking line ends at the last level",
        );
        assert.ok(!lines.some((line) => line.includes("()")), "no empty brackets");
    } finally {
        setKeybindings(
            new KeybindingsManager({
                "app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle to next model" },
                "app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
                "app.tools.expand": { defaultKeys: "ctrl+o", description: "Expand tools" },
            }),
        );
    }
});

test("the art is dropped instead of wrapping on narrow terminals", () => {
    const { header } = makeHeader();
    const lines = header.render(30);

    assert.ok(!lines.some((line) => BLOCK.test(line)), "no art at 30 columns");
    assert.ok(lines.some((line) => line.includes("Vendor: Anthropic")), "the vendor still labels the header");
    assert.ok(lines.some((line) => line.includes("Model: Claude Sonnet 4.5")));
});

test("70 columns keeps the art and the model name", () => {
    const { header } = makeHeader();
    const lines = header.render(70);

    assert.ok(lines.some((line) => BLOCK.test(line)));
    assert.ok(lines[0].includes("Model: Claude Sonnet 4.5"));
    assert.ok(lines.every((line) => visibleWidth(line) <= 70));
});

test("an unknown family falls back to the Pi logo", () => {
    const { header } = makeHeader({ family: "default", provider: "local", modelId: "my-model", modelName: "My Model" });
    const lines = header.render(100);

    assert.ok(lines.some((line) => BLOCK.test(line)));
    assert.ok(lines.some((line) => line.includes("Vendor: Unknown")), "no vendor is claimed for an unknown model");
    assert.ok(lines.some((line) => line.includes("Provider: Local")));
});

test("provider ids get a capital first letter", () => {
    const { header } = makeHeader({ family: "default", provider: "openrouter", modelId: "my-model", modelName: "My Model" });
    const lines = header.render(100);

    assert.ok(lines.some((line) => line.includes("Provider: Openrouter")));
    assert.ok(lines.some((line) => line.includes("Vendor: Unknown")));
});

test("models without reasoning show no thinking level", () => {
    const { header } = makeHeader({ thinking: undefined, thinkingLevels: [] });
    const lines = header.render(100);

    assert.ok(!lines.some((line) => line.includes("Thinking:")));
    assert.ok(!lines.some((line) => THINKING_KEY !== "" && line.includes(`(${THINKING_KEY})`)));
});

test("the model name is tinted with the logo's primary colour", () => {
    const styled: Array<{ text: string; fg: unknown }> = [];
    const recording = {
        fg: (_color: string, text: string) => text,
        style: (text: string, options: { fg?: unknown }) => {
            styled.push({ text, fg: options?.fg });
            return text;
        },
    } as unknown as ConstructorParameters<typeof BannerHeader>[1];

    const header = new BannerHeader(
        { requestRender: () => {} } as unknown as ConstructorParameters<typeof BannerHeader>[0],
        recording,
        {
            family: "anthropic",
            modelName: "Claude Sonnet 4.5",
            modelId: "claude-sonnet-4-5-20250929",
            provider: "anthropic",
            thinking: "high",
            thinkingLevels: ["off", "minimal", "low", "medium", "high"],
        },
    );
    header.render(100);

    const name = styled.find((entry) => entry.text === "Claude Sonnet 4.5");
    assert.ok(name, "the model name is styled");
    assert.deepEqual(name.fg, primaryColor("anthropic"));
    assert.notEqual(name.fg, "accent");
});

test("setState invalidates the cache and asks the TUI for a repaint", () => {
    const { header, renders } = makeHeader();
    const before = header.render(100);

    header.setState({
        family: "openai",
        modelName: "GPT-5",
        modelId: "gpt-5",
        provider: "openai",
        thinking: "off",
        thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });

    assert.equal(renders(), 1, "requestRender is called once");
    assert.notDeepEqual(header.render(100), before);
    const after = header.render(100);
    assert.ok(after[0].includes("Model: GPT-5"));
    assert.ok(after.some((line) => line.includes("Vendor: OpenAI")));
    assert.ok(after.some((line) => line.includes("Thinking: [off]")), "the new selection is bracketed");
});

test("repeated renders reuse the cached lines", () => {
    const { header } = makeHeader();
    const first = header.render(100);
    const second = header.render(100);

    assert.equal(first, second, "identical width and state should hit the cache");
    header.invalidate();
    assert.notEqual(header.render(100), first, "invalidate() rebuilds");
});
