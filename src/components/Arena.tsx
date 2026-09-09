import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment } from '@react-three/drei'
import { Suspense } from 'react'
import type { MatchState } from '../types'
import { FightCamera } from './FightCamera'
import { ImpactFX } from './ImpactFX'
import { Ring } from './Ring'
import { Robot } from './Robot'

type Props = {
  state: MatchState
}

export function Arena({ state }: Props) {
  return (
    <div className="arena-canvas">
      <Canvas
        shadows
        camera={{ position: [3.8, 3.2, 4.6], fov: 42 }}
        dpr={[1, 1.75]}
      >
        <color attach="background" args={['#1c1410']} />
        <fog attach="fog" args={['#1c1410', 8, 18]} />
        <ambientLight intensity={0.45} />
        <directionalLight
          castShadow
          position={[4, 8, 3]}
          intensity={1.35}
          shadow-mapSize={[1024, 1024]}
        />
        <spotLight
          position={[-3, 6, -2]}
          intensity={0.8}
          angle={0.5}
          penumbra={0.6}
          color="#ffd38a"
        />
        <Suspense fallback={null}>
          <Ring />
          <Robot
            fighter={state.red}
            opponent={state.blue}
            side="red"
            phase={state.phase}
            lastImpact={state.lastImpact}
          />
          <Robot
            fighter={state.blue}
            opponent={state.red}
            side="blue"
            phase={state.phase}
            lastImpact={state.lastImpact}
          />
          <ImpactFX impact={state.lastImpact} />
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.45}
            scale={8}
            blur={2.5}
            far={4}
          />
          <Environment preset="warehouse" />
        </Suspense>
        <FightCamera phase={state.phase} lastImpact={state.lastImpact} />
      </Canvas>
    </div>
  )
}
