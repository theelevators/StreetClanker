import {
  App,
  Startup,
  Update,
  Time,
  Transform,
  type World,
  type Plugin,
  type ComponentBundleItem,
} from 'mob3'
import {
  ThreePlugin,
  ThreeScene,
  ThreeObject,
  ThreeCamera,
  ThreeRenderer,
} from '@mob3/three'
import * as THREE from 'three'
import type { MatchState } from '../types'
import {
  MatchBridge,
  FighterCorner,
  FighterAnim,
  FighterRig,
  ImpactFx,
  ImpactTag,
  RingTag,
  CameraShake,
} from './components'
import { buildImpactFx, buildRing, buildRobot } from './meshes'
import { faceYawFor, initialAnim, stepFighterAnim, HOME_X } from './animate'

export type FightAppOptions = {
  canvas: HTMLCanvasElement
  getState: () => MatchState | null
}

/** mob3 factories return data without the brand in TS — assert for spawn bundles. */
function b(item: unknown): ComponentBundleItem {
  return item as ComponentBundleItem
}

function setupScene(world: World) {
  const scene = world.resource(ThreeScene) as unknown as THREE.Scene
  const camera = world.resource(ThreeCamera) as unknown as THREE.PerspectiveCamera
  const renderer = world.resource(ThreeRenderer) as unknown as THREE.WebGLRenderer

  scene.background = new THREE.Color('#1c1410')
  scene.fog = new THREE.Fog('#1c1410', 8, 18)
  renderer.shadowMap.enabled = true

  camera.fov = 42
  camera.near = 0.1
  camera.far = 100
  camera.position.set(3.8, 3.2, 4.6)
  camera.lookAt(0, 0.75, 0)
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
  scene.add(ring)
  world.spawn(b(Transform()), b(ThreeObject(ring as unknown as THREE.Object3D)), RingTag)

  for (const corner of ['red', 'blue'] as const) {
    const { root, rig } = buildRobot(corner)
    scene.add(root)
    world.spawn(
      b(
        Transform({
          x: HOME_X[corner],
          y: 0,
          z: 0,
          ry: faceYawFor(corner),
        }),
      ),
      b(ThreeObject(root as unknown as THREE.Object3D)),
      b(FighterCorner({ corner })),
      b(FighterAnim(initialAnim(corner))),
      b(FighterRig(rig)),
    )
  }

  const fx = buildImpactFx()
  scene.add(fx.group)
  world.spawn(
    b(Transform({ y: 1.1 })),
    b(ThreeObject(fx.group as unknown as THREE.Object3D)),
    ImpactTag,
    b(
      ImpactFx({
        lastId: null,
        flash: fx.flash,
        ring: fx.ring,
        group: fx.group,
      }),
    ),
  )

  world.insertResource(CameraShake, {
    shake: 0,
    lastImpactId: null,
    baseX: 3.8,
    baseY: 3.2,
    baseZ: 4.6,
  })
}

function animateFighters(world: World) {
  const bridge = world.resource(MatchBridge)
  const state = bridge.getState()
  if (!state) return
  const now = Date.now()

  for (const [, transform, three, corner, anim, rig] of world.query(
    Transform,
    ThreeObject,
    FighterCorner,
    FighterAnim,
    FighterRig,
  )) {
    const side = corner.corner
    stepFighterAnim({
      anim,
      rig,
      side,
      fighter: state[side],
      opponent: state[side === 'red' ? 'blue' : 'red'],
      phase: state.phase,
      lastImpact: state.lastImpact,
      now,
    })
    transform.x = anim.x
    transform.y = anim.y
    transform.z = anim.z
    transform.rx = anim.sway * 0.15
    transform.ry = faceYawFor(side)
    transform.rz = -anim.lean
    // Apply immediately — keeps the bout responsive even if PreRender
    // change-detection misses a field write this tick.
    const obj = three.object
    obj.position.set(transform.x, transform.y, transform.z)
    obj.rotation.set(transform.rx, transform.ry, transform.rz)
  }
}

