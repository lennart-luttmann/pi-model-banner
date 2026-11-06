import assert from "node:assert/strict";
import { test } from "node:test";

import { FAMILIES } from "../content/families.ts";
import { FAMILY_LABELS } from "../content/labels.ts";
import {
    familyFor,
    isFamily,
    normalizeModelId,
    resolveFamily,
} from "../lib/family.ts";

test("every family has a label", () => {
    for (const family of FAMILIES) {
        assert.equal(typeof FAMILY_LABELS[family], "string");
        assert.ok(FAMILY_LABELS[family].length > 0);
    }
});

test("model ids map to their lab", () => {
    const cases: Array<[string, string]> = [
        ["claude-sonnet-4-5-20250929", "anthropic"],
        ["claude-3-5-haiku-latest", "anthropic"],
        ["gpt-5", "openai"],
        ["gpt-4o-mini", "openai"],
        ["gpt-oss-120b", "openai"],
        ["o1", "openai"],
        ["o3-mini", "openai"],
        ["o4", "openai"],
        ["codex-mini-latest", "openai"],
        ["gemini-2.5-pro", "google"],
        ["gemini-2.0-flash-lite", "google"],
        ["gemma-3-27b-it", "google"],
        ["mistral-large-latest", "mistral"],
        ["codestral-2501", "mistral"],
        ["devstral-small", "mistral"],
        ["magistral-medium", "mistral"],
        ["grok-4", "xai"],
        ["deepseek-chat", "deepseek"],
        ["deepseek-r1", "deepseek"],
        ["qwen3-coder", "qwen"],
        ["kimi-k2", "moonshot"],
        ["glm-4.6", "zai"],
        ["minimax-m2", "minimax"],
        ["llama-3.3-70b-instruct", "meta"],
    ];

    for (const [modelId, expected] of cases) {
        assert.equal(familyFor("unknown-provider", modelId), expected, modelId);
    }
});

test("the model id beats the provider id (routers host other labs' models)", () => {
    assert.equal(familyFor("openrouter", "anthropic/claude-sonnet-4"), "anthropic");
    assert.equal(familyFor("openrouter", "openai/gpt-5"), "openai");
    assert.equal(familyFor("amazon-bedrock", "anthropic.claude-3-5-sonnet-20241022-v2:0"), "anthropic");
    assert.equal(familyFor("google-vertex", "models/gemini-2.5-flash"), "google");
    assert.equal(familyFor("azure-openai", "grok-4"), "xai");
});

test("the provider id is the fallback when the model id is unfamiliar", () => {
    assert.equal(familyFor("anthropic", "mystery-1"), "anthropic");
    assert.equal(familyFor("openai", "mystery-1"), "openai");
    assert.equal(familyFor("google", "mystery-1"), "google");
    assert.equal(familyFor("mistral", "mystery-1"), "mistral");
    assert.equal(familyFor("xai", "mystery-1"), "xai");
    assert.equal(familyFor("deepseek", "mystery-1"), "deepseek");
    assert.equal(familyFor("moonshotai", "mystery-1"), "moonshot");
    assert.equal(familyFor("zai", "mystery-1"), "zai");
    assert.equal(familyFor("minimax", "mystery-1"), "minimax");
    assert.equal(familyFor("llama.cpp", "mystery-1"), "meta");
});

test("unknown models and providers fall back to the Pi logo", () => {
    assert.equal(familyFor("openrouter", "some-random-model"), "default");
    assert.equal(familyFor("my-local-llm", "my-finetune-7b"), "default");
    assert.equal(familyFor("", ""), "default");
    assert.equal(familyFor(undefined as unknown as string, undefined as unknown as string), "default");
});

test("model ids are normalized before matching", () => {
    assert.equal(normalizeModelId("Anthropic/Claude-Sonnet-4"), "claude-sonnet-4");
    assert.equal(normalizeModelId("claude-sonnet-4[1m]"), "claude-sonnet-4");
    assert.equal(normalizeModelId("claude-3-5-sonnet@20240620"), "claude-3-5-sonnet");
    assert.equal(normalizeModelId("models/gemini-2.5-pro"), "gemini-2.5-pro");
    assert.equal(normalizeModelId("deepseek/deepseek-r1:free"), "deepseek-r1");
    assert.equal(normalizeModelId("  GPT-5  "), "gpt-5");

    assert.equal(familyFor("openrouter", "anthropic/claude-3-5-sonnet@20240620"), "anthropic");
    assert.equal(familyFor("openrouter", "claude-sonnet-4[1m]"), "anthropic");
    assert.equal(familyFor("openrouter", "google/gemini-2.5-pro:free"), "google");
});

test("user overrides win over the built-in rules", () => {
    const overrides = {
        "my-local-model": "meta",
        "MiniMax-M2": "qwen",
        "openrouter/some-random-model": "mistral",
        "gpt-5": "not-a-family",
    };

    assert.equal(resolveFamily("local", "my-local-model", overrides), "meta");
    assert.equal(resolveFamily("local", "minimax-m2", overrides), "qwen");
    assert.equal(resolveFamily("openrouter", "some-random-model", overrides), "mistral");
    // An override pointing at an unknown family is ignored.
    assert.equal(resolveFamily("openai", "gpt-5", overrides), "openai");
    // No override → normal mapping.
    assert.equal(resolveFamily("anthropic", "claude-sonnet-4", overrides), "anthropic");
    assert.equal(resolveFamily("anthropic", "claude-sonnet-4"), "anthropic");
});

test("isFamily only accepts shipped families", () => {
    assert.equal(isFamily("anthropic"), true);
    assert.equal(isFamily("default"), true);
    assert.equal(isFamily("Anthropic"), false);
    assert.equal(isFamily("nope"), false);
    assert.equal(isFamily(undefined), false);
});
