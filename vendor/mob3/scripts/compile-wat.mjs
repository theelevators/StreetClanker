/**
 * Compile Phase 8 WAT fixtures → .wasm (dev dependency: wabt).
 * Run: node packages/core/scripts/compile-wat.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import wabtFactory from "wabt";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "../tests/fixtures/wasm");
mkdirSync(fixtures, { recursive: true });

const wabt = await wabtFactory();

function compile(name, wat) {
  const features = { threads: true };
  const module = wabt.parseWat(name, wat, features);
  module.resolveNames();
  module.validate(features);
  const { buffer } = module.toBinary({ log: false });
  const out = join(fixtures, name.replace(/\.wat$/, ".wasm"));
  writeFileSync(out, Buffer.from(buffer));
  console.log("wrote", out, buffer.byteLength, "bytes");
}

const integrateWat = readFileSync(join(fixtures, "integrate.wat"), "utf8");
compile("integrate.wat", integrateWat);

const doubleWat = readFileSync(join(fixtures, "double.wat"), "utf8");
compile("double.wat", doubleWat);

const trapWat = `(module
  (memory (import "env" "memory") 1 256 shared)
  (func (export "abi_version") (result i32) (i32.const 1))
  (func (export "run")
    (param i32) (param f32)
    (param i32) (param i32) (param i32)
    (param i32) (param i32) (param i32)
    unreachable)
)`;
writeFileSync(join(fixtures, "trap.wat"), trapWat);
compile("trap.wat", trapWat);

const badAbiWat = `(module
  (memory (import "env" "memory") 1 256 shared)
  (func (export "abi_version") (result i32) (i32.const 2))
  (func (export "run")
    (param i32) (param f32)
    (param i32) (param i32) (param i32)
    (param i32) (param i32) (param i32))
)`;
writeFileSync(join(fixtures, "bad_abi.wat"), badAbiWat);
compile("bad_abi.wat", badAbiWat);
