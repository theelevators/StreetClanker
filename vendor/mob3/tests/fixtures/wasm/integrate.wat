;; Phase 8 first WASM system — Transform += Velocity * delta
;; Import shared linear memory from host WasmMemoryArena.
;; Hot path uses offsets only (no names).
(module
  (memory (import "env" "memory") 1 1024 shared)

  (func (export "abi_version") (result i32)
    (i32.const 1))

  ;; run(count, delta, tx, ty, tz, vx, vy, vz)
  ;; All * offsets are byte offsets into linear memory of f32 columns.
  (func (export "run")
    (param $count i32)
    (param $delta f32)
    (param $tx i32)
    (param $ty i32)
    (param $tz i32)
    (param $vx i32)
    (param $vy i32)
    (param $vz i32)

    (local $i i32)
    (local $off i32)

    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))

        (local.set $off (i32.mul (local.get $i) (i32.const 4)))

        ;; tx[i] += vx[i] * delta
        (f32.store
          (i32.add (local.get $tx) (local.get $off))
          (f32.add
            (f32.load (i32.add (local.get $tx) (local.get $off)))
            (f32.mul
              (f32.load (i32.add (local.get $vx) (local.get $off)))
              (local.get $delta))))

        (f32.store
          (i32.add (local.get $ty) (local.get $off))
          (f32.add
            (f32.load (i32.add (local.get $ty) (local.get $off)))
            (f32.mul
              (f32.load (i32.add (local.get $vy) (local.get $off)))
              (local.get $delta))))

        (f32.store
          (i32.add (local.get $tz) (local.get $off))
          (f32.add
            (f32.load (i32.add (local.get $tz) (local.get $off)))
            (f32.mul
              (f32.load (i32.add (local.get $vz) (local.get $off)))
              (local.get $delta))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop))))
)
