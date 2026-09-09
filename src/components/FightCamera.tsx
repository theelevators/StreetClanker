import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import type { FightPhase, ImpactEvent } from '../types'

type Props = {
  phase: FightPhase
  lastImpact: ImpactEvent | null
}

export function FightCamera({ phase, lastImpact }: Props) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const shake = useRef(0)
  const lastId = useRef<string | null>(null)
  const base = useRef({
    pos: new THREE.Vector3(3.8, 3.2, 4.6),
    target: new THREE.Vector3(0, 0.75, 0),
  })

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const fighting = phase === 'fighting' || phase === 'countdown' || phase === 'knockout'

    if (lastImpact && lastImpact.id !== lastId.current) {
      lastId.current = lastImpact.id
      shake.current =
        lastImpact.result === 'hit'
          ? Math.min(0.55, 0.18 + lastImpact.damage / 40)
          : lastImpact.result === 'blocked'
            ? 0.12
            : 0.06
    }

    // Slow orbit drift during fight for presence
    const orbit = fighting ? 0.08 * Math.sin(t * 0.35) : 0
    const zoom = phase === 'knockout' ? 0.35 : phase === 'fighting' ? 0.12 : 0
    const desired = base.current.pos
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit)
      .multiplyScalar(1 - zoom * 0.08)
    if (phase === 'knockout') desired.y += 0.25

    if (shake.current > 0.001) {
      desired.x += (Math.random() - 0.5) * shake.current
      desired.y += (Math.random() - 0.5) * shake.current * 0.6
      desired.z += (Math.random() - 0.5) * shake.current
      shake.current *= 0.86
    }

    // Only nudge camera if user isn't mid-drag heavily — soft follow
    camera.position.lerp(desired, 0.045)

    if (controls.current) {
      const target = base.current.target.clone()
      if (lastImpact && Date.now() - lastImpact.at < 350) {
        target.x += lastImpact.attacker === 'red' ? -0.08 : 0.08
        target.y += 0.05
      }
      controls.current.target.lerp(target, 0.06)
      controls.current.update()
    }
  })

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minPolarAngle={0.35}
      maxPolarAngle={1.35}
      minDistance={3.2}
      maxDistance={9}
      target={[0, 0.75, 0]}
    />
  )
}
