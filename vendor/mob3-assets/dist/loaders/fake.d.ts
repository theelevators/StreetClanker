import { type AssetLoader } from "../types.js";
export type FakeAssetData = {
    id: string;
    payload: unknown;
};
export declare const FakeAsset: import("../types.js").AssetType<FakeAssetData>;
export type FakeController = {
    resolve: (value?: unknown) => void;
    reject: (error?: Error) => void;
    readonly pending: number;
};
/**
 * Deterministic fake loader for lifecycle tests — no network.
 */
export declare function createFakeLoader(): {
    loader: AssetLoader<FakeAssetData>;
    controllerFor: (key: string) => FakeController;
    invocations: () => number;
};
//# sourceMappingURL=fake.d.ts.map