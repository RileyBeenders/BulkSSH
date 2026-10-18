import { useEffect, useRef } from 'react'
import { attachTerminal } from '../terminals'

export function TerminalView({ deviceId }: { deviceId: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    return attachTerminal(deviceId, ref.current)
  }, [deviceId])

  return <div className="terminal" ref={ref} />
}
