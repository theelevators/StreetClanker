import * as THREE from 'three'
import type { Corner } from '../types'
import type { FighterRigData } from './components'

const RED = '#e23b2f'
const BLUE = '#2f7fd4'
const METAL = '#c5c8ce'
const DARK = '#2a2d33'

export function buildRing(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Ring'

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.7, metalness: 0.15 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  root.add(floor)

  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshStandardMaterial({ color: '#f3d34a', roughness: 0.65, metalness: 0.1 }),
  )
  mat.rotation.x = -Math.PI / 2
  mat.position.y = 0.01
  mat.receiveShadow = true
  root.add(mat)

  const center = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.62, 48),
    new THREE.MeshStandardMaterial({ color: '#fff8d6', roughness: 0.5 }),
  )
  center.rotation.x = -Math.PI / 2
  center.position.y = 0.02
  root.add(center)

  const panelMat = new THREE.MeshStandardMaterial({
    color: '#d9a61a',
    roughness: 0.55,
    metalness: 0.2,
  })
  for (const [x, z, sx, sz] of [
    [0, 2.05, 4.2, 0.12],
    [0, -2.05, 4.2, 0.12],
    [2.05, 0, 0.12, 4.2],
    [-2.05, 0, 0.12, 4.2],
  ] as const) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.55, sz), panelMat)
    panel.position.set(x, 0.28, z)
    panel.castShadow = true
    root.add(panel)
  }

  // Branding plate via canvas texture (no drei Text)
  const brand = makeBrandSprite()
  brand.position.set(0, 0.28, 2.12)
  root.add(brand)

  for (const x of [-1.55, 1.55]) {
    for (const z of [-1.55, 1.55]) {
      const post = new THREE.Group()
      post.position.set(x, 0, z)
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 1.2, 12),
        new THREE.MeshStandardMaterial({ color: '#f0c12e', metalness: 0.4, roughness: 0.35 }),
      )
      pole.position.y = 0.7
      pole.castShadow = true
      post.add(pole)
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 12),
        new THREE.MeshStandardMaterial({ color: '#fff6c8', metalness: 0.5, roughness: 0.3 }),
      )
      cap.position.y = 1.32
      post.add(cap)
      root.add(post)
    }
  }

  for (const y of [0.45, 0.75, 1.05]) {
    addRope(root, y, [-1.55, -1.55], [1.55, -1.55])
    addRope(root, y, [1.55, -1.55], [1.55, 1.55])
    addRope(root, y, [1.55, 1.55], [-1.55, 1.55])
    addRope(root, y, [-1.55, 1.55], [-1.55, -1.55])
  }

  addPillar(root, [-2.35, 0, 0.9], RED)
  addPillar(root, [-2.35, 0, -0.9], RED)
  addPillar(root, [2.35, 0, 0.9], BLUE)
  addPillar(root, [2.35, 0, -0.9], BLUE)

  return root
}

function addRope(
  root: THREE.Group,
  y: number,
  from: [number, number],
  to: [number, number],
) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  const angle = Math.atan2(dx, dz)
  const rope = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, len),
    new THREE.MeshStandardMaterial({ color: '#f7f4ef', roughness: 0.45 }),
  )
  rope.position.set((from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2)
  rope.rotation.y = angle
  rope.name = 'rope'
  rope.userData.baseY = y
  root.add(rope)
}

/** Collect rope meshes for idle sway. */
export function collectRopes(root: THREE.Group): THREE.Object3D[] {
  const ropes: THREE.Object3D[] = []
  root.traverse((obj) => {
    if (obj.name === 'rope') ropes.push(obj)
  })
  return ropes
}

/** Soft dust motes above the canvas. */
export function buildDust(): THREE.Points {
  const count = 48
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 5
    positions[i * 3 + 1] = 0.4 + Math.random() * 2.4
    positions[i * 3 + 2] = (Math.random() - 0.5) * 5
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: '#ffe6a8',
    size: 0.035,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  points.name = 'Dust'
  return points
}

export function buildHitLight(): THREE.PointLight {
  const light = new THREE.PointLight('#ffd38a', 0, 5, 2)
  light.position.set(0, 1.4, 0)
  light.name = 'HitLight'
  return light
}

