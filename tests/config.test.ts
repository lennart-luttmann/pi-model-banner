/**
 * Config-file tests. `loadConfig` takes an explicit path so nothing here needs
 * the real `~/.pi/agent/` directory.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfig } from "../lib/config.ts";

function withConfig(contents: string): string {
    const directory = mkdtempSync(join(tmpdir(), "model-banner-"));
    const path = join(directory, "model-banner.json");
    writeFileSync(path, contents, "utf8");
    return path;
}

test("a missing file means enabled with no overrides", () => {
    const config = loadConfig(join(tmpdir(), "definitely-not-here", "model-banner.json"));

    assert.equal(config.enabled, true);
    assert.deepEqual(config.overrides, {});
    assert.equal(config.error, undefined);
});

test("enabled and overrides are read", () => {
    const config = loadConfig(withConfig(JSON.stringify({ enabled: false, overrides: { "my-model": "meta" } })));

    assert.equal(config.enabled, false);
    assert.deepEqual(config.overrides, { "my-model": "meta" });
    assert.equal(config.error, undefined);
});

test("partial configs fall back to defaults", () => {
    const config = loadConfig(withConfig(JSON.stringify({ overrides: { x: "openai" } })));

    assert.equal(config.enabled, true);
    assert.deepEqual(config.overrides, { x: "openai" });
});

test("broken JSON is reported, not thrown", () => {
    const config = loadConfig(withConfig("{ nope"));

    assert.equal(config.enabled, true);
    assert.deepEqual(config.overrides, {});
    assert.match(config.error ?? "", /ignoring .*model-banner\.json/);
});

test("wrong shapes are reported, not thrown", () => {
    for (const body of ["[]", "null", '"text"', JSON.stringify({ enabled: "yes" }), JSON.stringify({ overrides: [] })]) {
        const config = loadConfig(withConfig(body));
        assert.equal(config.enabled, true, `body ${body}`);
        assert.deepEqual(config.overrides, {}, `body ${body}`);
        assert.ok(config.error, `body ${body} should report an error`);
    }
});

test("a bad overrides block keeps a valid enabled: false", () => {
    const config = loadConfig(withConfig(JSON.stringify({ enabled: false, overrides: { x: 1 } })));

    assert.equal(config.enabled, false);
    assert.deepEqual(config.overrides, {});
    assert.match(config.error ?? "", /override "x"/);
});

test("a bad enabled value keeps valid overrides", () => {
    const config = loadConfig(withConfig(JSON.stringify({ enabled: "no", overrides: { x: "meta" } })));

    assert.equal(config.enabled, true);
    assert.deepEqual(config.overrides, { x: "meta" });
    assert.match(config.error ?? "", /"enabled"/);
});
