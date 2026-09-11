import { describe, expect, it, vi } from "vitest";
import { App, Startup, PreRender, Transform } from "mob3";
import * as THREE from "three";
import {
  ThreePlugin,
  ThreeObject,
  ThreeScene,
  syncTransforms,
} from "../src/index.js";

describe("@mob3/three", () => {
  it("inserts scene/renderer/camera resources", () => {
    const renderer = {
      setClearColor: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      domElement: { clientWidth: 800, clientHeight: 600 },
    } as unknown as THREE.WebGLRenderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    const app = new App().addPlugin(
      ThreePlugin({
        renderer,
        scene,
        camera,
        autoResize: false,
      }),
    );

    expect(app.world.resource(ThreeScene)).toBe(scene);
  });

  it("syncs Transform → Object3D in PreRender", () => {
    const mesh = new THREE.Mesh();
    const app = new App()
      .addPlugin({
        build(a) {
          a.addSystem(PreRender, syncTransforms);
        },
      })
      .addSystem(Startup, (world) => {
        world.spawn(
          Transform({ x: 1, y: 2, z: 3, ry: 0.5, sx: 2, sy: 2, sz: 2 }),
          ThreeObject(mesh),
        );
      });

    app.update(1 / 60);

    expect(mesh.position.x).toBeCloseTo(1);
    expect(mesh.position.y).toBeCloseTo(2);
    expect(mesh.position.z).toBeCloseTo(3);
    expect(mesh.rotation.y).toBeCloseTo(0.5);
    expect(mesh.scale.x).toBeCloseTo(2);
  });

  it("entities without ThreeObject are not synced", () => {
    const mesh = new THREE.Mesh();
    mesh.position.set(9, 9, 9);

    const app = new App()
      .addPlugin({
        build(a) {
          a.addSystem(PreRender, syncTransforms);
        },
      })
      .addSystem(Startup, (world) => {
        world.spawn(Transform({ x: 1, y: 2, z: 3 })); // no ThreeObject
        world.spawn(Transform({ x: 4, y: 5, z: 6 }), ThreeObject(mesh));
      });

    app.update(1 / 60);
    expect(mesh.position.x).toBeCloseTo(4);
  });

  it("syncs GlobalTransform and skips unchanged frames", () => {
    const mesh = new THREE.Mesh();
    const app = new App()
      .addPlugin({
        build(a) {
          a.addSystem(PreRender, syncTransforms);
        },
      })
      .addSystem(Startup, (world) => {
        world.spawn(Transform({ x: 1, y: 2, z: 3 }), ThreeObject(mesh));
      });

    app.update(1 / 60);
    expect(mesh.position.x).toBeCloseTo(1);

    mesh.position.set(50, 50, 50);
    app.update(1 / 60);
    // No Transform mutation → sync should skip; position stays poked
    expect(mesh.position.x).toBe(50);

    app.world.getMut(
      [...app.world.query(Transform)][0]![0],
      Transform,
    )!.x = 7;
    app.update(1 / 60);
    expect(mesh.position.x).toBeCloseTo(7);
  });
});
