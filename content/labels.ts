/**
 * Human-readable family names.
 *
 * Content module: plain data, no side effects.
 */

import type { Family } from "./families.ts";

/** Human-readable names, shown as the banner's `Vendor:` and in `/banner status`. */
export const FAMILY_LABELS: Record<Family, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    mistral: "Mistral",
    xai: "xAI",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    moonshot: "Moonshot",
    zai: "Z.ai",
    minimax: "MiniMax",
    meta: "Meta",
    default: "Pi",
};
