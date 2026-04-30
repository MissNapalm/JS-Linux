'use strict';
(function() {

  const BOOT_LINES = [
    '[    0.000000] Linux version 6.6.9-amd64 (debian-kernel@lists.debian.org)',
    '[    0.001234] BIOS-provided physical RAM map:',
    '[    0.234512] ACPI: RSDP 0x00000000000F0490 000024 (v02 BOCHS)',
    '[    0.891203] PCI: Using configuration type 1 for base access',
    '[    1.453211] Initializing cgroup subsys cpuset',
    '[    1.823401] NET: Registered PF_INET6 protocol family',
    '[    2.102341] SCSI subsystem initialized',
    '[    3.001923] EXT4-fs (sda1): mounted filesystem with ordered data mode',
    '[    3.234512] systemd[1]: Detected virtualization kvm.',
    '[    3.567891] systemd[1]: Starting kali-linux.service...',
    '[    4.123401] Starting Network Manager...',
    '[    4.567234] eth0: renamed from veth9c8b2e1',
    '[    4.789012] IPv6: ADDRCONF(NETDEV_CHANGE): eth0: link becomes ready',
    '[    5.012345] systemd[1]: Started OpenBSD Secure Shell server.',
    '[    5.234567] systemd[1]: Reached target Multi-User System.',
    '[    5.400000] kali login: ',
  ];

  // ── Boot ──────────────────────────────────────────────────────────────────
  const bootEl    = document.getElementById('boot');
  const bootLogEl = document.getElementById('boot-log');
  const bootBarEl = document.getElementById('boot-bar');
  const loginEl   = document.getElementById('login');
  const desktopEl = document.getElementById('desktop');

  let msgIdx = 0, progress = 0;
  const iv = setInterval(() => {
    if (msgIdx < BOOT_LINES.length) bootLogEl.textContent += BOOT_LINES[msgIdx++] + '\n';
    progress = Math.min(100, progress + 100 / BOOT_LINES.length);
    bootBarEl.style.width = progress + '%';
    if (progress >= 100) {
      clearInterval(iv);
      setTimeout(() => {
        bootEl.style.opacity = '0'; bootEl.style.transition = 'opacity 0.4s';
        setTimeout(() => {
          bootEl.style.display = 'none';
          loginEl.classList.remove('hidden');
          document.getElementById('login-pass').focus();
        }, 400);
      }, 300);
    }
  }, 120);

  // ── Login ─────────────────────────────────────────────────────────────────
  function doLogin() {
    loginEl.style.opacity = '0'; loginEl.style.transition = 'opacity 0.35s';
    setTimeout(() => {
      loginEl.style.display = 'none';
      desktopEl.classList.remove('hidden');
      initDesktop();
    }, 350);
  }
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // ── Desktop ───────────────────────────────────────────────────────────────
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

    const appMenuBtn = document.getElementById('app-menu-btn');
    const appMenu    = document.getElementById('app-menu');
    appMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      appMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => appMenu.classList.add('hidden'));
    appMenu.querySelectorAll('.app-menu-item').forEach(el => {
      el.addEventListener('click', () => {
        appMenu.classList.add('hidden');
        launchApp(el.dataset.app);
      });
    });

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

    const win = createWindow('Terminal — kali@kali', 720, 460, `
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
    const kh = '/home/kali';
    const hashes = SIM.hashesOnDisk ? [{ name: 'hashes.kerberoast', type: 'file' }] : [];
    const map = {
      '/': [
        { name: 'home', type: 'dir' },
        { name: 'root', type: 'dir' },
        { name: 'etc',  type: 'dir' },
        { name: 'tmp',  type: 'dir' },
        { name: 'usr',  type: 'dir' },
        { name: 'var',  type: 'dir' },
      ],
      '/home': [{ name: 'kali', type: 'dir' }],
      [kh]: [
        { name: 'Desktop',   type: 'dir' },
        { name: 'Documents', type: 'dir' },
        { name: 'Downloads', type: 'dir' },
        { name: 'Music',     type: 'dir' },
        { name: 'Pictures',  type: 'dir' },
        { name: 'Videos',    type: 'dir' },
        { name: 'notes.txt', type: 'file' },
        ...hashes,
      ],
      [kh + '/Desktop']:   [],
      [kh + '/Documents']: [],
      [kh + '/Downloads']: [],
      [kh + '/Music']:     [],
      [kh + '/Pictures']:  [],
      [kh + '/Videos']:    [],
      '/root': [
        { name: 'notes.txt', type: 'file' },
        ...hashes,
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
    const extras = SIM.hashesOnDisk ? {
      '/home/kali/hashes.kerberoast': KRB5_HASHES,
      '/root/hashes.kerberoast': KRB5_HASHES,
    } : {};
    const all = {
      ...SIM.files,
      ...extras,
      '/usr/share/wordlists/rockyou.txt': '# rockyou.txt — 14,341,564 passwords\n[file truncated for display]\npassword\n123456\npassword1\nPassword1!\nBackup2023!\nletmein\nqwerty\n...',
    };
    return all[path] !== undefined ? all[path] : null;
  }

  // ── File manager window ───────────────────────────────────────────────────
  function openFileManagerWindow() {
    const startPath = SIM.user === 'root' ? '/root' : '/home/kali';

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
            <div class="fm-sidebar-item" data-path="/home/kali"><i class="fa fa-house"></i> Home</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Desktop"><i class="fa fa-display"></i> Desktop</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Documents"><i class="fa fa-folder"></i> Documents</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Downloads"><i class="fa fa-arrow-down"></i> Downloads</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Music"><i class="fa fa-music"></i> Music</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Pictures"><i class="fa fa-image"></i> Pictures</div>
            <div class="fm-sidebar-item" data-path="/home/kali/Videos"><i class="fa fa-film"></i> Videos</div>
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
          kali: '👤', etc: '⚙️', tmp: '📂', usr: '📂', var: '📂',
          share: '📂', wordlists: '📋', log: '📋',
        };
        return `<span class="fm-icon-emoji">${map[item.name] || '📁'}</span>`;
      }
      if (item.name.endsWith('.kerberoast') || item.name.endsWith('.hash')) {
        return '<span class="fm-icon-emoji">🔑</span>';
      }
      if (item.name.endsWith('.txt')) return '<span class="fm-icon-emoji">📝</span>';
      if (item.name === 'rockyou.txt')  return '<span class="fm-icon-emoji">📋</span>';
      return '<span class="fm-icon-emoji">📄</span>';
    }

    function fmIconSm(name) {
      if (name.endsWith('.kerberoast')) return '🔑';
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
    homeBtn.addEventListener('click', () => navigate('/home/kali'));
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
