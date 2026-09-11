export const IS_EVENT_TYPE = Symbol.for("mob3.isEventType");

export interface EventType<T = unknown> {
  readonly [IS_EVENT_TYPE]: true;
  readonly id: symbol;
  readonly name?: string;
}

export function event<T>(name = "Event"): EventType<T> {
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
  private buffers = new Map<symbol, unknown[]>();

  send<T>(type: EventType<T>, value: T): void {
    let list = this.buffers.get(type.id);
    if (!list) {
      list = [];
      this.buffers.set(type.id, list);
    }
    list.push(value);
  }

  *read<T>(type: EventType<T>): IterableIterator<T> {
    const list = this.buffers.get(type.id);
    if (!list) return;
    for (const item of list) {
      yield item as T;
    }
  }

  clear(): void {
    for (const list of this.buffers.values()) {
      list.length = 0;
    }
  }
}
