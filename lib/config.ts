/**
 * Config file handling for the model banner.
 *
 * The file is optional. A missing file means "enabled, no overrides". A broken
 * file falls back to the same defaults for whatever could not be read, plus a
 * one-line warning the extension surfaces on `session_start` instead of failing
 * to load.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 
 * File name inside the agent directory (`~/.pi/agent/`). 
 */
export const CONFIG_FILE = "model-banner.json";

/** Settings read from the config file. */
export interface BannerConfig {

    /** Set to false to keep the built-in Pi header. */
    enabled: boolean;

    /** `{ "my-model": "meta" }` — model id (or `provider/model`) to family. */
    overrides: Record<string, string>;
}

/** The config as loaded: the settings plus where they came from and any problem. */
export interface LoadedConfig extends BannerConfig {

    /** Absolute path that was read (whether or not it exists). */
    path: string;

    /** Human-readable problem with the file, when it could not be used. */
    error?: string;
}

/** Default config location: `~/.pi/agent/model-banner.json`. */
export function configPath(): string {
    return join(getAgentDir(), CONFIG_FILE);
}

/** Config used when the file is missing or unusable. */
const DEFAULTS = (): BannerConfig => ({ enabled: true, overrides: {} });

/** `overrides` validated, or the problem with it. */
function readOverrides(value: unknown): Record<string, string> | string {
    if (value === undefined) return {};
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `"overrides" must be an object of model id → family`;
    }
    const overrides: Record<string, string> = {};
    for (const [key, family] of Object.entries(value as Record<string, unknown>)) {
        if (typeof family !== "string") return `override "${key}" must be a family name string`;
        overrides[key] = family;
    }
    return overrides;
}

/**
 * Read and validate the config file.
 * Never throws.
 * Each setting is validated on its own, so a bad `overrides` block does not
 * undo a valid `"enabled": false`. Unreadable JSON falls back to the defaults.
 */
export function loadConfig(path: string = configPath()): LoadedConfig {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return { ...DEFAULTS(), path };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ...DEFAULTS(), path, error: `ignoring ${path}: ${message}` };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ...DEFAULTS(), path, error: `ignoring ${path}: expected a JSON object` };
    }

    const record = parsed as Record<string, unknown>;
    const config: LoadedConfig = { ...DEFAULTS(), path };
    const problems: string[] = [];

    if (typeof record.enabled === "boolean") {
        config.enabled = record.enabled;
    } else if (record.enabled !== undefined) {
        problems.push(`"enabled" must be true or false`);
    }

    const overrides = readOverrides(record.overrides);
    if (typeof overrides === "string") problems.push(overrides);
    else config.overrides = overrides;

    if (problems.length > 0) config.error = `ignoring parts of ${path}: ${problems.join("; ")}`;
    return config;
}
