import {
  type App,
  type Plugin,
  type World,
  Startup,
  Update,
  Time,
  Transform,
} from '@mob3/core'
import {
  ThreeScene,
  ThreeObject,
  ThreeCamera,
  ThreeRenderer,
} from '@mob3/three'
import * as THREE from 'three'
import type { Corner } from '../types'
import {
  MatchBridge,
  FighterCorner,
  FighterAnim,
  FighterRig,
  ImpactFx,
  ImpactTag,
  RingTag,
  RingFx,
  CameraShake,
} from './components'
import {
  buildImpactFx,
  buildRing,
  buildRobot,
  buildDust,
  buildHitLight,
  collectRopes,
} from './meshes'
import { faceYawFor, initialAnim, stepFighterAnim, HOME_X } from './animate'

/** Ring fight systems. ThreePlugin is attached by `@mob3/react`. */
export function FightPlugin(): Plugin {
  return {
    build(app: App) {
      app.addSystem(Startup, setupScene)
      app.addSystem(Update, animateFighters)
      app.addSystem(Update, animateImpact)
      app.addSystem(Update, animateRingAmbience)
      app.addSystem(Update, animateCamera)
    },
  }
}

function setupScene(world: World) {
  const scene = world.resource(ThreeScene) as unknown as THREE.Scene
  const camera = world.resource(ThreeCamera) as unknown as THREE.PerspectiveCamera
  const renderer = world.resource(ThreeRenderer) as unknown as THREE.WebGLRenderer

  scene.background = new THREE.Color('#1c1410')
  scene.fog = new THREE.Fog('#1c1410', 8, 18)
  renderer.shadowMap.enabled = true

  camera.fov = 48
  camera.near = 0.1
  camera.far = 100
  // Closer + wider so the ring fills the fullscreen play surface behind the HUD
  camera.position.set(2.9, 2.55, 3.55)
  camera.lookAt(0, 0.95, 0)
  camera.updateProjectionMatrix()

  scene.add(new THREE.AmbientLight(0xffffff, 0.45))
  const sun = new THREE.DirectionalLight(0xffffff, 1.35)
  sun.position.set(4, 8, 3)
  sun.castShadow = true
  scene.add(sun)
  const spot = new THREE.SpotLight(0xffd38a, 0.8, 0, 0.5, 0.6)
  spot.position.set(-3, 6, -2)
  scene.add(spot)

  const ring = buildRing()
  const dust = buildDust()
  const hitLight = buildHitLight()
  ring.add(dust)
  ring.add(hitLight)
  scene.add(ring)
  world.spawn(
    Transform(),
    ThreeObject(ring),
    RingTag,
    RingFx({
      ropes: collectRopes(ring),
      dust,
      hitLight,
      hitPulse: 0,
    }),
  )

  for (const corner of ['red', 'blue'] as const) {
    const { root, rig } = buildRobot(corner)
    scene.add(root)
    world.spawn(
      Transform({
        x: HOME_X[corner],
        y: 0,
        z: 0,
        ry: faceYawFor(corner),
      }),
      ThreeObject(root),
      FighterCorner({ corner }),
      FighterAnim(initialAnim(corner)),
      FighterRig(rig),
    )
  }

  const fx = buildImpactFx()
  scene.add(fx.group)
  world.spawn(
    Transform({ y: 1.1 }),
    ThreeObject(fx.group),
    ImpactTag,
    ImpactFx({
      lastId: null,
      flash: fx.flash,
      ring: fx.ring,
      group: fx.group,
    }),
  )

  world.insertResource(CameraShake, {
    shake: 0,
    lastImpactId: null,
    baseX: 2.9,
    baseY: 2.55,
    baseZ: 3.55,
  })
}

function animateFighters(world: World) {
  const bridge = world.tryResource(MatchBridge)
  const state = bridge?.getState()
  if (!state) return
  const now = Date.now()

  for (const [entity, , , corner, anim, rig] of world.query(
    Transform,
    ThreeObject,
    FighterCorner,
    FighterAnim,
    FighterRig,
  )) {
    const side = corner.corner as Corner
    const fighter = state[side]
    stepFighterAnim({
      anim,
      rig,
      side,
      fighter,
      opponent: state[side === 'red' ? 'blue' : 'red'],
      phase: state.phase,
      lastImpact: state.lastImpact,
      activePhrases: state.activePhrases,
      cardHeat: state.cardHeat,
      now,
    })

    // Low-HP eyes burn hotter / redder
    const hp = Math.max(0, Math.min(1, fighter.health / Math.max(1, fighter.maxHealth || 300)))
    const baseGlow = 0.55 + (1 - hp) * 1.35
    if (rig.leftEye.emissiveIntensity < baseGlow) {
      rig.leftEye.emissiveIntensity = baseGlow
      rig.rightEye.emissiveIntensity = baseGlow
    }
    const tint = new THREE.Color().setHSL(0.02 + hp * 0.08, 0.85, 0.45 + hp * 0.15)
    rig.leftEye.emissive.copy(tint)
    rig.rightEye.emissive.copy(tint)

    world.mutate(entity, Transform, (transform) => {
      transform.x = anim.x
      transform.y = anim.y
      transform.z = anim.z
      transform.rx = anim.sway * 0.15
      transform.ry = faceYawFor(side)
      transform.rz = -anim.lean
    })
  }
}

