/**
 * The families we ship logo art for.
 *
 * Content module: plain data, no imports and no side effects, so the mapping
 * logic in `lib/family.ts` and the logo scripts can both read it.
 */

/**
 * Every family that can have its own art file in `content/ansi/`.
 *
 * Adding one means an `icons/<family>.svg` (rules in the header of
 * `scripts/build-logos.sh`), a label in `content/labels.ts`, and keywords in
 * `content/model-keywords.ts` / `content/provider-keywords.ts`.
 * `scripts/check-logos.py` then fails until the regenerated art exists.
 */
export const FAMILIES = [
    "anthropic",
    "openai",
    "google",
    "mistral",
    "xai",
    "deepseek",
    "qwen",
    "moonshot",
    "zai",
    "minimax",
    "meta",
    "default",
] as const;

/** A family we ship logo art for. */
export type Family = (typeof FAMILIES)[number];
