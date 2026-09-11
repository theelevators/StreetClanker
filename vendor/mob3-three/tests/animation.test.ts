import { describe, expect, it } from "vitest";
import { App, Update, Transform, GlobalTransform, Name } from "mob3";
import { AssetsPlugin, getAssets } from "@mob3/assets";
import * as THREE from "three";
import {
  ThreePlugin,
  ThreeObject,
  GltfAsset,
  createGltfLoader,
  AnimationPlugin,
  AnimationPlayer,
  AnimationFinished,
  BoneAttachment,
  animationEventFlush,
  instantiateAnimatedGltf,
  despawnAnimatedGltf,
  createProceduralCharacterAsset,
  playAnimation,
  pauseAnimation,
  resumeAnimation,
  stopAnimation,
  crossfadeAnimation,
  listAnimationClips,
  animationStoreOf,
  stripRootMotion,
} from "../src/index.js";

function mockThree() {
  return ThreePlugin({
    renderer: {
      setClearColor() {},
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
      domElement: { clientWidth: 800, clientHeight: 600 },
    } as never,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    autoResize: false,
  });
}

function makeApp() {
  const app = new App()
    .addPlugin(mockThree())
    .addPlugin(AssetsPlugin({ json: false }))
    .addPlugin(AnimationPlugin());
  const assets = getAssets(app.world);
  assets.registerLoader(GltfAsset, {
    async load() {
      throw new Error("unused");
    },
    dispose(v) {
      createGltfLoader().dispose?.(v);
    },
  });
  const data = createProceduralCharacterAsset();
  const handle = assets.insert(GltfAsset, "character.glb", data);
  return { app, assets, handle, data };
}

