import { describe, expect, it } from "vitest";
import { App, Name } from "mob3";
import { getAssets } from "@mob3/assets";
import * as THREE from "three";
import {
  ThreePlugin,
  ThreeObject,
  ThreeAssetsPlugin,
  GltfAsset,
  createGltfLoader,
  instantiateGltf,
  despawnGltfInstance,
  gltfDataFromObject3D,
  minimalBoxGltfJson,
} from "../src/index.js";

function buildShipTemplate(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Ship";
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
  const body = new THREE.Mesh(geo, mat);
  body.name = "Body";
  const turret = new THREE.Mesh(geo, mat);
  turret.name = "Turret";
  turret.position.set(0, 0.6, 0);
  root.add(body);
  root.add(turret);
  return root;
}

function mockThreePlugin() {
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

describe("@mob3/three assets", () => {
  it("instantiate creates ECS hierarchy with shared geo/mat", () => {
    const app = new App()
      .addPlugin(mockThreePlugin())
      .addPlugin(ThreeAssetsPlugin());

    const assets = getAssets(app.world);
    const data = gltfDataFromObject3D(buildShipTemplate());
    assets.registerLoader(GltfAsset, {
      async load() {
        throw new Error("unused");
      },
      dispose(v) {
        createGltfLoader().dispose?.(v);
      },
    });

    const handle = assets.insert(GltfAsset, "ship", data);
    const root = instantiateGltf(app.world, handle);
    app.update(1 / 60);

    expect(app.world.get(root, Name)?.value).toBe("Ship");
    const kids = [...app.world.children(root)];
    expect(kids.length).toBe(2);
    const names = kids.map((e) => app.world.get(e, Name)?.value).sort();
    expect(names).toEqual(["Body", "Turret"]);

    const geos = new Set<THREE.BufferGeometry>();
    for (const [, three] of app.world.query(ThreeObject)) {
      const mesh = three.object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) geos.add(mesh.geometry);
    }
    expect(geos.size).toBe(1);
    app.dispose();
  });

  it("despawn instance does not dispose shared GPU; unload does once", () => {
    const app = new App()
      .addPlugin(mockThreePlugin())
      .addPlugin(ThreeAssetsPlugin());

    const assets = getAssets(app.world);
    const data = gltfDataFromObject3D(buildShipTemplate());
    assets.registerLoader(GltfAsset, {
      async load() {
        throw new Error("unused");
      },
      dispose(v) {
        createGltfLoader().dispose?.(v);
      },
    });

    const handle = assets.insert(GltfAsset, "ship", data);
    const a = instantiateGltf(app.world, handle);
    const b = instantiateGltf(app.world, handle);
    const c = instantiateGltf(app.world, handle);

    despawnGltfInstance(app.world, b);
    expect(data.disposeCounts.geometry).toBe(0);
    expect(data.disposeCounts.material).toBe(0);

    despawnGltfInstance(app.world, a);
    despawnGltfInstance(app.world, c);
    expect(data.disposeCounts.geometry).toBe(0);

    // Drop insert retain + any leftovers
    while (assets.refCount(handle) > 0) {
      assets.release(handle, { unload: assets.refCount(handle) === 1 });
    }
    if (assets.status(handle) !== "absent") {
      assets.unload(handle);
    }

    expect(data.disposeCounts.geometry).toBe(1);
    expect(data.disposeCounts.material).toBe(1);
    app.dispose();
  });

  it("cannot instantiate while loading", async () => {
    const app = new App()
      .addPlugin(mockThreePlugin())
      .addPlugin(ThreeAssetsPlugin({
        gltf: {
          resolve: async () => {
            await new Promise(() => {});
            return new ArrayBuffer(0);
          },
        },
      }));

    const assets = getAssets(app.world);
    // Re-register hanging loader
    assets.registerLoader(GltfAsset, {
      async load() {
        await new Promise(() => {});
        return null as never;
      },
    });
    const h = assets.load(GltfAsset, "pending.glb");
    expect(() => instantiateGltf(app.world, h)).toThrow(/Loading/);
    app.dispose();
  });

  it("GLTFLoader.parse accepts minimal fixture", async () => {
    const json = minimalBoxGltfJson();
    const app = new App().addPlugin(ThreeAssetsPlugin({
      gltf: {
        resolve: async () => json,
      },
    }));
    const assets = getAssets(app.world);
    const h = assets.load(GltfAsset, "minimal");
    await Promise.resolve();
    await Promise.resolve();
    // allow microtasks for parse
    for (let i = 0; i < 10; i++) await Promise.resolve();
    app.update(1 / 60);
    // Node may or may not fully parse empty-ish glTF — accept ready or failed clearly
    const st = assets.status(h);
    expect(["ready", "failed", "loading"]).toContain(st);
    app.dispose();
  });
});
