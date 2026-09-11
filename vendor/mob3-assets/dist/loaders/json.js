import { defineAssetType } from "../types.js";
export const JsonAsset = defineAssetType("JsonAsset");
/**
 * Generic JSON loader — proves @mob3/assets is not GLTF infrastructure.
 * Default: resolves from `options.sources` or parses `key` if it looks like JSON.
 */
export function createJsonLoader(opts = {}) {
    return {
        async load(request, ctx) {
            const sources = opts.sources ?? {};
            if (Object.prototype.hasOwnProperty.call(sources, request.key)) {
                const v = sources[request.key];
                const resolved = typeof v === "function" ? await v() : v;
                if (ctx.signal.aborted)
                    throw new DOMException("Aborted", "AbortError");
                return resolved;
            }
            if (opts.fetchJson) {
                return opts.fetchJson(request.key, ctx.signal);
            }
            // Inline JSON string key
            if (request.key.trim().startsWith("{") || request.key.trim().startsWith("[")) {
                return JSON.parse(request.key);
            }
            throw new Error(`JsonAsset "${request.key}": no source registered (pass sources or fetchJson)`);
        },
    };
}
//# sourceMappingURL=json.js.map