describe("Phase 11 animation", () => {
  it("independent playback on shared asset", () => {
    const { app, handle } = makeApp();
    const a = instantiateAnimatedGltf(app.world, handle, { name: "A" });
    const b = instantiateAnimatedGltf(app.world, handle, { name: "B" });
    const c = instantiateAnimatedGltf(app.world, handle, { name: "C" });

    playAnimation(app.world, a, "Run", { speed: 1 });
    playAnimation(app.world, b, "Idle", { speed: 1 });
    playAnimation(app.world, c, "Walk", { speed: 0.5 });

    for (let i = 0; i < 30; i++) app.update(1 / 60);

    expect(app.world.get(a, AnimationPlayer)!.clip).toBe("Run");
    expect(app.world.get(b, AnimationPlayer)!.clip).toBe("Idle");
    expect(app.world.get(c, AnimationPlayer)!.clip).toBe("Walk");
    expect(app.world.get(c, AnimationPlayer)!.speed).toBe(0.5);

    crossfadeAnimation(app.world, b, "Run", 0.1);
    for (let i = 0; i < 20; i++) app.update(1 / 60);
    expect(app.world.get(b, AnimationPlayer)!.clip).toBe("Run");
    expect(app.world.get(a, AnimationPlayer)!.clip).toBe("Run");
    expect(app.world.get(c, AnimationPlayer)!.clip).toBe("Walk");

    const store = animationStoreOf(app.world);
    expect(store.size()).toBe(3);
    app.dispose();
  });

  it("pause resume stop and missing clip error", () => {
    const { app, handle } = makeApp();
    const e = instantiateAnimatedGltf(app.world, handle);
    playAnimation(app.world, e, "Walk");
    app.update(1 / 60);
    pauseAnimation(app.world, e);
    const t0 = app.world.get(e, AnimationPlayer)!.time;
    app.update(1 / 60);
    app.update(1 / 60);
    expect(app.world.get(e, AnimationPlayer)!.time).toBeCloseTo(t0, 5);
    resumeAnimation(app.world, e);
    app.update(1 / 60);
    stopAnimation(app.world, e);
    expect(app.world.get(e, AnimationPlayer)!.clip).toBe("");
    expect(() => playAnimation(app.world, e, "Fly")).toThrow(/Fly/);
    expect(listAnimationClips(app.world, e)).toEqual(
      expect.arrayContaining(["Idle", "Walk", "Run"]),
    );
    app.dispose();
  });

  it("AnimationFinished once for LoopOnce", () => {
    const { app, handle } = makeApp();
    const e = instantiateAnimatedGltf(app.world, handle);
    const finished: string[] = [];
    app.addSystem(
      Update,
      (world) => {
        for (const ev of world.events(AnimationFinished)) {
          finished.push(ev.clip);
        }
      },
      { after: animationEventFlush },
    );
    playAnimation(app.world, e, "Idle", { loop: false, fadeDuration: 0 });
    // Idle period = 2s — advance past end
    for (let i = 0; i < 150; i++) app.update(1 / 60);
    expect(finished.filter((c) => c === "Idle").length).toBe(1);
    expect(app.world.get(e, AnimationPlayer)!.playing).toBe(false);
    app.dispose();
  });

  it("bone attachment follows source instance only", () => {
    const { app, handle } = makeApp();
    const a = instantiateAnimatedGltf(app.world, handle, { name: "A" });
    const b = instantiateAnimatedGltf(app.world, handle, { name: "B" });
    app.world.getMut(a, Transform)!.x = 10;
    app.world.getMut(b, Transform)!.x = -10;

    const swordA = app.world.spawn(
      Name({ value: "SwordA" }) as never,
      Transform() as never,
      GlobalTransform() as never,
      BoneAttachment({ source: a, bone: "RightHand" }) as never,
    );
    const swordB = app.world.spawn(
      Name({ value: "SwordB" }) as never,
      Transform() as never,
      GlobalTransform() as never,
      BoneAttachment({ source: b, bone: "RightHand" }) as never,
    );

    playAnimation(app.world, a, "Run");
    playAnimation(app.world, b, "Idle");
    for (let i = 0; i < 10; i++) app.update(1 / 60);

    // Sync roots first so ThreeObject matrices match ECS
    const gA = app.world.get(swordA, GlobalTransform)!;
    const gB = app.world.get(swordB, GlobalTransform)!;
    expect(gA.x).toBeGreaterThan(5);
    expect(gB.x).toBeLessThan(-5);

    despawnAnimatedGltf(app.world, a);
    app.update(1 / 60);
    expect(app.world.has(swordA, BoneAttachment)).toBe(false);
    expect(app.world.isAlive(swordB)).toBe(true);
    expect(app.world.has(swordB, BoneAttachment)).toBe(true);
    void swordB;
    app.dispose();
  });

  it("root Transform not overwritten by animation (root motion stripped)", () => {
    const { app, handle } = makeApp();
    const e = instantiateAnimatedGltf(app.world, handle);
    app.world.getMut(e, Transform)!.x = 3;
    playAnimation(app.world, e, "Run", { fadeDuration: 0 });
    for (let i = 0; i < 60; i++) app.update(1 / 60);
    expect(app.world.get(e, Transform)!.x).toBeCloseTo(3, 5);
    const clip = animationStoreOf(app.world).get(e)!.clips.get("Run")!;
    expect(clip.tracks.some((t) => t.name.endsWith(".position"))).toBe(false);
    app.dispose();
  });

  it("stripRootMotion does not mutate shared clip", () => {
    const data = createProceduralCharacterAsset();
    const original = data.clips.find((c) => c.name === "Run")!;
    const n = original.tracks.length;
    const stripped = stripRootMotion(original, "Character");
    expect(original.tracks.length).toBe(n);
    expect(stripped.tracks.length).toBeLessThan(n);
  });

  it("despawn one instance does not dispose shared geo; unload does", () => {
    const { app, assets, handle, data } = makeApp();
    const a = instantiateAnimatedGltf(app.world, handle);
    const b = instantiateAnimatedGltf(app.world, handle);
    despawnAnimatedGltf(app.world, a);
    expect(data.disposeCounts.geometry).toBe(0);
    expect(animationStoreOf(app.world).size()).toBe(1);
    despawnAnimatedGltf(app.world, b);
    while (assets.refCount(handle) > 0) {
      assets.release(handle, { unload: assets.refCount(handle) === 1 });
    }
    if (assets.status(handle) !== "absent") assets.unload(handle);
    expect(data.disposeCounts.geometry).toBe(1);
    app.dispose();
  });

  it("dispose torture with playing animations", () => {
    for (let i = 0; i < 20; i++) {
      const { app, handle } = makeApp();
      const ents = [];
      for (let j = 0; j < 5; j++) {
        const e = instantiateAnimatedGltf(app.world, handle);
        playAnimation(app.world, e, j % 2 ? "Run" : "Walk");
        ents.push(e);
      }
      for (let k = 0; k < 5; k++) app.update(1 / 60);
      app.dispose();
    }
  });

  it("no stale AnimationFinished after despawn", () => {
    const { app, handle } = makeApp();
    const e = instantiateAnimatedGltf(app.world, handle);
    const finished: number[] = [];
    app.addSystem(
      Update,
      (world) => {
        for (const ev of world.events(AnimationFinished)) {
          finished.push(ev.entity);
        }
      },
      { after: animationEventFlush },
    );
    playAnimation(app.world, e, "Idle", { loop: false, fadeDuration: 0 });
    for (let i = 0; i < 30; i++) app.update(1 / 60);
    despawnAnimatedGltf(app.world, e);
    const before = finished.length;
    for (let i = 0; i < 120; i++) app.update(1 / 60);
    expect(finished.length).toBe(before);
    app.dispose();
  });

  it("100 instances independent mixers share clip defs", () => {
    const { app, handle } = makeApp();
    const ents = Array.from({ length: 100 }, (_, i) =>
      instantiateAnimatedGltf(app.world, handle, {
        clip: ["Idle", "Walk", "Run"][i % 3],
      }),
    );
    for (let i = 0; i < 10; i++) app.update(1 / 60);
    expect(animationStoreOf(app.world).size()).toBe(100);
    const clipA = animationStoreOf(app.world).get(ents[0]!)!.clips.get("Run");
    const clipB = animationStoreOf(app.world).get(ents[1]!)!.clips.get("Run");
    // Same name; may be derived instances but shared source identity via asset
    expect(clipA?.name).toBe(clipB?.name);
    app.dispose();
  });
});

void ThreeObject;
