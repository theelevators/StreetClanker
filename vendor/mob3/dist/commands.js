/**
 * Deferred structural mutations.
 */
export class Commands {
    world;
    ops = [];
    constructor(world) {
        this.world = world;
    }
    spawn(...bundle) {
        const entity = this.world.reserveEntity();
        this.ops.push({ kind: "spawn", entity, bundle: [...bundle] });
        return entity;
    }
    spawnChild(parent, ...bundle) {
        const entity = this.spawn(...bundle);
        this.setParent(entity, parent);
        return entity;
    }
    despawn(entity, options = {}) {
        this.ops.push({ kind: "despawn", entity, options });
    }
    add(entity, item) {
        this.ops.push({ kind: "add", entity, item });
    }
    remove(entity, type) {
        this.ops.push({ kind: "remove", entity, type });
    }
    setParent(child, parent, options = {}) {
        this.ops.push({ kind: "setParent", child, parent, options });
    }
    removeParent(child) {
        this.setParent(child, null);
    }
    get pending() {
        return this.ops.length;
    }
    flush() {
        const ops = this.ops;
        this.ops = [];
        for (const op of ops) {
            switch (op.kind) {
                case "spawn":
                    this.world.realizeReserved(op.entity, op.bundle);
                    break;
                case "despawn":
                    this.world.despawn(op.entity, op.options);
                    break;
                case "add":
                    if (this.world.isAlive(op.entity)) {
                        this.world.add(op.entity, op.item);
                    }
                    break;
                case "remove":
                    this.world.remove(op.entity, op.type);
                    break;
                case "setParent":
                    if (this.world.isAlive(op.child)) {
                        if (op.parent === null || this.world.isAlive(op.parent)) {
                            this.world.setParent(op.child, op.parent, op.options);
                        }
                    }
                    break;
            }
        }
    }
}
//# sourceMappingURL=commands.js.map