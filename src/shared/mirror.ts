// Keystroke mirroring: input typed into the driver terminal (the one with
// focus) is also sent to every other checked, connected device.

export function mirrorTargets(
  driverId: string,
  checked: ReadonlySet<string>,
  isLive: (deviceId: string) => boolean
): string[] {
  return [...checked].filter((id) => id !== driverId && isLive(id))
}

// xterm.js reports some things back through the same channel as keystrokes:
// replies to queries the remote program sent (cursor position, device
// attributes, mode reports, OSC color queries), focus in/out, and mouse
// events. Those describe the driver's own screen, so they must go only to
// the driver and never be mirrored to other devices.
const REPORT_PATTERNS: RegExp[] = [
  /^\x1b\[\??\d+;\d+R$/, // cursor position report
  /^\x1b\[[?>=][\d;]*c$/, // device attributes
  /^\x1b\[\??[\d;]*\$y$/, // mode report (DECRPM)
  /^\x1b\[[IO]$/, // focus in / out
  /^\x1b\[<\d+;\d+;\d+[Mm]$/, // SGR mouse
  /^\x1b\[M[\s\S]{3}$/, // X10 / normal mouse
  /^\x1b\[\d+;\d+;\d+t$/, // window size report
  /^\x1b\][\s\S]*(\x07|\x1b\\)$/, // OSC reply (e.g. colour query)
  /^\x1bP[\s\S]*\x1b\\$/ // DCS reply (e.g. XTGETTCAP, DECRQSS)
]

export function isTerminalReport(data: string): boolean {
  return REPORT_PATTERNS.some((re) => re.test(data))
}
