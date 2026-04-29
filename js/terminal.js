'use strict';

const TERM_INSTANCES = [];

function createTerminal() {
  const inst = {
    _history: [],
    _histIdx: -1,
    _busy: false,
    _loadCancel: null,
    _progressFn: null,
    _loadStart: 0,
    _loadTotal: 0,
    _outputEl: null,
    _inputEl: null,
    _promptEl: null,
    _prompt1El: null,
    _sudoPendingCmd: null,

    init(container) {
      this._outputEl  = container.querySelector('.term-output');
      this._inputEl   = container.querySelector('.term-input');
      this._promptEl  = container.querySelector('.term-prompt');
      this._prompt1El = container.querySelector('.term-prompt-top');

      this._updatePrompt();
      this._inputEl.focus();

      this._inputEl.addEventListener('keydown', e => this._onKey(e));
      this._outputEl.addEventListener('click', () => {
        if (this._sudoPendingCmd !== null) this._outputEl.focus();
        else this._inputEl.focus();
      });

      // Capture keypresses while input row is hidden (sudo prompt or busy load)
      this._outputEl.tabIndex = -1;
      this._outputEl.addEventListener('keydown', e => {
        if (this._sudoPendingCmd !== null || this._busy) { e.preventDefault(); this._onKey(e); }
      });

      this._printLines([
        { t: '┌──────────────────────────────────────────────────────────┐', cls: 'p' },
        { t: '│  Kali Linux 2024.2 — Kerberoasting CTF Lab               │', cls: 'p' },
        { t: '│  Type  help  to see all attack steps                     │', cls: 'p' },
        { t: '│  CTF Missions panel on the right tracks your progress    │', cls: 'p' },
        { t: '└──────────────────────────────────────────────────────────┘', cls: 'p' },
        { t: '' },
      ]);
    },

    _updatePrompt() {
      if (SIM.windowsShell) {
        this._prompt1El.innerHTML = '';
        this._promptEl.style.color = '#fbbf24';
        this._promptEl.textContent = 'C:\\Windows\\system32> ';
      } else {
        const user  = SIM.user;
        const home  = user === 'root' ? '/root' : '/home/kali';
        const cwd   = SIM.cwd === home ? '~' : SIM.cwd;
        const sigil = user === 'root' ? '#' : '$';
        this._prompt1El.innerHTML =
          `<span style="color:#a78bfa">┌──(</span>` +
          `<span style="color:#22c55e;font-weight:bold">${this._esc(user)}</span>` +
          `<span style="color:#a78bfa">㉿</span>` +
          `<span style="color:#22c55e">kali</span>` +
          `<span style="color:#a78bfa">)-[</span>` +
          `<span style="color:#60a5fa">${this._esc(cwd)}</span>` +
          `<span style="color:#a78bfa">]</span>`;
        this._promptEl.style.color = '';
        this._promptEl.innerHTML =
          `<span style="color:#a78bfa">└─</span>` +
          `<span style="color:#fff">${sigil} </span>`;
      }
    },

    _onKey(e) {
      if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        if (this._busy && this._loadCancel) {
          this._loadCancel();
          this._loadCancel = null;
          this._appendLine({ t: '^C', cls: 'd' });
          return;
        }
        if (this._sudoPendingCmd !== null) {
          this._sudoPendingCmd = null;
          this._appendLine({ t: '^C', cls: 'd' });
          this._inputEl.value = '';
          this._prompt1El.style.display = '';
          this._inputEl.parentElement.style.display = '';
          this._updatePrompt();
          this._inputEl.focus();
          return;
        }
        this._echoCommand(this._inputEl.value);
        this._appendLine({ t: '^C', cls: 'd' });
        this._inputEl.value = '';
        return;
      }

      // Enter during a scan: print nmap-style progress
      if (this._busy && e.key === 'Enter' && this._progressFn) {
        e.preventDefault();
        const elapsed = Date.now() - this._loadStart;
        this._printLines(this._progressFn(elapsed, this._loadTotal));
        this._scrollBottom();
        return;
      }

      if (this._busy) { e.preventDefault(); return; }

      if (e.key === 'Enter') {
        const val = this._inputEl.value;
        this._inputEl.value = '';
        if (this._sudoPendingCmd !== null) {
          this._runSudoCmd(this._sudoPendingCmd);
        } else {
          this._runCommand(val);
        }
        return;
      }

      if (this._sudoPendingCmd !== null) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this._histIdx < this._history.length - 1) {
          this._histIdx++;
          this._inputEl.value = this._history[this._history.length - 1 - this._histIdx];
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this._histIdx > 0) {
          this._histIdx--;
          this._inputEl.value = this._history[this._history.length - 1 - this._histIdx];
        } else {
          this._histIdx = -1;
          this._inputEl.value = '';
        }
        return;
      }
      if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        this._outputEl.innerHTML = '';
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const val = this._inputEl.value;
        const completions = [
          'sudo nmap ','sudo apt-get update','sudo apt-get install ',
          'nmap ','enum4linux ','crackmapexec smb 10.10.10.10 ',
          'impacket-GetUserSPNs ','impacket-secretsdump ','impacket-psexec ',
          'john ','hashcat ','cat ','ls','pwd','help',
        ];
        const match = completions.find(c => c.startsWith(val) && c !== val);
        if (match) this._inputEl.value = match;
      }
    },

    async _runCommand(raw) {
      if (raw.trim()) { this._history.push(raw.trim()); this._histIdx = -1; }
      this._echoCommand(raw);

      const result = runCommand(raw);
      if (!result) { this._updatePrompt(); return; }

      if (result.clear) {
        this._outputEl.innerHTML = '';
        this._updatePrompt();
        return;
      }

      if (result.waitSudo) {
        this._sudoPendingCmd = result.pendingCmd;
        this._appendLine({ t: `[sudo] password for ${SIM.user}: `, cls: 'd' });
        this._prompt1El.style.display = 'none';
        this._inputEl.parentElement.style.display = 'none';
        this._outputEl.focus();
        return;
      }

      if (result.loadTime) {
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn);
        this._busy = false;
        if (cancelled) { this._updatePrompt(); return; }
      }

      this._printLines(result.lines || []);
      this._updatePrompt();
      this._scrollBottom();

      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    async _runSudoCmd(pendingCmd) {
      this._sudoPendingCmd = null;
      this._prompt1El.style.display = '';
      this._inputEl.parentElement.style.display = '';

      const wasRoot = SIM.user === 'root';
      if (!wasRoot) SIM.user = 'root';

      const result = runCommand(pendingCmd);

      const permanentRoot = /^(-i$|-s\s|su(\s|$))/.test(pendingCmd.trim());
      if (!wasRoot && !permanentRoot) SIM.user = 'kali';

      if (!result) { this._updatePrompt(); return; }

      if (result.clear) {
        this._outputEl.innerHTML = '';
        this._updatePrompt();
        return;
      }

      if (result.loadTime) {
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn);
        this._busy = false;
        if (cancelled) { this._updatePrompt(); return; }
      }

      this._printLines(result.lines || []);
      this._updatePrompt();
      this._scrollBottom();

      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    _animateLoad(ms, progressFn) {
      this._progressFn = progressFn || null;
      this._loadStart  = Date.now();
      this._loadTotal  = ms;

      this._prompt1El.style.display = 'none';
      this._inputEl.parentElement.style.display = 'none';
      this._outputEl.focus();

      return new Promise(resolve => {
        const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
        const div = document.createElement('div');
        div.className = 'tl d';
        div.textContent = frames[0];
        this._outputEl.appendChild(div);
        this._scrollBottom();

        let i = 0;
        const iv = setInterval(() => {
          div.textContent = frames[++i % frames.length];
          this._scrollBottom();
        }, 80);

        const finish = (cancelled) => {
          clearInterval(iv);
          div.remove();
          this._loadCancel = null;
          this._progressFn = null;
          this._prompt1El.style.display = '';
          this._inputEl.parentElement.style.display = '';
          this._inputEl.focus();
          resolve(cancelled);
        };

        this._loadCancel = () => finish(true);
        setTimeout(() => finish(false), ms);
      });
    },

    _echoCommand(raw) {
      const user  = SIM.user;
      const home  = user === 'root' ? '/root' : '/home/kali';
      const cwd   = SIM.cwd === home ? '~' : SIM.cwd;
      const sigil = user === 'root' ? '#' : '$';
      const div = document.createElement('div');
      div.className = 'tl';
      if (SIM.windowsShell) {
        div.innerHTML = `<span style="color:#fbbf24">C:\\Windows\\system32&gt;</span> <span style="color:#e0e0e0">${this._esc(raw)}</span>`;
      } else {
        div.innerHTML =
          `<span style="color:#a78bfa">┌──(</span><span style="color:#22c55e;font-weight:bold">${this._esc(user)}</span><span style="color:#a78bfa">㉿kali)-[</span><span style="color:#60a5fa">${this._esc(cwd)}</span><span style="color:#a78bfa">]</span>` +
          `\n<span style="color:#a78bfa">└─</span><span style="color:#fff">${sigil} </span><span style="color:#e0e0e0">${this._esc(raw)}</span>`;
      }
      this._outputEl.appendChild(div);
      this._scrollBottom();
    },

    _appendLine({ t, cls }) {
      const div = document.createElement('div');
      div.className = 'tl' + (cls ? ' ' + cls : '');
      div.textContent = t;
      this._outputEl.appendChild(div);
      this._scrollBottom();
    },

    _printLines(lines) {
      for (const l of lines) this._appendLine(l);
    },

    _scrollBottom() { this._outputEl.scrollTop = this._outputEl.scrollHeight; },
    _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
  };

  TERM_INSTANCES.push(inst);
  return inst;
}
