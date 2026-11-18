(() => {
  const reloadKey = 'ytm.asset-recovery.reloaded';
  let checking = false;
  let notified = false;
  const pending = new Set();

  const showRetry = () => {
    if (notified) return;
    notified = true;
    const render = () => {
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.id = 'asset-recovery-notice';
      notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;border:1px solid #bbb;border-radius:12px;background:#fff;color:#222;font:16px/1.5 system-ui;box-shadow:0 4px 24px #0003';
      const message = document.createElement('p');
      message.textContent = '部分網頁檔案載入失敗，請確認連線後重新載入。';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '重新載入';
      button.style.cssText = 'min-height:44px;padding:8px 16px;background:#222;color:#fff;border:0;border-radius:8px;font:inherit;cursor:pointer';
      button.addEventListener('click', () => location.reload());
      notice.append(message, button);
      document.body.append(notice);
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  };

  const missingResources = () => performance.getEntriesByType('resource')
    .filter((entry) => entry.responseStatus === 404 || entry.responseStatus === 410)
    .map((entry) => entry.name);

  const recover = async (candidates) => {
    const assets = [...new Set(candidates)].filter((value) => {
      try {
        const url = new URL(value, location.href);
        return url.origin === location.origin && /^\/_astro\/.+\.(css|m?js)$/.test(url.pathname);
      } catch {
        return false;
      }
    });
    if (!assets.length) return;
    assets.forEach((asset) => pending.add(asset));
    if (checking) return;
    checking = true;
    try {
      for (const asset of pending) {
        pending.delete(asset);
        let response;
        try {
          response = await fetch(asset, {
            method: 'HEAD', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          // One failed check must not skip other queued resources.
          continue;
        }
        if (response.status !== 404 && response.status !== 410) continue;
        // Never reset this budget automatically: it survives reloads and both routes.
        if (sessionStorage.getItem(reloadKey)) break;
        sessionStorage.setItem(reloadKey, '1');
        if (sessionStorage.getItem(reloadKey) !== '1') break;
        location.reload();
        return;
      }
    } catch {
      // Storage blocked or an unconfirmed reload marker requires a manual retry.
    } finally {
      checking = false;
    }
    showRetry();
  };

  window.addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement) recover([...missingResources(), target.src]);
    else if (target instanceof HTMLLinkElement && target.relList.contains('stylesheet')) {
      recover([...missingResources(), target.href]);
    }
  }, true);

  const moduleFailure = (error) => {
    const urls = String(error?.message ?? error ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    const candidates = [...missingResources(), ...urls];
    if (candidates.length) recover(candidates);
    else showRetry();
  };
  window.addEventListener('vite:preloadError', (event) => moduleFailure(event.payload));
  window.addEventListener('unhandledrejection', (event) => {
    if (/dynamically imported module|importing a module script|loading chunk/i.test(String(event.reason?.message ?? ''))) {
      moduleFailure(event.reason);
    }
  });
})();
