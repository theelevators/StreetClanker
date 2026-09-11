export function normalizePlugin(plugin) {
    return typeof plugin === "function" ? { build: plugin } : plugin;
}
//# sourceMappingURL=plugin.js.map