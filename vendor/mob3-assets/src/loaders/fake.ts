import { defineAssetType, type AssetLoader } from "../types.js";

export type FakeAssetData = {
  id: string;
  payload: unknown;
};

export const FakeAsset = defineAssetType<FakeAssetData>("FakeAsset");

type Waiter = {
  resolve: (v: FakeAssetData) => void;
  reject: (e: Error) => void;
};

type KeyState = {
  waiters: Waiter[];
  /** If set, next load() resolves/rejects immediately. */
  next?: { ok: true; value: FakeAssetData } | { ok: false; error: Error };
};

export type FakeController = {
  resolve: (value?: unknown) => void;
  reject: (error?: Error) => void;
  readonly pending: number;
};

/**
 * Deterministic fake loader for lifecycle tests — no network.
 */
export function createFakeLoader(): {
  loader: AssetLoader<FakeAssetData>;
  controllerFor: (key: string) => FakeController;
  invocations: () => number;
} {
  let totalInvocations = 0;
  const keys = new Map<string, KeyState>();

  function state(key: string): KeyState {
    let s = keys.get(key);
    if (!s) {
      s = { waiters: [] };
      keys.set(key, s);
    }
    return s;
  }

  const loader: AssetLoader<FakeAssetData> = {
    load(request, ctx) {
      totalInvocations++;
      const s = state(request.key);
      if (s.next) {
        const n = s.next;
        s.next = undefined;
        if (ctx.signal.aborted) {
          return Promise.reject(new DOMException("Aborted", "AbortError"));
        }
        if (n.ok) return Promise.resolve(n.value);
        return Promise.reject(n.error);
      }
      return new Promise<FakeAssetData>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject };
        if (ctx.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const onAbort = () => {
          const idx = s.waiters.indexOf(waiter);
          if (idx >= 0) s.waiters.splice(idx, 1);
          reject(new DOMException("Aborted", "AbortError"));
        };
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        waiter.resolve = (v) => {
          ctx.signal.removeEventListener("abort", onAbort);
          resolve(v);
        };
        waiter.reject = (e) => {
          ctx.signal.removeEventListener("abort", onAbort);
          reject(e);
        };
        s.waiters.push(waiter);
      });
    },
  };

  return {
    loader,
    invocations: () => totalInvocations,
    controllerFor(key: string): FakeController {
      return {
        get pending() {
          return state(key).waiters.length;
        },
        resolve(value?: unknown) {
          const s = state(key);
          const data: FakeAssetData = {
            id: key,
            payload: value ?? { ok: true },
          };
          if (s.waiters.length === 0) {
            s.next = { ok: true, value: data };
            return;
          }
          const q = s.waiters.splice(0, s.waiters.length);
          for (const w of q) w.resolve(data);
        },
        reject(error?: Error) {
          const s = state(key);
          const err = error ?? new Error(`FakeAsset "${key}" failed`);
          if (s.waiters.length === 0) {
            s.next = { ok: false, error: err };
            return;
          }
          const q = s.waiters.splice(0, s.waiters.length);
          for (const w of q) w.reject(err);
        },
      };
    },
  };
}
