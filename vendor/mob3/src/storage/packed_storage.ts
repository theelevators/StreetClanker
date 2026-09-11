import type { Entity } from "../entity.js";
import {
  type ComponentStorage,
  type FieldKind,
  type FieldSchema,
  type PackedComponentMeta,
  type StorageKind,
  bytesPerField,
  makeTypedArray,
} from "./types.js";

type Column = Float32Array | Float64Array | Int32Array | Uint32Array;

/**
 * Structure-of-arrays packed numeric storage over ArrayBuffer.
 * Swap-remove on delete. Ephemeral write-through views from get().
 */
export class PackedStorage implements ComponentStorage {
  readonly kind: StorageKind = "packed";
  readonly fields: string[];
  readonly kinds: FieldKind[];
  readonly name: string;

  private capacity: number;
  private count = 0;
  private buffer: ArrayBuffer;
  private columns: Column[] = [];
  private readonly entityToSlot = new Map<Entity, number>();
  private slotToEntity: Entity[] = [];
  /** Generation bump when structure changes — invalidates view freshness checks if used. */
  private structGen = 0;
  private readonly viewProto: object;
  private readonly viewPool: PackedView[] = [];

  constructor(meta: PackedComponentMeta, initialCapacity = 16) {
    this.fields = meta.fields;
    this.kinds = meta.kinds;
    this.name = meta.name;
    this.capacity = Math.max(1, initialCapacity);
    this.buffer = this.allocBuffer(this.capacity);
    this.rebuildColumns();
    this.viewProto = this.buildViewProto();
  }

  get size(): number {
    return this.count;
  }

  get length(): number {
    return this.count;
  }

  get capacitySlots(): number {
    return this.capacity;
  }

  get generation(): number {
    return this.structGen;
  }

  /** Dense entity ids for live slots `[0, count)`. */
  entityIds(): Uint32Array {
    const out = new Uint32Array(this.count);
    for (let i = 0; i < this.count; i++) out[i] = this.slotToEntity[i]! >>> 0;
    return out;
  }

  /** Column arrays (length === capacity; live length is `size`). */
  column(field: string): Column {
    const i = this.fields.indexOf(field);
    if (i < 0) throw new Error(`Unknown field '${field}' on ${this.name}`);
    return this.columns[i]!;
  }

  slotOf(entity: Entity): number | undefined {
    return this.entityToSlot.get(entity);
  }

  entityAt(slot: number): Entity | undefined {
    if (slot < 0 || slot >= this.count) return undefined;
    return this.slotToEntity[slot];
  }

  has(entity: Entity): boolean {
    return this.entityToSlot.has(entity);
  }

  get(entity: Entity): unknown | undefined {
    const slot = this.entityToSlot.get(entity);
    if (slot === undefined) return undefined;
    return this.acquireView(slot);
  }

  set(entity: Entity, value: unknown): void {
    const obj = value as Record<string, number>;
    let slot = this.entityToSlot.get(entity);
    if (slot === undefined) {
      slot = this.allocSlot(entity);
    }
    for (let f = 0; f < this.fields.length; f++) {
      const key = this.fields[f]!;
      this.columns[f]![slot] = obj[key] ?? 0;
    }
  }

  remove(entity: Entity): boolean {
    const slot = this.entityToSlot.get(entity);
    if (slot === undefined) return false;
    this.swapRemove(slot);
    return true;
  }

  clear(): void {
    this.entityToSlot.clear();
    this.slotToEntity.length = 0;
    this.count = 0;
    this.structGen++;
  }

  *entities(): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.slotToEntity[i]!;
    }
  }

  /** Dense SoA iteration without per-row object allocation. */
  forEachSlot(fn: (slot: number, entity: Entity) => void): void {
    for (let i = 0; i < this.count; i++) {
      fn(i, this.slotToEntity[i]!);
    }
  }

  /** Read field at slot (hot path). */
  read(fieldIndex: number, slot: number): number {
    return this.columns[fieldIndex]![slot]!;
  }

  write(fieldIndex: number, slot: number, value: number): void {
    this.columns[fieldIndex]![slot] = value;
  }

  private allocSlot(entity: Entity): number {
    if (this.count >= this.capacity) {
      this.grow(this.capacity * 2);
    }
    const slot = this.count++;
    this.entityToSlot.set(entity, slot);
    this.slotToEntity[slot] = entity;
    this.structGen++;
    return slot;
  }

  private swapRemove(slot: number): void {
    const last = this.count - 1;
    const removed = this.slotToEntity[slot]!;
    this.entityToSlot.delete(removed);

    if (slot !== last) {
      const moved = this.slotToEntity[last]!;
      this.slotToEntity[slot] = moved;
      this.entityToSlot.set(moved, slot);
      for (let f = 0; f < this.columns.length; f++) {
        this.columns[f]![slot] = this.columns[f]![last]!;
      }
    }

    this.count--;
    this.structGen++;
  }

  private grow(newCap: number): void {
    const oldCount = this.count;
    const oldCols = this.columns;
    this.capacity = newCap;
    this.buffer = this.allocBuffer(newCap);
    this.rebuildColumns();
    for (let f = 0; f < this.fields.length; f++) {
      this.columns[f]!.set(oldCols[f]!.subarray(0, oldCount));
    }
    this.structGen++;
  }

  private allocBuffer(capacity: number): ArrayBuffer {
    let bytes = 0;
    for (const k of this.kinds) bytes += bytesPerField(k) * capacity;
    // Align to 8
    bytes = Math.ceil(bytes / 8) * 8;
    return new ArrayBuffer(bytes);
  }

  private rebuildColumns(): void {
    this.columns = [];
    let offset = 0;
    for (let f = 0; f < this.fields.length; f++) {
      const kind = this.kinds[f]!;
      const bpe = bytesPerField(kind);
      // align offset
      offset = Math.ceil(offset / bpe) * bpe;
      this.columns.push(
        makeTypedArray(kind, this.buffer, offset, this.capacity),
      );
      offset += bpe * this.capacity;
    }
  }

  private buildViewProto(): object {
    const proto: Record<string, unknown> = {};
    const self = this;
    for (let f = 0; f < this.fields.length; f++) {
      const idx = f;
      const name = this.fields[f]!;
      Object.defineProperty(proto, name, {
        enumerable: true,
        configurable: true,
        get(this: PackedView) {
          return self.columns[idx]![this._slot]!;
        },
        set(this: PackedView, v: number) {
          self.columns[idx]![this._slot] = v;
        },
      });
    }
    return proto;
  }

  private acquireView(slot: number): PackedView {
    let view = this.viewPool.pop();
    if (!view) {
      view = Object.create(this.viewProto) as PackedView;
    }
    view._slot = slot;
    view._store = this;
    return view;
  }

  /** Release a view back to the pool (optional; GC also fine). */
  releaseView(view: PackedView): void {
    if (this.viewPool.length < 256) this.viewPool.push(view);
  }
}

export type PackedView = {
  _slot: number;
  _store: PackedStorage;
} & Record<string, number>;

export function createPackedStorage(
  meta: PackedComponentMeta,
  capacity?: number,
): PackedStorage {
  return new PackedStorage(meta, capacity ?? 16);
}

/** Describe schema for tests/debug. */
export function schemaFromMeta(meta: PackedComponentMeta): FieldSchema {
  const out: FieldSchema = {};
  for (let i = 0; i < meta.fields.length; i++) {
    out[meta.fields[i]!] = meta.kinds[i]!;
  }
  return out;
}
