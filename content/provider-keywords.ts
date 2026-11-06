/**
 * Provider-id → family keyword table.
 *
 * Content module: plain data, no side effects.
 */

import type { Family } from "./families.ts";

/** Provider ids, checked when the model id says nothing. */
export const PROVIDER_KEYWORDS: ReadonlyArray<readonly [Family, readonly string[]]> = [
    ["anthropic", ["anthropic", "claude"]],
    ["openai", ["openai", "azure"]],
    ["google", ["google", "vertex", "gemini"]],
    ["mistral", ["mistral"]],
    ["xai", ["xai", "x-ai"]],
    ["deepseek", ["deepseek"]],
    ["qwen", ["qwen", "dashscope", "alibaba"]],
    ["moonshot", ["moonshot", "kimi"]],
    ["zai", ["zai", "z-ai", "zhipu"]],
    ["minimax", ["minimax"]],
    ["meta", ["meta", "llama"]],
];