function addPillar(root: THREE.Group, position: [number, number, number], color: string) {
  const g = new THREE.Group()
  g.position.set(...position)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 1.1, 0.28),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 }),
  )
  body.position.y = 0.55
  body.castShadow = true
  g.add(body)
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: '#f5d547', metalness: 0.5, roughness: 0.3 }),
  )
  knob.position.set(0, 1.15, 0.05)
  g.add(knob)
  const btn = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.06),
    new THREE.MeshStandardMaterial({
      color: '#f5d547',
      emissive: '#c9a010',
      emissiveIntensity: 0.35,
    }),
  )
  btn.position.set(0, 0.85, 0.16)
  g.add(btn)
  root.add(g)
}

function makeBrandSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 512, 128)
  ctx.fillStyle = '#1a1208'
  ctx.font = 'bold 72px Impact, Bebas Neue, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('BOXCLUB', 256, 64)
  const tex = new THREE.CanvasTexture(canvas)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.45),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  )
  return mesh
}

export function buildRobot(side: Corner): { root: THREE.Group; rig: FighterRigData } {
  const bodyColor = side === 'red' ? RED : BLUE
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.42,
    metalness: 0.38,
  })
  const metalMat = new THREE.MeshStandardMaterial({
    color: METAL,
    roughness: 0.28,
    metalness: 0.72,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: DARK,
    roughness: 0.55,
    metalness: 0.25,
  })
  const leftEye = new THREE.MeshStandardMaterial({
    color: '#ffef8a',
    emissive: '#ffb020',
    emissiveIntensity: 0.85,
  })
  const rightEye = leftEye.clone()

  const root = new THREE.Group()
  root.name = `Fighter-${side}`

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.48, 0.1, 24),
    new THREE.MeshStandardMaterial({ color: '#f5d547', roughness: 0.55, metalness: 0.2 }),
  )
  base.position.y = 0.05
  base.castShadow = true
  base.receiveShadow = true
  root.add(base)

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.35, 0.18), bodyMat)
  leftLeg.position.set(-0.12, 0.28, 0)
  leftLeg.castShadow = true
  root.add(leftLeg)
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.35, 0.18), bodyMat)
  rightLeg.position.set(0.12, 0.28, 0)
  rightLeg.castShadow = true
  root.add(rightLeg)

  const body = new THREE.Group()
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.32), bodyMat)
  torso.position.set(0, 0.62, 0)
  torso.castShadow = true
  body.add(torso)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.04), metalMat)
  plate.position.set(0, 0.62, 0.17)
  body.add(plate)

  const head = new THREE.Group()
  head.position.set(0, 0.55, 0)
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.34), bodyMat)
  skull.position.set(0, 0.42, 0)
  skull.castShadow = true
  head.add(skull)
  const le = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), leftEye)
  le.position.set(-0.09, 0.46, 0.17)
  head.add(le)
  const re = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), rightEye)
  re.position.set(0.09, 0.46, 0.17)
  head.add(re)
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.04), darkMat)
  mouth.position.set(0, 0.34, 0.18)
  head.add(mouth)
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), metalMat)
  ant.position.set(0, 0.66, 0)
  head.add(ant)
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 12),
    new THREE.MeshStandardMaterial({
      color: '#ffef8a',
      emissive: '#ffb020',
      emissiveIntensity: 0.9,
    }),
  )
  tip.position.set(0, 0.76, 0)
  head.add(tip)
  body.add(head)

  const leftArm = makeArm(bodyMat, darkMat)
  leftArm.position.set(-0.32, 0.7, 0)
  body.add(leftArm)
  const rightArm = makeArm(bodyMat, darkMat)
  rightArm.position.set(0.32, 0.7, 0)
  body.add(rightArm)

  root.add(body)

  return {
    root,
    rig: { body, head, leftArm, rightArm, leftEye, rightEye },
  }
}

function makeArm(bodyMat: THREE.Material, darkMat: THREE.Material) {
  const arm = new THREE.Group()
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.46), bodyMat)
  beam.position.set(0, -0.05, 0.2)
  beam.castShadow = true
  arm.add(beam)
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.18), darkMat)
  glove.position.set(0, -0.05, 0.48)
  glove.castShadow = true
  arm.add(glove)
  return arm
}

export function buildImpactFx(): {
  group: THREE.Group
  flash: THREE.Mesh
  ring: THREE.Mesh
} {
  const group = new THREE.Group()
  group.name = 'ImpactFX'
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      color: '#fff2b0',
      depthWrite: false,
    }),
  )
  flash.visible = false
  group.add(flash)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.14, 24),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.8,
      color: '#ffe29a',
      depthWrite: false,
    }),
  )
  ring.rotation.x = Math.PI / 2
  ring.visible = false
  group.add(ring)
  return { group, flash, ring }
}
