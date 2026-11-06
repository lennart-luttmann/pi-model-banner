/**
 * Model-id → family keyword table.
 *
 * Content module: plain data, no side effects.
 */

import type { Family } from "./families.ts";

/**
 * Model-id keywords, checked in order. The id wins over the provider because
 * routers (OpenRouter, Bedrock, Vertex, Azure, custom providers) serve other
 * labs' models: `openrouter` + `anthropic/claude-…` must render Anthropic art.
 */
export const MODEL_KEYWORDS: ReadonlyArray<readonly [Family, readonly string[]]> = [
    ["anthropic", ["claude"]],
    ["openai", ["gpt", "codex", "chatgpt"]],
    ["google", ["gemini", "gemma"]],
    ["mistral", ["mistral", "codestral", "devstral", "magistral"]],
    ["xai", ["grok"]],
    ["deepseek", ["deepseek"]],
    ["qwen", ["qwen"]],
    ["moonshot", ["kimi", "moonshot"]],
    ["zai", ["glm"]],
    ["minimax", ["minimax"]],
    ["meta", ["llama"]],
];
