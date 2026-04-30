'use strict';

const CTF_CHALLENGES = [
  {
    id: 1, title: 'Port Scan the DC', pts: 100,
    flag: 'FLAG{dc01_discovered_ports_445_88_389}',
    hint: 'sudo nmap -sV -sC -p- 10.10.10.10',
    explain: 'Nmap (Network Mapper) is the industry-standard port scanner used on every pentest. The -sV flag probes each open port to fingerprint the exact service and version. -sC runs built-in NSE (Nmap Scripting Engine) scripts that extract OS details, SSL certs, and SMB info automatically. -p- tells Nmap to scan all 65,535 TCP ports instead of just the default top 1,000 — many services hide on non-standard ports. On a Domain Controller the results are unmistakable: port 88 (Kerberos authentication), 389/636 (LDAP directory), 445 (SMB file sharing), and 3268 (Global Catalog) together are the fingerprint of a Windows AD DC. Without this scan we would not know the DC\'s IP or which attack surface exists.',
    done: false,
    check: r => r.id === 'nmap-full',
  },
  {
    id: 2, title: 'SMB Enumeration', pts: 100,
    flag: 'FLAG{corp_local_domain_enumerated}',
    hint: 'enum4linux -a 10.10.10.10',
    explain: 'enum4linux is a Linux tool that extracts information from Windows machines via the SMB and RPC protocols without needing a password. Older Windows servers allowed "null sessions" — anonymous connections that let anyone query user lists, group memberships, shared folder names, and the domain password policy. The password policy is critical intel: knowing the lockout threshold (5 attempts here) tells us we can spray up to 4 passwords per account without locking anyone out. The username list we collect — john.doe, svc_backup, svc_sql, svc_web — becomes our entire target list for the rest of the attack chain.',
    done: false,
    check: r => r.id === 'enum4linux',
  },
  {
    id: 3, title: 'Validate Credentials', pts: 150,
    flag: 'FLAG{john_doe_authenticated_smb}',
    hint: "crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'",
    explain: 'CrackMapExec (CME) is an Active Directory swiss-army knife written in Python. It speaks the SMB protocol natively, exactly as Windows does when you authenticate to a network share. When we supply john.doe\'s credentials (found in notes.txt on the workstation), CME sends an NTLM authentication challenge to the DC and reads the response. A [+] response means the Domain Controller accepted those credentials as valid. This confirms our first real foothold — a legitimate domain account we can use to query Active Directory. CME can also spray one password across all discovered accounts simultaneously to find more footholds without triggering lockouts.',
    done: false,
    check: r => r.id === 'cme-johndoe',
  },
  {
    id: 4, title: 'Find SPNs', pts: 200,
    flag: 'FLAG{3_spns_found_svc_backup_svc_sql_svc_web}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10",
    explain: 'A Service Principal Name (SPN) is a unique identifier that ties a specific service — SQL Server, a web app, a backup agent — to the domain account running it. Active Directory uses SPNs so Kerberos knows which account to issue a service ticket for. The critical design flaw: any authenticated domain user can query the entire directory for all registered SPNs, with no admin rights required. We use john.doe\'s credentials to list every service account in the domain. The accounts svc_backup, svc_sql, and svc_web are now our Kerberoasting targets — because requesting a Kerberos ticket for their service causes the DC to encrypt that ticket with each account\'s password hash.',
    done: false,
    check: r => r.id === 'spns-enum',
  },
  {
    id: 5, title: 'Request TGS Tickets', pts: 250,
    flag: 'FLAG{tgs_tickets_captured_rc4_etype23}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10 -request -outputfile hashes.kerberoast",
    explain: 'This is the Kerberoasting attack itself, first demonstrated publicly by Tim Medin at DerbyCon 2014. When any domain user requests a Kerberos TGS (Ticket Granting Service) ticket for an SPN, the DC encrypts that ticket blob using the service account\'s NTLM hash as the key. Critically, the default encryption is RC4-HMAC (etype 23) — a relatively weak cipher. We request tickets for all three SPN accounts and save them to a file with -outputfile. The attack is entirely offline from here: we never touch the DC again while cracking. This generates zero logon events in the SIEM because issuing TGS tickets is normal, expected DC behavior.',
    done: false,
    check: r => r.id === 'spns-request',
  },
  {
    id: 6, title: 'Crack TGS Hashes', pts: 300,
    flag: 'FLAG{svc_backup_cracked_Backup2023}',
    hint: 'john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt',
    explain: 'John the Ripper is an offline password cracker. "Offline" is the key word — we have the hash and never need to contact the DC again. John loads the Kerberos ticket blobs, extracts the encrypted portion, and for every candidate in rockyou.txt, computes what the ticket would look like if that were the password. When the computed result matches the captured blob, the password is found. rockyou.txt contains 14.3 million real passwords leaked from the 2009 RockYou data breach — meaning real users actually chose these. Service accounts like svc_backup are often configured once by a sysadmin and never rotated, so weak passwords like "Backup2023!" survive for years. A modern GPU can test billions of RC4 hashes per second.',
    done: false,
    check: r => r.id === 'john-crack' || r.id === 'hashcat',
  },
  {
    id: 7, title: 'Validate svc_backup', pts: 200,
    flag: 'FLAG{svc_backup_backup_operators_group}',
    hint: "crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'",
    explain: "CME confirms the cracked password is valid. But the critical detail is what appears next to it: svc_backup is in the Backup Operators group. This is a built-in Windows group Microsoft created for backup software agents — its members can read any file on the system, regardless of normal permissions, via SeBackupPrivilege. This was designed so backup agents could read locked system files. Attackers abuse it because Backup Operators can read C:\\Windows\\NTDS\\NTDS.dit — the Active Directory database — and the SYSTEM registry hive needed to decrypt it. One service account password unlocks the entire domain.",
    done: false,
    check: r => r.id === 'cme-svcbackup',
  },
  {
    id: 8, title: 'Dump NTDS.dit', pts: 400,
    flag: 'FLAG{ntds_dumped_all_domain_hashes}',
    hint: "impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10",
    explain: "NTDS.dit is the Active Directory database stored on every DC at C:\\Windows\\NTDS\\NTDS.dit. It contains the NT hashes, Kerberos keys, password history, and metadata for every single account in the domain — including Administrator and every service account. impacket-secretsdump connects with svc_backup's privileges, requests a Volume Shadow Copy (VSS) snapshot to bypass the file lock, then uses the DRSUAPI directory replication protocol to stream all credentials remotely. In a real enterprise with 5,000 users this dump contains 5,000 hashes — all instantly usable for Pass-the-Hash without cracking a single one.",
    done: false,
    check: r => r.id === 'secretsdump',
  },
  {
    id: 9, title: 'Pass-the-Hash', pts: 350,
    flag: 'FLAG{administrator_pth_pwn3d}',
    hint: 'crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889',
    explain: "Pass-the-Hash (PtH) exploits a fundamental property of NTLM authentication: the client never sends the actual password — it sends the NT hash as the proof of identity via a challenge-response exchange. Windows has no way to distinguish 'I know the password' from 'I have the hash.' This was documented as a practical attack in 1997 by Paul Ashton. We take Administrator's NT hash (fc525c...) directly from the secretsdump output and pass it to CME with the -H flag. The [+] Pwn3d! response confirms full Domain Admin access — without ever knowing or cracking the Administrator password.",
    done: false,
    check: r => r.id === 'cme-pth',
  },
  {
    id: 10, title: 'SYSTEM Shell', pts: 500,
    flag: 'FLAG{dc01_compromised_nt_authority_system}',
    hint: 'impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 CORP.LOCAL/Administrator@10.10.10.10',
    explain: "impacket-psexec implements the same technique as Microsoft's own Sysinternals PsExec tool. It authenticates to the ADMIN$ share using the Administrator hash, uploads a randomly-named service executable (XGaHpFZv.exe here), registers it with the Windows Service Control Manager (SCM), starts it, and pipes its I/O back over SMB. The result is an interactive shell running as NT AUTHORITY\\SYSTEM — the highest privilege level on Windows, above even Administrator. SYSTEM is the internal OS account: it cannot be locked out, has no password to change, and can access every process, file, and registry key. The domain is fully compromised.",
    done: false,
    check: r => r.id === 'psexec',
  },
  {
    id: 11, title: 'Exfiltrate Loot', pts: 500,
    flag: 'FLAG{23452_customers_pwned_pci_dss_breach_confirmed}',
    hint: 'dir C:\\CORP_DATA  (then: type C:\\CORP_DATA\\Customer\\Credit_Card_Database.csv)',
    explain: "Domain Controllers are frequently misused as general-purpose file servers in small and mid-size companies — 'it's already the most powerful server.' This is catastrophic: a DC compromise, which we just demonstrated through a chain of misconfigurations, gives attackers access to everything stored there. The Credit_Card_Database.csv contains 23,452 records with full PANs (card numbers), CVV codes, expiry dates, and SSNs — a textbook PCI-DSS breach. Under PCI-DSS regulations, each record carries potential fines. Under GDPR and CCPA, this triggers mandatory breach notification. Real-world parallels include the 2020 SolarWinds compromise, where DC-level access enabled months of silent exfiltration across multiple government agencies before anyone noticed.",
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
          : `<div class="ctf-hint">${c.hint}</div>`}
      </div>`
    ).join('');

    // Attach explain click handlers
    list.querySelectorAll('.ctf-item').forEach(el => {
      el.addEventListener('click', () => {
        const cid = parseInt(el.dataset.cid);
        const ch  = this.challenges.find(c => c.id === cid);
        if (ch) this._showExplain(ch);
      });
    });
  },

  _showExplain(ch) {
    document.getElementById('ctf-explain-num').textContent   = ch.id;
    document.getElementById('ctf-explain-title').textContent = ch.title;
    document.getElementById('ctf-explain-text').textContent  = ch.explain;
    document.getElementById('ctf-explain-hint').textContent  = ch.hint;
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