function animateImpact(world: World) {
  const { delta } = world.resource(Time)
  const bridge = world.resource(MatchBridge)
  const state = bridge.getState()
  const impact = state?.lastImpact ?? null
  const now = Date.now()

  for (const [, transform, fx] of world.query(Transform, ImpactFx)) {
    if (impact && impact.id !== fx.lastId) {
      fx.lastId = impact.id
      const midX =
        impact.result === 'dodged'
          ? impact.defender === 'red'
            ? -0.4
            : 0.4
          : impact.attacker === 'red'
            ? -0.02
            : 0.02
      const y = impact.result === 'blocked' ? 0.98 : 1.1
      transform.x = midX
      transform.y = y
      transform.z = 0.02
      fx.group.position.set(midX, y, 0.02)

      fx.flash.visible = true
      fx.flash.scale.setScalar(impact.result === 'hit' ? 1.45 : 0.85)
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
        const count = impact.result === 'hit' ? 14 : 8
        for (let i = 0; i < count; i++) {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.04),
            new THREE.MeshBasicMaterial({
              color: '#ffe29a',
              transparent: true,
              opacity: 1,
              depthWrite: false,
            }),
          )
          mesh.userData.vx = (Math.random() - 0.5) * 4
          mesh.userData.vy = Math.random() * 3
          mesh.userData.vz = (Math.random() - 0.5) * 4
          mesh.userData.life = 0.35 + Math.random() * 0.25
          fx.group.add(mesh)
        }
      }

      const shake = world.resource(CameraShake)
      shake.lastImpactId = impact.id
      shake.shake =
        impact.result === 'hit'
          ? Math.min(0.55, 0.18 + impact.damage / 40)
          : impact.result === 'blocked'
            ? 0.12
            : 0.06
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
      mesh.userData.life -= delta
      mesh.userData.vy -= 4 * delta
      mesh.position.x += mesh.userData.vx * delta
      mesh.position.y += mesh.userData.vy * delta
      mesh.position.z += mesh.userData.vz * delta
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

function animateCamera(world: World) {
  const camera = world.resource(ThreeCamera) as unknown as THREE.PerspectiveCamera
  const shake = world.tryResource(CameraShake)
  if (!shake) return
  const bridge = world.resource(MatchBridge)
  const state = bridge.getState()
  const phase = state?.phase
  const fighting =
    phase === 'fighting' || phase === 'countdown' || phase === 'knockout'
  const t = world.resource(Time).elapsed

  const orbit = fighting ? 0.08 * Math.sin(t * 0.35) : 0
  const zoom = phase === 'knockout' ? 0.35 : phase === 'fighting' ? 0.12 : 0

  const desired = new THREE.Vector3(shake.baseX, shake.baseY, shake.baseZ)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit)
    .multiplyScalar(1 - zoom * 0.08)
  if (phase === 'knockout') desired.y += 0.25

  if (shake.shake > 0.001) {
    desired.x += (Math.random() - 0.5) * shake.shake
    desired.y += (Math.random() - 0.5) * shake.shake * 0.6
    desired.z += (Math.random() - 0.5) * shake.shake
    shake.shake *= 0.86
  }

  camera.position.lerp(desired, 0.045)
  camera.lookAt(0, 0.75, 0)
}

export function BoxClubFightPlugin(): Plugin {
  return {
    build(app: App) {
      app.addSystem(Startup, setupScene)
      app.addSystem(Update, animateFighters)
      app.addSystem(Update, animateImpact)
      app.addSystem(Update, animateCamera)
    },
  }
}

export function createFightApp(options: FightAppOptions): App {
  return new App()
    .addPlugin(
      ThreePlugin({
        canvas: options.canvas,
        antialias: true,
        clearColor: 0x1c1410,
        autoResize: true,
      }),
    )
    .insertResource(MatchBridge, { getState: options.getState })
    .addPlugin(BoxClubFightPlugin())
}
