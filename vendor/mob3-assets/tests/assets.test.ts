import { describe, expect, it } from "vitest";
import { App, Update } from "mob3";
import {
  AssetsPlugin,
  Assets,
  FakeAsset,
  createFakeLoader,
  JsonAsset,
  createJsonLoader,
  AssetReady,
  AssetFailed,
  getAssets,
  assetMaintenance,
} from "../src/index.js";

async function flushAssets(app: App): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  app.update(1 / 60);
}

async function microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("@mob3/assets registry", () => {
  it("load → loading → ready only after maintenance", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);

    const h = assets.load(FakeAsset, "ship");
    expect(assets.status(h)).toBe("loading");
    expect(assets.get(h)).toBeUndefined();

    fake.controllerFor("ship").resolve({ hp: 10 });
    await microtasks();
    expect(assets.status(h)).toBe("loading");

    app.update(1 / 60);
    expect(assets.isReady(h)).toBe(true);
    expect(assets.get(h)?.payload).toEqual({ hp: 10 });
    app.dispose();
  });

  it("dedupes identical pending loads to one loader invocation", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);

    const handles = Array.from({ length: 100 }, () =>
      assets.load(FakeAsset, "ship"),
    );
    expect(fake.invocations()).toBe(1);
    expect(app.world.resource(Assets).loaderInvocationCount).toBe(1);

    fake.controllerFor("ship").resolve();
    await flushAssets(app);
    for (const h of handles) expect(assets.isReady(h)).toBe(true);
    expect(assets.refCount(handles[0]!)).toBe(100);
    app.dispose();
  });

  it("shared cancel: A releases, B keeps load alive", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);

    const a = assets.load(FakeAsset, "ship");
    const b = assets.load(FakeAsset, "ship");
    expect(fake.invocations()).toBe(1);

    assets.release(a);
    expect(assets.refCount(b)).toBe(1);
    expect(assets.status(b)).toBe("loading");

    fake.controllerFor("ship").resolve();
    await flushAssets(app);
    expect(assets.isReady(b)).toBe(true);
    app.dispose();
  });

  it("last release while loading cancels underlying request", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);

    const h = assets.load(FakeAsset, "ship");
    assets.release(h);
    await microtasks();
    app.update(1 / 60);
    expect(["absent", "cancelled"]).toContain(assets.status(h));
    app.dispose();
  });

  it("failure + reload ignores stale generation", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);

    const h1 = assets.load(FakeAsset, "ship");
    fake.controllerFor("ship").reject(new Error("boom"));
    await flushAssets(app);
    expect(assets.status(h1)).toBe("failed");
    expect(assets.error(h1)?.message).toMatch(/boom/);

    const h2 = assets.reload(h1);
    expect(h2.generation).toBeGreaterThan(h1.generation);
    expect(assets.status(h2)).toBe("loading");

    fake.controllerFor("ship").resolve({ ok: true });
    await flushAssets(app);
    expect(assets.isReady(h2)).toBe(true);
    expect(assets.status(h1)).toBe("absent");
    app.dispose();
  });

  it("JsonAsset works headlessly", async () => {
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(
      JsonAsset,
      createJsonLoader({
        sources: { "game-config": { difficulty: 3 } },
      }),
    );
    const h = assets.load(JsonAsset, "game-config");
    await flushAssets(app);
    expect(assets.get(h)).toEqual({ difficulty: 3 });
    app.dispose();
  });

  it("insert memory asset + external ownership not disposed by unload", () => {
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    let disposed = 0;
    assets.registerLoader(FakeAsset, {
      load() {
        return Promise.reject(new Error("unused"));
      },
      dispose() {
        disposed++;
      },
    });
    const value = { id: "x", payload: 1 };
    const h = assets.insert(FakeAsset, "mem", value, { ownership: "external" });
    assets.unload(h);
    expect(disposed).toBe(0);
    app.dispose();
  });

  it("AssetReady event fires at maintenance boundary", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);
    const seen: string[] = [];
    app.addSystem(
      Update,
      (world) => {
        for (const e of world.events(AssetReady)) seen.push(e.key);
      },
      { after: assetMaintenance },
    );
    const h = assets.load(FakeAsset, "ship");
    fake.controllerFor("ship").resolve();
    await flushAssets(app);
    expect(seen).toEqual(["ship"]);
    expect(assets.isReady(h)).toBe(true);
    app.dispose();
  });

  it("late completion after dispose is ignored", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);
    assets.load(FakeAsset, "ship");
    app.dispose();
    expect(() => assets.load(FakeAsset, "other")).toThrow(/disposed/);
    fake.controllerFor("ship").resolve();
    await microtasks();
    expect(assets.formatRegistry()).toContain("(empty)");
  });

  it("dispose torture: 50 apps with pending/ready mix", async () => {
    for (let i = 0; i < 50; i++) {
      const fake = createFakeLoader();
      const app = new App().addPlugin(AssetsPlugin({ json: false }));
      const assets = getAssets(app.world);
      assets.registerLoader(FakeAsset, fake.loader);
      const a = assets.load(FakeAsset, "a");
      const b = assets.load(FakeAsset, "b");
      if (i % 2 === 0) {
        fake.controllerFor("a").resolve();
        await flushAssets(app);
        expect(assets.isReady(a)).toBe(true);
      }
      void b;
      app.dispose();
      fake.controllerFor("a").resolve();
      fake.controllerFor("b").reject();
      await microtasks();
    }
  });

  it("formatRegistry lists assets", async () => {
    const fake = createFakeLoader();
    const app = new App().addPlugin(AssetsPlugin({ json: false }));
    const assets = getAssets(app.world);
    assets.registerLoader(FakeAsset, fake.loader);
    assets.load(FakeAsset, "ship");
    fake.controllerFor("ship").resolve();
    await flushAssets(app);
    const text = assets.formatRegistry();
    expect(text).toContain("ship");
    expect(text).toContain("ready");
    app.dispose();
  });
});

void AssetFailed;
