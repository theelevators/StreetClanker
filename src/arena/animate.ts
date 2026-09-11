import type {
  ActivePhrase,
  Corner,
  FightPhase,
  FighterPublic,
  ImpactEvent,
  PhraseMove,
  PhraseStyle,
} from '../types'
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

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/** Chamber (neg) → snap → hold → recover. */
function punchCurve(age: number, duration: number) {
  const t = clamp(age / duration, 0, 1)
  if (t < 0.14) return -0.4 * (t / 0.14)
  if (t < 0.34) return easeOutBack((t - 0.14) / 0.2)
  if (t < 0.55) return 1
  return 1 - easeOutCubic((t - 0.55) / 0.45)
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

function isPunch(move: string | null | undefined) {
  return !!move && ['jab', 'punch_left', 'punch_right'].includes(move)
}

function stylePressure(style: PhraseStyle | undefined) {
  switch (style) {
    case 'aggressive':
      return 1.18
    case 'showboat':
      return 0.92
    case 'counter':
      return 0.95
    default:
      return 1
  }
}

type Upcoming = {
  move: PhraseMove
  /** seconds until beat fires; negative = already due / resolving */
  eta: number
  style: PhraseStyle
  justResolved: boolean
}

function upcomingBeat(
  phrases: ActivePhrase[] | undefined,
  corner: Corner,
  now: number,
): Upcoming | null {
  const phrase = phrases?.find((p) => p.corner === corner)
  if (!phrase) return null

  for (let i = 0; i < phrase.beats.length; i++) {
    const beat = phrase.beats[i]!
    const resolved = phrase.resolved.includes(i)
    const eta = (beat.at - now) / 1000
    if (!resolved) {
      return { move: beat.move, eta, style: phrase.style, justResolved: false }
    }
    if (now - beat.at < 420) {
      return {
        move: beat.move,
        eta: (beat.at - now) / 1000,
        style: phrase.style,
        justResolved: true,
      }
    }
  }
  return null
}

export function stepFighterAnim(opts: {
  anim: FighterAnimData
  rig: FighterRigData
  side: Corner
  fighter: FighterPublic
  opponent: FighterPublic
  phase: FightPhase
  lastImpact: ImpactEvent | null
  activePhrases?: ActivePhrase[]
  cardHeat?: number
  now: number
}): void {
  const {
    anim: p,
    rig,
    side,
    fighter,
    opponent,
    phase,
    lastImpact,
    activePhrases,
    cardHeat = 0,
    now,
  } = opts
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
  const slippedIt =
    iAmDefender && lastImpact?.result === 'dodged' && impactAge < 0.45
  const landedHit = iAmAttacker && lastImpact?.result === 'hit' && impactAge < 0.45
  const whiffed =
    iAmAttacker && lastImpact?.result === 'dodged' && impactAge < 0.4

  const upcoming = upcomingBeat(activePhrases, side, now)
  const pressure = stylePressure(upcoming?.style)

  // Dodge wins over covering — server briefly flags covering on defense beats
  const activelyDodging =
    (action === 'dodge' && actionAge < 0.58) ||
    (upcoming?.move === 'dodge' && upcoming.eta < 0.05 && upcoming.eta > -0.35)
  const activelyBlocking =
    !activelyDodging &&
    (fighter.covering ||
      (action === 'block' && actionAge < 0.75) ||
      (upcoming?.move === 'block' && upcoming.eta < 0.05 && upcoming.eta > -0.35))
  const activelyPunching =
    !activelyDodging &&
    !activelyBlocking &&
    !!action &&
    isPunch(action) &&
    actionAge < 0.88
  const activelyTaunting =
    !activelyPunching &&
    !activelyBlocking &&
    !activelyDodging &&
    upcoming?.move === 'taunt' &&
    (upcoming.eta < 0.18 || upcoming.justResolved)
  const windingUp =
    !activelyPunching &&
    !activelyBlocking &&
    !activelyDodging &&
    !activelyTaunting &&
    !!upcoming &&
    isPunch(upcoming.move) &&
    upcoming.eta > 0 &&
    upcoming.eta < 0.28

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

  if (phase === 'fighting' || phase === 'countdown') {
    const heatAmp = 1 + (cardHeat / 100) * 0.35
    targetY = Math.sin(now / 210) * 0.012 * heatAmp
    targetZ = Math.sin(now / 380) * 0.018 * toward
    sway = Math.sin(now / 460) * 0.04
    if (upcoming) {
      targetX = homeX + toward * 0.06 * (pressure - 0.9) * 4
    }
  }

  if (windingUp && upcoming) {
    const wind = 1 - clamp(upcoming.eta / 0.28, 0, 1)
    const isLeft = upcoming.move === 'jab' || upcoming.move === 'punch_left'
    const power = upcoming.move === 'jab' ? 0.7 : 1
    targetX = homeX + toward * (-0.08 * wind * power)
    torsoTwist = (isLeft ? 0.35 : -0.38) * wind
    torsoLean = -0.1 * wind
    headPitch = 0.1 * wind
    lean = toward * -0.06 * wind
    const chamberArm: ArmPoseData = {
      rotX: -0.35 + 0.2 * wind,
      rotY: isLeft ? 0.12 : -0.12,
      rotZ: isLeft ? 0.2 : -0.2,
      extend: 0.04,
      y: 0.04 * wind,
      x: isLeft ? 0.06 : -0.06,
    }
    const guardArm: ArmPoseData = {
      rotX: -0.85,
      rotY: isLeft ? -0.15 : 0.15,
      rotZ: isLeft ? -0.2 : 0.2,
      extend: 0.1,
      y: 0.06,
      x: isLeft ? -0.03 : 0.03,
    }
    if (isLeft) {
      left = chamberArm
      right = guardArm
    } else {
      right = chamberArm
      left = guardArm
    }
  } else if (activelyPunching && action) {
    const isJab = action === 'jab'
    const isLeft = action === 'jab' || action === 'punch_left'
    const duration = isJab ? 0.46 : 0.6
    const curve = punchCurve(actionAge, duration)
    const shot = Math.max(0, curve)
    const chamber = curve < 0 ? -curve : 0
    const power = (isJab ? 0.72 : 1) * pressure

    targetX = homeX + toward * (0.58 * shot * power - 0.12 * chamber)
    targetY = 0.02 * shot
    torsoTwist = (isLeft ? 0.78 : -0.82) * shot
    torsoLean = 0.26 * shot - 0.14 * chamber
    lean = toward * 0.14 * shot
    sway = (isLeft ? 0.06 : -0.06) * shot
    headPitch = -0.12 * shot + 0.14 * chamber
    headRoll = (isLeft ? -0.08 : 0.08) * shot

    const punchArm: ArmPoseData = {
      rotX: -0.55 + 0.55 * shot + 0.28 * chamber,
      rotY: isLeft ? 0.05 : -0.05,
      rotZ: isLeft ? 0.1 : -0.1,
      extend: 0.08 + 1.22 * shot * power,
      y: 0.02 + 0.06 * shot,
      x: isLeft ? 0.05 : -0.05,
    }
    const coverArm: ArmPoseData = {
      rotX: -0.75,
      rotY: isLeft ? -0.12 : 0.12,
      rotZ: isLeft ? -0.18 : 0.18,
      extend: 0.1,
      y: 0.04,
      x: isLeft ? -0.03 : 0.03,
    }
    if (isLeft) {
      left = punchArm
      right = coverArm
    } else {
      right = punchArm
      left = coverArm
    }
  } else if (activelyTaunting) {
    const u = upcoming
      ? clamp(1 - Math.abs(Math.min(upcoming.eta, 0)) / 0.4, 0, 1)
      : 1
    const wave = easeInOut(u) * (0.7 + 0.3 * Math.sin(now / 90))
    targetX = homeX - toward * 0.04
    targetY = 0.04 * wave
    torsoTwist = 0.45 * Math.sin(now / 120) * wave
    torsoLean = -0.08 * wave
    headPitch = -0.15 * wave
    headRoll = 0.2 * Math.sin(now / 100) * wave
    left = {
      rotX: -0.15 + 0.4 * wave,
      rotY: 0.5,
      rotZ: 0.65,
      extend: 0.15 + 0.25 * wave,
      y: 0.18 * wave,
      x: 0.12,
    }
    right = {
      rotX: -0.15 + 0.4 * wave,
      rotY: -0.5,
      rotZ: -0.65,
      extend: 0.15 + 0.25 * wave,
      y: 0.18 * wave,
      x: -0.12,
    }
    rig.leftEye.emissiveIntensity = 1.4 + wave * 1.6
    rig.rightEye.emissiveIntensity = 1.4 + wave * 1.6
  } else if (activelyBlocking) {
    const turtle = fighter.covering && action !== 'block' ? 1.15 : 1
    targetX = homeX - toward * 0.1 * turtle
    targetY = -0.02 * turtle
    torsoLean = 0.18 * turtle
    headPitch = 0.2 * turtle
    left = {
      rotX: -1.35,
      rotY: 0.4,
      rotZ: 0.45,
      extend: 0.2,
      y: 0.14,
      x: 0.1,
    }
    right = {
      rotX: -1.35,
      rotY: -0.4,
      rotZ: -0.45,
      extend: 0.2,
      y: 0.14,
      x: -0.1,
    }
  } else if (activelyDodging) {
    const u = clamp(actionAge / 0.52, 0, 1)
    const slip = Math.sin(u * Math.PI)
    const away =
      lastImpact?.attacker && lastImpact.attacker !== side
        ? lastImpact.attacker === 'red'
          ? 1
          : -1
        : toward
    targetX = homeX - toward * 0.05 * slip
    targetZ = 0.34 * slip * away
    targetY = 0.03 * slip
    sway = 0.42 * slip
    torsoTwist = -0.42 * slip * away
    headRoll = 0.48 * slip * away
    headPitch = 0.14 * slip
    left = { ...READY_LEFT, rotX: -0.7, y: 0.04 }
    right = { ...READY_RIGHT, rotX: -0.7, y: 0.04 }
  }

  if (gotHit) {
    const snap = Math.sin((1 - impactAge / 0.55) * Math.PI)
    const power = Math.min(1.45, (lastImpact?.damage ?? 10) / 10)
    targetX = homeX - toward * 0.42 * snap * power
    targetY = 0.05 * snap
    lean = -toward * 0.28 * snap
    torsoLean = 0.48 * snap
    headPitch = 0.85 * snap
    headRoll = 0.35 * snap * (side === 'red' ? 1 : -1)
    left = { ...READY_LEFT, rotX: -0.2, extend: 0.03, y: -0.04 }
    right = { ...READY_RIGHT, rotX: -0.2, extend: 0.03, y: -0.04 }
    rig.leftEye.emissiveIntensity = 1.3 + snap * 3.2
    rig.rightEye.emissiveIntensity = 1.3 + snap * 3.2
  } else if (blockedHit) {
    const thud = Math.sin((1 - impactAge / 0.4) * Math.PI)
    targetX = homeX - toward * 0.12 * thud
    torsoLean = 0.16 * thud
    headPitch = 0.1 * thud
    left = {
      rotX: -1.4,
      rotY: 0.45,
      rotZ: 0.5,
      extend: 0.22,
      y: 0.16,
      x: 0.1,
    }
    right = {
      rotX: -1.4,
      rotY: -0.45,
      rotZ: -0.5,
      extend: 0.22,
      y: 0.16,
      x: -0.1,
    }
  } else if (slippedIt) {
    const slip = Math.sin((1 - impactAge / 0.45) * Math.PI)
    targetZ = 0.22 * slip * toward
    sway = 0.3 * slip
    headRoll = 0.35 * slip
  } else if (!activelyTaunting) {
    rig.leftEye.emissiveIntensity = lerp(rig.leftEye.emissiveIntensity, 0.85, 0.12)
    rig.rightEye.emissiveIntensity = lerp(rig.rightEye.emissiveIntensity, 0.85, 0.12)
  }

  if (landedHit && activelyPunching) {
    targetX = homeX + toward * 0.52
    torsoLean = Math.max(torsoLean, 0.3)
  }
  if (whiffed && activelyPunching) {
    targetX = homeX + toward * 0.62
    torsoLean = 0.35
    headPitch = 0.2
  }

  const oppAge = opponent.lastActionAt ? (now - opponent.lastActionAt) / 1000 : 99
  if (activelyPunching && oppAge < 0.5 && isPunch(opponent.lastAction)) {
    targetX = lerp(targetX, toward * 0.12, 0.28)
  }

  if (fighter.knockedOut) {
    const pop = easeOutCubic(
      Math.min(1, (now - (lastImpact?.at ?? fighter.lastActionAt ?? now)) / 650),
    )
    headY = 0.55 + 1.05 * pop
    headPitch = -0.5
    headRoll = 0.14 * Math.sin(now / 75)
    torsoLean = 0.4
    targetX = homeX - toward * 0.12
    targetY = -0.04
    left = { rotX: 0.2, rotY: 0.45, rotZ: 0.55, extend: 0.04, y: -0.08, x: 0.12 }
    right = {
      rotX: 0.2,
      rotY: -0.45,
      rotZ: -0.55,
      extend: 0.04,
      y: -0.08,
      x: -0.12,
    }
  }

  if (phase === 'lobby' || phase === 'ended' || phase === 'between_rounds') {
    left = { ...READY_LEFT, rotX: -0.35 }
    right = { ...READY_RIGHT, rotX: -0.35 }
    targetY = Math.sin(now / 500) * 0.008
  }

  const damp =
    activelyPunching || gotHit || fighter.knockedOut || activelyDodging
      ? 0.5
      : windingUp || activelyTaunting
        ? 0.32
        : 0.2
  p.x = lerp(p.x, targetX, damp)
  p.y = lerp(p.y, targetY, 0.28)
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
