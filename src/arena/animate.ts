import type { Corner, FightPhase, FighterPublic, ImpactEvent } from '../types'
import type { ArmPoseData, FighterAnimData, FighterRigData } from './components'

export const HOME_X: Record<'red' | 'blue', number> = { red: -0.78, blue: 0.78 }

const READY_LEFT: ArmPoseData = {
  rotX: -0.55,
  rotY: 0.12,
  rotZ: 0.18,
  extend: 0.06,
  y: 0,
  x: 0.02,
}
const READY_RIGHT: ArmPoseData = {
  rotX: -0.55,
  rotY: -0.12,
  rotZ: -0.18,
  extend: 0.06,
  y: 0,
  x: -0.02,
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function easeOutBack(t: number) {
  const c = 1.70158
  const u = t - 1
  return 1 + c * u * u * u + u * u
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

function punchCurve(age: number, duration: number) {
  const t = clamp(age / duration, 0, 1)
  if (t < 0.12) return -0.35 * (t / 0.12)
  if (t < 0.32) return easeOutBack((t - 0.12) / 0.2)
  if (t < 0.58) return 1
  return 1 - easeOutCubic((t - 0.58) / 0.42)
}

function blendArm(current: ArmPoseData, target: ArmPoseData, alpha: number) {
  current.rotX = lerp(current.rotX, target.rotX, alpha)
  current.rotY = lerp(current.rotY, target.rotY, alpha)
  current.rotZ = lerp(current.rotZ, target.rotZ, alpha)
  current.extend = lerp(current.extend, target.extend, alpha)
  current.y = lerp(current.y, target.y, alpha)
  current.x = lerp(current.x, target.x, alpha)
}

function applyArm(
  arm: FighterRigData['leftArm'],
  pose: ArmPoseData,
  baseX: number,
) {
  arm.position.set(baseX + pose.x, 0.7 + pose.y, 0)
  arm.rotation.set(pose.rotX, pose.rotY, pose.rotZ)
  const beam = arm.children[0]
  if (beam) {
    beam.position.set(0, -0.05, 0.12 + pose.extend * 0.55)
    beam.scale.set(1, 1, 1 + pose.extend * 0.9)
  }
  const glove = arm.children[1]
  if (glove) glove.position.set(0, -0.05, 0.38 + pose.extend * 1.05)
}

export function initialAnim(side: Corner): FighterAnimData {
  return {
    x: HOME_X[side],
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
  }
}

export function stepFighterAnim(opts: {
  anim: FighterAnimData
  rig: FighterRigData
  side: Corner
  fighter: FighterPublic
  opponent: FighterPublic
  phase: FightPhase
  lastImpact: ImpactEvent | null
  now: number
}): void {
  const { anim: p, rig, side, fighter, opponent, phase, lastImpact, now } = opts
  const toward = side === 'red' ? 1 : -1
  const homeX = HOME_X[side]
  const faceYaw = side === 'red' ? Math.PI / 2 : -Math.PI / 2

  const action = fighter.lastAction
  const actionAge = fighter.lastActionAt ? (now - fighter.lastActionAt) / 1000 : 99
  const impactAge = lastImpact ? (now - lastImpact.at) / 1000 : 99
  const iAmAttacker = lastImpact?.attacker === side
  const iAmDefender = lastImpact?.defender === side
  const gotHit = iAmDefender && lastImpact?.result === 'hit' && impactAge < 0.55
  const blockedHit =
    iAmDefender && lastImpact?.result === 'blocked' && impactAge < 0.4
  const landedHit = iAmAttacker && lastImpact?.result === 'hit' && impactAge < 0.45

  const activelyBlocking =
    fighter.covering || (action === 'block' && actionAge < 0.7)
  const activelyDodging = action === 'dodge' && actionAge < 0.55 && !fighter.covering
  const activelyPunching =
    !!action &&
    ['jab', 'punch_left', 'punch_right'].includes(action) &&
    actionAge < 0.85 &&
    !fighter.covering

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
  let left: ArmPoseData = { ...READY_LEFT }
  let right: ArmPoseData = { ...READY_RIGHT }

  if (activelyPunching && action) {
    const isJab = action === 'jab'
    const isLeft = action === 'jab' || action === 'punch_left'
    const duration = isJab ? 0.48 : 0.62
    const curve = punchCurve(actionAge, duration)
    const shot = Math.max(0, curve)
    const chamber = curve < 0 ? -curve : 0
    const power = isJab ? 0.72 : 1

    targetX = homeX + toward * (0.55 * shot * power - 0.1 * chamber)
    torsoTwist = (isLeft ? 0.7 : -0.75) * shot
    torsoLean = 0.22 * shot - 0.12 * chamber
    lean = toward * 0.12 * shot
    sway = (isLeft ? 0.05 : -0.05) * shot
    headPitch = -0.1 * shot + 0.12 * chamber

    const punchArm: ArmPoseData = {
      rotX: -0.55 + 0.5 * shot + 0.25 * chamber,
      rotY: isLeft ? 0.05 : -0.05,
      rotZ: isLeft ? 0.08 : -0.08,
      extend: 0.08 + 1.15 * shot * power,
      y: 0.02 + 0.05 * shot,
      x: isLeft ? 0.04 : -0.04,
    }
    const coverArm: ArmPoseData = {
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
    const u = clamp(actionAge / 0.5, 0, 1)
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

  if (gotHit) {
    const snap = Math.sin((1 - impactAge / 0.55) * Math.PI)
    const power = Math.min(1.35, (lastImpact?.damage ?? 10) / 11)
    targetX = homeX - toward * 0.38 * snap * power
    lean = -toward * 0.22 * snap
    torsoLean = 0.4 * snap
    headPitch = 0.75 * snap
    headRoll = 0.3 * snap * (side === 'red' ? 1 : -1)
    left = { ...READY_LEFT, rotX: -0.25, extend: 0.04 }
    right = { ...READY_RIGHT, rotX: -0.25, extend: 0.04 }
    rig.leftEye.emissiveIntensity = 1.2 + snap * 2.8
    rig.rightEye.emissiveIntensity = 1.2 + snap * 2.8
  } else if (blockedHit) {
    const thud = Math.sin((1 - impactAge / 0.4) * Math.PI)
    targetX = homeX - toward * 0.1 * thud
    torsoLean = 0.12 * thud
  } else {
    rig.leftEye.emissiveIntensity = lerp(rig.leftEye.emissiveIntensity, 0.85, 0.12)
    rig.rightEye.emissiveIntensity = lerp(rig.rightEye.emissiveIntensity, 0.85, 0.12)
  }

  if (landedHit && activelyPunching) {
    targetX = homeX + toward * 0.5
  }

  const oppAge = opponent.lastActionAt ? (now - opponent.lastActionAt) / 1000 : 99
  if (
    activelyPunching &&
    oppAge < 0.5 &&
    opponent.lastAction &&
    ['jab', 'punch_left', 'punch_right'].includes(opponent.lastAction)
  ) {
    targetX = lerp(targetX, toward * 0.15, 0.25)
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

  const damp = activelyPunching || gotHit || fighter.knockedOut ? 0.48 : 0.22
  p.x = lerp(p.x, targetX, damp)
  p.y = lerp(p.y, targetY, 0.25)
  p.z = lerp(p.z, targetZ, damp)
  p.lean = lerp(p.lean, lean, damp)
  p.sway = lerp(p.sway, sway, damp)
  p.headY = lerp(p.headY, headY, fighter.knockedOut ? 0.18 : 0.28)
  p.headPitch = lerp(p.headPitch, headPitch, damp)
  p.headRoll = lerp(p.headRoll, headRoll, damp)
  p.torsoTwist = lerp(p.torsoTwist, torsoTwist, damp)
  p.torsoLean = lerp(p.torsoLean, torsoLean, damp)
  blendArm(p.left, left, damp)
  blendArm(p.right, right, damp)

  // Apply to Transform is done by caller; apply local rig here
  void faceYaw
  rig.body.rotation.set(p.torsoLean, p.torsoTwist, 0)
  rig.head.position.y = p.headY
  rig.head.rotation.set(p.headPitch, 0, p.headRoll)
  applyArm(rig.leftArm, p.left, -0.32)
  applyArm(rig.rightArm, p.right, 0.32)
}

export function faceYawFor(side: Corner) {
  return side === 'red' ? Math.PI / 2 : -Math.PI / 2
}
