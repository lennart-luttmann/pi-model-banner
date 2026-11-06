/**
 * Extension entry point: installs the banner and keeps it in sync with the
 * selected model and thinking level.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import type { Family } from "./content/families.ts";
import { FAMILY_LABELS } from "./content/labels.ts";
import { type LoadedConfig, configPath, loadConfig } from "./lib/config.ts";
import { resolveFamily } from "./lib/family.ts";
import { BannerHeader, type BannerState } from "./lib/header.ts";
import { availableFamilies, clearLogoCache } from "./lib/ansi.ts";

/** Register the banner's lifecycle hooks and the `/banner` command. */
export default function modelBanner(pi: ExtensionAPI) {

    /** Loaded config file, re-read on every session start (and therefore on /reload). */
    let config: LoadedConfig | undefined;

    /** The installed banner, when one is on screen. */
    let header: BannerHeader | undefined;

    /** Session-local switch; `/banner` flips it, the config file sets the default. */
    let enabled = true;

    /** Snapshot the model facts the banner renders. */
    function bannerState(model: Model<any> | undefined): BannerState {
        const provider = model?.provider ?? "";
        const modelId = model?.id ?? "";
        const family: Family = resolveFamily(provider, modelId, config?.overrides ?? {});
        const thinking = model?.reasoning ? pi.getThinkingLevel() : undefined;
        const thinkingLevels = model?.reasoning ? getSupportedThinkingLevels(model) : [];

        return {
            family,
            modelName: model?.name || modelId || "no model",
            modelId,
            provider,
            thinking,
            thinkingLevels,
        };
    }

    /**
     * Install the banner. Pi calls the factory synchronously, so `header` is set
     * by the time `setHeader` returns — later model changes mutate that instance
     * (`invalidate()` + `tui.requestRender()`) instead of re-installing, which
     * keeps the component (and its cache) stable across a session.
     */
    function install(ctx: ExtensionContext): void {
        if (ctx.mode !== "tui") return;

        const model = ctx.model;
        ctx.ui.setHeader((tui: TUI, theme: Theme) => {
            header = new BannerHeader(tui, theme, bannerState(model));
            return header;
        });
    }

    /** Remove the banner and drop the instance. */
    function uninstall(ctx: ExtensionContext): void {
        header = undefined;
        if (ctx.mode === "tui") ctx.ui.setHeader(undefined);
    }

    pi.on("session_start", async (_event, ctx) => {
        // Fresh art and config for this runtime (also covers /reload).
        clearLogoCache();
        config = loadConfig();
        enabled = config.enabled;
        header = undefined;

        if (config.error && ctx.hasUI) {
            ctx.ui.notify(`model-banner: ${config.error}`, "warning");
        }

        if (!enabled) {
            if (ctx.mode === "tui") ctx.ui.setHeader(undefined);
            return;
        }

        install(ctx);
    });

    pi.on("model_select", (event) => {
        if (!enabled || !header) return;
        header.setState(bannerState(event.model));
    });

    pi.on("thinking_level_select", (_event, ctx) => {
        if (!enabled || !header) return;
        header.setState(bannerState(ctx.model));
    });

    pi.on("session_shutdown", () => {
        // Idempotent: reload, session replacement and process exit all land here.
        header = undefined;
        config = undefined;
    });

    pi.registerCommand("banner", {
        description: "Toggle the model banner, or show its status (/banner on|off|toggle|status)",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const argument = (args ?? "").trim().toLowerCase();

            /** One-line status summary. */
            const status = () => {
                const state = bannerState(ctx.model);
                return [
                    `model-banner: ${enabled ? "on" : "off"}`,
                    `${FAMILY_LABELS[state.family]} (${state.provider}/${state.modelId})`,
                    `art: ${availableFamilies().join(", ") || "none"}`,
                    `config: ${config?.path ?? configPath()}`,
                ].join(" · ");
            };

            if (argument === "status") {
                ctx.ui.notify(status(), "info");
                return;
            }

            if (argument === "on" || argument === "off") {
                enabled = argument === "on";
            } else if (argument === "" || argument === "toggle") {
                enabled = !enabled;
            } else {
                ctx.ui.notify(`Usage: /banner [on|off|toggle|status] — got "${argument}"`, "warning");
                return;
            }

            if (enabled) {
                if (!header) install(ctx);
            } else {
                uninstall(ctx);
            }

            ctx.ui.notify(status(), "info");
        },
    });
}
