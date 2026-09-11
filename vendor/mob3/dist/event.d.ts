export declare const IS_EVENT_TYPE: unique symbol;
export interface EventType<T = unknown> {
    readonly [IS_EVENT_TYPE]: true;
    readonly id: symbol;
    readonly name?: string;
}
export declare function event<T>(name?: string): EventType<T>;
/**
 * Typed event queues with one-update lifetime.
 * Events sent during an update are readable until that update ends, then cleared.
 */
export declare class EventStore {
    private buffers;
    send<T>(type: EventType<T>, value: T): void;
    read<T>(type: EventType<T>): IterableIterator<T>;
    clear(): void;
}
//# sourceMappingURL=event.d.ts.map