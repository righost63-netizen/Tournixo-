import { ONESIGNAL_CONFIG } from '../config/onesignal-config.js';
import { STORAGE_KEYS } from '../utils/constants.js';
import { state } from '../scripts/state.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Line 36: `console.log("Permission: ", permission)` in production
 *    ✅ সরানো হয়েছে → শুধু console.warn শুধু error case এ, dev-এ চাইলে
 *       __DEV__ flag দিয়ে log করা যাবে।
 * 2. ✅ সব console.* guarded — production এ spam হবে না।
 * ─────────────────────────────────────────────────────────────
 */

// ✅ Central dev flag — flip to true only in local dev
const __DEV__ = false;
const log = (...args) => { if (__DEV__) console.log(...args); };
const warn = (...args) => { if (__DEV__) console.warn(...args); };

let _initStarted = false;
let _permWatchStarted = false;
let _toggleBusy = false;

let _resolveReady;
const _ready = new Promise(resolve => { _resolveReady = resolve; });

function deferred() {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    return window.OneSignalDeferred;
}

function waitForSdk(ms = 6000) {
    return Promise.race([
        _ready,
        new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
}

function notifSupported() {
    return typeof Notification !== 'undefined';
}

function browserPermission() {
    return notifSupported() ? Notification.permission : 'unsupported';
}

function savedPrefIsOff() {
    try { return localStorage.getItem(STORAGE_KEYS.notifications) === 'off'; }
    catch (e) { return false; }
}

function savePref(value) {
    try { localStorage.setItem(STORAGE_KEYS.notifications, value); } catch (e) {}
}

function setToggle(el, on) {
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
}

export function initOneSignal() {
    if (_initStarted) return;
    _initStarted = true;

    // ✅ FIX: আসল App ID না বসানো পর্যন্ত OneSignal সম্পূর্ণ skip করা হবে।
    // আগে placeholder ID নিয়ে SDK লোড হতো আর init silently fail করতো।
    const appId = String(ONESIGNAL_CONFIG.appId || '').trim();
    if (!appId || appId.includes('YOUR_')) {
        warn('[OneSignal] Skipped — set a real appId in config/onesignal-config.js to enable push notifications.');
        _resolveReady(null);
        syncNotifToggleUI();
        return;
    }

    if (!document.querySelector('script[data-onesignal-sdk]')) {
        const s = document.createElement('script');
        s.src = ONESIGNAL_CONFIG.sdkUrl;
        s.defer = true;
        s.setAttribute('data-onesignal-sdk', '1');
        s.onerror = () => {
            warn('[OneSignal] SDK failed to load (blocked or offline).');
            _resolveReady(null);
        };
        document.head.appendChild(s);
    }

    deferred().push(async function(OneSignal) {
        try {
            await OneSignal.init({
                appId: ONESIGNAL_CONFIG.appId,
                allowLocalhostAsSecureOrigin: ONESIGNAL_CONFIG.allowLocalhostAsSecureOrigin
            });
        } catch (e) {
            warn('[OneSignal] init failed:', e.message);
            _resolveReady(null);
            return;
        }
        _resolveReady(OneSignal);

        // v6: the old auto-prompt (setTimeout → requestPermission when permission
        // is 'default') was removed. Dismissing the prompt kept permission at
        // 'default', so it re-prompted on EVERY page load once a real App ID was
        // set. Permission is now requested only from the Notifications toggle —
        // an explicit user gesture, no annoyance loop.
    });

    syncNotifToggleUI();
}

export function syncNotifToggleUI() {
    const el = document.getElementById('notif-toggle');
    if (!el) return;

    setToggle(el, browserPermission() === 'granted' && !savedPrefIsOff());

    waitForSdk(4000).then(OneSignal => {
        if (!OneSignal) return;
        try {
            const optedIn = OneSignal.User?.PushSubscription?.optedIn;
            if (optedIn === false) setToggle(el, false);
        } catch (e) {}
    });

    if (!_permWatchStarted && navigator.permissions?.query) {
        _permWatchStarted = true;
        navigator.permissions.query({ name: 'notifications' }).then(status => {
            status.onchange = () => syncNotifToggleUI();
        }).catch(() => {});
    }
}

export async function toggleNotifications(el) {
    if (_toggleBusy) return;
    _toggleBusy = true;
    try {
        const turningOn = !el.classList.contains('on');

        if (!turningOn) {
            savePref('off');
            setToggle(el, false);
            window.showToast('Notifications disabled', 'info', 2000);
            waitForSdk(3000).then(async OneSignal => {
                try {
                    if (OneSignal?.User?.PushSubscription) await OneSignal.User.PushSubscription.optOut();
                } catch (e) {}
            });
            return;
        }

        if (!notifSupported()) {
            setToggle(el, false);
            window.showToast('Notifications are not supported on this device or browser', 'warning', 3500);
            return;
        }
        if (Notification.permission === 'denied') {
            setToggle(el, false);
            window.showToast('Notifications are blocked. Allow them in your browser / app settings, then try again.', 'warning', 5000);
            return;
        }

        // Native permission prompt FIRST — this opens the browser/OS dialog
        // (on Android Chrome it IS the Android-style permission sheet; on iOS
        // it is the iOS prompt). It works with or without the OneSignal SDK.
        // A page cannot force the grant — the user must tap "Allow".
        if (Notification.permission !== 'granted') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                setToggle(el, false);
                window.showToast('Notification permission was not granted', 'warning', 3500);
                return;
            }
        }

        // OneSignal push registration — best effort, only if the SDK loaded
        // (needs a real App ID in config/onesignal-config.js for remote push).
        const OneSignal = await waitForSdk(2500);
        try {
            if (OneSignal?.User?.PushSubscription) await OneSignal.User.PushSubscription.optIn();
            if (OneSignal && state.currentUser?.uid) await OneSignal.login(state.currentUser.uid);
        } catch (e) { /* local permission already granted; remote push optional */ }

        savePref('on');
        setToggle(el, true);
        // v6: distinguish "App ID not configured" from "SDK failed to load" —
        // the old toast blamed the App ID even when the SDK just failed (offline).
        const appIdMissing = String(ONESIGNAL_CONFIG.appId || '').indexOf('YOUR_') === 0;
        window.showToast(
            OneSignal
                ? 'Notifications enabled'
                : appIdMissing
                    ? 'Notifications allowed on this device. Set your OneSignal App ID to enable remote push.'
                    : 'Notifications allowed on this device, but the push service failed to load. Check your connection and try again.',
            OneSignal ? 'success' : 'info',
            4000
        );
    } catch (e) {
        warn('toggleNotifications error:', e.message);
        syncNotifToggleUI();
        window.showToast('Could not change notification setting. Please try again.', 'error', 3500);
    } finally {
        _toggleBusy = false;
    }
}

export function oneSignalLogin(uid) {
    deferred().push(async function(OneSignal) {
        try { await OneSignal.login(uid); } catch (e) {}
    });
}

export function oneSignalLogout() {
    deferred().push(async function(OneSignal) {
        try { await OneSignal.logout(); } catch (e) {}
    });
}

window.toggleNotifications = toggleNotifications;