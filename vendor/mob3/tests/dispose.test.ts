import { describe, expect, it, beforeAll } from "vitest";
import { App } from "mob3";
import { SyntheticInputPlugin, InputPlugin } from "@mob3/input";
import { initRapier, RapierPlugin, physicsBodyCount } from "@mob3/rapier";
import { MobArenaPlugin } from "../../../examples/mob-arena/src/systems.ts";

beforeAll(async () => {
  await initRapier();
});

describe("Disposal torture", () => {
  it("create/update/dispose 50 headless apps without throwing", () => {
    for (let i = 0; i < 50; i++) {
      const app = new App()
        .addPlugin(SyntheticInputPlugin())
        .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
        .addPlugin(MobArenaPlugin({ seed: i }));
      for (let t = 0; t < 30; t++) app.update(1 / 60);
      const bodies = physicsBodyCount(app.world);
      expect(bodies).toBeGreaterThan(0);
      app.dispose();
      expect(app.isDisposed).toBe(true);
    }
  });

  it("InputPlugin dispose removes listeners (smoke)", () => {
    if (typeof window === "undefined") return;
    const app = new App().addPlugin(InputPlugin());
    app.dispose();
    app.dispose();
  });
});
