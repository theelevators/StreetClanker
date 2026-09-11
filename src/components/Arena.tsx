import { useRef } from 'react'
import { useMob3App } from '@mob3/react'
import type { MatchState } from '../types'
import { MatchBridge } from '../arena/components'
import { FightPlugin } from '../arena/systems'

type Props = {
  state: MatchState
}

/**
 * Canvas host for the mob3 fight App via `@mob3/react`.
 * React owns coach UI; mob3 + `@mob3/three` own the ring loop.
 */
export function Arena({ state }: Props) {
  const stateRef = useRef(state)
  stateRef.current = state

  const { canvasRef } = useMob3App({
    three: {
      antialias: true,
      clearColor: 0x1c1410,
      autoResize: true,
      syncMode: 'always',
    },
    plugins: [FightPlugin()],
    setup(app) {
      app.insertResource(MatchBridge, {
        getState: () => stateRef.current,
      })
    },
  })

  return (
    <div className="arena-canvas">
      <canvas ref={canvasRef} className="arena-gl" />
    </div>
  )
}
