'use strict';
(function() {

  // ── Auth ───────────────────────────────────────────────────────────────────────────
  const authScreen  = document.getElementById('auth-screen');
  const desktopEl   = document.getElementById('desktop');
  const authTitle   = document.getElementById('auth-title');
  const authSubmit  = document.getElementById('auth-submit');
  const authError   = document.getElementById('auth-error');
  const authPassEl  = document.getElementById('auth-password');
  const authUserEl  = document.getElementById('auth-username');
  const authRegFields = document.getElementById('auth-register-fields');

  const storedUser = localStorage.getItem('hacklet_user');
  const storedHash = localStorage.getItem('hacklet_pass');
  const isFirstRun = !storedUser;

  if (isFirstRun) {
    authTitle.textContent = 'Create Account';
    authSubmit.textContent = 'Create Account';
    authRegFields.classList.remove('hidden');
  }

  function simpleHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(16);
  }

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function doAuth() {
    authError.classList.add('hidden');
    const pass = authPassEl.value;
    if (!pass) { showError('Password required'); return; }

    if (isFirstRun) {
      const user = authUserEl.value.trim();
      if (!user) { showError('Username required'); return; }
      localStorage.setItem('hacklet_user', user);
      localStorage.setItem('hacklet_pass', simpleHash(pass));
      _applyUser(user);
    } else {
      if (simpleHash(pass) !== storedHash) { showError('Incorrect password'); authPassEl.value = ''; return; }
      _applyUser(storedUser);
    }

    authScreen.style.opacity = '0';
    authScreen.style.transition = 'opacity 0.3s';
    setTimeout(async () => {
      authScreen.style.display = 'none';
      desktopEl.style.display = 'block';
      try {
        await loadLabs();
      } catch (e) {
        console.error('[RembrandtOS] Failed to load lab data:', e);
      }
      initDesktop();
    }, 300);
  }

  function _applyUser(user) {
    SIM.user = user;
    SIM.cwd  = '/home/' + user;
    const h = '/home/' + user;
    // Copy default home files from /home/rembrandt to the real user's home
    const defaults = ['/home/rembrandt/notes.txt', '/home/rembrandt/.bash_history'];
    for (const src of defaults) {
      const dest = src.replace('/home/rembrandt/', h + '/');
      if (!SIM.files[dest]) SIM.files[dest] = SIM.files[src] || '';
    }
    // Populate home subdirectory files
    SIM.files[h + '/Desktop/README.txt']                    = `Welcome to RembrandtOS 2024.2\nThis is your Desktop folder.`;
    SIM.files[h + '/Documents/credentials.txt']             = `# Credentials found during engagement\n# DO NOT SHARE\nadmin : ChangeMe123!`;
    SIM.files[h + '/Documents/network_notes.md']            = `# Network Notes\n## EternalBlue lab targets\n- 10.10.20.5  - Kali attack box (you)\n- 10.10.20.10 - WIN7-PC (Windows 7 SP1, SMB exposed)\n\n## Open Ports (WIN7-PC)\n- 135 RPC\n- 139 NetBIOS\n- 445 SMB (vulnerable to MS17-010)\n- 3389 RDP`;
    SIM.files[h + '/Documents/reports/pentest_report_draft.md'] = `# Penetration Test Report - DRAFT\n## Executive Summary\nA legacy Windows host was compromised via MS17-010 (EternalBlue), giving SYSTEM-level shell access.\n## Findings\n1. Unpatched SMBv1 on internal subnet\n2. No network segmentation between attack and victim subnets\n3. Sensitive documents stored on Administrator desktop`;
    SIM.files[h + '/Documents/reports/scope.txt']            = `# Engagement Scope\nClient: WORKGROUP / 10.10.20.0/24\nIP Range: 10.10.20.0/24\nKey target: 10.10.20.10 (WIN7-PC)\nStart: 2024-01-15\nEnd: 2024-01-22`;
    SIM.files[h + '/Documents/tools/nmap_cheatsheet.txt']    = `# Nmap Cheatsheet\nnmap -sn 10.10.20.0/24                                  # ping sweep\nnmap -sV -p- 10.10.20.10                                # full version scan\nnmap -p 445 --script smb-vuln-ms17-010 10.10.20.10      # ms17-010 check\nnmap --script vuln <ip>                                 # generic vuln scan`;
    SIM.files[h + '/Documents/tools/ad_attack_notes.txt']    = `# Windows Exploitation Notes\n## EternalBlue (MS17-010)\n1. Confirm SMBv1 is exposed on 445\n2. msfconsole -> use exploit/windows/smb/ms17_010_eternalblue\n3. set RHOSTS, set LHOST, exploit\n\n## Post-exploitation\n- hashdump for local SAM hashes\n- shell to drop into cmd.exe as SYSTEM`;
    SIM.files[h + '/Downloads/linpeas.sh']                   = `#!/bin/bash\n# linpeas.sh - Linux Privilege Escalation Awesome Script\necho "[+] Starting LinPEAS..."\necho "[+] System info:" && uname -a`;
    SIM.files[h + '/.ssh/known_hosts']                       = `10.10.10.10 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC...\n10.10.10.1 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY...`;
    SIM.files[h + '/.bashrc']                                = `# ~/.bashrc: executed by bash for non-login shells\nexport PATH="$HOME/.local/bin:$PATH"\nalias ll='ls -alF'\nalias la='ls -A'\nalias l='ls -CF'\nalias grep='grep --color=auto'\nalias ls='ls --color=auto'\nPS1='\\u@\\h:\\w\\$ '`;
    SIM.files[h + '/.bash_logout']                           = `# ~/.bash_logout: executed by bash when login shell exits\nclear`;
    SIM.files[h + '/.profile']                               = `# ~/.profile: executed by the command interpreter for login shells\nif [ -n "$BASH_VERSION" ]; then\n  if [ -f "$HOME/.bashrc" ]; then\n    . "$HOME/.bashrc"\n  fi\nfi\nif [ -d "$HOME/bin" ] ; then\n  PATH="$HOME/bin:$PATH"\nfi`;
    SIM.files[h + '/.zshrc']                                 = `# ~/.zshrc\nexport ZSH="$HOME/.oh-my-zsh"\nZSH_THEME="robbyrussell"\nplugins=(git)\nalias ll='ls -alF'\nalias grep='grep --color=auto'`;
    SIM.files[h + '/.msf4/history']                          = `use exploit/windows/smb/ms17_010_eternalblue\nset RHOSTS 10.10.10.10\nrun`;
    // Update /etc/passwd and /etc/group with real username
    SIM.files['/etc/passwd'] = `root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n${user}:x:1000:1000:${user},,,:/home/${user}:/bin/bash`;
    SIM.files['/etc/group']  = `root:x:0:\ndaemon:x:1:\nsudo:x:27:${user}\nadm:x:4:${user}\ncdrom:x:24:${user}\ndip:x:30:${user}\npluggdev:x:46:${user}\nnetdev:x:109:${user}\n${user}:x:1000:`;
    SIM.files['/etc/shadow'] = `root:!:19736:0:99999:7:::\ndaemon:*:19736:0:99999:7:::\n${user}:$6$rounds=656000$randomsalt$hashedpassword:19736:0:99999:7:::`;
    SIM.files['/etc/hostname'] = user === 'rembrandt' ? 'rembrandt' : user;
  }

  authSubmit.addEventListener('click', doAuth);
  authPassEl.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
  authUserEl.addEventListener('keydown', e => { if (e.key === 'Enter') authPassEl.focus(); });

  // focus correct field on load
  if (isFirstRun) authUserEl.focus(); else authPassEl.focus();

  // hover effect handled by Tailwind classes

  // ── Desktop ─────────────────────────────────────────────────────────────────
  function initDesktop() {
    const clockEl = document.getElementById('clock');
    function tick() {
      const n = new Date();
      clockEl.textContent = String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
    }
    tick(); setInterval(tick, 10000);

    CTF.init();

    document.getElementById('ctf-toggle-btn').addEventListener('click', () => {
      const sb = document.getElementById('ctf-sidebar');
      sb.classList.toggle('collapsed');
      const isOpen = !sb.classList.contains('collapsed');
      document.getElementById('ctf-toggle-btn').classList.toggle('active-btn', isOpen);
    });

    document.getElementById('fp-close').addEventListener('click', () => {
      document.getElementById('flag-popup').classList.add('hidden');
    });

    document.getElementById('an-close').addEventListener('click', () => {
      document.getElementById('app-notice').classList.add('hidden');
    });

    // Welcome modal — show once per session
    const welcomeModal = document.getElementById('welcome-modal');
    welcomeModal.classList.remove('hidden');

    // Carousel
    const slides = [...welcomeModal.querySelectorAll('.wc-slide')];
    const dots   = [...welcomeModal.querySelectorAll('.wc-dot')];
    const prevBtn = document.getElementById('wc-prev');
    const nextBtn = document.getElementById('wc-next');
    let current = 0;

    function wcGoto(n) {
      slides[current].style.display = 'none';
      dots[current].classList.remove('active');
      current = n;
      slides[current].style.display = 'block';
      dots[current].classList.add('active');
      prevBtn.disabled = current === 0;
      nextBtn.textContent = current === slides.length - 1 ? '✓' : '›';
    }

    prevBtn.addEventListener('click', () => { if (current > 0) wcGoto(current - 1); });
    nextBtn.addEventListener('click', () => {
      if (current < slides.length - 1) wcGoto(current + 1);
      else closeWelcome();
    });

    function closeWelcome() { welcomeModal.classList.add('hidden'); }
    document.getElementById('welcome-close').addEventListener('click', closeWelcome);
    document.getElementById('welcome-close-dot').addEventListener('click', closeWelcome);
    welcomeModal.addEventListener('click', e => { if (e.target === welcomeModal) closeWelcome(); });
    document.addEventListener('keydown', function onWelcomeEsc(e) {
      if (!welcomeModal.classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          closeWelcome();
        }
      }
    }, true);

    const appMenuBtn = document.getElementById('app-menu-btn');
    const appMenu    = document.getElementById('app-menu');
    const appMenuSearch = document.getElementById('app-menu-search');
    const appMenuCats   = document.getElementById('app-menu-cats');
    const appMenuApps   = document.getElementById('app-menu-apps');

    const AM_APPS = [
      { app:'terminal',   cat:'system',   icon:'fa fa-terminal',          iconBg:'#f1f5f9', iconColor:'#a78bfa', name:'Terminal',             desc:'Command line shell' },
      { app:'files',      cat:'system',   icon:'fa fa-folder',             iconBg:'#f1f5f9', iconColor:'#fbbf24', name:'Files',                desc:'File manager' },
      { app:'settings',   cat:'system',   icon:'fa fa-gear',               iconBg:'#f1f5f9', iconColor:'#94a3b8', name:'System Settings',      desc:'Configure your system' },
      { app:'browser',    cat:'internet', icon:'fa-brands fa-firefox',     iconBg:'#f1f5f9', iconColor:'#fb923c', name:'Firefox ESR',          desc:'Web browser' },
      { app:'burp',       cat:'security', icon:'fa fa-shield-halved',      iconBg:'#f1f5f9', iconColor:'#f97316', name:'Burp Suite Pro',       desc:'Web app security testing' },
      { app:'wireshark',  cat:'security', icon:'fa fa-wave-square',        iconBg:'#f1f5f9', iconColor:'#60a5fa', name:'Wireshark',            desc:'Network traffic analyzer' },
      { app:'metasploit', cat:'security', icon:'fa fa-skull',              iconBg:'#f1f5f9', iconColor:'#f87171', name:'Metasploit Framework', desc:'Exploitation framework' },
      { app:'ghidra',     cat:'security', icon:'fa fa-magnifying-glass',   iconBg:'#f1f5f9', iconColor:'#4ade80', name:'Ghidra',               desc:'Reverse engineering suite' },
      { app:'nmap',       cat:'security', icon:'fa fa-network-wired',      iconBg:'#f1f5f9', iconColor:'#a78bfa', name:'Zenmap',               desc:'Nmap GUI frontend' },
      { app:'vscode',     cat:'dev',      icon:'fa fa-code',               iconBg:'#f1f5f9', iconColor:'#38bdf8', name:'VS Code',              desc:'Code editor' },
      { app:'texteditor', cat:'dev',      icon:'fa fa-file-lines',         iconBg:'#f1f5f9', iconColor:'#94a3b8', name:'Text Editor',          desc:'Simple text editor' },
      { app:'calculator', cat:'dev',      icon:'fa fa-calculator',         iconBg:'#f1f5f9', iconColor:'#34d399', name:'Calculator',           desc:'Desktop calculator' },
    ];

    let amActiveCat = 'all';

    function amRender(filter) {
      const q = (filter || '').toLowerCase().trim();
      const list = AM_APPS.filter(a =>
        (amActiveCat === 'all' || a.cat === amActiveCat) &&
        (!q || a.name.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q))
      );
      appMenuApps.innerHTML = list.map(a => `
        <div class="am-app" data-app="${a.app}">
          <div class="am-app-icon" style="background:${a.iconBg}">
            <i class="${a.icon}" style="color:${a.iconColor}"></i>
          </div>
          <div class="am-app-info">
            <div class="am-app-name">${a.name}</div>
            <div class="am-app-desc">${a.desc}</div>
          </div>
        </div>`).join('');
      appMenuApps.querySelectorAll('.am-app').forEach(el => {
        el.addEventListener('click', () => {
          appMenu.classList.add('hidden');
          launchApp(el.dataset.app);
        });
      });
    }

    appMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      const opening = appMenu.classList.contains('hidden');
      appMenu.classList.toggle('hidden');
      if (opening) {
        appMenuSearch.value = '';
        amActiveCat = 'all';
        appMenuCats.querySelectorAll('.am-cat').forEach(c => c.classList.toggle('active', c.dataset.cat === 'all'));
        amRender('');
        setTimeout(() => appMenuSearch.focus(), 50);
      }
    });

    document.addEventListener('click', e => {
      if (!appMenu.contains(e.target) && e.target !== appMenuBtn) appMenu.classList.add('hidden');
    });

    appMenuSearch.addEventListener('input', () => amRender(appMenuSearch.value));
    appMenuSearch.addEventListener('click', e => e.stopPropagation());

    appMenuCats.querySelectorAll('.am-cat').forEach(cat => {
      cat.addEventListener('click', e => {
        e.stopPropagation();
        amActiveCat = cat.dataset.cat;
        appMenuCats.querySelectorAll('.am-cat').forEach(c => c.classList.toggle('active', c === cat));
        amRender(appMenuSearch.value);
      });
    });

    appMenu.querySelectorAll('.am-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        appMenu.classList.add('hidden');
        document.getElementById('app-notice').classList.remove('hidden');
      });
    });

    amRender('');

    // Desktop icons — single click selects, double-click opens
    document.querySelectorAll('.desk-icon').forEach(icon => {
      let clicks = 0, clickTimer;
      icon.addEventListener('click', () => {
        document.querySelectorAll('.desk-icon').forEach(i => i.classList.remove('selected'));
        icon.classList.add('selected');
        clicks++;
        if (clicks === 1) {
          clickTimer = setTimeout(() => { clicks = 0; }, 400);
        } else if (clicks >= 2) {
          clearTimeout(clickTimer); clicks = 0;
          launchApp(icon.dataset.app);
        }
      });
    });

    document.getElementById('wallpaper').addEventListener('click', () => {
      document.querySelectorAll('.desk-icon').forEach(i => i.classList.remove('selected'));
    });

    setTimeout(() => launchApp('terminal'), 400);
  }

  // ── Window management ─────────────────────────────────────────────────────
  let _zTop = 20;
  let _termCount = 0;

  function launchApp(appId) {
    if (appId === 'terminal') {
      openTerminalWindow();
    } else if (appId === 'files') {
      openFileManagerWindow();
    } else {
      document.getElementById('app-notice').classList.remove('hidden');
    }
  }

  function openTerminalWindow() {
    _termCount++;
    const label = _termCount === 1 ? '>_ Terminal' : `>_ Terminal ${_termCount}`;

    const win = createWindow('Terminal — ' + SIM.user + '@rembrandt', 720, 460, `
      <div class="term-tabs-bar"></div>
      <div class="term-panes"></div>
    `);

    const offset = (_termCount - 1) * 24;
    win.style.left = Math.max(20, (window.innerWidth - 720) / 2 - 140 + offset) + 'px';
    win.style.top  = Math.max(20, (window.innerHeight - 460) / 2 - 60 + offset) + 'px';

    const tabsBar  = win.querySelector('.term-tabs-bar');
    const panesDiv = win.querySelector('.term-panes');
    let tabSeq = 0;

    function addTab() {
      const tid = ++tabSeq;

      const tab = document.createElement('div');
      tab.className = 'term-tab active';
      tab.dataset.tid = tid;
      tab.innerHTML = `<span>bash</span><button class="term-tab-x" title="Close tab">×</button>`;

      const pane = document.createElement('div');
      pane.className = 'term-pane active';
      pane.dataset.tid = tid;

      // Deactivate existing tabs/panes, then insert new ones already active
      tabsBar.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
      panesDiv.querySelectorAll('.term-pane').forEach(p => p.classList.remove('active'));

      const plusBtn = tabsBar.querySelector('.term-new-tab');
      tabsBar.insertBefore(tab, plusBtn);
      panesDiv.appendChild(pane);

      // Pane is display:flex now — init terminal with correct dimensions
      const termInst = createTerminal();
      pane._termInst = termInst;
      termInst.init(pane);

      tab.addEventListener('click', e => {
        if (e.target.classList.contains('term-tab-x')) return;
        switchTab(tid);
      });
      tab.querySelector('.term-tab-x').addEventListener('click', e => {
        e.stopPropagation();
        closeTab(tid);
      });
    }

    function switchTab(tid) {
      tabsBar.querySelectorAll('.term-tab').forEach(t => t.classList.toggle('active', t.dataset.tid == tid));
      panesDiv.querySelectorAll('.term-pane').forEach(p => p.classList.toggle('active', p.dataset.tid == tid));
      const pane = panesDiv.querySelector(`.term-pane[data-tid="${tid}"]`);
      if (pane?._termInst) {
        requestAnimationFrame(() => { pane._termInst.fit(); pane._termInst.focus(); });
      }
    }

    function closeTab(tid) {
      const allTabs = [...tabsBar.querySelectorAll('.term-tab')];
      if (allTabs.length <= 1) { win.remove(); removeTaskbarBtn(win); return; }

      const tab  = tabsBar.querySelector(`.term-tab[data-tid="${tid}"]`);
      const pane = panesDiv.querySelector(`.term-pane[data-tid="${tid}"]`);
      const wasActive = tab.classList.contains('active');

      if (wasActive) {
        const idx = allTabs.indexOf(tab);
        const next = allTabs[idx + 1] || allTabs[idx - 1];
        if (next) switchTab(next.dataset.tid);
      }

      if (pane?._termInst) {
        const i = TERM_INSTANCES.indexOf(pane._termInst);
        if (i !== -1) TERM_INSTANCES.splice(i, 1);
      }
      tab.remove(); pane?.remove();
    }

    // + button
    const plusBtn = document.createElement('button');
    plusBtn.className = 'term-new-tab';
    plusBtn.title = 'New tab';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', addTab);
    tabsBar.appendChild(plusBtn);

    addTab();
    addTaskbarBtn(win, label);
  }

  // ── Virtual filesystem for file manager ───────────────────────────────────
  function fmGetDir(path) {
    const kh = '/home/' + SIM.user;
    const map = {
      '/': [
        { name: 'home', type: 'dir' },
        { name: 'root', type: 'dir' },
        { name: 'etc',  type: 'dir' },
        { name: 'tmp',  type: 'dir' },
        { name: 'usr',  type: 'dir' },
        { name: 'var',  type: 'dir' },
      ],
      '/home': [{ name: SIM.user, type: 'dir' }],
      [kh]: [
        { name: 'Desktop',   type: 'dir' },
        { name: 'Documents', type: 'dir' },
        { name: 'Downloads', type: 'dir' },
        { name: 'Music',     type: 'dir' },
        { name: 'Pictures',  type: 'dir' },
        { name: 'Videos',    type: 'dir' },
        { name: 'notes.txt', type: 'file' },
      ],
      [kh + '/Desktop']:   [],
      [kh + '/Documents']: [],
      [kh + '/Downloads']: [],
      [kh + '/Music']:     [],
      [kh + '/Pictures']:  [],
      [kh + '/Videos']:    [],
      '/root': [
        { name: 'notes.txt', type: 'file' },
      ],
      '/etc': [
        { name: 'hosts',      type: 'file' },
        { name: 'passwd',     type: 'file' },
        { name: 'os-release', type: 'file' },
      ],
      '/tmp': [],
      '/usr': [{ name: 'share', type: 'dir' }],
      '/usr/share': [{ name: 'wordlists', type: 'dir' }],
      '/usr/share/wordlists': [{ name: 'rockyou.txt', type: 'file' }],
      '/var': [{ name: 'log', type: 'dir' }],
      '/var/log': [],
    };
    return map[path] !== undefined ? map[path] : null;
  }

  function fmGetFileContent(path) {
    const all = {
      ...SIM.files,
      '/usr/share/wordlists/rockyou.txt': '# rockyou.txt — 14,341,564 passwords\n[file truncated for display]\npassword\n123456\npassword1\nletmein\nqwerty\n...',
    };
    return all[path] !== undefined ? all[path] : null;
  }

  // ── File manager window ───────────────────────────────────────────────────
  function openFileManagerWindow() {
    const startPath = SIM.user === 'root' ? '/root' : '/home/' + SIM.user;

    const win = createWindow('Files', 800, 520, `
      <div class="fm-window">
        <div class="fm-toolbar">
          <button class="fm-btn fm-back" title="Back">&#8249;</button>
          <button class="fm-btn fm-fwd"  title="Forward">&#8250;</button>
          <button class="fm-btn fm-up"   title="Parent directory">↑</button>
          <div class="fm-path-bar"></div>
          <button class="fm-btn fm-home-btn" title="Home"><i class="fa fa-house"></i></button>
        </div>
        <div class="fm-body">
          <nav class="fm-sidebar">
            <div class="fm-sidebar-label">Places</div>
            <div class="fm-sidebar-item" data-path="/home/" + SIM.user><i class="fa fa-house"></i> Home</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Desktop"><i class="fa fa-display"></i> Desktop</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Documents"><i class="fa fa-folder"></i> Documents</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Downloads"><i class="fa fa-arrow-down"></i> Downloads</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Music"><i class="fa fa-music"></i> Music</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Pictures"><i class="fa fa-image"></i> Pictures</div>
            <div class="fm-sidebar-item" data-path="/home/rembrandt/Videos"><i class="fa fa-film"></i> Videos</div>
            <div class="fm-sidebar-label">System</div>
            <div class="fm-sidebar-item" data-path="/"><i class="fa fa-server"></i> File System</div>
            <div class="fm-sidebar-item" data-path="/root"><i class="fa fa-user-shield"></i> Root</div>
            <div class="fm-sidebar-item" data-path="/etc"><i class="fa fa-gear"></i> /etc</div>
            <div class="fm-sidebar-item" data-path="/usr/share/wordlists"><i class="fa fa-list"></i> Wordlists</div>
          </nav>
          <div class="fm-content-area"></div>
        </div>
      </div>
    `);

    win.style.left = Math.max(20, (window.innerWidth  - 800) / 2 - 100) + 'px';
    win.style.top  = Math.max(20, (window.innerHeight - 520) / 2 -  60) + 'px';

    const pathBar     = win.querySelector('.fm-path-bar');
    const contentArea = win.querySelector('.fm-content-area');
    const backBtn     = win.querySelector('.fm-back');
    const fwdBtn      = win.querySelector('.fm-fwd');
    const upBtn       = win.querySelector('.fm-up');
    const homeBtn     = win.querySelector('.fm-home-btn');
    const sidebar     = win.querySelector('.fm-sidebar');

    let hist    = [startPath];
    let histIdx = 0;

    function isRootOnly(path) {
      return path === '/root' || path.startsWith('/root/');
    }

    function navigate(path) {
      if (isRootOnly(path) && SIM.user !== 'root') {
        contentArea.innerHTML = `
          <div class="fm-perm-denied">
            <i class="fa fa-lock fm-lock-icon"></i>
            <div>
              <h3>Permission Denied</h3>
              <p>You don't have permission to access <code>/root</code>.<br>
              Authenticate as root first: run <code>sudo su</code> in a terminal,<br>
              then re-open Files.</p>
            </div>
          </div>`;
        return;
      }
      if (hist[histIdx] === path) return;
      hist = hist.slice(0, histIdx + 1);
      hist.push(path);
      histIdx = hist.length - 1;
      render();
    }

    function render() {
      const path = hist[histIdx];
      pathBar.textContent = path;
      backBtn.disabled = histIdx === 0;
      fwdBtn.disabled  = histIdx === hist.length - 1;
      upBtn.disabled   = path === '/';

      sidebar.querySelectorAll('.fm-sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.path === path);
      });

      const items = fmGetDir(path);
      contentArea.innerHTML = '';

      if (items === null) {
        contentArea.innerHTML = '<div class="fm-empty"><i class="fa fa-circle-exclamation"></i> Directory not found</div>';
        return;
      }
      if (items.length === 0) {
        contentArea.innerHTML = '<div class="fm-empty"><i class="fa fa-folder-open"></i> Empty folder</div>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'fm-grid';

      const sorted = [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      sorted.forEach(item => {
        const el = document.createElement('div');
        el.className = 'fm-item';
        el.innerHTML = `
          <div class="fm-item-icon">${fmIcon(item)}</div>
          <div class="fm-item-name">${esc(item.name)}</div>
        `;
        el.addEventListener('click', () => {
          contentArea.querySelectorAll('.fm-item').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
        });
        el.addEventListener('dblclick', () => {
          if (item.type === 'dir') {
            const child = path === '/' ? '/' + item.name : path + '/' + item.name;
            navigate(child);
          } else {
            const filePath = path === '/' ? '/' + item.name : path + '/' + item.name;
            openFile(filePath, item.name);
          }
        });
        grid.appendChild(el);
      });

      contentArea.appendChild(grid);
    }

    function openFile(filePath, name) {
      const content = fmGetFileContent(filePath);
      if (content === null) {
        contentArea.innerHTML = '<div class="fm-empty"><i class="fa fa-ban"></i> Cannot read file</div>';
        return;
      }
      contentArea.innerHTML = `
        <div class="fm-file-view">
          <div class="fm-file-header">
            <button class="fm-btn fm-file-back" title="Back to folder"><i class="fa fa-arrow-left"></i></button>
            <span class="fm-file-icon-sm">${fmIconSm(name)}</span>
            <span class="fm-file-title">${esc(name)}</span>
          </div>
          <pre class="fm-file-content">${esc(content)}</pre>
        </div>
      `;
      contentArea.querySelector('.fm-file-back').addEventListener('click', render);
    }

    function fmIcon(item) {
      if (item.type === 'dir') {
        const map = {
          Desktop: '🖥', Documents: '📄', Downloads: '⬇️', Music: '🎵',
          Pictures: '🖼', Videos: '🎬', home: '🏠', root: '🔒',
          rembrandt: '👤', etc: '⚙️', tmp: '📂', usr: '📂', var: '📂',
          share: '📂', wordlists: '📋', log: '📋',
        };
        return `<span class="fm-icon-emoji">${map[item.name] || '📁'}</span>`;
      }
      if (item.name.endsWith('.hash')) {
        return '<span class="fm-icon-emoji">🔑</span>';
      }
      if (item.name.endsWith('.txt')) return '<span class="fm-icon-emoji">📝</span>';
      if (item.name === 'rockyou.txt')  return '<span class="fm-icon-emoji">📋</span>';
      return '<span class="fm-icon-emoji">📄</span>';
    }

    function fmIconSm(name) {
      if (name.endsWith('.txt'))        return '📝';
      return '📄';
    }

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    backBtn.addEventListener('click', () => { if (histIdx > 0) { histIdx--; render(); } });
    fwdBtn.addEventListener('click',  () => { if (histIdx < hist.length - 1) { histIdx++; render(); } });
    upBtn.addEventListener('click',   () => {
      const p = hist[histIdx];
      const parent = p.lastIndexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : '/';
      navigate(parent);
    });
    homeBtn.addEventListener('click', () => navigate('/home/' + SIM.user));
    sidebar.querySelectorAll('.fm-sidebar-item').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.path));
    });

    render();
    addTaskbarBtn(win, '📁 Files');
  }

  // ── Window chrome ─────────────────────────────────────────────────────────
  function createWindow(title, w, h, bodyHTML) {
    const win = document.createElement('div');
    win.className = 'window focused';
    win.style.width  = w + 'px';
    win.style.height = h + 'px';
    win.style.zIndex = ++_zTop;

    win.innerHTML = `
      <div class="win-titlebar">
        <span class="win-dot win-dot-red"></span>
        <span class="win-dot win-dot-yellow"></span>
        <span class="win-dot win-dot-green"></span>
        <span class="win-title">${title}</span>
      </div>
      <div class="win-body">${bodyHTML}</div>
    `;

    win._savedW = w; win._savedH = h;

    document.getElementById('windows').appendChild(win);
    makeDraggable(win, win.querySelector('.win-titlebar'));

    win.addEventListener('mousedown', () => {
      if (!win.classList.contains('minimized')) focusWindow(win);
    });

    win.querySelector('.win-dot-red').addEventListener('click', e => {
      e.stopPropagation();
      win.remove();
      removeTaskbarBtn(win);
    });

    win.querySelector('.win-dot-yellow').addEventListener('click', e => {
      e.stopPropagation();
      minimizeWindow(win);
    });

    win.querySelector('.win-dot-green').addEventListener('click', e => {
      e.stopPropagation();
      toggleMaximize(win);
    });

    win.querySelector('.win-titlebar').addEventListener('dblclick', e => {
      if (e.target.classList.contains('win-dot')) return;
      toggleMaximize(win);
    });

    return win;
  }

  function focusWindow(win) {
    if (win.classList.contains('minimized')) { unminimizeWindow(win); return; }
    document.querySelectorAll('.window').forEach(w => w.classList.remove('focused'));
    win.classList.add('focused');
    win.style.zIndex = ++_zTop;
    document.querySelectorAll('.tb-win-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tb-win-btn[data-win="${win.dataset.winId}"]`);
    if (btn) btn.classList.add('active');
    const activePane = win.querySelector('.term-pane.active');
    if (activePane?._termInst) activePane._termInst.focus();
    else { const inp = win.querySelector('.term-input'); if (inp) inp.focus(); }
  }

  function minimizeWindow(win) {
    win.classList.add('minimized');
    win.classList.remove('focused');
    const btn = document.querySelector(`.tb-win-btn[data-win="${win.dataset.winId}"]`);
    if (btn) btn.classList.remove('active');
  }

  function unminimizeWindow(win) {
    win.classList.remove('minimized');
    win.style.zIndex = ++_zTop;
    document.querySelectorAll('.window').forEach(w => w.classList.remove('focused'));
    win.classList.add('focused');
    document.querySelectorAll('.tb-win-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tb-win-btn[data-win="${win.dataset.winId}"]`);
    if (btn) btn.classList.add('active');
    const activePane2 = win.querySelector('.term-pane.active');
    if (activePane2?._termInst) activePane2._termInst.focus();
    else { const inp = win.querySelector('.term-input'); if (inp) inp.focus(); }
  }

  function toggleMaximize(win) {
    if (win.classList.contains('maximized')) {
      win.style.width  = (win._savedW || 720) + 'px';
      win.style.height = (win._savedH || 460) + 'px';
      win.style.left   = win._savedLeft || '20px';
      win.style.top    = win._savedTop  || '20px';
      win.classList.remove('maximized');
    } else {
      win._savedLeft = win.style.left;
      win._savedTop  = win.style.top;
      win._savedW    = parseInt(win.style.width)  || win._savedW || 720;
      win._savedH    = parseInt(win.style.height) || win._savedH || 460;
      win.style.left   = '0px';
      win.style.top    = '0px';
      win.style.width  = '100%';
      win.style.height = 'calc(100% - 48px)';
      win.classList.add('maximized');
    }
    focusWindow(win);
    setTimeout(() => {
      win.querySelectorAll('.term-pane').forEach(p => { if (p._termInst) p._termInst.fit(); });
    }, 50);
  }

  let _winIdSeq = 0;
  function addTaskbarBtn(win, label) {
    const id = 'win-' + (++_winIdSeq);
    win.dataset.winId = id;
    const btn = document.createElement('button');
    btn.className = 'tb-win-btn active';
    btn.dataset.win = id;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (!document.body.contains(win)) return;
      if (win.classList.contains('minimized')) {
        unminimizeWindow(win);
      } else if (win.classList.contains('focused')) {
        minimizeWindow(win);
      } else {
        focusWindow(win);
      }
    });
    document.getElementById('taskbar-windows').appendChild(btn);
  }

  function removeTaskbarBtn(win) {
    const id  = win.dataset.winId;
    const btn = document.querySelector(`.tb-win-btn[data-win="${id}"]`);
    if (btn) btn.remove();
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  function makeDraggable(win, handle) {
    let sx, sy, sl, st;
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('win-dot')) return;
      if (win.classList.contains('maximized')) return;
      sx = e.clientX; sy = e.clientY;
      sl = win.offsetLeft; st = win.offsetTop;
      function onMove(e) {
        win.style.left = Math.max(0, sl + e.clientX - sx) + 'px';
        win.style.top  = Math.max(0, st + e.clientY - sy) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

})();
