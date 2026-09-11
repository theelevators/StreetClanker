(module
  (memory (import "env" "memory") 1 256 shared)
  (func (export "abi_version") (result i32) (i32.const 2))
  (func (export "run")
    (param i32) (param f32)
    (param i32) (param i32) (param i32)
    (param i32) (param i32) (param i32))
)