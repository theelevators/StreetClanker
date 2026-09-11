(module
  (memory (import "env" "memory") 1 1 shared)
  (func (export "go") (param $base i32) (param $n i32)
    (local $i i32)
    (local $off i32)
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $off
          (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const 4))))
        (f32.store (local.get $off)
          (f32.mul (f32.load (local.get $off)) (f32.const 2)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop))))
)
