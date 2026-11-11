/* Koda Multi-Device Automatic Update Engine */
(function() {
  const CURRENT_BUILD_TIME = 1793820000000;
  const CURRENT_VERSION = '1.0.3';
  let isUpdating = false;
  let pendingReload = false;
  let swRegistration = null;

  function isUserBusy() {
    try {
      // In chat.html: check if any prompt is streaming or audio recording
      if (typeof S !== 'undefined' && S && S.ctl) {
        const isStreaming = Object.values(S.ctl).some(c => !!c);
        if (isStreaming) return true;
      }
      if (typeof listening !== 'undefined' && listening) return true;
      const qInput = document.getElementById('q');
      if (qInput && qInput.value && qInput.value.trim().length > 0 && document.activeElement === qInput) {
        return true; // User is actively composing a prompt
      }
    } catch (_) {}
    return false;
  }

  function applyUpdate() {
    if (isUpdating) return;
    if (isUserBusy()) {
      pendingReload = true;
      return;
    }
    isUpdating = true;
    try {
      sessionStorage.setItem('koda_just_updated', Date.now().toString());
    } catch (_) {}
    window.location.reload();
  }

  // Periodic check to trigger pending reload when user becomes idle
  setInterval(() => {
    if (pendingReload && !isUserBusy()) {
      applyUpdate();
    }
  }, 3000);

  // Check version against centralized hosting endpoint
  async function checkForUpdates() {
    try {
      const endpoint = location.protocol.startsWith('http') ? './version.json?_t=' + Date.now() : null;
      if (!endpoint) return;
      const res = await fetch(endpoint, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
      });
      if (!res.ok) return;
      const data = await res.json();
      const serverBuild = Number(data.buildTime || 0);
      const serverVer = String(data.version || '');
      if ((serverBuild && serverBuild > CURRENT_BUILD_TIME) || (serverVer && serverVer !== CURRENT_VERSION)) {
        console.log('[Koda Auto-Update] Newer version detected on server:', serverVer, serverBuild);
        if (swRegistration) {
          try { await swRegistration.update(); } catch (_) {}
        }
        applyUpdate();
      }
    } catch (_) {}
  }

  // Register Service Worker with live network checks
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        swRegistration = reg;

        // Force check for sw.js update on load
        try { await reg.update(); } catch (_) {}

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[Koda Auto-Update] New service worker installed, activating...');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch (err) {
        console.warn('[Koda Auto-Update] SW register failed:', err);
      }
    });

    // When controller changes, reload seamlessly
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      applyUpdate();
    });

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && (event.data.type === 'KODA_SW_UPDATED' || event.data.action === 'reload')) {
        applyUpdate();
      }
    });
  }

  // Poll for updates every 30 seconds
  setInterval(checkForUpdates, 30000);

  // Also check immediately when user switches back to the tab/window or reconnects online
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (swRegistration) { try { swRegistration.update(); } catch (_) {} }
      checkForUpdates();
    }
  });
  window.addEventListener('focus', () => {
    if (swRegistration) { try { swRegistration.update(); } catch (_) {} }
    checkForUpdates();
  });
  window.addEventListener('online', () => {
    if (swRegistration) { try { swRegistration.update(); } catch (_) {} }
    checkForUpdates();
  });

  window.__kodaCheckForUpdates = checkForUpdates;
})();
