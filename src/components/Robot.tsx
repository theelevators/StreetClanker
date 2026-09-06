import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { FightAction, FighterPublic } from '../types'

const RED = '#e23b2f'
const BLUE = '#2f7fd4'
const METAL = '#c5c8ce'
const DARK = '#2a2d33'
type Props = {
  fighter: FighterPublic
  side: 'red' | 'blue'
}

export function Robot({ fighter, side }: Props) {
  const group = useRef<THREE.Group>(null)
  const leftArm = useRef<THREE.Group>(null)
  const rightArm = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const bodyColor = side === 'red' ? RED : BLUE
  const x = side === 'red' ? -0.85 : 0.85
  const facing = side === 'red' ? 1 : -1

  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.45,
        metalness: 0.35,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: METAL,
        roughness: 0.3,
        metalness: 0.7,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: DARK,
        roughness: 0.6,
        metalness: 0.2,
      }),
      eye: new THREE.MeshStandardMaterial({
        color: '#ffef8a',
        emissive: '#ffb020',
        emissiveIntensity: 0.8,
      }),
    }),
    [bodyColor],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const g = group.current
    if (!g) return

    const action = fighter.lastAction
    const age = fighter.lastActionAt ? (Date.now() - fighter.lastActionAt) / 1000 : 99
    const punchT = Math.max(0, 1 - age / 0.35)

    // Idle bob
    g.position.y = 0.02 * Math.sin(t * 3 + (side === 'red' ? 0 : 1))
    g.rotation.y = facing * 0.08 * Math.sin(t * 1.4)

    if (fighter.knockedOut && head.current) {
      head.current.position.y = THREE.MathUtils.lerp(head.current.position.y, 0.95, 0.12)
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, -0.15, 0.1)
    } else if (head.current) {
      head.current.position.y = THREE.MathUtils.lerp(head.current.position.y, 0.55, 0.2)
      head.current.rotation.x = 0
    }

    animateArm(leftArm.current, action, 'left', punchT, fighter)
    animateArm(rightArm.current, action, 'right', punchT, fighter)

    if (action === 'dodge' && age < 0.5) {
      g.position.x = x + facing * -0.18 * Math.sin(punchT * Math.PI)
    } else {
      g.position.x = THREE.MathUtils.lerp(g.position.x, x, 0.15)
    }

    if (action === 'block' && age < 0.6) {
      g.position.z = THREE.MathUtils.lerp(g.position.z, -0.08, 0.2)
    } else {
      g.position.z = THREE.MathUtils.lerp(g.position.z, 0, 0.12)
    }
  })

  return (
    <group ref={group} position={[x, 0, 0]} scale={[facing, 1, 1]}>
      {/* Base plate */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.48, 0.1, 24]} />
        <meshStandardMaterial color="#f5d547" roughness={0.55} metalness={0.2} />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.12, 0.28, 0]} castShadow material={materials.body}>
        <boxGeometry args={[0.16, 0.35, 0.18]} />
      </mesh>
      <mesh position={[0.12, 0.28, 0]} castShadow material={materials.body}>
        <boxGeometry args={[0.16, 0.35, 0.18]} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 0.62, 0]} castShadow material={materials.body}>
        <boxGeometry args={[0.48, 0.42, 0.32]} />
      </mesh>
      <mesh position={[0, 0.62, 0.17]} material={materials.metal}>
        <boxGeometry args={[0.2, 0.16, 0.04]} />
      </mesh>

      {/* Head */}
      <group ref={head} position={[0, 0.55, 0]}>
        <mesh position={[0, 0.42, 0]} castShadow material={materials.body}>
          <boxGeometry args={[0.36, 0.34, 0.34]} />
        </mesh>
        <mesh position={[-0.09, 0.46, 0.17]} material={materials.eye}>
          <boxGeometry args={[0.08, 0.06, 0.04]} />
        </mesh>
        <mesh position={[0.09, 0.46, 0.17]} material={materials.eye}>
          <boxGeometry args={[0.08, 0.06, 0.04]} />
        </mesh>
        <mesh position={[0, 0.34, 0.18]} material={materials.dark}>
          <boxGeometry args={[0.14, 0.05, 0.04]} />
        </mesh>
        {/* Antenna */}
        <mesh position={[0, 0.66, 0]} material={materials.metal}>
          <cylinderGeometry args={[0.02, 0.02, 0.16, 8]} />
        </mesh>
        <mesh position={[0, 0.76, 0]} material={materials.eye}>
          <sphereGeometry args={[0.04, 12, 12]} />
        </mesh>
      </group>

      {/* Arms */}
      <group ref={leftArm} position={[-0.32, 0.7, 0]}>
        <mesh position={[0, -0.05, 0.18]} castShadow material={materials.body}>
          <boxGeometry args={[0.14, 0.14, 0.42]} />
        </mesh>
        <mesh position={[0, -0.05, 0.42]} castShadow material={materials.dark}>
          <boxGeometry args={[0.18, 0.18, 0.14]} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.32, 0.7, 0]}>
        <mesh position={[0, -0.05, 0.18]} castShadow material={materials.body}>
          <boxGeometry args={[0.14, 0.14, 0.42]} />
        </mesh>
        <mesh position={[0, -0.05, 0.42]} castShadow material={materials.dark}>
          <boxGeometry args={[0.18, 0.18, 0.14]} />
        </mesh>
      </group>
    </group>
  )
}

function animateArm(
  arm: THREE.Group | null,
  action: FightAction | null,
  which: 'left' | 'right',
  punchT: number,
  fighter: FighterPublic,
) {
  if (!arm) return
  const isLeft = which === 'left'
  const punching =
    (action === 'punch_left' && isLeft) ||
    (action === 'punch_right' && !isLeft) ||
    (action === 'jab' && isLeft)

  if (fighter.lastAction === 'block') {
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.9, 0.2)
    arm.position.z = THREE.MathUtils.lerp(arm.position.z, 0.12, 0.2)
    return
  }

  if (punching && punchT > 0) {
    const swing = Math.sin(punchT * Math.PI) * 1.35
    arm.rotation.x = -swing
    arm.position.z = swing * 0.25
  } else {
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.15, 0.15)
    arm.position.z = THREE.MathUtils.lerp(arm.position.z, 0, 0.15)
  }
}
