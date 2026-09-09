import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ImpactEvent } from '../types'

type Props = {
  impact: ImpactEvent | null
}

type Spark = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
}

export function ImpactFX({ impact }: Props) {
  const group = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const sparks = useRef<Spark[]>([])
  const lastId = useRef<string | null>(null)

  const sparkMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffe29a',
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    [],
  )

  useFrame((_, delta) => {
    if (!group.current) return
    const now = Date.now()

    if (impact && impact.id !== lastId.current) {
      lastId.current = impact.id
      const midX =
        impact.result === 'dodged'
          ? impact.defender === 'red'
            ? -0.4
            : 0.4
          : impact.attacker === 'red'
            ? -0.02
            : 0.02
      const y = impact.result === 'blocked' ? 0.98 : 1.1
      group.current.position.set(midX, y, 0.02)

      if (flash.current) {
        flash.current.visible = true
        flash.current.scale.setScalar(impact.result === 'hit' ? 1.45 : 0.85)
        const mat = flash.current.material as THREE.MeshBasicMaterial
        mat.color.set(
          impact.result === 'hit'
            ? '#fff2b0'
            : impact.result === 'blocked'
              ? '#d7e6ff'
              : '#b8ffd0',
        )
        mat.opacity = 0.95
      }
      if (ring.current) {
        ring.current.visible = impact.result !== 'dodged'
        ring.current.scale.setScalar(0.2)
        const mat = ring.current.material as THREE.MeshBasicMaterial
        mat.opacity = 0.8
      }

      // Spawn sparks
      clearSparks()
      if (impact.result !== 'dodged') {
        const count = impact.result === 'hit' ? 14 : 8
        for (let i = 0; i < count; i++) {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.04),
            sparkMat.clone(),
          )
          mesh.position.set(0, 0, 0)
          group.current.add(mesh)
          const dir = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            Math.random() * 1.6,
            (Math.random() - 0.5) * 2,
          ).normalize()
          sparks.current.push({
            mesh,
            velocity: dir.multiplyScalar(1.8 + Math.random() * 2.2),
            life: 0.35 + Math.random() * 0.25,
          })
        }
      }
    }

    const age = impact ? (now - impact.at) / 1000 : 99

    if (flash.current) {
      if (age < 0.18) {
        flash.current.visible = true
        const mat = flash.current.material as THREE.MeshBasicMaterial
        mat.opacity = 0.95 * (1 - age / 0.18)
        flash.current.scale.setScalar(0.6 + age * 4)
      } else {
        flash.current.visible = false
      }
    }

    if (ring.current) {
      if (age < 0.28 && impact?.result !== 'dodged') {
        ring.current.visible = true
        ring.current.scale.setScalar(0.25 + age * 3.5)
        const mat = ring.current.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(0, 0.75 * (1 - age / 0.28))
      } else {
        ring.current.visible = false
      }
    }

    for (let i = sparks.current.length - 1; i >= 0; i--) {
      const s = sparks.current[i]!
      s.life -= delta
      s.velocity.y -= 4 * delta
      s.mesh.position.addScaledVector(s.velocity, delta)
      s.mesh.rotation.x += delta * 8
      s.mesh.rotation.y += delta * 6
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, s.life * 2)
      if (s.life <= 0) {
        group.current.remove(s.mesh)
        s.mesh.geometry.dispose()
        mat.dispose()
        sparks.current.splice(i, 1)
      }
    }
  })

  function clearSparks() {
    if (!group.current) return
    for (const s of sparks.current) {
      group.current.remove(s.mesh)
      s.mesh.geometry.dispose()
      ;(s.mesh.material as THREE.Material).dispose()
    }
    sparks.current = []
  }

  return (
    <group ref={group}>
      <mesh ref={flash} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial transparent opacity={0.9} color="#fff2b0" depthWrite={false} />
      </mesh>
      <mesh ref={ring} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.14, 24]} />
        <meshBasicMaterial transparent opacity={0.8} color="#ffe29a" depthWrite={false} />
      </mesh>
    </group>
  )
}
