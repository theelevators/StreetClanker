import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { FightPhase, FighterPublic, ImpactEvent } from '../types'

const RED = '#e23b2f'
const BLUE = '#2f7fd4'
const METAL = '#c5c8ce'
const DARK = '#2a2d33'

type Props = {
  fighter: FighterPublic
  opponent: FighterPublic
  side: 'red' | 'blue'
  phase: FightPhase
  lastImpact: ImpactEvent | null
}

type ArmPose = {
  /** 0 = straight forward at opponent, negative = raised */
  rotX: number
  rotY: number
  rotZ: number
  /** How far the fist shoots along local +Z toward the opponent */
  extend: number
  y: number
  x: number
}

type AnimPose = {
  x: number
  y: number
  z: number
  lean: number
  sway: number
  headY: number
  headPitch: number
  headRoll: number
  torsoTwist: number
  torsoLean: number
  left: ArmPose
  right: ArmPose
}

const HOME_X = { red: -0.78, blue: 0.78 } as const

function easeOutBack(t: number) {
  const c = 1.70158
  const u = t - 1
  return 1 + c * u * u * u + u * u
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

/**
 * Punch timeline (age seconds → extension 0..1, with negative = chamber).
 * Slow enough to READ: chamber, shoot, hold on the chin, pull back.
 */
function punchCurve(age: number, duration: number) {
  const t = THREE.MathUtils.clamp(age / duration, 0, 1)
  if (t < 0.12) return -0.35 * (t / 0.12)
  if (t < 0.32) return easeOutBack((t - 0.12) / 0.2)
  if (t < 0.58) return 1
  return 1 - easeOutCubic((t - 0.58) / 0.42)
}

const READY_LEFT: ArmPose = {
  rotX: -0.55,
  rotY: 0.12,
  rotZ: 0.18,
  extend: 0.06,
  y: 0,
  x: 0.02,
}
const READY_RIGHT: ArmPose = {
  rotX: -0.55,
  rotY: -0.12,
  rotZ: -0.18,
  extend: 0.06,
  y: 0,
  x: -0.02,
}

export function Robot({ fighter, opponent, side, phase, lastImpact }: Props) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const leftEye = useRef<THREE.MeshStandardMaterial>(null)
  const rightEye = useRef<THREE.MeshStandardMaterial>(null)

  const bodyColor = side === 'red' ? RED : BLUE
  const toward = side === 'red' ? 1 : -1
  const homeX: number = HOME_X[side]
  const faceYaw = side === 'red' ? Math.PI / 2 : -Math.PI / 2

  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.42,
        metalness: 0.38,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: METAL,
        roughness: 0.28,
        metalness: 0.72,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: DARK,
        roughness: 0.55,
        metalness: 0.25,
      }),
    }),
    [bodyColor],
  )

  const pose = useRef<AnimPose>({
    x: homeX,
    y: 0,
    z: 0,
    lean: 0,
    sway: 0,
    headY: 0.55,
    headPitch: 0,
    headRoll: 0,
    torsoTwist: 0,
    torsoLean: 0,
    left: { ...READY_LEFT },
    right: { ...READY_RIGHT },
  })

  useFrame(() => {
    const now = Date.now()
    const p = pose.current
    const action = fighter.lastAction
    const actionAge = fighter.lastActionAt ? (now - fighter.lastActionAt) / 1000 : 99
    const impactAge = lastImpact ? (now - lastImpact.at) / 1000 : 99
    const iAmAttacker = lastImpact?.attacker === side
    const iAmDefender = lastImpact?.defender === side
    const gotHit = iAmDefender && lastImpact?.result === 'hit' && impactAge < 0.55
    const blockedHit =
      iAmDefender && lastImpact?.result === 'blocked' && impactAge < 0.4
    const landedHit = iAmAttacker && lastImpact?.result === 'hit' && impactAge < 0.45

    const activelyBlocking = action === 'block' && actionAge < 0.7
    const activelyDodging = action === 'dodge' && actionAge < 0.55
    const activelyPunching =
      !!action &&
      ['jab', 'punch_left', 'punch_right'].includes(action) &&
      actionAge < 0.85

    // ---- STILL ready pose. No dancing. ----
    let targetX = homeX
    let targetY = 0
    let targetZ = 0
    let lean = 0
    let sway = 0
    let headY = 0.55
    let headPitch = 0
    let headRoll = 0
    let torsoTwist = 0
    let torsoLean = 0.02
    let left: ArmPose = { ...READY_LEFT }
    let right: ArmPose = { ...READY_RIGHT }

    if (activelyPunching && action) {
      const isJab = action === 'jab'
      const isLeft = action === 'jab' || action === 'punch_left'
      const duration = isJab ? 0.48 : 0.62
      const curve = punchCurve(actionAge, duration)
      const shot = Math.max(0, curve)
      const chamber = curve < 0 ? -curve : 0
      const power = isJab ? 0.72 : 1

      // Big readable lunge into the pocket
      targetX = homeX + toward * (0.55 * shot * power - 0.1 * chamber)
      torsoTwist = (isLeft ? 0.7 : -0.75) * shot
      torsoLean = 0.22 * shot - 0.12 * chamber
      lean = toward * 0.12 * shot
      sway = (isLeft ? 0.05 : -0.05) * shot
      headPitch = -0.1 * shot + 0.12 * chamber

      // KEY: punch arm goes STRAIGHT at opponent (rotX → ~0), fist rockets out
      const punchArm: ArmPose = {
        rotX: -0.55 + 0.5 * shot + 0.25 * chamber, // rises from ready → forward
        rotY: isLeft ? 0.05 : -0.05,
        rotZ: isLeft ? 0.08 : -0.08,
        extend: 0.08 + 1.15 * shot * power, // long telegraphed reach
        y: 0.02 + 0.05 * shot,
        x: isLeft ? 0.04 : -0.04,
      }
      // Off-hand stays quiet near the body — not waving
      const coverArm: ArmPose = {
        rotX: -0.7,
        rotY: isLeft ? -0.1 : 0.1,
        rotZ: isLeft ? -0.15 : 0.15,
        extend: 0.08,
        y: 0.02,
        x: isLeft ? -0.02 : 0.02,
      }

      if (isLeft) {
        left = punchArm
        right = coverArm
      } else {
        right = punchArm
        left = coverArm
      }
    } else if (activelyBlocking) {
      // Freeze a high guard — held, not shaking
      targetX = homeX - toward * 0.08
      torsoLean = 0.14
      headPitch = 0.15
      left = {
        rotX: -1.25,
        rotY: 0.35,
        rotZ: 0.4,
        extend: 0.18,
        y: 0.12,
        x: 0.08,
      }
      right = {
        rotX: -1.25,
        rotY: -0.35,
        rotZ: -0.4,
        extend: 0.18,
        y: 0.12,
        x: -0.08,
      }
    } else if (activelyDodging) {
      const u = THREE.MathUtils.clamp(actionAge / 0.5, 0, 1)
      const slip = Math.sin(u * Math.PI)
      targetX = homeX - toward * 0.06 * slip
      targetZ = 0.28 * slip * toward
      sway = 0.35 * slip
      torsoTwist = -0.35 * slip
      headRoll = 0.4 * slip
      headPitch = 0.12 * slip
      left = { ...READY_LEFT, rotX: -0.65 }
      right = { ...READY_RIGHT, rotX: -0.65 }
    }

    // Hit reaction — one sharp knockback, then settle
    if (gotHit) {
      const snap = Math.sin((1 - impactAge / 0.55) * Math.PI)
      const power = Math.min(1.35, (lastImpact?.damage ?? 10) / 11)
      targetX = homeX - toward * 0.38 * snap * power
      lean = -toward * 0.22 * snap
      torsoLean = 0.4 * snap
      headPitch = 0.75 * snap
      headRoll = 0.3 * snap * (side === 'red' ? 1 : -1)
      // Drop hands on impact — looks stunned, not dancing
      left = { ...READY_LEFT, rotX: -0.25, extend: 0.04 }
      right = { ...READY_RIGHT, rotX: -0.25, extend: 0.04 }
      if (leftEye.current) leftEye.current.emissiveIntensity = 1.2 + snap * 2.8
      if (rightEye.current) rightEye.current.emissiveIntensity = 1.2 + snap * 2.8
    } else if (blockedHit) {
      const thud = Math.sin((1 - impactAge / 0.4) * Math.PI)
      targetX = homeX - toward * 0.1 * thud
      torsoLean = 0.12 * thud
    } else {
      if (leftEye.current)
        leftEye.current.emissiveIntensity = THREE.MathUtils.lerp(
          leftEye.current.emissiveIntensity,
          0.85,
          0.12,
        )
      if (rightEye.current)
        rightEye.current.emissiveIntensity = THREE.MathUtils.lerp(
          rightEye.current.emissiveIntensity,
          0.85,
          0.12,
        )
    }

    if (landedHit && activelyPunching) {
      targetX = homeX + toward * 0.5
    }

    // Tiny clinch only while BOTH are mid-punch
    const oppAge = opponent.lastActionAt ? (now - opponent.lastActionAt) / 1000 : 99
    if (
      activelyPunching &&
      oppAge < 0.5 &&
      opponent.lastAction &&
      ['jab', 'punch_left', 'punch_right'].includes(opponent.lastAction)
    ) {
      targetX = THREE.MathUtils.lerp(targetX, toward * 0.15, 0.25)
    }

    if (fighter.knockedOut) {
      const pop = easeOutCubic(
        Math.min(1, (now - (lastImpact?.at ?? fighter.lastActionAt ?? now)) / 650),
      )
      headY = 0.55 + 1.0 * pop
      headPitch = -0.45
      headRoll = 0.12 * Math.sin(now / 80)
      torsoLean = 0.35
      targetX = homeX - toward * 0.1
      left = { rotX: 0.15, rotY: 0.4, rotZ: 0.5, extend: 0.04, y: -0.06, x: 0.1 }
      right = { rotX: 0.15, rotY: -0.4, rotZ: -0.5, extend: 0.04, y: -0.06, x: -0.1 }
    }

    if (phase === 'lobby' || phase === 'ended' || phase === 'between_rounds') {
      left = { ...READY_LEFT, rotX: -0.35 }
      right = { ...READY_RIGHT, rotX: -0.35 }
    }

    // Snappy when punching/hit, slower settle otherwise — no floaty dance lerp
    const damp = activelyPunching || gotHit || fighter.knockedOut ? 0.48 : 0.22
    p.x = THREE.MathUtils.lerp(p.x, targetX, damp)
    p.y = THREE.MathUtils.lerp(p.y, targetY, 0.25)
    p.z = THREE.MathUtils.lerp(p.z, targetZ, damp)
    p.lean = THREE.MathUtils.lerp(p.lean, lean, damp)
    p.sway = THREE.MathUtils.lerp(p.sway, sway, damp)
    p.headY = THREE.MathUtils.lerp(p.headY, headY, fighter.knockedOut ? 0.18 : 0.28)
    p.headPitch = THREE.MathUtils.lerp(p.headPitch, headPitch, damp)
    p.headRoll = THREE.MathUtils.lerp(p.headRoll, headRoll, damp)
    p.torsoTwist = THREE.MathUtils.lerp(p.torsoTwist, torsoTwist, damp)
    p.torsoLean = THREE.MathUtils.lerp(p.torsoLean, torsoLean, damp)
    blendArm(p.left, left, damp)
    blendArm(p.right, right, damp)

    const g = root.current
    if (!g) return
    g.position.set(p.x, p.y, p.z)
    g.rotation.set(p.sway * 0.15, faceYaw, -p.lean)

    if (body.current) body.current.rotation.set(p.torsoLean, p.torsoTwist, 0)
    if (head.current) {
      head.current.position.y = p.headY
      head.current.rotation.set(p.headPitch, 0, p.headRoll)
    }
    applyArm(leftArm.current, p.left, -0.32)
    applyArm(rightArm.current, p.right, 0.32)
  })

  return (
    <group ref={root} position={[homeX, 0, 0]} rotation={[0, faceYaw, 0]}>
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.48, 0.1, 24]} />
        <meshStandardMaterial color="#f5d547" roughness={0.55} metalness={0.2} />
      </mesh>

      <mesh position={[-0.12, 0.28, 0]} castShadow material={materials.body}>
        <boxGeometry args={[0.16, 0.35, 0.18]} />
      </mesh>
      <mesh position={[0.12, 0.28, 0]} castShadow material={materials.body}>
        <boxGeometry args={[0.16, 0.35, 0.18]} />
      </mesh>

      <group ref={body}>
        <mesh position={[0, 0.62, 0]} castShadow material={materials.body}>
          <boxGeometry args={[0.48, 0.42, 0.32]} />
        </mesh>
        <mesh position={[0, 0.62, 0.17]} material={materials.metal}>
          <boxGeometry args={[0.2, 0.16, 0.04]} />
        </mesh>

        <group ref={head} position={[0, 0.55, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow material={materials.body}>
            <boxGeometry args={[0.36, 0.34, 0.34]} />
          </mesh>
          <mesh position={[-0.09, 0.46, 0.17]}>
            <boxGeometry args={[0.08, 0.06, 0.04]} />
            <meshStandardMaterial
              ref={leftEye}
              color="#ffef8a"
              emissive="#ffb020"
              emissiveIntensity={0.85}
            />
          </mesh>
          <mesh position={[0.09, 0.46, 0.17]}>
            <boxGeometry args={[0.08, 0.06, 0.04]} />
            <meshStandardMaterial
              ref={rightEye}
              color="#ffef8a"
              emissive="#ffb020"
              emissiveIntensity={0.85}
            />
          </mesh>
          <mesh position={[0, 0.34, 0.18]} material={materials.dark}>
            <boxGeometry args={[0.14, 0.05, 0.04]} />
          </mesh>
          <mesh position={[0, 0.66, 0]} material={materials.metal}>
            <cylinderGeometry args={[0.02, 0.02, 0.16, 8]} />
          </mesh>
          <mesh position={[0, 0.76, 0]}>
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshStandardMaterial
              color="#ffef8a"
              emissive="#ffb020"
              emissiveIntensity={0.9}
            />
          </mesh>
        </group>

        <group ref={leftArm} position={[-0.32, 0.7, 0]}>
          <mesh position={[0, -0.05, 0.2]} castShadow material={materials.body}>
            <boxGeometry args={[0.15, 0.15, 0.46]} />
          </mesh>
          <mesh position={[0, -0.05, 0.48]} castShadow material={materials.dark}>
            <boxGeometry args={[0.22, 0.22, 0.18]} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.32, 0.7, 0]}>
          <mesh position={[0, -0.05, 0.2]} castShadow material={materials.body}>
            <boxGeometry args={[0.15, 0.15, 0.46]} />
          </mesh>
          <mesh position={[0, -0.05, 0.48]} castShadow material={materials.dark}>
            <boxGeometry args={[0.22, 0.22, 0.18]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function blendArm(current: ArmPose, target: ArmPose, alpha: number) {
  current.rotX = THREE.MathUtils.lerp(current.rotX, target.rotX, alpha)
  current.rotY = THREE.MathUtils.lerp(current.rotY, target.rotY, alpha)
  current.rotZ = THREE.MathUtils.lerp(current.rotZ, target.rotZ, alpha)
  current.extend = THREE.MathUtils.lerp(current.extend, target.extend, alpha)
  current.y = THREE.MathUtils.lerp(current.y, target.y, alpha)
  current.x = THREE.MathUtils.lerp(current.x, target.x, alpha)
}

function applyArm(arm: THREE.Group | null, pose: ArmPose, baseX: number) {
  if (!arm) return
  arm.position.set(baseX + pose.x, 0.7 + pose.y, 0)
  arm.rotation.set(pose.rotX, pose.rotY, pose.rotZ)
  const beam = arm.children[0] as THREE.Mesh | undefined
  if (beam) {
    // Stretch the forearm toward the opponent
    beam.position.set(0, -0.05, 0.12 + pose.extend * 0.55)
    beam.scale.set(1, 1, 1 + pose.extend * 0.9)
  }
  const glove = arm.children[1] as THREE.Mesh | undefined
  if (glove) glove.position.set(0, -0.05, 0.38 + pose.extend * 1.05)
}
