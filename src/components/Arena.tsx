import { useEffect, useRef } from 'react'
import type { MatchState } from '../types'
import { createFightApp } from '../arena/systems'
import type { App } from 'mob3'

type Props = {
  state: MatchState
}

/**
 * Host canvas for the mob3 fight App.
 * React owns coach UI; mob3 + @mob3/three own the ring simulation/render loop.
 */
export function Arena({ state }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const appRef = useRef<App | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const app = createFightApp({
      canvas,
      getState: () => stateRef.current,
    })
    appRef.current = app
    app.run()

    return () => {
      app.dispose()
      appRef.current = null
    }
  }, [])

  return (
    <div className="arena-canvas">
      <canvas ref={canvasRef} className="arena-gl" />
    </div>
  )
}
