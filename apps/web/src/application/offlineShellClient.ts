const setOfflineShellStatus = (value: string) => {
  document.documentElement.dataset.offlineShell = value;
  window.dispatchEvent(new Event('sensa-offline-shell'));
};

/** Register updates after the application has rendered; a waiting release activates only on user action. */
export async function startOfflineShellClient(): Promise<void> {
  setOfflineShellStatus('preparing');
  let reloading = false;
  let activating = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  const updateReady = () => {
    document.documentElement.dataset.appUpdate = 'ready';
    window.dispatchEvent(new Event('sensa-app-update-ready'));
  };
  const registration = await navigator.serviceWorker.register('/sw.js');
  if (registration.waiting) updateReady();
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady();
    });
  });
  window.addEventListener('sensa-activate-app-update', () => {
    activating = true;
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading && (hadController || activating)) {
      reloading = true;
      window.location.reload();
    }
  });
  await navigator.serviceWorker.ready;
  setOfflineShellStatus('ready');
}

export function failOfflineShellClient(): void {
  setOfflineShellStatus('failed');
}
