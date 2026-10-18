import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MAX_COMMAND_LENGTH } from '@shared/session'

interface Props {
  mirrorOn: boolean
  onToggleMirror: () => void
  // Name of the tile you are typing in, if any.
  driverName: string | null
  // Checked, connected devices other than the driver.
  mirrorCount: number
  // Checked, connected devices (broadcast targets).
  targetCount: number
  running: boolean
  onRun: (command: string) => void
}

const MAX_HISTORY = 100

export function BroadcastBar(props: Props): React.JSX.Element {
  const [command, setCommand] = useState('')
  // Commands run this session, newest last. Kept in memory only: commands
  // can contain secrets, so they are never written to disk.
  const history = useRef<string[]>([])
  // Position while browsing history with Up/Down; history.length = the draft.
  const [cursor, setCursor] = useState(0)
  const draft = useRef('')
  const { mirrorOn, mirrorCount, targetCount } = props

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (command.trim() === '' || targetCount === 0 || props.running) return
    const h = history.current
    if (h[h.length - 1] !== command) h.push(command)
    if (h.length > MAX_HISTORY) h.shift()
    setCursor(h.length)
    props.onRun(command)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const h = history.current
    if (h.length === 0) return
    e.preventDefault()
    const from = Math.min(cursor, h.length)
    if (from === h.length) draft.current = command
    const next = Math.max(0, Math.min(h.length, from + (e.key === 'ArrowUp' ? -1 : 1)))
    setCursor(next)
    setCommand(next === h.length ? draft.current : h[next])
  }

  return (
    <div className="broadcast-bar">
      <button
        type="button"
        className={`mirror-toggle${mirrorOn ? ' on' : ''}`}
        aria-pressed={mirrorOn}
        onClick={props.onToggleMirror}
        title="Mirror keystrokes to checked devices (Ctrl+Shift+M)"
      >
        Mirror {mirrorOn ? 'ON' : 'off'}
      </button>
      <span className={`mirror-info${mirrorOn && mirrorCount > 0 ? ' live' : ''}`} role="status">
        {!mirrorOn
          ? 'Keystrokes go only to the tile you type in'
          : mirrorCount === 0
            ? 'No other checked devices are connected'
            : `Typing in ${props.driverName ?? 'a tile'} also goes to ${mirrorCount} device${mirrorCount === 1 ? '' : 's'}`}
      </span>
      <form className="broadcast-form" onSubmit={submit}>
        <input
          value={command}
          onChange={(e) => {
            setCommand(e.target.value)
            setCursor(history.current.length)
          }}
          onKeyDown={onKeyDown}
          maxLength={MAX_COMMAND_LENGTH}
          placeholder="Run a command on checked devices… (Up/Down: history)"
          aria-label="Broadcast command"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={command.trim() === '' || targetCount === 0 || props.running}>
          {props.running ? 'Running…' : `Run on ${targetCount}`}
        </button>
      </form>
    </div>
  )
}
