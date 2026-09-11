import type { World, App, Plugin } from "mob3";
import {
  PreRender,
  Render,
  FixedUpdate,
  Update,
  Transform,
  GlobalTransform,
  PendingDespawn,
  system,
} from "mob3";
import * as THREE from "three";
import {
  ThreeCamera,
  ThreeObject,
  ThreeRenderer,
  ThreeScene,
  type ThreePluginOptions,
} from "./components.js";

type Owned = {
  ownsRenderer: boolean;
  resize?: () => void;
};

/**
 * Flat scene sync: ECS GlobalTransform → Object3D.
 * Three parenting is NOT authoritative; objects stay under Scene.
 * Change-aware: only sync GlobalTransform (or Transform fallback) changed this tick.
 */
export const syncTransforms = system({
  name: "syncTransforms",
  access: {
    read: [GlobalTransform, Transform],
    write: [ThreeObject],
  },
  run(world) {
    // Prefer changed globals; also sync newly added ThreeObject
    for (const [, global, three] of world
      .query(GlobalTransform, ThreeObject)
      .changed(GlobalTransform)) {
      applyTrs(three.object, global);
    }
    for (const [, global, three] of world
      .query(GlobalTransform, ThreeObject)
      .added(ThreeObject)) {
      applyTrs(three.object, global);
    }
    // Fallback: Transform+ThreeObject without GlobalTransform yet
    for (const [e, transform, three] of world.query(Transform, ThreeObject)) {
      if (world.has(e, GlobalTransform)) continue;
      if (!world.isChanged(e, Transform) && !world.isAdded(e, ThreeObject)) {
        continue;
      }
      applyTrs(three.object, transform);
    }
  },
});

function applyTrs(
  obj: THREE.Object3D,
  t: {
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
    sx: number;
    sy: number;
    sz: number;
  },
): void {
  obj.position.set(t.x, t.y, t.z);
  obj.rotation.set(t.rx, t.ry, t.rz);
  obj.scale.set(t.sx, t.sy, t.sz);
}

export const renderFrame = system({
  name: "renderFrame",
  access: {
    resources: {
      read: [ThreeRenderer, ThreeScene, ThreeCamera],
    },
  },
  run(world) {
    const renderer = world.resource(ThreeRenderer);
    const scene = world.resource(ThreeScene);
    const camera = world.resource(ThreeCamera);
    renderer.render(scene, camera);
  },
});

/** Detach Object3D for entities pending despawn (public PendingDespawn tag). */
export const detachPendingThreeObjects = system({
  name: "detachPendingThreeObjects",
  access: {
    read: [PendingDespawn],
    write: [ThreeObject],
  },
  run(world) {
    for (const [, three] of world.query(ThreeObject).with(PendingDespawn)) {
      three.object.removeFromParent();
    }
  },
});

/**
 * Thin Three.js integration.
 *
 * Ownership: objects created by the plugin are disposed on `app.dispose()`.
 * Caller-supplied renderer/scene/camera are left alone.
 */
export function ThreePlugin(options: ThreePluginOptions = {}): Plugin {
  const owned: Owned = {
    ownsRenderer: !options.renderer,
  };

  return {
    build(app: App) {
      const {
        canvas,
        antialias = true,
        createDefaultCamera = true,
        clearColor = 0x111111,
        autoResize = true,
      } = options;

      const renderer =
        options.renderer ??
        new THREE.WebGLRenderer({
          canvas,
          antialias,
        });
      renderer.setClearColor(clearColor);
      renderer.setPixelRatio(
        typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
      );

      const scene = options.scene ?? new THREE.Scene();

      let camera = options.camera;
      if (!camera && createDefaultCamera) {
        const aspect =
          canvas && canvas.clientWidth > 0
            ? canvas.clientWidth / Math.max(canvas.clientHeight, 1)
            : 16 / 9;
        camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        camera.position.set(0, 18, 22);
        camera.lookAt(0, 0, 0);
      }
      if (!camera) {
        throw new Error(
          "ThreePlugin: provide camera or leave createDefaultCamera enabled",
        );
      }

      if (autoResize && typeof window !== "undefined") {
        const resize = () => {
          const target = renderer.domElement;
          const width = target.clientWidth || window.innerWidth;
          const height = target.clientHeight || window.innerHeight;
          renderer.setSize(width, height, false);
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.aspect = width / Math.max(height, 1);
            camera.updateProjectionMatrix();
          }
        };
        resize();
        window.addEventListener("resize", resize);
        owned.resize = resize;
      }

      app.insertResource(ThreeRenderer, renderer);
      app.insertResource(ThreeScene, scene);
      app.insertResource(ThreeCamera, camera);

      app.addSystem(FixedUpdate, detachPendingThreeObjects);
      app.addSystem(Update, detachPendingThreeObjects);
      app.addSystem(PreRender, syncTransforms);
      app.addSystem(Render, renderFrame);
    },
    dispose(app: App) {
      if (owned.resize && typeof window !== "undefined") {
        window.removeEventListener("resize", owned.resize);
        owned.resize = undefined;
      }
      const renderer = app.world.tryResource(ThreeRenderer);
      if (renderer && owned.ownsRenderer) {
        renderer.dispose();
      }
    },
  };
}
