#!/usr/bin/env node
/**
 * Link Pi's host-provided packages into ./node_modules so `node --test` can
 * import the extension's modules.
 *
 * Pi supplies `@earendil-works/pi-tui`, `pi-ai`, `pi-agent-core` and
 * `pi-coding-agent` to extensions at runtime, so they are not dependencies of
 * this package. Plain Node does not know about that mapping, hence these
 * symlinks. They are dev-only and gitignored.
 *
 * Usage: node scripts/link-pi-deps.mjs
 * Override discovery with MODEL_BANNER_PI_DIR=/path/to/pi-coding-agent.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_PACKAGES = ["pi-tui", "pi-ai", "pi-agent-core", "pi-coding-agent"];
const SCOPE = "@earendil-works";

function findCodingAgentDir() {
    if (process.env.MODEL_BANNER_PI_DIR) return resolve(process.env.MODEL_BANNER_PI_DIR);

    let binary;
    try {
        const which = process.platform === "win32" ? "where" : "which";
        binary = execFileSync(which, ["pi"], { encoding: "utf8" }).trim().split("\n")[0];
    } catch {
        throw new Error("could not find the `pi` binary; set MODEL_BANNER_PI_DIR to the pi-coding-agent package");
    }

    let dir = dirname(realpathSync(binary));
    for (let depth = 0; depth < 8; depth += 1) {
        const manifest = join(dir, "package.json");
        if (existsSync(manifest)) {
            try {
                if (JSON.parse(readFileSync(manifest, "utf8")).name === `${SCOPE}/pi-coding-agent`) return dir;
            } catch {
                // Not a package root, keep walking.
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error("could not locate @earendil-works/pi-coding-agent; set MODEL_BANNER_PI_DIR");
}

const codingAgentDir = findCodingAgentDir();
const searchRoots = [
    join(dirname(dirname(codingAgentDir)), SCOPE), // global install: node_modules/@earendil-works
    join(codingAgentDir, "node_modules", SCOPE), // nested install
];

const target = join(ROOT, "node_modules", SCOPE);
mkdirSync(target, { recursive: true });

let linked = 0;
for (const name of HOST_PACKAGES) {
    const source = searchRoots
        .map((root) => join(root, name))
        .find((candidate) => existsSync(join(candidate, "package.json")));
    if (!source) {
        console.warn(`  skip ${SCOPE}/${name} (not found)`);
        continue;
    }

    const destination = join(target, name);
    rmSync(destination, { force: true, recursive: true });
    symlinkSync(realpathSync(source), destination, "junction");
    linked += 1;
    console.log(`  ${SCOPE}/${name} -> ${realpathSync(source)}`);
}

console.log(`linked ${linked}/${HOST_PACKAGES.length} host packages from ${codingAgentDir}`);
