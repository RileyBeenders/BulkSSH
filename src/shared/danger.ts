// Safety net for commands sent to many devices at once: a broadcast, or a
// line typed while keystrokes are mirrored. Matching commands need an extra
// confirmation. This is a heuristic list, not a sandbox.

interface Rule {
  pattern: RegExp
  reason: string
}

// Matches `rest` only where a command starts: line start, after ; & | ( or
// $(, optionally behind sudo/doas/exec/nohup/time. So `grep -r reboot` is
// fine but `uptime; reboot` is not. Unix commands are case-sensitive.
function cmd(rest: string, flags = ''): RegExp {
  return new RegExp(String.raw`(?:^|[;&|(]|\$\()\s*(?:(?:sudo|doas|exec|nohup|time)\s+(?:-\S+(?:\s+[^-\s]\S*)?\s+)*)*` + rest, flags)
}

const RULES: Rule[] = [
  { pattern: cmd(String.raw`rm\s+(?:-\S+\s+)*-[a-zA-Z]*[rR]`), reason: 'deletes files recursively (rm -r)' },
  { pattern: cmd(String.raw`(?:reboot|shutdown|poweroff|halt)\b`), reason: 'reboots or shuts down the device' },
  { pattern: cmd(String.raw`init\s+[06]\b`), reason: 'reboots or shuts down the device' },
  { pattern: cmd(String.raw`systemctl\s+(?:-\S+\s+)*(?:reboot|poweroff|halt|kexec)\b`), reason: 'reboots or shuts down the device' },
  { pattern: cmd(String.raw`systemctl\s+(?:-\S+\s+)*(?:stop|disable|mask|kill)\b`), reason: 'stops or disables a service' },
  { pattern: cmd(String.raw`(?:mkfs(?:\.\w+)?|wipefs|fdisk|parted|sfdisk)\b`), reason: 'formats or repartitions a disk' },
  { pattern: cmd(String.raw`dd\s.*\bof=`), reason: 'writes raw data with dd' },
  { pattern: />\s*\/dev\/(?:sd|hd|vd|nvme|mmcblk)/, reason: 'overwrites a disk device' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { pattern: cmd(String.raw`(?:chmod|chown|chgrp)\s+(?:-\S+\s+)*-[a-zA-Z]*R`), reason: 'changes permissions or ownership recursively' },
  { pattern: cmd(String.raw`(?:killall|pkill)\b|kill\s+(?:-\S+\s+)*-1\b`), reason: 'kills processes in bulk' },
  {
    pattern: cmd(String.raw`(?:(?:iptables|ip6tables)\s+(?:-\S+\s+)*(?:-F|--flush)\b|nft\s+flush\b|ufw\s+(?:disable|reset)\b)`),
    reason: 'flushes or disables the firewall'
  },
  {
    pattern: cmd(String.raw`(?:ifdown\b|ip\s+link\s+set\s+\S+\s+down\b|nmcli\s+\S+\s+down\b)`),
    reason: 'takes a network interface down (you may lose access)'
  },
  { pattern: cmd(String.raw`(?:userdel|deluser|passwd|chpasswd|usermod)\b`), reason: 'changes user accounts or passwords' },
  { pattern: cmd(String.raw`crontab\s+(?:-\S+\s+)*-r\b`), reason: 'removes the crontab' },
  {
    pattern: cmd(String.raw`(?:apt(?:-get)?\s+(?:-\S+\s+)*(?:remove|purge|autoremove)|yum\s+(?:remove|erase)|dnf\s+remove|pacman\s+-R)`),
    reason: 'removes packages'
  },
  // Network equipment (Cisco, Juniper, Arista and similar); their CLIs are case-insensitive.
  { pattern: /^\s*reload\b/i, reason: 'reloads (reboots) network equipment' },
  {
    pattern: /^\s*(?:write\s+erase\b|erase\s+(?:startup-config|nvram|flash)|format\s+\S+:|delete\s+\S*flash:)/i,
    reason: 'erases configuration or flash on network equipment'
  },
  { pattern: /^\s*request\s+system\s+(?:reboot|halt|power-off|zeroize)\b/i, reason: 'reboots or wipes network equipment' }
]

// Why `command` looks dangerous; empty means nothing matched.
export function dangerReasons(command: string): string[] {
  return [...new Set(RULES.filter((r) => r.pattern.test(command)).map((r) => r.reason))]
}

export interface SubmittedLine {
  line: string
  // False when cursor movement, history recall or tab completion happened on
  // this line, so `line` may not be what the device actually runs.
  known: boolean
}

// Rebuilds the command line being typed into one terminal from the raw
// keystrokes, so a mirrored Enter can be checked before it is sent.
export class LineTracker {
  private line = ''
  private known = true

  // Lines that `data` would submit (one per Enter), without changing state.
  preview(data: string): SubmittedLine[] {
    return this.run(data, false)
  }

  // Updates state after `data` was actually sent.
  commit(data: string): void {
    this.run(data, true)
  }

  private run(data: string, apply: boolean): SubmittedLine[] {
    let line = this.line
    let known = this.known
    const submitted: SubmittedLine[] = []

    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (ch === '\r' || ch === '\n') {
        submitted.push({ line, known })
        line = ''
        known = true
        if (ch === '\r' && data[i + 1] === '\n') i++
      } else if (ch === '\x7f' || ch === '\b') {
        line = line.slice(0, -1)
      } else if (ch === '\x15' || ch === '\x03') {
        // Ctrl+U clears the line, Ctrl+C abandons it.
        line = ''
        known = true
      } else if (ch === '\x17') {
        line = line.replace(/\S+\s*$/, '')
      } else if (ch === '\x1b') {
        const seq = escapeSequence(data, i)
        i += seq.length - 1
        // Bracketed-paste markers wrap pasted text and do not move the cursor.
        if (seq !== '\x1b[200~' && seq !== '\x1b[201~') known = false
      } else if (ch < ' ') {
        // Tab completion, Ctrl+A/E/R/P/N and friends change the line in ways we can't see.
        known = false
      } else {
        line += ch
      }
    }

    if (apply) {
      this.line = line
      this.known = known
    }
    return submitted
  }
}

// The escape sequence starting at data[start] (CSI, SS3 or a two-byte ESC x).
function escapeSequence(data: string, start: number): string {
  const next = data[start + 1]
  if (next === '[') {
    let end = start + 2
    while (end < data.length && !(data[end] >= '@' && data[end] <= '~')) end++
    return data.slice(start, end + 1)
  }
  if (next === 'O') return data.slice(start, start + 3)
  return data.slice(start, start + 2)
}
