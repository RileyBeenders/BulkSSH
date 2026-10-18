import { describe, expect, it } from 'vitest'
import { dangerReasons, LineTracker } from '@shared/danger'

describe('dangerReasons', () => {
  it.each([
    'rm -rf /var/log/app',
    'sudo rm -r ./build',
    'rm -f -R old',
    'reboot',
    'sudo shutdown -h now',
    'init 6',
    'systemctl poweroff',
    'systemctl stop nginx',
    'mkfs.ext4 /dev/sdb1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'cat image > /dev/sda',
    ':(){ :|:& };:',
    'chmod -R 777 /',
    'chown -R nobody /srv',
    'killall sshd',
    'iptables -F',
    'ufw disable',
    'ip link set eth0 down',
    'ifdown eth0',
    'passwd root',
    'crontab -r',
    'apt-get purge openssh-server',
    'reload',
    'write erase',
    'erase startup-config',
    'request system reboot',
    'cd /tmp && rm -rf *',
    'uptime; reboot',
    'echo $(reboot)',
    'sudo -u root shutdown now',
    'sudo -E reboot',
    'RELOAD', // network CLIs are case-insensitive
    'Write Erase'
  ])('flags %s', (cmd) => {
    expect(dangerReasons(cmd).length).toBeGreaterThan(0)
  })

  it.each([
    'ls -la',
    'rm old.log',
    'rm -f old.log',
    'df -h',
    'systemctl status nginx',
    'systemctl reload nginx',
    'show running-config',
    'grep -r reboot /var/log',
    'echo hello',
    'uptime',
    'cat /etc/os-release',
    'sudo apt-get install htop',
    'chmod 644 file.txt',
    'chmod -r file.txt', // removes read permission, not recursive
    'dd --help',
    'echo reboot later',
    'man shutdown',
    'show reload'
  ])('allows %s', (cmd) => {
    expect(dangerReasons(cmd)).toEqual([])
  })

  it('lists each reason once', () => {
    expect(dangerReasons('reboot; shutdown now')).toEqual(['reboots or shuts down the device'])
  })
})

describe('LineTracker', () => {
  it('reports the typed line on Enter, with backspace and Ctrl+W', () => {
    const t = new LineTracker()
    t.commit('rm -rf /tmpX')
    t.commit('\x7f')
    t.commit('\x17old')
    expect(t.preview('\r')).toEqual([{ line: 'rm -rf old', known: true }])
  })

  it('does not change state on preview', () => {
    const t = new LineTracker()
    t.commit('reboot')
    t.preview('\r')
    expect(t.preview('\r')).toEqual([{ line: 'reboot', known: true }])
  })

  it('starts a fresh line after Enter, Ctrl+U and Ctrl+C', () => {
    const t = new LineTracker()
    t.commit('ls\r')
    t.commit('reb')
    t.commit('\x15')
    t.commit('abc\x03')
    expect(t.preview('uptime\r')).toEqual([{ line: 'uptime', known: true }])
  })

  it('returns every line of a multi-line paste', () => {
    const t = new LineTracker()
    expect(t.preview('\x1b[200~echo a\rreboot\r\x1b[201~')).toEqual([
      { line: 'echo a', known: true },
      { line: 'reboot', known: true }
    ])
  })

  it('marks lines edited with arrows, history or tab as unknown', () => {
    const t = new LineTracker()
    t.commit('\x1b[A') // history recall
    expect(t.preview('\r')).toEqual([{ line: '', known: false }])
    t.commit('\r')
    t.commit('sys\t')
    expect(t.preview('\r')[0].known).toBe(false)
    t.commit('\r')
    t.commit('ls\x1bOD') // SS3 arrow left
    expect(t.preview('\r')[0].known).toBe(false)
  })
})
