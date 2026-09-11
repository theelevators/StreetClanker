import { component, resource, tag } from 'mob3'
import type { Group, MeshStandardMaterial, Mesh } from 'three'
import type { Corner, MatchState } from '../types'

/** Latest match snapshot from React / WebSocket — mutated in place each frame. */
export const MatchBridge = resource<{
  getState: () => MatchState | null
}>('MatchBridge')

export const RingTag = tag('RingTag')
export const ImpactTag = tag('ImpactTag')

export const FighterCorner = component<{ corner: Corner }>(
  { corner: 'red' },
  'FighterCorner',
)

export type ArmPoseData = {
  rotX: number
  rotY: number
  rotZ: number
  extend: number
  y: number
  x: number
}

export type FighterAnimData = {
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
  left: ArmPoseData
  right: ArmPoseData
}

export const FighterAnim = component<FighterAnimData>(
  {
    x: 0,
    y: 0,
    z: 0,
    lean: 0,
    sway: 0,
    headY: 0.55,
    headPitch: 0,
    headRoll: 0,
    torsoTwist: 0,
    torsoLean: 0,
    left: { rotX: -0.55, rotY: 0.12, rotZ: 0.18, extend: 0.06, y: 0, x: 0.02 },
    right: { rotX: -0.55, rotY: -0.12, rotZ: -0.18, extend: 0.06, y: 0, x: -0.02 },
  },
  'FighterAnim',
)

/** Sub-object handles for procedural robot rig (not synced via Transform). */
export type FighterRigData = {
  body: Group
  head: Group
  leftArm: Group
  rightArm: Group
  leftEye: MeshStandardMaterial
  rightEye: MeshStandardMaterial
}

export const FighterRig = component<FighterRigData>(
  {
    body: null as unknown as Group,
    head: null as unknown as Group,
    leftArm: null as unknown as Group,
    rightArm: null as unknown as Group,
    leftEye: null as unknown as MeshStandardMaterial,
    rightEye: null as unknown as MeshStandardMaterial,
  },
  'FighterRig',
)

export type ImpactFxData = {
  lastId: string | null
  flash: Mesh
  ring: Mesh
  group: Group
}

export const ImpactFx = component<ImpactFxData>(
  {
    lastId: null,
    flash: null as unknown as Mesh,
    ring: null as unknown as Mesh,
    group: null as unknown as Group,
  },
  'ImpactFx',
)

export type CameraShakeData = {
  shake: number
  lastImpactId: string | null
  baseX: number
  baseY: number
  baseZ: number
}

export const CameraShake = resource<CameraShakeData>('CameraShake')
