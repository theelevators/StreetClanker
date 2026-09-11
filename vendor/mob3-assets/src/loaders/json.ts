import { defineAssetType, type AssetLoader } from "../types.js";

export type JsonAssetData = unknown;

export const JsonAsset = defineAssetType<JsonAssetData>("JsonAsset");

export type JsonLoaderOptions = {
  /** Map of key → JSON value or async factory (tests / memory). */
  sources?: Record<string, unknown | (() => Promise<unknown>)>;
  /** Optional fetch-like for URL keys. */
  fetchJson?: (key: string, signal: AbortSignal) => Promise<unknown>;
};

/**
 * Generic JSON loader — proves @mob3/assets is not GLTF infrastructure.
 * Default: resolves from `options.sources` or parses `key` if it looks like JSON.
 */
export function createJsonLoader(
  opts: JsonLoaderOptions = {},
): AssetLoader<JsonAssetData> {
  return {
    async load(request, ctx) {
      const sources = opts.sources ?? {};
      if (Object.prototype.hasOwnProperty.call(sources, request.key)) {
        const v = sources[request.key];
        const resolved = typeof v === "function" ? await (v as () => Promise<unknown>)() : v;
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
        return resolved;
      }
      if (opts.fetchJson) {
        return opts.fetchJson(request.key, ctx.signal);
      }
      // Inline JSON string key
      if (request.key.trim().startsWith("{") || request.key.trim().startsWith("[")) {
        return JSON.parse(request.key) as unknown;
      }
      throw new Error(
        `JsonAsset "${request.key}": no source registered (pass sources or fetchJson)`,
      );
    },
  };
}