function animateImpact(world: World) {
  const time = world.resource(Time)
  const bridge = world.tryResource(MatchBridge)
  const state = bridge?.getState()
  const impact = state?.lastImpact ?? null
  const now = Date.now()

  for (const [entity, , fx] of world.query(Transform, ImpactFx)) {
    if (impact && impact.id !== fx.lastId) {
      fx.lastId = impact.id
      const contact =
        impact.result === 'dodged'
          ? impact.defender === 'red'
            ? -0.42
            : 0.42
          : impact.attacker === 'red'
            ? 0.08
            : -0.08
      const midX = contact
      const y = impact.result === 'blocked' ? 0.98 : impact.result === 'hit' ? 1.12 : 1.05
      const power = Math.min(1.6, 0.7 + impact.damage / 14)

      world.mutate(entity, Transform, (transform) => {
        transform.x = midX
        transform.y = y
        transform.z = 0.02
      })

      fx.flash.visible = true
      fx.flash.scale.setScalar(
        (impact.result === 'hit' ? 1.55 : impact.result === 'blocked' ? 1.05 : 0.75) * power,
      )
      const flashMat = fx.flash.material as THREE.MeshBasicMaterial
      flashMat.color.set(
        impact.result === 'hit'
          ? '#fff2b0'
          : impact.result === 'blocked'
            ? '#d7e6ff'
            : '#b8ffd0',
      )
      flashMat.opacity = 0.95

      fx.ring.visible = impact.result !== 'dodged'
      fx.ring.scale.setScalar(0.2)
      ;(fx.ring.material as THREE.MeshBasicMaterial).opacity = 0.8

      for (let i = fx.group.children.length - 1; i >= 0; i--) {
        const child = fx.group.children[i]!
        if (child !== fx.flash && child !== fx.ring) {
          fx.group.remove(child)
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()
          ;(mesh.material as THREE.Material)?.dispose?.()
        }
      }

      if (impact.result !== 'dodged') {
        const count = Math.round((impact.result === 'hit' ? 16 : 9) * power)
        for (let i = 0; i < count; i++) {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.035, 0.035, 0.035),
            new THREE.MeshBasicMaterial({
              color: impact.result === 'hit' ? '#ffe29a' : '#d7e6ff',
              transparent: true,
              opacity: 1,
              depthWrite: false,
            }),
          )
          const burst = 3.2 * power
          mesh.userData.vx = (Math.random() - 0.5) * burst
          mesh.userData.vy = Math.random() * 2.8 * power
          mesh.userData.vz = (Math.random() - 0.5) * burst
          mesh.userData.life = 0.32 + Math.random() * 0.3
          fx.group.add(mesh)
        }
      } else {
        // Slip sparkle — green glitter without a thud
        for (let i = 0; i < 6; i++) {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.03, 0.03),
            new THREE.MeshBasicMaterial({
              color: '#b8ffd0',
              transparent: true,
              opacity: 0.9,
              depthWrite: false,
            }),
          )
          mesh.userData.vx = (Math.random() - 0.5) * 2
          mesh.userData.vy = Math.random() * 1.8
          mesh.userData.vz = (Math.random() - 0.5) * 2
          mesh.userData.life = 0.25 + Math.random() * 0.2
          fx.group.add(mesh)
        }
      }

      const shake = world.resource(CameraShake)
      shake.lastImpactId = impact.id
      shake.shake =
        impact.result === 'hit'
          ? Math.min(0.7, 0.2 + impact.damage / 32)
          : impact.result === 'blocked'
            ? 0.14
            : 0.08

      for (const [, ringFx] of world.query(RingFx)) {
        ringFx.hitPulse = impact.result === 'hit' ? 1.15 * power : impact.result === 'blocked' ? 0.7 : 0.4
        ringFx.hitLight.color.set(
          impact.result === 'hit'
            ? '#ffd27a'
            : impact.result === 'blocked'
              ? '#cfe0ff'
              : '#b8ffd0',
        )
      }
    }

    const age = impact ? (now - impact.at) / 1000 : 99
    const flashMat = fx.flash.material as THREE.MeshBasicMaterial
    if (age < 0.18) {
      fx.flash.visible = true
      flashMat.opacity = 0.95 * (1 - age / 0.18)
      fx.flash.scale.setScalar(0.6 + age * 4)
    } else {
      fx.flash.visible = false
    }

    const ringMat = fx.ring.material as THREE.MeshBasicMaterial
    if (age < 0.28 && impact?.result !== 'dodged') {
      fx.ring.visible = true
      fx.ring.scale.setScalar(0.25 + age * 3.5)
      ringMat.opacity = Math.max(0, 0.75 * (1 - age / 0.28))
    } else {
      fx.ring.visible = false
    }

    for (let i = fx.group.children.length - 1; i >= 0; i--) {
      const child = fx.group.children[i]!
      if (child === fx.flash || child === fx.ring) continue
      const mesh = child as THREE.Mesh
      mesh.userData.life -= time.delta
      mesh.userData.vy -= 4 * time.delta
      mesh.position.x += mesh.userData.vx * time.delta
      mesh.position.y += mesh.userData.vy * time.delta
      mesh.position.z += mesh.userData.vz * time.delta
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, mesh.userData.life * 2)
      if (mesh.userData.life <= 0) {
        fx.group.remove(mesh)
        mesh.geometry.dispose()
        mat.dispose()
      }
    }
  }
}

