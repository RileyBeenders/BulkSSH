import { useEffect, useState } from 'react'
import { DEFAULT_PAGE_SIZE } from '@shared/paging'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.bulkssh.getVersion().then(setVersion)
  }, [])

  return (
    <div className="shell">
      <aside className="devices">
        <h2>Devices</h2>
        <p className="muted">No devices yet.</p>
      </aside>
      <main className="grid">
        <p className="muted">
          BulkSSH {version} &middot; {DEFAULT_PAGE_SIZE} devices per page
        </p>
      </main>
      <footer className="broadcast">
        <input placeholder="Broadcast command to checked devices" disabled />
        <button disabled>Send</button>
      </footer>
    </div>
  )
}
