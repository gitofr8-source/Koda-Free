/* ==========================================================================
   KODA AI — Pure AMOLED & Light Mode Theme Engine
   Supported Themes: Pure AMOLED (100% OLED pitch-black) • Light Mode
   ========================================================================== */

(function() {
  'use strict';

  // 1. Theme Registry: Strictly Pure AMOLED and Light Mode
  window.KODA_THEMES = {
    amoled: {
      id: 'amoled',
      name: 'Pure AMOLED',
      type: 'dark',
      desc: '100% pitch-black for pure OLED battery efficiency & maximum contrast',
      previewBg: '#000000',
      previewSurface: '#0d0d0d',
      previewBorder: '#333333',
      previewText: '#ffffff',
      previewAccent: '#ffffff',
      previewSecondary: '#d4d4d4',
      statusBar: '#000000',
      statusStyle: 'DARK'
    },
    light: {
      id: 'light',
      name: 'Light Mode',
      type: 'light',
      desc: 'Clean off-white backgrounds, crisp cards, dark typography & high clarity',
      previewBg: '#f8fafc',
      previewSurface: '#ffffff',
      previewBorder: '#cbd5e1',
      previewText: '#0f172a',
      previewAccent: '#0f172a',
      previewSecondary: '#334155',
      statusBar: '#f8fafc',
      statusStyle: 'LIGHT'
    }
  };

  // Resolve stored preference (defaults to 'amoled')
  function resolveThemeId(raw) {
    if (raw === 'light' || raw === 'arctic') return 'light';
    return 'amoled'; // Default to Pure AMOLED for everything else
  }

  let currentThemeId = resolveThemeId(localStorage.getItem('koda_theme_id') || localStorage.getItem('koda_theme'));

  // 2. Apply Theme
  function applyTheme(themeId, enableTransition = true) {
    themeId = resolveThemeId(themeId);
    currentThemeId = themeId;

    if (enableTransition) {
      document.documentElement.classList.add('koda-theme-transition');
      setTimeout(() => {
        document.documentElement.classList.remove('koda-theme-transition');
      }, 250);
    }

    const cfg = window.KODA_THEMES[themeId];

    // Set root attributes and dark/light classes
    document.documentElement.setAttribute('data-theme', themeId);
    if (themeId === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }

    // Save preference
    localStorage.setItem('koda_theme_id', themeId);
    localStorage.setItem('koda_theme', themeId);

    // Update <meta name="theme-color">
    const metaColor = document.querySelector('meta[name="theme-color"]');
    if (metaColor) {
      metaColor.setAttribute('content', cfg.statusBar);
    }

    // Capacitor Native Android Status Bar Sync
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
      try {
        const { StatusBar } = window.Capacitor.Plugins;
        StatusBar.setBackgroundColor({ color: cfg.statusBar });
        StatusBar.setStyle({ style: cfg.statusStyle });
      } catch (_) {}
    }

    // Update Theme Studio active states if rendered
    updateThemeStudioUI();

    // Update Sun / Moon icon state
    updateThemeIcons(themeId);

    // Broadcast change
    window.dispatchEvent(new CustomEvent('koda-theme-changed', { detail: { themeId } }));
  }

  // Update Theme Toggle Icons (Sun for dark/amoled mode, Moon for light mode)
  function updateThemeIcons(themeId) {
    const isLight = (themeId === 'light' || document.documentElement.classList.contains('light'));
    document.querySelectorAll('#themeIconSun').forEach(el => {
      if (isLight) el.classList.add('hidden');
      else el.classList.remove('hidden');
    });
    document.querySelectorAll('#themeIconMoon').forEach(el => {
      if (isLight) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  }

  // Update Theme Studio Modal Cards
  function updateThemeStudioUI() {
    document.querySelectorAll('.theme-card-option').forEach(card => {
      const id = card.getAttribute('data-theme-id');
      if (id === currentThemeId) {
        card.classList.add('active-theme');
        const badge = card.querySelector('.theme-active-badge');
        if (badge) badge.classList.remove('hidden');
      } else {
        card.classList.remove('active-theme');
        const badge = card.querySelector('.theme-active-badge');
        if (badge) badge.classList.add('hidden');
      }
    });
  }

  // Render Theme Studio Modal Content (Exactly 2 themes: Pure AMOLED & Light Mode)
  function renderThemeStudio() {
    const container = document.getElementById('themeCardsContainer');
    if (!container) return;

    container.innerHTML = Object.values(window.KODA_THEMES).map(t => {
      const isActive = t.id === currentThemeId;
      return `
        <div class="theme-card-option ${isActive ? 'active-theme' : ''}" data-theme-id="${t.id}" onclick="window.KodaTheme.apply('${t.id}')">
          <div class="flex items-center justify-between">
            <span class="font-bold text-sm text-white">${t.name}</span>
            <span class="theme-active-badge ${isActive ? '' : 'hidden'} text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-emerald-400 font-semibold">Active</span>
          </div>
          <p class="text-[11px] text-[#949ba8] leading-relaxed mt-1">${t.desc}</p>
          <div class="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-white/10">
            <div class="w-5 h-5 rounded-md border border-white/20 shadow-sm" style="background-color: ${t.previewBg}" title="Background"></div>
            <div class="w-5 h-5 rounded-md border border-white/20 shadow-sm" style="background-color: ${t.previewSurface}" title="Surface"></div>
            <div class="w-5 h-5 rounded-md border border-white/20 shadow-sm" style="background-color: ${t.previewAccent}" title="Accent"></div>
            <div class="w-5 h-5 rounded-md border border-white/20 shadow-sm" style="background-color: ${t.previewSecondary}" title="Secondary"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Initialize immediately on load
  applyTheme(currentThemeId, false);

  // Wire into Navigation Bar & UI Buttons
  function wireNavButtons() {
    const toggleBtns = document.querySelectorAll('#themeToggle, .theme-toggle-btn, [data-action="toggle-theme"]');
    toggleBtns.forEach(btn => {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        window.toggleTheme();
      };
    });

    const settingsBtns = document.querySelectorAll('#themeSettingsBtn, .theme-settings-btn, [data-action="open-theme-studio"]');
    settingsBtns.forEach(btn => {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        window.openThemeModal();
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderThemeStudio();
      updateThemeStudioUI();
      wireNavButtons();
    });
  } else {
    renderThemeStudio();
    updateThemeStudioUI();
    wireNavButtons();
  }

  // Cross-tab sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'koda_theme_id' || e.key === 'koda_theme') {
      const newTheme = resolveThemeId(localStorage.getItem('koda_theme_id') || localStorage.getItem('koda_theme'));
      if (newTheme !== currentThemeId) {
        applyTheme(newTheme, true);
      }
    }
  });

  // Public Interface
  window.KodaTheme = {
    apply: applyTheme,
    getCurrent: () => currentThemeId,
    renderStudio: renderThemeStudio
  };

  // Quick Toggle between Light Mode and Pure AMOLED
  window.toggleTheme = function() {
    const next = currentThemeId === 'amoled' ? 'light' : 'amoled';
    applyTheme(next, true);
  };

  function ensureThemeModalHtml() {
    let m = document.getElementById('themeModal');
    if (m) return m;

    m = document.createElement('div');
    m.id = 'themeModal';
    m.className = 'hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4';
    m.innerHTML = `
      <div class="panel p-5 sm:p-6 w-[95vw] max-w-lg rounded-3xl shadow-2xl relative max-h-[90vh] overflow-hidden flex flex-col border border-[var(--border)] bg-[var(--panel)]">
        <div class="flex items-center justify-between pb-3.5 border-b border-[var(--border-muted)]">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            </div>
            <div>
              <b class="text-base text-white block leading-tight">Theme Settings</b>
              <span class="text-[11px] text-[#949ba8]">Choose between Pure AMOLED and Light Mode</span>
            </div>
          </div>
          <button class="btn !p-1.5 text-xs text-[#949ba8] hover:text-white cursor-pointer" onclick="window.closeThemeModal()">&times;</button>
        </div>
        <div class="flex-1 overflow-y-auto touch-scroll pr-1 text-xs space-y-4 mt-4">
          <div>
            <div id="themeCardsContainer" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
          </div>
        </div>
      </div>
    `;

    // Close when clicking modal backdrop
    m.addEventListener('click', (e) => {
      if (e.target === m) window.closeThemeModal();
    });

    document.body.appendChild(m);
    return m;
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.closeThemeModal();
    }
  });

  window.openThemeModal = function() {
    const m = ensureThemeModalHtml();
    renderThemeStudio();
    updateThemeStudioUI();
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  window.closeThemeModal = function() {
    const m = document.getElementById('themeModal');
    if (m) m.classList.add('hidden');
    document.body.style.overflow = '';
  };
})();
