import type { App } from "./app.js";

/**
 * A plugin configures an App. Keep it boring.
 * Prefer public App APIs so third-party plugins stay first-class.
 */
export interface Plugin {
  build(app: App): void;
  /** Optional cleanup. Called once from `app.dispose()`. */
  dispose?(app: App): void;
}

export type PluginFactory = Plugin | ((app: App) => void);

export function normalizePlugin(plugin: PluginFactory): Plugin {
  return typeof plugin === "function" ? { build: plugin } : plugin;
}
