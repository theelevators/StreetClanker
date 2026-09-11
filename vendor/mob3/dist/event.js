export const IS_EVENT_TYPE = Symbol.for("mob3.isEventType");
export function event(name = "Event") {
    return {
        [IS_EVENT_TYPE]: true,
        id: Symbol(`mob3.event.${name}`),
        name,
    };
}
/**
 * Typed event queues with one-update lifetime.
 * Events sent during an update are readable until that update ends, then cleared.
 */
export class EventStore {
    buffers = new Map();
    send(type, value) {
        let list = this.buffers.get(type.id);
        if (!list) {
            list = [];
            this.buffers.set(type.id, list);
        }
        list.push(value);
    }
    *read(type) {
        const list = this.buffers.get(type.id);
        if (!list)
            return;
        for (const item of list) {
            yield item;
        }
    }
    clear() {
        for (const list of this.buffers.values()) {
            list.length = 0;
        }
    }
}
//# sourceMappingURL=event.js.map