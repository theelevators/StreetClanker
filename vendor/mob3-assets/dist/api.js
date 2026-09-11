import { resource } from "mob3";
export const Assets = resource("Assets");
export function assetsOf(world) {
    const a = world.tryResource(Assets);
    if (!a) {
        throw new Error("Assets resource missing — add AssetsPlugin()");
    }
    return a;
}
/** Ergonomic facade stored alongside the registry resource when useful. */
export class AssetsApi {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    registerLoader(type, loader) {
        this.registry.registerLoader(type, loader);
    }
    load(type, key, options) {
        return this.registry.load(type, key, options);
    }
    insert(type, key, value, opts) {
        return this.registry.insert(type, key, value, opts);
    }
    retain(handle) {
        this.registry.retain(handle);
    }
    release(handle, opts) {
        this.registry.release(handle, opts);
    }
    unload(handle) {
        this.registry.unload(handle);
    }
    reload(handle) {
        return this.registry.reload(handle);
    }
    cancel(handle) {
        this.registry.cancel(handle);
    }
    state(handle) {
        return this.registry.state(handle);
    }
    status(handle) {
        return this.registry.status(handle);
    }
    isReady(handle) {
        return this.registry.isReady(handle);
    }
    get(handle) {
        return this.registry.get(handle);
    }
    error(handle) {
        return this.registry.error(handle);
    }
    refCount(handle) {
        return this.registry.refCount(handle);
    }
    inspect() {
        return this.registry.inspect();
    }
    formatRegistry() {
        return this.registry.formatRegistry();
    }
}
//# sourceMappingURL=api.js.map