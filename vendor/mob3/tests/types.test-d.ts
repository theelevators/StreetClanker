/**
 * Compile-time type expectations. This file is typechecked; runtime is a no-op.
 */
import { World, component, tag, type Entity } from "../src/index.js";

const Position = component({ x: 0, y: 0, z: 0 });
const Velocity = component({ x: 0, y: 0, z: 0 });
const Player = tag();

function typeTests(world: World) {
  for (const [entity, position, velocity] of world.query(Position, Velocity)) {
    const _e: Entity = entity;
    const _x: number = position.x;
    const _vx: number = velocity.x;
    void _e;
    void _x;
    void _vx;
  }

  for (const [entity, position] of world.query(Position).with(Player)) {
    const _e: Entity = entity;
    const _y: number = position.y;
    void _e;
    void _y;
  }

  const p = Position({ x: 1 });
  // @ts-expect-error — unknown fields should fail
  Position({ w: 1 });

  void p;
}

void typeTests;
