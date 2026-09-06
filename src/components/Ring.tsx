import { Text } from '@react-three/drei'

export function Ring() {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[4.2, 4.2]} />
        <meshStandardMaterial color="#e8b923" roughness={0.7} metalness={0.15} />
      </mesh>

      {/* Inner mat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[3.2, 3.2]} />
        <meshStandardMaterial color="#f3d34a" roughness={0.65} metalness={0.1} />
      </mesh>

      {/* Center circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.55, 0.62, 48]} />
        <meshStandardMaterial color="#fff8d6" roughness={0.5} />
      </mesh>

      {/* Side branding panels */}
      <mesh position={[0, 0.28, 2.05]} castShadow>
        <boxGeometry args={[4.2, 0.55, 0.12]} />
        <meshStandardMaterial color="#d9a61a" roughness={0.55} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.28, -2.05]} castShadow>
        <boxGeometry args={[4.2, 0.55, 0.12]} />
        <meshStandardMaterial color="#d9a61a" roughness={0.55} metalness={0.2} />
      </mesh>
      <mesh position={[2.05, 0.28, 0]} castShadow>
        <boxGeometry args={[0.12, 0.55, 4.2]} />
        <meshStandardMaterial color="#d9a61a" roughness={0.55} metalness={0.2} />
      </mesh>
      <mesh position={[-2.05, 0.28, 0]} castShadow>
        <boxGeometry args={[0.12, 0.55, 4.2]} />
        <meshStandardMaterial color="#d9a61a" roughness={0.55} metalness={0.2} />
      </mesh>

      <Text
        position={[0, 0.28, 2.12]}
        fontSize={0.22}
        color="#1a1208"
        anchorX="center"
        anchorY="middle"
      >
        BOXCLUB
      </Text>

      {/* Corner posts + ropes */}
      {([-1.55, 1.55] as const).map((x) =>
        ([-1.55, 1.55] as const).map((z) => (
          <group key={`${x}-${z}`} position={[x, 0, z]}>
            <mesh position={[0, 0.7, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.07, 1.2, 12]} />
              <meshStandardMaterial color="#f0c12e" metalness={0.4} roughness={0.35} />
            </mesh>
            <mesh position={[0, 1.32, 0]}>
              <sphereGeometry args={[0.08, 12, 12]} />
              <meshStandardMaterial color="#fff6c8" metalness={0.5} roughness={0.3} />
            </mesh>
          </group>
        )),
      )}

      {[0.45, 0.75, 1.05].map((y) => (
        <group key={y}>
          <Rope y={y} from={[-1.55, -1.55]} to={[1.55, -1.55]} />
          <Rope y={y} from={[1.55, -1.55]} to={[1.55, 1.55]} />
          <Rope y={y} from={[1.55, 1.55]} to={[-1.55, 1.55]} />
          <Rope y={y} from={[-1.55, 1.55]} to={[-1.55, -1.55]} />
        </group>
      ))}

      {/* Control pillars behind corners */}
      <ControlPillar position={[-2.35, 0, 0.9]} color="#e23b2f" />
      <ControlPillar position={[-2.35, 0, -0.9]} color="#e23b2f" />
      <ControlPillar position={[2.35, 0, 0.9]} color="#2f7fd4" />
      <ControlPillar position={[2.35, 0, -0.9]} color="#2f7fd4" />
    </group>
  )
}

function Rope({
  y,
  from,
  to,
}: {
  y: number
  from: [number, number]
  to: [number, number]
}) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  const angle = Math.atan2(dx, dz)
  return (
    <mesh
      position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]}
      rotation={[0, angle, 0]}
    >
      <boxGeometry args={[0.05, 0.05, len]} />
      <meshStandardMaterial color="#f7f4ef" roughness={0.45} />
    </mesh>
  )
}

function ControlPillar({
  position,
  color,
}: {
  position: [number, number, number]
  color: string
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.28, 1.1, 0.28]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
      </mesh>
      <mesh position={[0, 1.15, 0.05]}>
        <cylinderGeometry args={[0.06, 0.06, 0.1, 12]} />
        <meshStandardMaterial color="#f5d547" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.85, 0.16]}>
        <boxGeometry args={[0.12, 0.12, 0.06]} />
        <meshStandardMaterial color="#f5d547" emissive="#c9a010" emissiveIntensity={0.35} />
      </mesh>
    </group>
  )
}
