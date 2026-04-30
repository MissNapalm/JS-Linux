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
    _nano: null,  // nano editor state, null when not active

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

      // Block browser from stealing Ctrl+W / Ctrl+S when nano is active
      this._xterm.textarea?.addEventListener('keydown', e => {
        if (this._nano && (e.ctrlKey || e.metaKey)) {
          const blocked = ['w','s','r','f','g','k','u','x','o','\\'];
          if (blocked.includes(e.key.toLowerCase())) e.preventDefault();
        }
      }, true);

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
        this._xterm.write('\x1b[33m' + SIM.winCwd + '>\x1b[0m ');
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
      // ── Nano editor mode ─────────────────────────────────────────────────
      if (this._nano) { this._nanoInput(data); return; }

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
          'john ','hashcat ','cat ','ls','pwd','help','whoami','cd ','reset',
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

    // ── Nano editor ──────────────────────────────────────────────────────────
    _nanoOpen(filename, content) {
      const cols = this._xterm.cols || 80;
      const rows = this._xterm.rows || 24;
      this._nano = {
        filename,
        lines: content.split('\n'),
        cx: 0,       // cursor col in current line
        cy: 0,       // cursor row in lines[]
        scrollY: 0,  // first visible line index
        dirty: false,
        // search state
        searchStr: '',
        // prompt state: null | 'save' | 'search' | 'exit'
        prompt: null,
        promptBuf: '',
        // cut buffer
        cutBuf: [],
      };
      this._xterm.write('\x1b[?25l'); // hide cursor during draw
      this._nanoRender();
      this._xterm.write('\x1b[?25h');
    },

    _nanoRows() { return (this._xterm.rows || 24) - 3; }, // header + status + keybars
    _nanoCols() { return this._xterm.cols || 80; },

    _nanoRender() {
      const n = this._nano;
      const cols = this._nanoCols();
      const rows = this._nanoRows();
      const t = this._xterm;

      // Move to top-left, clear screen
      t.write('\x1b[H\x1b[2J');

      // ── Header bar ──────────────────────────────────────────────────────
      const ver = ' GNU nano 7.2 ';
      const fname = n.filename || 'New Buffer';
      const modified = n.dirty ? ' (modified)' : '';
      const title = fname + modified;
      const pad = Math.max(0, Math.floor((cols - ver.length - title.length) / 2));
      const header = ver + ' '.repeat(pad) + title;
      t.write('\x1b[7m' + header.padEnd(cols) + '\x1b[0m\r\n');

      // ── Text area ───────────────────────────────────────────────────────
      for (let r = 0; r < rows; r++) {
        const lineIdx = n.scrollY + r;
        t.write('\x1b[K'); // clear line
        if (lineIdx < n.lines.length) {
          const line = n.lines[lineIdx];
          // Truncate to visible cols from horizontal scroll (basic, no horiz scroll for now)
          t.write(line.slice(0, cols));
        }
        if (r < rows - 1) t.write('\r\n');
      }

      // ── Status bar ──────────────────────────────────────────────────────
      t.write('\r\n');
      if (n.prompt === 'save') {
        const msg = `File Name to Write: ${n.promptBuf}`;
        t.write('\x1b[7m' + msg.padEnd(cols) + '\x1b[0m');
      } else if (n.prompt === 'search') {
        const msg = `Search: ${n.promptBuf}`;
        t.write('\x1b[7m' + msg.padEnd(cols) + '\x1b[0m');
      } else if (n.prompt === 'exit') {
        const msg = 'Save modified buffer? (Answering "No" will DISCARD changes.)  Y/N/?';
        t.write('\x1b[7m' + msg.padEnd(cols) + '\x1b[0m');
      } else if (n._statusMsg) {
        t.write('\x1b[7m' + n._statusMsg.padEnd(cols) + '\x1b[0m');
        n._statusMsg = '';
      } else {
        t.write('\x1b[K');
      }

      // ── Keybinding bars ─────────────────────────────────────────────────
      t.write('\r\n');
      const keys = n.prompt
        ? '\x1b[7m^G\x1b[0m Cancel      \x1b[7m^T\x1b[0m To Files    \x1b[7mM-D\x1b[0m DOS Format  \x1b[7mM-A\x1b[0m Append      \x1b[7mM-B\x1b[0m Backup File'
        : '\x1b[7m^G\x1b[0m Help   \x1b[7m^O\x1b[0m Write Out  \x1b[7m^W\x1b[0m Where Is  \x1b[7m^K\x1b[0m Cut    \x1b[7m^T\x1b[0m Execute  \x1b[7m^C\x1b[0m Location\r\n\x1b[7m^X\x1b[0m Exit   \x1b[7m^R\x1b[0m Read File  \x1b[7m^\\\x1b[0m Replace   \x1b[7m^U\x1b[0m Paste  \x1b[7m^J\x1b[0m Justify  \x1b[7m^/\x1b[0m Go To Line';
      t.write(keys);

      // ── Reposition cursor ────────────────────────────────────────────────
      if (n.prompt) {
        // cursor at end of prompt input on status bar line
        const promptLabel = n.prompt === 'save' ? 'File Name to Write: '
                          : n.prompt === 'search' ? 'Search: '
                          : 'Save modified buffer? (Answering "No" will DISCARD changes.)  Y/N/?';
        const promptRow = rows + 2; // 1-based: header(1) + rows + status(1)
        const promptCol = n.prompt === 'exit' ? promptLabel.length + 1 : promptLabel.length + n.promptBuf.length + 1;
        t.write(`\x1b[${promptRow};${Math.min(promptCol, cols)}H`);
      } else {
        const screenRow = n.cy - n.scrollY + 2; // +2 for header
        const screenCol = n.cx + 1;
        t.write(`\x1b[${screenRow};${screenCol}H`);
      }
    },

    _nanoInput(data) {
      const n = this._nano;
      const cols = this._nanoCols();
      const rows = this._nanoRows();

      // ── Prompt mode (save / search / exit confirm) ───────────────────────
      if (n.prompt === 'exit') {
        if (data === 'y' || data === 'Y') {
          n.prompt = 'save';
          n.promptBuf = n.filename || '';
          this._nanoRender();
        } else if (data === 'n' || data === 'N') {
          this._nanoClose();
        } else if (data === '\x07' || data === '\x03') { // ^G or ^C cancel
          n.prompt = null;
          this._nanoRender();
        }
        return;
      }

      if (n.prompt === 'save') {
        if (data === '\r') {
          const fname = n.promptBuf.trim();
          if (fname) {
            n.filename = fname;
            const abs = fname.startsWith('/') ? fname : SIM.cwd.replace(/\/?$/, '/') + fname;
            SIM.files[abs] = n.lines.join('\n');
            n.dirty = false;
            n._statusMsg = `Wrote ${n.lines.length} lines`;
          }
          n.prompt = null;
          n.promptBuf = '';
          this._nanoRender();
          // if we were exiting, close now
          if (n._exitAfterSave) this._nanoClose();
          return;
        }
        if (data === '\x07' || data === '\x03') { n.prompt = null; n.promptBuf = ''; this._nanoRender(); return; }
        if (data === '\x7f') { n.promptBuf = n.promptBuf.slice(0, -1); this._nanoRender(); return; }
        if (data.length === 1 && data >= ' ') { n.promptBuf += data; this._nanoRender(); return; }
        return;
      }

      if (n.prompt === 'search') {
        if (data === '\r') {
          n.searchStr = n.promptBuf;
          n.prompt = null;
          n.promptBuf = '';
          this._nanoDoSearch();
          return;
        }
        if (data === '\x07' || data === '\x03') { n.prompt = null; n.promptBuf = ''; this._nanoRender(); return; }
        if (data === '\x7f') { n.promptBuf = n.promptBuf.slice(0, -1); this._nanoRender(); return; }
        if (data.length === 1 && data >= ' ') { n.promptBuf += data; this._nanoRender(); return; }
        return;
      }

      // ── Normal editing mode ──────────────────────────────────────────────

      // Ctrl+X — exit
      if (data === '\x18') {
        if (n.dirty) {
          n.prompt = 'exit';
          n._exitAfterSave = false;
          this._nanoRender();
        } else {
          this._nanoClose();
        }
        return;
      }

      // Ctrl+O — write out
      if (data === '\x0f') {
        n.prompt = 'save';
        n.promptBuf = n.filename || '';
        n._exitAfterSave = false;
        this._nanoRender();
        return;
      }

      // Ctrl+W — search
      if (data === '\x17') {
        n.prompt = 'search';
        n.promptBuf = n.searchStr || '';
        this._nanoRender();
        return;
      }

      // Ctrl+K — cut line
      if (data === '\x0b') {
        n.cutBuf = n.lines.splice(n.cy, 1);
        if (n.lines.length === 0) n.lines = [''];
        n.cy = Math.min(n.cy, n.lines.length - 1);
        n.cx = Math.min(n.cx, n.lines[n.cy].length);
        n.dirty = true;
        this._nanoScrollIntoView();
        this._nanoRender();
        return;
      }

      // Ctrl+U — paste
      if (data === '\x15') {
        if (n.cutBuf.length > 0) {
          n.lines.splice(n.cy, 0, ...n.cutBuf);
          n.cy += n.cutBuf.length;
          n.cx = 0;
          n.dirty = true;
          this._nanoScrollIntoView();
          this._nanoRender();
        }
        return;
      }

      // Ctrl+C — show cursor position
      if (data === '\x03') {
        n._statusMsg = `line ${n.cy + 1}/${n.lines.length} col ${n.cx + 1}`;
        this._nanoRender();
        return;
      }

      // Ctrl+G — help (mini)
      if (data === '\x07') {
        n._statusMsg = 'Ctrl+X Exit  Ctrl+O Save  Ctrl+W Search  Ctrl+K Cut  Ctrl+U Paste';
        this._nanoRender();
        return;
      }

      // Ctrl+\ — replace (simple: search then replace)
      if (data === '\x1c') {
        n.prompt = 'search';
        n.promptBuf = '';
        n._replacing = true;
        this._nanoRender();
        return;
      }

      // Arrow keys
      if (data === '\x1b[A') { // up
        if (n.cy > 0) { n.cy--; n.cx = Math.min(n.cx, n.lines[n.cy].length); }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[B') { // down
        if (n.cy < n.lines.length - 1) { n.cy++; n.cx = Math.min(n.cx, n.lines[n.cy].length); }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[C') { // right
        if (n.cx < n.lines[n.cy].length) {
          n.cx++;
        } else if (n.cy < n.lines.length - 1) {
          n.cy++; n.cx = 0;
        }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[D') { // left
        if (n.cx > 0) {
          n.cx--;
        } else if (n.cy > 0) {
          n.cy--; n.cx = n.lines[n.cy].length;
        }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Home / Ctrl+A
      if (data === '\x1b[H' || data === '\x01') {
        n.cx = 0; this._nanoRender(); return;
      }
      // End / Ctrl+E
      if (data === '\x1b[F' || data === '\x05') {
        n.cx = n.lines[n.cy].length; this._nanoRender(); return;
      }

      // PgUp / Ctrl+Y
      if (data === '\x1b[5~' || data === '\x19') {
        n.cy = Math.max(0, n.cy - rows);
        n.cx = Math.min(n.cx, n.lines[n.cy].length);
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      // PgDn / Ctrl+V
      if (data === '\x1b[6~' || data === '\x16') {
        n.cy = Math.min(n.lines.length - 1, n.cy + rows);
        n.cx = Math.min(n.cx, n.lines[n.cy].length);
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Ctrl+Home / go to first line
      if (data === '\x1b[1;5H' || data === '\x1b[H' && false) {
        n.cy = 0; n.cx = 0; this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      // Ctrl+End / go to last line
      if (data === '\x1b[1;5F') {
        n.cy = n.lines.length - 1; n.cx = n.lines[n.cy].length;
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Enter
      if (data === '\r') {
        const line = n.lines[n.cy];
        const before = line.slice(0, n.cx);
        const after  = line.slice(n.cx);
        n.lines[n.cy] = before;
        n.lines.splice(n.cy + 1, 0, after);
        n.cy++; n.cx = 0;
        n.dirty = true;
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Backspace
      if (data === '\x7f') {
        if (n.cx > 0) {
          n.lines[n.cy] = n.lines[n.cy].slice(0, n.cx - 1) + n.lines[n.cy].slice(n.cx);
          n.cx--;
        } else if (n.cy > 0) {
          const prev = n.lines[n.cy - 1];
          n.cx = prev.length;
          n.lines[n.cy - 1] = prev + n.lines[n.cy];
          n.lines.splice(n.cy, 1);
          n.cy--;
        }
        n.dirty = true;
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Delete key
      if (data === '\x1b[3~') {
        const line = n.lines[n.cy];
        if (n.cx < line.length) {
          n.lines[n.cy] = line.slice(0, n.cx) + line.slice(n.cx + 1);
        } else if (n.cy < n.lines.length - 1) {
          n.lines[n.cy] = line + n.lines[n.cy + 1];
          n.lines.splice(n.cy + 1, 1);
        }
        n.dirty = true;
        this._nanoRender(); return;
      }

      // Tab
      if (data === '\t') {
        const spaces = '  '; // 2-space tab like nano default
        n.lines[n.cy] = n.lines[n.cy].slice(0, n.cx) + spaces + n.lines[n.cy].slice(n.cx);
        n.cx += spaces.length;
        n.dirty = true;
        this._nanoRender(); return;
      }

      // Printable chars (including paste)
      if (data.length >= 1 && (data.length > 1 || data >= ' ')) {
        const printable = data.replace(/[\x00-\x1f\x7f]/g, '');
        if (!printable) return;
        n.lines[n.cy] = n.lines[n.cy].slice(0, n.cx) + printable + n.lines[n.cy].slice(n.cx);
        n.cx += printable.length;
        n.dirty = true;
        this._nanoRender();
      }
    },

    _nanoScrollIntoView() {
      const n = this._nano;
      const rows = this._nanoRows();
      if (n.cy < n.scrollY) n.scrollY = n.cy;
      if (n.cy >= n.scrollY + rows) n.scrollY = n.cy - rows + 1;
    },

    _nanoDoSearch() {
      const n = this._nano;
      if (!n.searchStr) { this._nanoRender(); return; }
      const str = n.searchStr.toLowerCase();
      // Search from current position forward, wrap around
      for (let i = 0; i < n.lines.length; i++) {
        const lineIdx = (n.cy + i + 1) % n.lines.length;
        const col = n.lines[lineIdx].toLowerCase().indexOf(str, lineIdx === n.cy ? n.cx + 1 : 0);
        if (col !== -1) {
          n.cy = lineIdx; n.cx = col;
          n._statusMsg = `Found "${n.searchStr}"`;
          this._nanoScrollIntoView();
          this._nanoRender();
          return;
        }
      }
      n._statusMsg = `"${n.searchStr}" not found`;
      this._nanoRender();
    },

    _nanoClose() {
      this._nano = null;
      this._xterm.write('\x1b[H\x1b[2J'); // clear screen
      this._writePrompt();
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

      if (result.clear) {
        this._xterm.clear();
        if (raw.trim() === 'reset') this._printWelcome();
        this._writePrompt();
        return;
      }

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
