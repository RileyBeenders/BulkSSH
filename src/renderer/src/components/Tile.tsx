import type { Device } from '@shared/device'
import type { SessionStatus } from '@shared/session'
import { TerminalView } from './TerminalView'

const STATUS_TEXT: Record<SessionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  closed: 'Disconnected',
  error: 'Error'
}

interface Props {
  device: Device
  number: number
  status: SessionStatus | undefined
  active: boolean
  // Shown alone, full size (focus view).
  focused: boolean
  // 'driver': mirrored keystrokes come from this tile; 'target': they go to it.
  mirror: 'driver' | 'target' | null
  onActivate: () => void
  onToggleFocus: () => void
  onConnect: () => void
  onDisconnect: () => void
  onClose: () => void
}

// One device's live terminal in the grid.
export function Tile(props: Props): React.JSX.Element {
  const { device, status } = props
  const live = status === 'connecting' || status === 'connected'

  return (
    <section
      className={`tile${props.active ? ' active' : ''}${props.focused ? ' focused' : ''}${props.mirror ? ` mirror-${props.mirror}` : ''}`}
      aria-label={`${props.number}: ${device.name}`}
      onFocus={props.onActivate}
      onMouseDown={props.onActivate}
    >
      <header className="tile-header" onDoubleClick={props.onToggleFocus} title="Double-click to toggle focus view">
        <span className="num">{props.number}</span>
        <span className={`dot ${status ?? 'idle'}`} />
        <span className="name">{device.name}</span>
        <span className={`status ${status ?? 'idle'}`}>{status ? STATUS_TEXT[status] : 'Not connected'}</span>
        {props.mirror && (
          <span
            className={`badge ${props.mirror}`}
            title={props.mirror === 'driver' ? 'Keystrokes typed here are mirrored to checked devices' : 'Receives mirrored keystrokes'}
          >
            {props.mirror === 'driver' ? 'source' : 'mirrored'}
          </span>
        )}
        <span className="grow" />
        {live ? (
          <button onClick={props.onDisconnect} title="Disconnect" aria-label={`Disconnect ${device.name}`}>
            ■
          </button>
        ) : (
          <button className="primary" onClick={props.onConnect} title="Reconnect" aria-label={`Reconnect ${device.name}`}>
            ▶
          </button>
        )}
        <button
          onClick={props.onToggleFocus}
          title={props.focused ? 'Back to the grid (Ctrl+Shift+F)' : 'Focus this device (Ctrl+Shift+F)'}
          aria-label={props.focused ? 'Back to the grid' : `Focus ${device.name}`}
        >
          {props.focused ? '⤡' : '⤢'}
        </button>
        <button onClick={props.onClose} title="Close tile" aria-label={`Close ${device.name}`}>
          ✕
        </button>
      </header>
      <TerminalView deviceId={device.id} />
    </section>
  )
}
