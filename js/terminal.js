'use strict';

const TERM_INSTANCES = [];

function createTerminal() {
  const inst = {
    _xterm: null,
    _fitAddon: null,
    _history: [],
    _histIdx: -1,
    _busy: false,
    _liveMode: false,
    _loadCancel: null,
    _progressFn: null,
    _loadStart: 0,
    _loadTotal: 0,
    _sudoPendingCmd: null,
    _sudoAttempts: 0,
    _inputBuf: '',
    _cursorPos: 0,

    init(container) {
      const TermClass = (typeof Terminal === 'function') ? Terminal
                      : (Terminal && typeof Terminal.Terminal === 'function') ? Terminal.Terminal
                      : null;
      const FitClass = (typeof FitAddon !== 'undefined')
                      ? (typeof FitAddon.FitAddon === 'function' ? FitAddon.FitAddon : FitAddon)
                      : null;

      if (!TermClass) { container.textContent = 'xterm.js failed to load'; return; }

      this._xterm = new TermClass({
        fontFamily: '"Cascadia Code", "Fira Code", "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.25,
        theme: {
          background: '#0d0d14',
          foreground: '#d4d4d4',
          cursor: '#a78bfa',
          cursorAccent: '#0d0d14',
          selectionBackground: 'rgba(167,139,250,0.25)',
          black: '#1e1e2e', red: '#f38ba8', green: '#a6e3a1',
          yellow: '#f9e2af', blue: '#89b4fa', magenta: '#cba6f7',
          cyan: '#89dceb', white: '#cdd6f4',
          brightBlack: '#45475a', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
          brightCyan: '#89dceb', brightWhite: '#ffffff',
        },
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 2000,
        convertEol: true,
        copyOnSelect: true,
      });

      if (FitClass) {
        this._fitAddon = new FitClass();
        this._xterm.loadAddon(this._fitAddon);
      }

      this._xterm.open(container);

      // Fit synchronously — container must be visible (display:flex) before this call
      if (this._fitAddon) this._fitAddon.fit();
      this._xterm.focus();

      this._printWelcome();
      this._writePrompt();
      this._xterm.onData(d => this._onData(d));

      // Re-fit after first paint in case flex layout settled differently
      requestAnimationFrame(() => { if (this._fitAddon) this._fitAddon.fit(); });
    },

    focus() { this._xterm?.focus(); },

    fit() {
      if (this._fitAddon) {
        this._fitAddon.fit();
      }
    },

    // ── Colors ──────────────────────────────────────────────────────────────
    _clsColor(cls) {
      return { p:'\x1b[35m', d:'\x1b[90m', g:'\x1b[32m', r:'\x1b[31m',
               y:'\x1b[33m', c:'\x1b[36m', b:'\x1b[94m', h:'\x1b[97m', w:'\x1b[97m' }[cls] || '';
    },

    _writeLine(text, cls) {
      const color = this._clsColor(cls);
      for (const line of String(text).split('\n')) {
        if (color) this._xterm.writeln(color + line + '\x1b[0m');
        else this._xterm.writeln(line);
      }
    },

    _printLines(lines) {
      for (const l of lines) {
        if (l.t === '') this._xterm.writeln('');
        else this._writeLine(l.t, l.cls);
      }
    },

    _printWelcome() {
      this._printLines([
        { t: '┌──────────────────────────────────────────────────────────┐', cls: 'p' },
        { t: '│  HackletOS 2024.2 — Kerberoasting CTF Lab                │', cls: 'p' },
        { t: '│  Type  help  to see all attack steps                     │', cls: 'p' },
        { t: '│  CTF Missions panel on the right tracks your progress    │', cls: 'p' },
        { t: '└──────────────────────────────────────────────────────────┘', cls: 'p' },
        { t: '' },
      ]);
    },

    // ── Prompt ──────────────────────────────────────────────────────────────
    _writePrompt() {
      if (SIM.windowsShell) {
        this._xterm.write('\x1b[33mC:\\Windows\\system32>\x1b[0m ');
        return;
      }
      const user  = SIM.user;
      const home  = user === 'root' ? '/root' : '/home/kali';
      const cwd   = SIM.cwd === home ? '~' : SIM.cwd;
      const sigil = user === 'root' ? '#' : '$';
      this._xterm.writeln(
        '\x1b[35m┌──(\x1b[0m\x1b[1;32m' + user + '\x1b[0m' +
        '\x1b[35m㉿\x1b[0m\x1b[32mkali\x1b[0m' +
        '\x1b[35m)-[\x1b[0m\x1b[94m' + cwd + '\x1b[0m\x1b[35m]\x1b[0m'
      );
      this._xterm.write('\x1b[35m└─\x1b[0m\x1b[97m' + sigil + ' \x1b[0m');
    },

    _updatePrompt() {
      if (this._busy || this._sudoPendingCmd !== null) return;
      if (this._cursorPos > 0) this._xterm.write('\r\x1b[K');
      this._inputBuf = '';
      this._cursorPos = 0;
      this._xterm.writeln('');
      this._writePrompt();
    },

    // ── Input handling ──────────────────────────────────────────────────────
    _onData(data) {
      // ── Busy (scan / load animation / live display) ──────────────────────
      if (this._busy) {
        if (data === '\x03' || (this._liveMode && (data === 'q' || data === 'Q'))) {
          if (this._loadCancel) { this._loadCancel(); this._loadCancel = null; }
        } else if (data === '\r' && this._progressFn) {
          const elapsed = Date.now() - this._loadStart;
          this._xterm.writeln('');
          this._printLines(this._progressFn(elapsed, this._loadTotal));
        }
        return;
      }

      // ── Sudo password entry ─────────────────────────────────────────────
      if (this._sudoPendingCmd !== null) {
        if (data === '\x03') {
          this._sudoPendingCmd = null; this._inputBuf = '';
          this._xterm.writeln('^C'); this._writePrompt();
        } else if (data === '\r') {
          const pwd = this._inputBuf;
          this._inputBuf = '';
          this._xterm.writeln('');
          if (pwd === 'root') {
            this._sudoAttempts = 0;
            this._runSudoCmd(this._sudoPendingCmd);
          } else {
            this._sudoAttempts++;
            if (this._sudoAttempts >= 3) {
              this._sudoAttempts = 0;
              this._sudoPendingCmd = null;
              this._xterm.writeln('\x1b[31msudo: 3 incorrect password attempts\x1b[0m');
              this._writePrompt();
            } else {
              this._xterm.writeln('\x1b[31mSorry, try again.\x1b[0m');
              this._xterm.write('\x1b[90m[sudo] password for ' + SIM.user + ': \x1b[0m');
            }
          }
        } else if (data === '\x7f') {
          if (this._inputBuf.length > 0) this._inputBuf = this._inputBuf.slice(0, -1);
        } else {
          this._inputBuf += data;
        }
        return;
      }

      // ── Normal input ────────────────────────────────────────────────────
      if (data === '\x03') {
        if (this._xterm.getSelection()) { this._xterm.clearSelection(); return; }
        this._xterm.writeln('\x1b[90m^C\x1b[0m');
        this._inputBuf = ''; this._cursorPos = 0;
        this._writePrompt(); return;
      }
      if (data === '\x0c') {
        this._xterm.clear(); this._writePrompt(); return;
      }
      if (data === '\r') {
        const cmd = this._inputBuf;
        this._inputBuf = ''; this._cursorPos = 0;
        this._xterm.writeln('');
        this._runCommand(cmd); return;
      }
      if (data === '\x7f') {
        if (this._cursorPos > 0) {
          const before = this._inputBuf.slice(0, this._cursorPos - 1);
          const after  = this._inputBuf.slice(this._cursorPos);
          this._inputBuf = before + after;
          this._cursorPos--;
          if (after.length === 0) {
            this._xterm.write('\b \b');
          } else {
            this._xterm.write('\b\x1b[K' + after + '\x1b[' + after.length + 'D');
          }
        }
        return;
      }

      // Arrow Up
      if (data === '\x1b[A') {
        if (this._histIdx < this._history.length - 1) {
          this._histIdx++;
          this._setInput(this._history[this._history.length - 1 - this._histIdx]);
        }
        return;
      }
      // Arrow Down
      if (data === '\x1b[B') {
        if (this._histIdx > 0) {
          this._histIdx--;
          this._setInput(this._history[this._history.length - 1 - this._histIdx]);
        } else { this._histIdx = -1; this._setInput(''); }
        return;
      }
      // Arrow Right
      if (data === '\x1b[C') {
        if (this._cursorPos < this._inputBuf.length) { this._cursorPos++; this._xterm.write('\x1b[C'); }
        return;
      }
      // Arrow Left
      if (data === '\x1b[D') {
        if (this._cursorPos > 0) { this._cursorPos--; this._xterm.write('\x1b[D'); }
        return;
      }
      // Home / Ctrl+A
      if (data === '\x1b[H' || data === '\x01') {
        if (this._cursorPos > 0) { this._xterm.write('\x1b[' + this._cursorPos + 'D'); this._cursorPos = 0; }
        return;
      }
      // End / Ctrl+E
      if (data === '\x1b[F' || data === '\x05') {
        const d = this._inputBuf.length - this._cursorPos;
        if (d > 0) { this._xterm.write('\x1b[' + d + 'C'); this._cursorPos = this._inputBuf.length; }
        return;
      }
      // Tab completion
      if (data === '\t') {
        const completions = [
          'sudo nmap ','sudo apt-get update','sudo apt-get install ',
          'nmap ','enum4linux ','crackmapexec smb 10.10.10.10 ',
          'impacket-GetUserSPNs ','impacket-secretsdump ','impacket-psexec ',
          'john ','hashcat ','cat ','ls','pwd','help','whoami','cd ',
          'lscpu','lsblk','lspci','lsusb','hostnamectl','timedatectl',
          'dmidecode','vmstat','iostat','dmesg','journalctl',
          'ss -tulpn','netstat -tulpn','dig ','traceroute ',
          'dpkg -l','stat ','file ','xxd ','md5sum ','sha256sum ',
        ];
        const match = completions.find(c => c.startsWith(this._inputBuf) && c !== this._inputBuf);
        if (match) this._setInput(match);
        return;
      }
      // Printable chars (including multi-char paste)
      if (data.length >= 1 && (data.length > 1 || data >= ' ')) {
        const printable = data.replace(/[\x00-\x1f\x7f]/g, '');
        if (!printable) return;
        const before = this._inputBuf.slice(0, this._cursorPos);
        const after  = this._inputBuf.slice(this._cursorPos);
        this._inputBuf = before + printable + after;
        this._cursorPos += printable.length;
        if (after.length === 0) {
          this._xterm.write(printable);
        } else {
          this._xterm.write(printable + after + '\x1b[' + after.length + 'D');
        }
      }
    },

    _setInput(val) {
      if (this._cursorPos > 0) this._xterm.write('\x1b[' + this._cursorPos + 'D');
      this._xterm.write('\x1b[K');
      this._inputBuf = val; this._cursorPos = val.length;
      if (val) this._xterm.write(val);
    },

    // ── Command execution ───────────────────────────────────────────────────
    async _runCommand(raw) {
      if (raw.trim()) { this._history.push(raw.trim()); this._histIdx = -1; }

      const result = runCommand(raw);
      if (!result) { this._writePrompt(); return; }

      if (result.clear) { this._xterm.clear(); this._writePrompt(); return; }

      if (result.waitSudo) {
        this._sudoPendingCmd = result.pendingCmd;
        this._inputBuf = '';
        this._xterm.write('\x1b[90m[sudo] password for ' + SIM.user + ': \x1b[0m');
        return;
      }

      if (result.liveDisplay) {
        this._busy = true;
        this._liveMode = true;
        await this._animateLive(result.displayFn, result.loadTime || 120000, result.refreshMs || 2000);
        this._liveMode = false;
        this._busy = false;
        this._writePrompt();
        return;
      }

      if (result.loadTime) {
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn);
        this._busy = false;
        if (cancelled) { this._writePrompt(); return; }
      }

      if (result.lines) this._printLines(result.lines);
      this._writePrompt();

      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    async _runSudoCmd(pendingCmd) {
      this._sudoPendingCmd = null; this._inputBuf = '';
      const wasRoot = SIM.user === 'root';
      if (!wasRoot) SIM.user = 'root';
      const result = runCommand(pendingCmd);
      const permanentRoot = /^(-i$|-s\s*$|su(\s|$))/.test(pendingCmd.trim());
      if (!wasRoot && !permanentRoot) SIM.user = 'kali';
      if (!result) { this._writePrompt(); return; }
      if (result.clear) { this._xterm.clear(); this._writePrompt(); return; }

      if (result.liveDisplay) {
        this._busy = true;
        this._liveMode = true;
        await this._animateLive(result.displayFn, result.loadTime || 120000, result.refreshMs || 2000);
        this._liveMode = false;
        this._busy = false;
        this._writePrompt();
        return;
      }

      if (result.loadTime) {
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn);
        this._busy = false;
        if (cancelled) { this._writePrompt(); return; }
      }
      if (result.lines) this._printLines(result.lines);
      this._writePrompt();
      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    // ── Live display (top/htop/watch) ───────────────────────────────────────
    _animateLive(displayFn, maxMs, refreshMs) {
      return new Promise(resolve => {
        let prevLineCount = 0;
        let tick = 0;

        const render = () => {
          // Erase previous frame
          if (prevLineCount > 0) {
            this._xterm.write('\x1b[' + prevLineCount + 'A\x1b[J');
          }
          const lines = displayFn(tick++);
          prevLineCount = 0;
          for (const l of lines) {
            const text = String(l.t ?? '');
            const subLines = text.split('\n');
            prevLineCount += subLines.length;
            const color = this._clsColor(l.cls);
            for (const sub of subLines) {
              if (color) this._xterm.writeln(color + sub + '\x1b[0m');
              else this._xterm.writeln(sub);
            }
          }
        };

        render();
        const iv = setInterval(render, refreshMs);

        const finish = (cancelled) => {
          clearInterval(iv);
          this._loadCancel = null;
          // Clear the live frame before returning to shell
          if (prevLineCount > 0) {
            this._xterm.write('\x1b[' + prevLineCount + 'A\x1b[J');
          }
          if (cancelled) this._xterm.writeln('\x1b[90m^C\x1b[0m');
          resolve(cancelled);
        };

        this._loadCancel = () => finish(true);
        setTimeout(() => finish(false), maxMs);
      });
    },

    _animateLoad(ms, progressFn) {
      this._progressFn = progressFn || null;
      this._loadStart  = Date.now();
      this._loadTotal  = ms;
      return new Promise(resolve => {
        const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
        let i = 0;
        this._xterm.write(frames[0]);
        const iv = setInterval(() => { this._xterm.write('\r' + frames[++i % frames.length]); }, 80);
        const finish = (cancelled) => {
          clearInterval(iv);
          this._xterm.write('\r\x1b[K');
          this._loadCancel = null; this._progressFn = null;
          if (cancelled) this._xterm.writeln('\x1b[90m^C\x1b[0m');
          resolve(cancelled);
        };
        this._loadCancel = () => finish(true);
        setTimeout(() => finish(false), ms);
      });
    },
  };

  TERM_INSTANCES.push(inst);
  return inst;
}
