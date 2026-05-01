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
    _onEnterProgress: null,
    _loadStart: 0,
    _loadTotal: 0,
    _sudoPendingCmd: null,
    _sudoAttempts: 0,
    _inputBuf: '',
    _cursorPos: 0,
    _nano: null,
    _tabMatches: null,
    _tabIdx: -1,
    _tabPrefix: '',
    // per-tab shell state (shadows SIM for isolation between tabs)
    _user: null,
    _cwd: null,
    _windowsShell: false,
    _winCwd: 'C:\\Windows\\system32',

    // push this tab's state into SIM before running a command
    _simPush() {
      if (this._user !== null) SIM.user = this._user;
      if (this._cwd  !== null) SIM.cwd  = this._cwd;
      SIM.windowsShell = this._windowsShell;
      SIM.winCwd       = this._winCwd;
      if (this._msfMeterWin !== undefined) SIM.msfMeterWin = this._msfMeterWin;
    },
    // pull SIM state back into this tab after a command
    _simPull() {
      this._user         = SIM.user;
      this._cwd          = SIM.cwd;
      this._windowsShell = SIM.windowsShell;
      this._winCwd       = SIM.winCwd;
      this._msfMeterWin  = SIM.msfMeterWin;
    },

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
      // new tabs always start as the registered user, never inherit root from another tab
      const registeredUser = localStorage.getItem('hacklet_user') || 'rembrandt';
      this._user = registeredUser;
      this._cwd  = '/home/' + registeredUser;
      this._windowsShell = false;
      this._winCwd = 'C:\\Windows\\system32';
      this._writePrompt();
      this._xterm.onData(d => this._onData(d));

      // Block browser from stealing Ctrl+W / Ctrl+S when nano is active
      // Also block Tab from moving browser focus away from terminal
      this._xterm.textarea?.addEventListener('keydown', e => {
        if (e.key === 'Tab') { e.preventDefault(); }
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
      return { p:'\x1b[35m', d:'\x1b[37m', g:'\x1b[32m', r:'\x1b[31m',
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
      // skip if only output is a single empty string (silent success)
      if (lines.length === 1 && (lines[0].t === '' || lines[0].t === null || lines[0].t === undefined)) return;
      for (const l of lines) {
        if (l.t === '' || l.t === null || l.t === undefined) { this._xterm.writeln(''); continue; }
        this._writeLine(l.t, l.cls);
      }
    },

    _printWelcome() {},

    // ── Prompt ──────────────────────────────────────────────────────────────
    _atomicClearAndPrompt() {
      // Build the full prompt string and write everything atomically in one call
      // so there is zero visible intermediate state between clear and prompt
      const user  = this._user || SIM.user;
      const home  = user === 'root' ? '/root' : '/home/' + user;
      const cwd   = (this._cwd || SIM.cwd) === home ? '~' : (this._cwd || SIM.cwd);
      const sigil = user === 'root' ? '#' : '$';
      let prompt;
      if (this._windowsShell) {
        prompt = '\x1b[33m' + this._winCwd + '>\x1b[0m ';
      } else if (SIM.msf) {
        if (SIM.msfMeterWin) prompt = '\x1b[33mC:\\Windows\\system32>\x1b[0m ';
        else if (SIM.msfMeter) prompt = '\x1b[1;31mmeterpreter\x1b[0m \x1b[31m>\x1b[0m ';
        else if (SIM.msfModule) {
          const short = SIM.msfModule.split('/').pop();
          prompt = `\x1b[1;31mmsf6\x1b[0m \x1b[31mexploit\x1b[0m(\x1b[1;33m${short}\x1b[0m) \x1b[31m>\x1b[0m `;
        } else prompt = '\x1b[1;31mmsf6\x1b[0m \x1b[31m>\x1b[0m ';
      } else {
        prompt =
          '\x1b[35m\u250c\u2500\u2500(\x1b[0m\x1b[32m' + user + '@rembrandt\x1b[0m' +
          '\x1b[35m)-[\x1b[0m\x1b[94m' + cwd + '\x1b[0m\x1b[35m]\x1b[0m\r\n' +
          '\x1b[35m\u2514\u2500\x1b[0m\x1b[97m' + sigil + ' \x1b[0m';
      }
      // Hide cursor, erase everything, home, write prompt, show cursor — one atomic write
      this._xterm.write('\x1b[?25l\x1b[H\x1b[2J\x1b[3J\x1b[H' + prompt + '\x1b[?25h');
    },

    _writePrompt() {
      if (this._windowsShell) {
        this._xterm.write('\x1b[33m' + this._winCwd + '>\x1b[0m ');
        return;
      }
      if (SIM.msf) {
        if (SIM.msfMeterWin) {
          this._xterm.write('\x1b[33m' + (this._winCwd || SIM.winCwd) + '>\x1b[0m ');
        } else if (SIM.msfMeter) {
          this._xterm.write('\x1b[1;31mmeterpreter\x1b[0m \x1b[31m>\x1b[0m ');
        } else if (SIM.msfModule) {
          const short = SIM.msfModule.split('/').pop();
          this._xterm.write(`\x1b[1;31mmsf6\x1b[0m \x1b[31mexploit\x1b[0m(\x1b[1;33m${short}\x1b[0m) \x1b[31m>\x1b[0m `);
        } else {
          this._xterm.write('\x1b[1;31mmsf6\x1b[0m \x1b[31m>\x1b[0m ');
        }
        return;
      }
      const user  = this._user || SIM.user;
      const home  = user === 'root' ? '/root' : '/home/' + user;
      const cwd   = (this._cwd || SIM.cwd) === home ? '~' : (this._cwd || SIM.cwd);
      const sigil = user === 'root' ? '#' : '$';
      this._xterm.writeln(
        '\x1b[35m┌──(\x1b[0m\x1b[32m' + user + '@rembrandt\x1b[0m' +
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
        } else if (data === '\r') {
          if (this._onEnterProgress) {
            this._onEnterProgress();
          } else if (this._progressFn) {
            const elapsed = Date.now() - this._loadStart;
            this._xterm.writeln('');
            this._printLines(this._progressFn(elapsed, this._loadTotal));
          }
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
              this._xterm.write('\x1b[90m[sudo] password for ' + (this._user || SIM.user) + ': \x1b[0m');
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
      // reset tab cycling on any non-tab input
      if (data !== '\t') { this._tabMatches = null; this._tabIdx = -1; }

      if (data === '\x03') {
        if (this._xterm.getSelection()) { this._xterm.clearSelection(); return; }
        this._xterm.writeln('\x1b[90m^C\x1b[0m');
        this._inputBuf = ''; this._cursorPos = 0;
        this._writePrompt(); return;
      }
      if (data === '\x0c') {
        this._atomicClearAndPrompt(); return;
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
        // if we're mid-cycle, advance and apply next match silently
        if (this._tabMatches) {
          this._tabIdx = (this._tabIdx + 1) % this._tabMatches.length;
          const spIdx = this._tabPrefix.lastIndexOf(' ');
          const completed = (spIdx === -1 ? '' : this._tabPrefix.slice(0, spIdx + 1)) + this._tabMatches[this._tabIdx];
          const curLen = this._inputBuf.length;
          if (curLen > 0) this._xterm.write('\x1b[' + curLen + 'D');
          this._xterm.write('\x1b[K' + completed);
          this._inputBuf = completed;
          this._cursorPos = completed.length;
          return;
        }
        const buf = this._inputBuf.slice(0, this._cursorPos);
        // ── filename/dir completion ───────────────────────────────────────────────────────────────────────────
        // Build entries for a directory — mirrors the ls handler
        const _getDirEntries = (dir) => {
          const u = this._user || SIM.user;
          const h = '/home/' + u;
          const map = {
            [h]:                    { dirs: ['Desktop','Documents','Downloads','Music','Pictures','Public','Templates','Videos','.ssh','.config','.local','.msf4'], files: ['notes.txt','.bash_history','.bash_logout','.bashrc','.profile','.zshrc'] },
            [h+'/Desktop']:         { dirs: [], files: ['README.txt'] },
            [h+'/Documents']:       { dirs: ['reports','tools'], files: ['credentials.txt','network_notes.md'] },
            [h+'/Downloads']:       { dirs: [], files: ['linpeas.sh','winpeas.exe','mimikatz.zip'] },
            [h+'/Documents/reports']:{ dirs: [], files: ['pentest_report_draft.md','scope.txt'] },
            [h+'/Documents/tools']: { dirs: [], files: ['nmap_cheatsheet.txt','ad_attack_notes.txt'] },
            [h+'/.ssh']:            { dirs: [], files: ['known_hosts','id_rsa','id_rsa.pub'] },
            [h+'/.config']:         { dirs: ['xfce4','gtk-3.0','pulse'], files: [] },
            [h+'/.local']:          { dirs: ['share','bin'], files: [] },
            [h+'/.msf4']:           { dirs: ['logs','loot','modules','plugins'], files: ['history'] },
            '/':                    { dirs: ['bin','boot','dev','etc','home','lib','lib64','media','mnt','opt','proc','root','run','sbin','srv','sys','tmp','usr','var'], files: [] },
            '/root':                { dirs: ['Desktop','Documents','Downloads','.msf4','.ssh','.config'], files: ['notes.txt','root.txt','.bash_history','.bashrc','.profile'] },
            '/root/Documents':      { dirs: [], files: ['loot.txt'] },
            '/root/Downloads':      { dirs: [], files: ['linpeas.sh','chisel'] },
            '/root/.ssh':           { dirs: [], files: ['known_hosts','authorized_keys'] },
            '/home':                { dirs: [u], files: [] },
            '/etc':                 { dirs: ['apt','cron.d','cron.daily','cron.weekly','default','init.d','ld.so.conf.d','logrotate.d','network','pam.d','security','ssl','ssh','systemd','udev','X11'], files: ['bash.bashrc','crontab','environment','fstab','group','gshadow','hostname','hosts','hosts.allow','hosts.deny','issue','issue.net','locale.gen','login.defs','motd','mtab','nsswitch.conf','os-release','passwd','profile','protocols','resolv.conf','services','shadow','shells','sudoers','sysctl.conf','timezone'] },
            '/etc/ssh':             { dirs: [], files: ['ssh_config','sshd_config','ssh_host_ecdsa_key.pub','ssh_host_ed25519_key.pub','ssh_host_rsa_key.pub'] },
            '/etc/apt':             { dirs: ['sources.list.d','trusted.gpg.d','preferences.d'], files: ['sources.list'] },
            '/etc/systemd':         { dirs: ['system','user','network','resolved.conf.d'], files: ['journald.conf','logind.conf','resolved.conf','system.conf','timesyncd.conf','user.conf'] },
            '/etc/ssl':             { dirs: ['certs','private'], files: ['openssl.cnf'] },
            '/etc/pam.d':           { dirs: [], files: ['common-auth','common-account','common-password','common-session','login','sshd','sudo','su'] },
            '/tmp':                 { dirs: ['systemd-private-abc123'], files: ['sysinfo.txt','.font-unix','.ICE-unix','.X11-unix'] },
            '/opt':                 { dirs: ['metasploit-framework','impacket','crackmapexec','kerbrute','chisel'], files: [] },
            '/opt/metasploit-framework': { dirs: ['bin','data','modules','plugins','scripts','tools'], files: ['README.md','LICENSE'] },
            '/opt/impacket':        { dirs: ['impacket','examples','build'], files: ['README.md','setup.py'] },
            '/proc':                { dirs: ['1','2','432','591','623','1234','net'], files: ['cpuinfo','meminfo','version','uptime','loadavg','mounts'] },
            '/proc/net':            { dirs: [], files: ['arp','dev','route','tcp','tcp6','udp','udp6'] },
            '/dev':                 { dirs: ['block','bus','char','disk','input','mapper','net','pts','shm','snd'], files: ['console','null','random','sda','sda1','sda2','stderr','stdin','stdout','tty','urandom','zero'] },
            '/sys':                 { dirs: ['block','bus','class','dev','devices','firmware','fs','kernel','module','power'], files: [] },
            '/run':                 { dirs: ['lock','log','mount','network','sshd','systemd','udev','user'], files: ['motd.dynamic','utmp'] },
            '/media':               { dirs: [u], files: [] },
            '/mnt':                 { dirs: [], files: [] },
            '/srv':                 { dirs: ['http','ftp'], files: [] },
            '/boot':                { dirs: ['grub','efi'], files: ['config-6.6.9-amd64','initrd.img-6.6.9-amd64','vmlinuz-6.6.9-amd64'] },
            '/usr':                 { dirs: ['bin','include','lib','lib32','lib64','local','sbin','share','src'], files: [] },
            '/usr/bin':             { dirs: [], files: ['awk','base64','crackmapexec','curl','cut','dig','dpkg','enum4linux','file','gobuster','gpg','hashcat','head','htop','hydra','impacket-GetUserSPNs','impacket-psexec','impacket-secretsdump','john','kerbrute','md5sum','nano','netcat','nmap','openssl','python3','sha256sum','sort','ssh','ssh-keygen','strace','strings','tail','tcpdump','top','traceroute','vim','wc','wget','whoami','xxd'] },
            '/usr/sbin':            { dirs: [], files: ['adduser','apache2','cron','dmidecode','iptables','nft','sshd','tcpdump','useradd'] },
            '/usr/local':           { dirs: ['bin','etc','include','lib','sbin','share','src'], files: [] },
            '/usr/share':           { dirs: ['applications','doc','fonts','icons','man','metasploit-framework','nmap','wordlists','zsh'], files: [] },
            '/usr/share/wordlists': { dirs: ['dirb','dirbuster','metasploit','nmap','wfuzz'], files: ['fasttrack.txt','rockyou.txt'] },
            '/usr/share/nmap':      { dirs: ['nselib','scripts'], files: ['nmap-services','nmap-os-db','nmap-payloads'] },
            '/var':                 { dirs: ['backups','cache','lib','lock','log','mail','opt','run','spool','tmp'], files: [] },
            '/var/log':             { dirs: ['apt','journal','nginx'], files: ['auth.log','bootstrap.log','dpkg.log','kern.log','syslog'] },
            '/var/log/apt':         { dirs: [], files: ['history.log','term.log'] },
            '/var/lib':             { dirs: ['apt','dpkg','misc','NetworkManager','systemd','udev'], files: [] },
            '/var/cache':           { dirs: ['apt','debconf','ldconfig','man'], files: [] },
          };
          const entry = map[dir];
          if (!entry) {
            // fallback: scan simFiles for entries in this dir
            const result = { dirs: [], files: [] };
            const slash = dir === '/' ? '/' : dir + '/';
            for (const f of Object.keys(simFiles())) {
              if (f.startsWith(slash)) {
                const rest = f.slice(slash.length);
                if (!rest.includes('/')) result.files.push(rest);
              }
            }
            for (const d of SIM.dirs) {
              if (d.startsWith(slash)) {
                const rest = d.slice(slash.length);
                if (!rest.includes('/')) result.dirs.push(rest);
              }
            }
            return result;
          }
          // also merge runtime-created files/dirs
          const slash2 = dir === '/' ? '/' : dir + '/';
          for (const f of Object.keys(simFiles())) {
            if (f.startsWith(slash2)) {
              const rest = f.slice(slash2.length);
              if (!rest.includes('/') && !entry.files.includes(rest)) entry.files.push(rest);
            }
          }
          for (const d of SIM.dirs) {
            if (d.startsWith(slash2)) {
              const rest = d.slice(slash2.length);
              if (!rest.includes('/') && !entry.dirs.includes(rest)) entry.dirs.push(rest);
            }
          }
          return entry;
        };

        const spaceIdx = buf.lastIndexOf(' ');
        const partial = spaceIdx === -1 ? buf : buf.slice(spaceIdx + 1);
        if (partial) {
          // resolve directory to search
          const slashIdx = partial.lastIndexOf('/');
          const dirPart  = slashIdx === -1 ? '' : partial.slice(0, slashIdx + 1);
          const filePart = slashIdx === -1 ? partial : partial.slice(slashIdx + 1);
          const searchDir = dirPart
            ? (dirPart.startsWith('/') ? dirPart.replace(/\/$/, '') : ((this._cwd || SIM.cwd) + '/' + dirPart).replace(/\/$/, ''))
            : (this._cwd || SIM.cwd);
          // collect entries using the same map as ls
          const entry = _getDirEntries(searchDir);
          const allEntries = [
            ...entry.dirs.map(d => d + '/'),
            ...entry.files,
          ];
          const matches = [...new Set(allEntries)].filter(e => e.startsWith(filePart) && e !== filePart);
          if (matches.length === 1) {
            const prefix = buf.slice(0, spaceIdx === -1 ? 0 : spaceIdx + 1);
            const completed = prefix + dirPart + matches[0];
            this._inputBuf = completed;
            this._cursorPos = completed.length;
            if (buf.length > 0) this._xterm.write('\x1b[' + buf.length + 'D');
            this._xterm.write('\x1b[K' + completed);
            return;
          } else if (matches.length > 1) {
            const prefix = buf.slice(0, spaceIdx === -1 ? 0 : spaceIdx + 1);
            const baseToken = prefix + dirPart + filePart;
            this._tabMatches = matches;
            this._tabIdx = 0;
            this._tabPrefix = baseToken;
            // print list on next line, then move cursor back up — input unchanged
            this._xterm.write('\r\n\x1b[90m' + matches.join('    ') + '\x1b[0m');
            this._xterm.write('\x1b[1A\r');  // move up 1 line, carriage return
            // rewrite the current input line so cursor is at end of buf
            this._xterm.write('\x1b[K');  // clear to end of line (clears any leftover)
            // rewrite prompt sigil + input (we're on the └─$ line)
            const u3 = this._user || SIM.user;
            const sig3 = u3 === 'root' ? '#' : '$';
            this._xterm.write('\x1b[35m\u2514\u2500\x1b[0m\x1b[97m' + sig3 + ' \x1b[0m' + buf);
            this._inputBuf = buf;
            this._cursorPos = buf.length;
            return;
          }
        }
        // ── command completion ───────────────────────────────────────────────────────────────────────────
        const completions = [
          'sudo nmap ','sudo apt-get update','sudo apt-get install ',
          'nmap ','enum4linux ','crackmapexec smb 10.10.10.10 ',
          'impacket-GetUserSPNs ','impacket-secretsdump ','impacket-psexec ',
          'msfconsole','john ','hashcat ','cat ','ls','pwd','help','whoami','cd ','reset',
          'nano ','vim ','find ','grep ','chmod ','mkdir ','touch ','rm ',
          'neofetch','lscpu','lsblk','lspci','lsusb','hostnamectl','timedatectl',
          'dmidecode','vmstat','iostat','dmesg','journalctl',
          'ss -tulpn','netstat -tulpn','dig ','traceroute ',
          'dpkg -l','stat ','file ','xxd ','md5sum ','sha256sum ',
        ];
        const match = completions.find(c => c.startsWith(buf) && c !== buf);
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
    _nanoOpen(filename, content, filepath) {
      const cols = this._xterm.cols || 80;
      const rows = this._xterm.rows || 24;
      this._nano = {
        filename,
        filepath: filepath || (filename.startsWith('/') ? filename : (this._cwd || SIM.cwd).replace(/\/?$/, '/') + filename),
        lines: content.split('\n'),
        cx: 0,
        cy: 0,
        _prefCx: 0,  // preferred column — preserved across up/down through short lines
        scrollY: 0,
        dirty: false,
        searchStr: '',
        prompt: null,
        promptBuf: '',
        cutBuf: [],
      };
      this._xterm.write('\x1b[?25l'); // hide cursor during draw
      this._nanoRender();
      this._xterm.write('\x1b[?25h');
    },

    _nanoRows() { return (this._xterm.rows || 24) - 4; }, // header(1) + status(1) + keybars(2)
    _nanoCols() { return this._xterm.cols || 80; },

    _nanoRender() {
      const n = this._nano;
      const cols = this._nanoCols();
      const rows = this._nanoRows();
      const t = this._xterm;

      // Clear screen, home cursor
      t.write('\x1b[2J');

      // row 1: header
      const ver = ' GNU nano 7.2 ';
      const fname = n.filename || 'New Buffer';
      const modified = n.dirty ? ' (modified)' : '';
      const title = fname + modified;
      const pad = Math.max(0, Math.floor((cols - ver.length - title.length) / 2));
      const header = (ver + ' '.repeat(pad) + title).padEnd(cols).slice(0, cols);
      t.write('\x1b[1;1H\x1b[7m' + header + '\x1b[0m');

      // rows 2..rows+1: text area
      for (let r = 0; r < rows; r++) {
        const lineIdx = n.scrollY + r;
        t.write(`\x1b[${r + 2};1H\x1b[K`);
        if (lineIdx < n.lines.length) {
          t.write(n.lines[lineIdx].slice(0, cols));
        }
      }

      // row rows+2: status bar
      const statusRow = rows + 2;
      t.write(`\x1b[${statusRow};1H\x1b[K`);
      if (n.prompt === 'save') {
        t.write('\x1b[7m' + `File Name to Write: ${n.promptBuf}`.padEnd(cols).slice(0, cols) + '\x1b[0m');
      } else if (n.prompt === 'search') {
        const label = n._replacing ? 'Search (to replace): ' : 'Search: ';
        t.write('\x1b[7m' + (label + n.promptBuf).padEnd(cols).slice(0, cols) + '\x1b[0m');
      } else if (n.prompt === 'replace') {
        t.write('\x1b[7m' + `Replace with: ${n.promptBuf}`.padEnd(cols).slice(0, cols) + '\x1b[0m');
      } else if (n.prompt === 'exit') {
        t.write('\x1b[7m' + 'Save modified buffer? (Answering "No" will DISCARD changes.)  Y/N/?'.padEnd(cols).slice(0, cols) + '\x1b[0m');
      } else if (n._statusMsg) {
        t.write('\x1b[7m' + n._statusMsg.padEnd(cols).slice(0, cols) + '\x1b[0m');
        n._statusMsg = '';
      }

      // rows rows+3..rows+4: keybinding bars
      const k1 = rows + 3, k2 = rows + 4;
      if (n.prompt) {
        t.write(`\x1b[${k1};1H\x1b[K\x1b[7m^G\x1b[0m Cancel      \x1b[7m^T\x1b[0m To Files    \x1b[7mM-D\x1b[0m DOS Format  \x1b[7mM-A\x1b[0m Append`);
        t.write(`\x1b[${k2};1H\x1b[K`);
      } else {
        t.write(`\x1b[${k1};1H\x1b[K\x1b[7m^G\x1b[0m Help   \x1b[7m^O\x1b[0m Write Out  \x1b[7m^W\x1b[0m Where Is  \x1b[7m^K\x1b[0m Cut    \x1b[7m^T\x1b[0m Execute  \x1b[7m^C\x1b[0m Location`);
        t.write(`\x1b[${k2};1H\x1b[K\x1b[7m^X\x1b[0m Exit   \x1b[7m^R\x1b[0m Read File  \x1b[7m^\\\x1b[0m Replace   \x1b[7m^U\x1b[0m Paste  \x1b[7m^J\x1b[0m Justify  \x1b[7m^/\x1b[0m Go To Line`);
      }

      // reposition cursor
      if (n.prompt) {
        const labelLen = n.prompt === 'save'   ? 'File Name to Write: '.length
                       : n.prompt === 'search' ? 'Search: '.length
                       : 'Save modified buffer? (Answering "No" will DISCARD changes.)  Y/N/?'.length;
        const col = n.prompt === 'exit' ? labelLen + 1 : labelLen + n.promptBuf.length + 1;
        t.write(`\x1b[${statusRow};${Math.min(col, cols)}H`);
      } else {
        t.write(`\x1b[${(n.cy - n.scrollY) + 2};${n.cx + 1}H`);
      }
    },

    _nanoInput(data) {
      const n = this._nano;
      const rows = this._nanoRows();

      // ── Prompt modes ────────────────────────────────────────────────────
      if (n.prompt === 'exit') {
        if (data === 'y' || data === 'Y') {
          n.prompt = 'save'; n.promptBuf = n.filename || ''; this._nanoRender();
        } else if (data === 'n' || data === 'N') {
          this._nanoClose();
        } else if (data === '\x07' || data === '\x03') {
          n.prompt = null; this._nanoRender();
        }
        return;
      }

      if (n.prompt === 'save') {
        if (data === '\r') {
          const fname = n.promptBuf.trim();
          if (fname) {
            n.filename = fname;
            const abs = fname.startsWith('/') ? fname : (this._cwd || SIM.cwd).replace(/\/?$/, '/') + fname;
            n.filepath = abs;
            SIM.files[abs] = n.lines.join('\n');
            n.dirty = false;
            n._statusMsg = `Wrote ${n.lines.length} lines`;
          }
          n.prompt = null; n.promptBuf = '';
          this._nanoRender();
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
          if (n.promptBuf) n.searchStr = n.promptBuf;
          if (n._replacing) {
            n.prompt = 'replace'; n.promptBuf = n.replaceStr || '';
            this._nanoRender();
          } else {
            n.prompt = null; n.promptBuf = '';
            this._nanoDoSearch(false);
          }
          return;
        }
        if (data === '\x07' || data === '\x03') { n.prompt = null; n.promptBuf = ''; this._nanoRender(); return; }
        if (data === '\x7f') { n.promptBuf = n.promptBuf.slice(0, -1); this._nanoRender(); return; }
        if (data.length === 1 && data >= ' ') { n.promptBuf += data; this._nanoRender(); return; }
        return;
      }

      if (n.prompt === 'replace') {
        if (data === '\r') {
          n.replaceStr = n.promptBuf;
          n.prompt = null; n.promptBuf = '';
          this._nanoDoReplace();
          return;
        }
        if (data === '\x07' || data === '\x03') { n.prompt = null; n.promptBuf = ''; n._replacing = false; this._nanoRender(); return; }
        if (data === '\x7f') { n.promptBuf = n.promptBuf.slice(0, -1); this._nanoRender(); return; }
        if (data.length === 1 && data >= ' ') { n.promptBuf += data; this._nanoRender(); return; }
        return;
      }

      // ── Normal editing ───────────────────────────────────────────────────

      // Ctrl+X — exit
      if (data === '\x18') {
        if (n.dirty) { n.prompt = 'exit'; n._exitAfterSave = true; this._nanoRender(); }
        else this._nanoClose();
        return;
      }

      // Ctrl+O — write out
      if (data === '\x0f') {
        n.prompt = 'save'; n.promptBuf = n.filename || ''; n._exitAfterSave = false;
        this._nanoRender(); return;
      }

      // Ctrl+W — search
      if (data === '\x17') {
        n._replacing = false;
        n.prompt = 'search'; n.promptBuf = n.searchStr || '';
        this._nanoRender(); return;
      }

      // Ctrl+\ — replace
      if (data === '\x1c') {
        n._replacing = true;
        n.prompt = 'search'; n.promptBuf = n.searchStr || '';
        this._nanoRender(); return;
      }

      // Ctrl+K — cut line
      if (data === '\x0b') {
        n.cutBuf = n.lines.splice(n.cy, 1);
        if (n.lines.length === 0) n.lines = [''];
        n.cy = Math.min(n.cy, n.lines.length - 1);
        n.cx = Math.min(n.cx, n.lines[n.cy].length);
        n._prefCx = n.cx; n.dirty = true;
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Ctrl+U — paste
      if (data === '\x15') {
        if (n.cutBuf.length > 0) {
          n.lines.splice(n.cy, 0, ...n.cutBuf);
          n.cy += n.cutBuf.length; n.cx = 0; n._prefCx = 0; n.dirty = true;
          this._nanoScrollIntoView(); this._nanoRender();
        }
        return;
      }

      // Ctrl+C — cursor position
      if (data === '\x03') {
        n._statusMsg = `line ${n.cy + 1}/${n.lines.length} col ${n.cx + 1}`;
        this._nanoRender(); return;
      }

      // Ctrl+G — help
      if (data === '\x07') {
        n._statusMsg = '^X Exit  ^O Save  ^W Search  ^\\Replace  ^K Cut  ^U Paste  ^C Pos';
        this._nanoRender(); return;
      }

      // Arrow keys
      if (data === '\x1b[A') {
        if (n.cy > 0) { n.cy--; n._prefCx = Math.max(n._prefCx, n.cx); n.cx = Math.min(n._prefCx, n.lines[n.cy].length); }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[B') {
        if (n.cy < n.lines.length - 1) { n.cy++; n._prefCx = Math.max(n._prefCx, n.cx); n.cx = Math.min(n._prefCx, n.lines[n.cy].length); }
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[C') {
        if (n.cx < n.lines[n.cy].length) { n.cx++; } else if (n.cy < n.lines.length - 1) { n.cy++; n.cx = 0; }
        n._prefCx = n.cx; this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      if (data === '\x1b[D') {
        if (n.cx > 0) { n.cx--; } else if (n.cy > 0) { n.cy--; n.cx = n.lines[n.cy].length; }
        n._prefCx = n.cx; this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Home / Ctrl+A
      if (data === '\x1b[H' || data === '\x01') { n.cx = 0; n._prefCx = 0; this._nanoRender(); return; }
      // End / Ctrl+E
      if (data === '\x1b[F' || data === '\x05') { n.cx = n.lines[n.cy].length; n._prefCx = n.cx; this._nanoRender(); return; }

      // PgUp / Ctrl+Y
      if (data === '\x1b[5~' || data === '\x19') {
        n.cy = Math.max(0, n.cy - rows);
        n.cx = Math.min(n._prefCx, n.lines[n.cy].length);
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }
      // PgDn / Ctrl+V
      if (data === '\x1b[6~' || data === '\x16') {
        n.cy = Math.min(n.lines.length - 1, n.cy + rows);
        n.cx = Math.min(n._prefCx, n.lines[n.cy].length);
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Ctrl+Home
      if (data === '\x1b[1;5H') { n.cy = 0; n.cx = 0; n._prefCx = 0; this._nanoScrollIntoView(); this._nanoRender(); return; }
      // Ctrl+End
      if (data === '\x1b[1;5F') { n.cy = n.lines.length - 1; n.cx = n.lines[n.cy].length; n._prefCx = n.cx; this._nanoScrollIntoView(); this._nanoRender(); return; }

      // Enter
      if (data === '\r') {
        const line = n.lines[n.cy];
        n.lines[n.cy] = line.slice(0, n.cx);
        n.lines.splice(n.cy + 1, 0, line.slice(n.cx));
        n.cy++; n.cx = 0; n._prefCx = 0; n.dirty = true;
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
        n._prefCx = n.cx; n.dirty = true;
        this._nanoScrollIntoView(); this._nanoRender(); return;
      }

      // Delete
      if (data === '\x1b[3~') {
        const line = n.lines[n.cy];
        if (n.cx < line.length) {
          n.lines[n.cy] = line.slice(0, n.cx) + line.slice(n.cx + 1);
        } else if (n.cy < n.lines.length - 1) {
          n.lines[n.cy] = line + n.lines[n.cy + 1];
          n.lines.splice(n.cy + 1, 1);
        }
        n._prefCx = n.cx; n.dirty = true; this._nanoRender(); return;
      }

      // Tab
      if (data === '\t') {
        const sp = '  ';
        n.lines[n.cy] = n.lines[n.cy].slice(0, n.cx) + sp + n.lines[n.cy].slice(n.cx);
        n.cx += sp.length; n._prefCx = n.cx; n.dirty = true; this._nanoRender(); return;
      }

      // Printable / paste
      if (data.length >= 1 && (data.length > 1 || data >= ' ')) {
        const printable = data.replace(/[\x00-\x1f\x7f]/g, '');
        if (!printable) return;
        n.lines[n.cy] = n.lines[n.cy].slice(0, n.cx) + printable + n.lines[n.cy].slice(n.cx);
        n.cx += printable.length; n._prefCx = n.cx; n.dirty = true;
        this._nanoRender();
      }
    },

    _nanoScrollIntoView() {
      const n = this._nano;
      const rows = this._nanoRows();
      if (n.cy < n.scrollY) n.scrollY = n.cy;
      if (n.cy >= n.scrollY + rows) n.scrollY = n.cy - rows + 1;
    },

    _nanoDoSearch(fromCurrent) {
      const n = this._nano;
      if (!n.searchStr) { this._nanoRender(); return; }
      const str = n.searchStr.toLowerCase();
      const totalLines = n.lines.length;
      // Search forward from cursor, wrap around
      for (let i = 0; i < totalLines; i++) {
        const lineIdx = (n.cy + i) % totalLines;
        const startCol = (i === 0 && !fromCurrent) ? n.cx + 1 : (i === 0 ? n.cx : 0);
        const col = n.lines[lineIdx].toLowerCase().indexOf(str, startCol);
        if (col !== -1) {
          n.cy = lineIdx; n.cx = col; n._prefCx = col;
          n._statusMsg = `Found "${n.searchStr}"`;
          this._nanoScrollIntoView(); this._nanoRender(); return;
        }
      }
      n._statusMsg = `"${n.searchStr}" not found`;
      this._nanoRender();
    },

    _nanoDoReplace() {
      const n = this._nano;
      if (!n.searchStr) { this._nanoRender(); return; }
      const search = n.searchStr;
      const replace = n.replaceStr || '';
      let count = 0;
      for (let i = 0; i < n.lines.length; i++) {
        const orig = n.lines[i];
        const updated = orig.split(search).join(replace);
        if (updated !== orig) { n.lines[i] = updated; count += orig.split(search).length - 1; }
      }
      if (count > 0) {
        n.dirty = true;
        n._statusMsg = `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`;
        // reposition cursor to first match or clamp
        n.cx = Math.min(n.cx, n.lines[n.cy].length);
      } else {
        n._statusMsg = `"${search}" not found`;
      }
      n._replacing = false;
      this._nanoScrollIntoView(); this._nanoRender();
    },

    _nanoClose() {
      this._nano = null;
      this._xterm.write('\x1b[H\x1b[2J\x1b[H'); // clear screen
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

      this._simPush();
      const result = runCommand(raw);
      this._simPull();
      if (!result) { this._writePrompt(); return; }

      if (result.clear) {
        this._atomicClearAndPrompt();
        return;
      }

      if (result.dropRoot) {
        const registeredUser = localStorage.getItem('hacklet_user') || 'rembrandt';
        this._user = registeredUser;
        this._cwd  = '/home/' + registeredUser;
        SIM.user = registeredUser;
        SIM.cwd  = this._cwd;
        this._writeLine('logout', 'd');
        this._writePrompt();
        return;
      }

      if (result.waitSudo) {
        this._sudoPendingCmd = result.pendingCmd;
        this._inputBuf = '';
        this._xterm.write('\x1b[90m[sudo] password for ' + (this._user || SIM.user) + ': \x1b[0m');
        return;
      }

      if (result.openEditor) {
        this._nanoOpen(result.filename, result.content, result.filepath);
        return;
      }

      if (result.openMsf) {
        if (result.msfEcho) this._writeLine(result.msfEcho, 'g');
        this._writePrompt();
        if (result.id) {
          const captured = CTF.check(result);
          if (captured) CTF._renderSidebar();
        }
        return;
      }

      if (result.history) {
        this._history.forEach((cmd, i) => {
          this._writeLine(String(i + 1).padStart(5) + '  ' + cmd, '');
        });
        this._writePrompt();
        return;
      }

      if (result.lines && result.lines.length === 1 && result.lines[0].t && typeof result.lines[0].t === 'object' && result.lines[0].t.pingMode) {
        await this._animatePing(result.lines[0].t.target);
        this._writePrompt();
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

      if (result.stepLines) {
        this._busy = true;
        await this._animateSteps(result.stepLines);
        this._busy = false;
        if (result.after) { result.after(); }
        this._simPull();
        this._writePrompt();
        if (result.id) {
          const captured = CTF.check(result);
          if (captured) CTF._renderSidebar();
        }
        return;
      }

      if (result.loadTime) {
        // For silent-progress commands (nmap), print the first line immediately before scanning
        if (result.progressOnEnter && result.lines && result.lines.length > 0) {
          const firstLine = result.lines[0];
          const t = typeof firstLine.t === 'function' ? firstLine.t() : firstLine.t;
          if (t) {
            const color = this._clsColor(firstLine.cls || '');
            this._xterm.write((color ? color + t + '\x1b[0m' : t) + '\r\n');
          }
          result._firstLinePrinted = true;
        }
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn, result.progressOnEnter);
        this._busy = false;
        if (cancelled) { this._writePrompt(); return; }
      }

      if (result.lines) {
        const lines = result._firstLinePrinted ? result.lines.slice(1) : result.lines;
        this._printLines(lines);
      }
      this._writePrompt();

      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    async _runSudoCmd(pendingCmd) {
      this._sudoPendingCmd = null; this._inputBuf = '';
      this._simPush();
      const wasRoot = SIM.user === 'root';
      if (!wasRoot) SIM.user = 'root';
      const result = runCommand(pendingCmd);
      const permanentRoot = /^(-i$|-s\s*$|su(\s|$))/.test(pendingCmd.trim());
      if (!wasRoot && !permanentRoot) SIM.user = this._user || 'rembrandt';
      this._simPull();
      if (!result) { this._writePrompt(); return; }
      if (result.clear) { this._atomicClearAndPrompt(); return; }

      if (result.openEditor) {
        this._nanoOpen(result.filename, result.content, result.filepath);
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

      if (result.stepLines) {
        this._busy = true;
        await this._animateSteps(result.stepLines);
        this._busy = false;
        if (result.after) { result.after(); }
        this._simPull();
        this._writePrompt();
        if (result.id) {
          const captured = CTF.check(result);
          if (captured) CTF._renderSidebar();
        }
        return;
      }

      if (result.loadTime) {
        if (result.progressOnEnter && result.lines && result.lines.length > 0) {
          const firstLine = result.lines[0];
          const t = typeof firstLine.t === 'function' ? firstLine.t() : firstLine.t;
          if (t) this._writeLine(t, firstLine.cls || '');
          result._firstLinePrinted = true;
        }
        this._busy = true;
        const cancelled = await this._animateLoad(result.loadTime, result.progressFn, result.progressOnEnter);
        this._busy = false;
        if (cancelled) { this._writePrompt(); return; }
      }
      if (result.lines) {
        const lines = result._firstLinePrinted ? result.lines.slice(1) : result.lines;
        this._printLines(lines);
      }
      this._writePrompt();
      if (result.id) {
        const captured = CTF.check(result);
        if (captured) CTF._renderSidebar();
      }
    },

    // ── Stepped output (per-line delays) ───────────────────────────────────────
    _animateSteps(stepLines) {
      return new Promise(resolve => {
        let i = 0;
        const next = () => {
          if (i >= stepLines.length) { resolve(); return; }
          const s = stepLines[i++];
          setTimeout(() => {
            if (s.t !== '') this._writeLine(s.t, s.cls);
            else this._xterm.writeln('');
            next();
          }, s.delay ?? 0);
        };
        next();
      });
    },

    // ── Ping (infinite append, Ctrl+C to stop) ────────────────────────────────
    _animatePing(target) {
      const times = [1.23, 0.98, 1.05, 1.44, 0.87, 1.12, 2.01, 0.93, 1.38, 0.76,
                     1.55, 0.91, 1.22, 1.67, 0.84, 1.09, 1.31, 0.95, 1.48, 1.03];
      let seq = 0;
      this._writeLine(`PING ${target} 56(84) bytes of data.`);
      return new Promise(resolve => {
        const iv = setInterval(() => {
          const t = times[seq % times.length];
          this._writeLine(`64 bytes from ${target}: icmp_seq=${seq + 1} ttl=128 time=${t} ms`);
          seq++;
        }, 1000);
        this._busy = true;
        this._liveMode = true;
        this._loadCancel = () => {
          clearInterval(iv);
          this._busy = false;
          this._liveMode = false;
          this._loadCancel = null;
          this._xterm.writeln('\x1b[90m^C\x1b[0m');
          this._writeLine(`--- ${target} ping statistics ---`);
          const loss = 0;
          this._writeLine(`${seq} packets transmitted, ${seq} received, ${loss}% packet loss`);
          const avg = times.slice(0, Math.min(seq, times.length)).reduce((a,b)=>a+b,0) / Math.min(seq, times.length);
          const min = Math.min(...times.slice(0, Math.min(seq, times.length)));
          const max = Math.max(...times.slice(0, Math.min(seq, times.length)));
          this._writeLine(`round-trip min/avg/max = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)} ms`);
          resolve();
        };
      });
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
          const maxRows = (this._xterm.rows || 24) - 2; // leave room for prompt
          const allLines = displayFn(tick++);
          const lines = allLines.slice(0, maxRows);
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

    _animateLoad(ms, progressFn, progressOnEnter) {
      this._progressFn = progressFn || null;
      this._loadStart  = Date.now();
      this._loadTotal  = ms;
      return new Promise(resolve => {
        let iv;
        const finish = (cancelled) => {
          clearInterval(iv);
          if (!progressFn) this._xterm.write('\r\x1b[K');
          this._loadCancel = null; this._progressFn = null; this._onEnterProgress = null;
          if (cancelled) this._xterm.writeln('\x1b[90m^C\x1b[0m');
          resolve(cancelled);
        };
        if (progressFn && progressOnEnter) {
          // Silent — only print stats when Enter is pressed, no blank lines between blocks
          this._onEnterProgress = () => {
            const elapsed = Date.now() - this._loadStart;
            const lines = progressFn(elapsed, ms);
            lines.forEach((l) => {
              const color = this._clsColor(l.cls);
              const text = color ? color + l.t + '\x1b[0m' : l.t;
              this._xterm.write(text + '\r\n');
            });
          };
          iv = setInterval(() => {}, 999999);
        } else if (progressFn) {
          // Continuous rolling stats for other tools
          let lastLineCount = 0;
          iv = setInterval(() => {
            const elapsed = Date.now() - this._loadStart;
            const lines = progressFn(elapsed, ms);
            if (lastLineCount > 0) this._xterm.write('\x1b[' + lastLineCount + 'A\x1b[J');
            lastLineCount = lines.length;
            for (const l of lines) {
              const color = this._clsColor(l.cls);
              if (color) this._xterm.writeln(color + l.t + '\x1b[0m');
              else this._xterm.writeln(l.t);
            }
          }, 1000);
        } else {
          // Spinner for commands with no visible progress output
          const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
          let i = 0;
          this._xterm.write(frames[0]);
          iv = setInterval(() => { this._xterm.write('\r' + frames[++i % frames.length]); }, 80);
        }
        this._loadCancel = () => finish(true);
        setTimeout(() => finish(false), ms);
      });
    },
  };

  TERM_INSTANCES.push(inst);
  return inst;
}