function animateRingAmbience(world: World) {
  const time = world.resource(Time)
  const bridge = world.tryResource(MatchBridge)
  const heat = bridge?.getState()?.cardHeat ?? 0
  const heatGlow = heat / 100

  for (const [, fx] of world.query(RingFx)) {
    for (let i = 0; i < fx.ropes.length; i++) {
      const rope = fx.ropes[i]!
      const baseY = (rope.userData.baseY as number) ?? rope.position.y
      const amp = 0.012 + heatGlow * 0.02 + fx.hitPulse * 0.035
      rope.position.y =
        baseY + Math.sin(time.elapsed * (1.6 + heatGlow * 0.8) + i * 0.45) * amp
      rope.rotation.z =
        Math.sin(time.elapsed * 1.1 + i * 0.7) * (0.02 + heatGlow * 0.03 + fx.hitPulse * 0.04)
    }

    const positions = fx.dust.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i) + time.delta * (0.05 + (i % 5) * 0.01 + heatGlow * 0.03)
      if (y > 2.8) y = 0.35
      positions.setY(i, y)
      positions.setX(
        i,
        positions.getX(i) + Math.sin(time.elapsed * 0.4 + i) * time.delta * (0.02 + heatGlow * 0.02),
      )
    }
    positions.needsUpdate = true

    if (fx.hitPulse > 0.001) {
      fx.hitLight.intensity = fx.hitPulse * (3.4 + heatGlow * 2.2)
      fx.hitPulse *= Math.pow(0.07, time.delta)
    } else {
      fx.hitLight.intensity = heatGlow * 0.4
      fx.hitPulse = 0
    }
  }
}

function animateCamera(world: World) {
  const camera = world.resource(ThreeCamera) as unknown as THREE.PerspectiveCamera
  const shake = world.tryResource(CameraShake)
  if (!shake) return
  const bridge = world.tryResource(MatchBridge)
  const state = bridge?.getState()
  const phase = state?.phase
  const fighting =
    phase === 'fighting' || phase === 'countdown' || phase === 'knockout'
  const t = world.resource(Time).elapsed
  const heat = state?.cardHeat ?? 0
  const heatKick = fighting ? heat / 100 : 0

  // Soft pocket tracking from fighter transforms
  let lookX = 0
  let spread = 1.5
  const xs: number[] = []
  for (const [, , , corner, anim] of world.query(
    Transform,
    ThreeObject,
    FighterCorner,
    FighterAnim,
  )) {
    void corner
    xs.push(anim.x)
  }
  if (xs.length === 2) {
    lookX = (xs[0]! + xs[1]!) / 2
    spread = Math.abs(xs[0]! - xs[1]!)
  }

  const orbit = fighting ? 0.1 * Math.sin(t * 0.38) + heatKick * 0.04 * Math.sin(t * 1.5) : 0
  const zoom =
    phase === 'knockout'
      ? 0.42
      : phase === 'fighting'
        ? 0.14 + heatKick * 0.2 + Math.max(0, 1.4 - spread) * 0.06
        : 0

  const desired = new THREE.Vector3(shake.baseX, shake.baseY, shake.baseZ)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit)
    .multiplyScalar(1 - zoom * 0.08)
  desired.x += lookX * 0.18
  if (phase === 'knockout') desired.y += 0.3

  if (shake.shake > 0.001) {
    desired.x += (Math.random() - 0.5) * shake.shake
    desired.y += (Math.random() - 0.5) * shake.shake * 0.65
    desired.z += (Math.random() - 0.5) * shake.shake
    shake.shake *= 0.84
  }

  const wantFov = fighting ? 48 - heatKick * 14 : 48
  camera.fov = THREE.MathUtils.lerp(camera.fov ?? 48, wantFov, 0.05)
  camera.updateProjectionMatrix()

  camera.position.lerp(desired, 0.05)
  camera.lookAt(lookX * 0.4, 0.95 + Math.max(0, 1.4 - spread) * 0.05, 0)
}
