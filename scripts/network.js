// ════════════════════════════════════════════════════════════════
// Online/offline monitoring + user-facing offline UI.
//  • toggles  html.offline           (CSS hook, see styles/components/toast.css)
//  • shows    #offline-banner        (slides in from the top while offline)
//  • toasts   "Back online"          (only after a real offline → online change)
//  • emits    'network-status'       ({ detail: { online } }) for any page/module
// ════════════════════════════════════════════════════════════════
let _bannerEl = null;

function ensureBanner() {
    if (_bannerEl && document.body.contains(_bannerEl)) return _bannerEl;
    const el = document.createElement('div');
    el.id = 'offline-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = '📡 No internet connection — some features may not work';
    document.body.appendChild(el);
    _bannerEl = el;
    return el;
}

export function initNetworkMonitoring() {
    ensureBanner();
    let wasOnline = navigator.onLine;

    const updateNetworkStatus = () => {
        const online = navigator.onLine;

        document.documentElement.classList.toggle('offline', !online);

        // Only announce a real reconnect, never the initial page-load check
        if (online && !wasOnline && typeof window.showToast === 'function') {
            window.showToast('Back online', 'success', 2000);
        }
        wasOnline = online;

        window.dispatchEvent(
            new CustomEvent('network-status', {
                detail: { online }
            })
        );
    };

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    updateNetworkStatus();

    return () => {
        window.removeEventListener('online', updateNetworkStatus);
        window.removeEventListener('offline', updateNetworkStatus);
    };
}
