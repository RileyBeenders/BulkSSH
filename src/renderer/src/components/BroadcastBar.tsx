import { useState, type FormEvent } from 'react'
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

export function BroadcastBar(props: Props): React.JSX.Element {
  const [command, setCommand] = useState('')
  const { mirrorOn, mirrorCount, targetCount } = props

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (command.trim() === '' || targetCount === 0 || props.running) return
    props.onRun(command)
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
          onChange={(e) => setCommand(e.target.value)}
          maxLength={MAX_COMMAND_LENGTH}
          placeholder="Run a command on checked devices…"
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
