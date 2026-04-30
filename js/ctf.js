'use strict';

const CTF_CHALLENGES = [
  {
    id: 1, title: 'Port Scan the DC', pts: 100,
    flag: 'FLAG{dc01_discovered_ports_445_88_389}',
    hint: 'sudo nmap -sV -sC -p- 10.10.10.10',
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

const CTF = {
  challenges: CTF_CHALLENGES,

  _loadState() {
    try {
      const s = JSON.parse(localStorage.getItem('ctf_state') || '{}');
      this.challenges.forEach(c => { if (s[c.id]) c.done = true; });
    } catch {}
  },

  _saveState() {
    const s = {};
    this.challenges.forEach(c => { if (c.done) s[c.id] = true; });
    localStorage.setItem('ctf_state', JSON.stringify(s));
  },

  score()    { return this.challenges.filter(c => c.done).reduce((a, c) => a + c.pts, 0); },
  maxScore() { return this.challenges.reduce((a, c) => a + c.pts, 0); },
  doneCount(){ return this.challenges.filter(c => c.done).length; },

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
    localStorage.removeItem('ctf_state');
    SIM.hashesOnDisk = false;
    SIM.windowsShell = false;
    SIM.lootExfiltrated = false;
    SIM.user = 'kali';
    SIM.cwd  = '/home/capy';
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
          : `<div class="ctf-hint-row"><span class="ctf-hint">${c.hint}</span><button class="ctf-copy-btn" data-cmd="${c.hint.replace(/"/g,'&quot;')}" title="Copy command"><i class="fa fa-copy"></i></button></div>`}
      </div>`
    ).join('');

    // Attach explain click handlers
    list.querySelectorAll('.ctf-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.ctf-copy-btn')) return;
        const cid = parseInt(el.dataset.cid);
        const ch  = this.challenges.find(c => c.id === cid);
        if (ch) this._showExplain(ch);
      });
    });

    // Attach copy handlers
    list.querySelectorAll('.ctf-copy-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.cmd).then(() => {
          btn.innerHTML = '<i class="fa fa-check"></i>';
          setTimeout(() => { btn.innerHTML = '<i class="fa fa-copy"></i>'; }, 1500);
        });
      });
    });
  },

  _showExplain(ch) {
    document.getElementById('ctf-explain-num').textContent   = ch.id;
    document.getElementById('ctf-explain-title').textContent = ch.title;
    document.getElementById('ctf-explain-text').textContent  = ch.explain;
    document.getElementById('ctf-explain-hint').textContent  = ch.hint;
    const copyBtn = document.getElementById('ctf-explain-copy');
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(ch.hint).then(() => {
        copyBtn.innerHTML = '<i class="fa fa-check"></i> Copied';
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa fa-copy"></i> Copy'; }, 1500);
      });
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

    document.getElementById('ctf-reset-btn').addEventListener('click', () => {
      if (confirm('Reset all CTF progress?')) this.reset();
    });

    // Explanation modal close
    const closeExplain = () => document.getElementById('ctf-explain-modal').classList.add('hidden');
    document.getElementById('ctf-explain-close').addEventListener('click', closeExplain);
    document.getElementById('ctf-explain-ok').addEventListener('click', closeExplain);
    document.getElementById('ctf-explain-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('ctf-explain-modal')) closeExplain();
    });

    // CTF sidebar close button
    document.getElementById('ctf-close-btn')?.addEventListener('click', () => {
      document.getElementById('ctf-sidebar').classList.add('collapsed');
    });
  },
};
