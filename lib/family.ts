/**
 * Model to logo family mapping.
 *
 * This module is deliberately dependency-free and side-effect-free so it can be
 * unit tested without a TUI, a session, or Pi itself. The constant tables it
 * matches against live in `content/`.
 */

import { FAMILIES, type Family } from "../content/families.ts";
import { MODEL_KEYWORDS } from "../content/model-keywords.ts";
import { PROVIDER_KEYWORDS } from "../content/provider-keywords.ts";

/**
 * The OpenAI reasoning line (`o1`, `o3-mini`, `o4`, …), matched as a word.
 */
const O_SERIES = /(?:^|[^a-z0-9])o[1-9](?:$|[^a-z0-9])/;

/** True when `value` names a family we ship art for. */
export function isFamily(value: unknown): value is Family {
    return typeof value === "string" && (FAMILIES as readonly string[]).includes(value);
}

/**
 * Normalize a model id for keyword matching.
 *
 * - lowercase
 * - drop bracketed qualifiers (`claude-sonnet-4[1m]`)
 * - drop a `vendor/` / `models/` prefix (`anthropic/claude-…`, `models/gemini-…`)
 * - drop `@date` suffixes (`claude-3-5-sonnet@20240620`)
 * - drop `:free` / `:beta` / bedrock `:0` suffixes
 */
export function normalizeModelId(modelId: string): string {
    let id = (modelId ?? "").trim().toLowerCase();
    id = id.replace(/\[[^\]]*\]/g, "");
    const slash = id.lastIndexOf("/");
    if (slash !== -1) id = id.slice(slash + 1);
    id = id.replace(/@.*$/, "");
    id = id.replace(/:[a-z0-9_.-]+$/, "");
    return id.trim();
}

/** First rule whose keyword appears in `haystack`. */
function matchKeywords(haystack: string, rules: ReadonlyArray<readonly [Family, readonly string[]]>): Family | undefined {
    if (!haystack) return undefined;
    for (const [family, keywords] of rules) {
        for (const keyword of keywords) {
            if (haystack.includes(keyword)) return family;
        }
    }
    return undefined;
}

/**
 * Map a provider/model pair to a logo family.
 *
 * The model id is consulted first (routers host other labs' models), then the
 * provider id, and finally `"default"`, which is the Pi logo.
 */
export function familyFor(provider: string, modelId: string): Family {
    const id = normalizeModelId(modelId);
    const byModel = matchKeywords(id, MODEL_KEYWORDS) ?? (O_SERIES.test(id) ? "openai" : undefined);
    if (byModel) return byModel;

    const providerId = (provider ?? "").trim().toLowerCase();
    return matchKeywords(providerId, PROVIDER_KEYWORDS) ?? "default";
}

/**
 * Like {@link familyFor}, but honors user overrides from the config file.
 *
 * Override keys may be the raw model id (`MiniMax-M2`), the normalized id
 * (`minimax-m2`), or `provider/model` (`openrouter/minimax-m2`). Keys are
 * compared case-insensitively; values that are not a known family are ignored.
 */
export function resolveFamily(
    provider: string,
    modelId: string,
    overrides: Readonly<Record<string, string>> = {},
): Family {
    const override = findOverride(provider, modelId, overrides);
    return override ?? familyFor(provider, modelId);
}

/** The override matching this model, if any. */
function findOverride(
    provider: string,
    modelId: string,
    overrides: Readonly<Record<string, string>>,
): Family | undefined {
    const entries = Object.entries(overrides ?? {});
    if (entries.length === 0) return undefined;

    const lookup = new Map<string, string>();
    for (const [key, value] of entries) {
        if (typeof value === "string") lookup.set(key.trim().toLowerCase(), value.trim().toLowerCase());
    }

    const normalized = normalizeModelId(modelId);
    const raw = (modelId ?? "").trim().toLowerCase();
    const providerId = (provider ?? "").trim().toLowerCase();
    const candidates = [
        raw,
        normalized,
        `${providerId}/${raw}`,
        `${providerId}/${normalized}`,
    ];

    for (const candidate of candidates) {
        const value = lookup.get(candidate);
        if (isFamily(value)) return value;
    }
    return undefined;
}
