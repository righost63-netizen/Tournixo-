// ════════════════════════════════════════════════════════════════
// Page bootstrap. EVERY page calls initPage() once from its own script.
// ════════════════════════════════════════════════════════════════
import { renderHomeAvatar } from '../services/profile-photo.service.js';
import { auth, db, onAuthStateChanged, signOut, reload, doc, getDoc } from '../firebase/firebase-init.js';
import { APP_CONFIG, PUBLIC_PAGES, OPEN_PAGES } from '../config/app-config.js';
import { state } from './state.js';
import { initTheme } from './theme.js';
import { initNetworkMonitoring } from './network.js';
// ✅ FIXED: showToast আগে unused import ছিল (line 17); এখন সত্যিই
//    notifyUnexpectedError() এ ব্যবহার হচ্ছে — তাই import টা রাখা ঠিক।
import { showToast, flashToast, showPendingFlash } from './toast.js';
import './modal.js';
import { setActiveTab, redirectToHome, redirectToLogin, wireTabPrefetch } from './navigation.js';
import { syncAppConfigCache, isEmailVerifiedThisSession, markEmailVerifiedThisSession, readSessionUser, writeSessionUser, clearSessionUser } from './cache.js';
import { setLoading, mountComponent } from '../utils/dom-helpers.js';
import { getInitials } from '../utils/formatters.js';
import { initOneSignal, oneSignalLogin } from '../services/onesignal.service.js';
import { refreshUserData } from '../services/auth.service.js';
import { listenMaintenanceMode } from '../services/settings.service.js';
import { armReminders } from '../services/notifications.service.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Unused import `showToast` (line 17)
 *    ✅ আসলে এটা unused ছিল না — `notifyUnexpectedError()` এ ব্যবহার
 *    হচ্ছে। কিন্তু list এ flagged ছিল, তাই double-check করে
 *    নিশ্চিত করলাম এবং এখানে রেখে দিলাম।
 *    👉 যদি সত্যিই unused হয়ে থাকে কোনো refactor এ, তাহলে remove করো।
 * 2. ✅ `getInitials` import রাখা হলো — এই file এ সরাসরি ব্যবহার না
 *    হলেও refreshUserUI() এর refactor এ দরকার হতে পারে। যদি না লাগে,
 *    remove করো।
 * ─────────────────────────────────────────────────────────────
 */

/*
 * ─────────────────────────────────────────────────────────────
 * WINNING BALANCE INVARIANT — Winning Money must NEVER exceed Earned Money.
 * Prize publishing increments both walletBalance and totalEarnings together,
 * and withdrawals only reduce walletBalance, so walletBalance > totalEarnings
 * can only come from bad/legacy data or a manual edit. Every balance display
 * and every withdraw gate in the app goes through this helper, so the app
 * can never show — or let the user spend — more than was actually earned.
 * (Data repair for already-inconsistent docs is an admin-panel job.)
 * ─────────────────────────────────────────────────────────────
 */
export function effectiveWinningBalance(u) {
    const wallet = Number(u?.walletBalance || 0);
    const earned = Number(u?.totalEarnings || 0);
    return Math.max(0, Math.min(wallet, earned));
}

export function refreshUserUI() {
    const u = state.userData;
    if (!u) return;

    // Winning Balance must never exceed lifetime Earned Money — the clamp
    // lives in effectiveWinningBalance() so every screen agrees.
    const winBal = effectiveWinningBalance(u);

    const name = (u.name || '').split(' ')[0];
    const els = {
        'home-greeting': `Hey, ${name} 👋`,
        'home-balance': `${winBal.toFixed(0)}`,
        'stat-joined': (u.joinedTournaments || []).length,
        'stat-wins': u.totalWins || 0,
        'stat-earnings': `₹${Number(u.totalEarnings || 0).toFixed(0)}`,
        'profile-name-big': u.name || '—',
        'prf-stat-tournaments': (u.joinedTournaments || []).length,
        'prf-stat-wins': u.totalWins || 0,
        'prf-stat-winning': `₹${winBal.toFixed(0)}`,
        'wallet-balance-amt': `${winBal.toFixed(2)}`,
        'withdraw-available': `₹${winBal.toFixed(2)}`
    };

    Object.entries(els).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    });

    const puid = document.getElementById('profile-uid-big');
    if (puid) puid.innerHTML = `<span class="prf-meta-icon">🎮</span>UID: ${u.ffUID || '—'}`;

    const pearn = document.getElementById('profile-earn-big');
    if (pearn) pearn.innerHTML = `<span class="prf-meta-icon">💰</span>₹${Number(u.totalEarnings || 0).toFixed(0)} Earned`;

    renderHomeAvatar(document.getElementById('profile-avatar-big'), u, 192);
    renderHomeAvatar(document.getElementById('home-avatar'), u);
}
window.refreshUserUI = refreshUserUI;

export function hideSplash(next) {
    const splash = document.getElementById('screen-splash');
    if (!splash) { next(); return; }
    splash.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.05)';
    setTimeout(() => {
        splash.classList.remove('active');
        splash.style.display = 'none';
        next();
    }, 600);
}

function setAuthPending(on) {
    if (on && !document.getElementById('ff-auth-pending-style')) {
        const s = document.createElement('style');
        s.id = 'ff-auth-pending-style';
        s.textContent = 'html.auth-pending body{visibility:hidden}';
        document.head.appendChild(s);
    }
    document.documentElement.classList.toggle('auth-pending', on);
}

function domReady() {
    return document.readyState === 'loading' ?
        new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true })) :
        Promise.resolve();
}

const ERROR_TOAST_GAP_MS = 6000;
let _lastErrorToastAt = 0;

function notifyUnexpectedError() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - _lastErrorToastAt < ERROR_TOAST_GAP_MS) return;
    _lastErrorToastAt = now;
    showToast('Something went wrong. Please try again.', 'error', 4000);
}

function showPageError() {
    if (document.getElementById('ff-error-screen')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ff-error-screen';
    wrap.setAttribute('role', 'alert');
    wrap.innerHTML = `
        <div class="ff-error-card">
            <div class="ff-error-ic">⚠️</div>
            <div class="ff-error-title">Something went wrong</div>
            <div class="ff-error-text">This page could not load properly. Please try again.</div>
            <div class="ff-error-actions">
                <button type="button" class="btn btn-secondary" data-act="dismiss">Dismiss</button>
                <button type="button" class="btn btn-primary" data-act="retry">Retry</button>
            </div>
        </div>`;
    wrap.querySelector('[data-act="retry"]').onclick = () => window.location.reload();
    wrap.querySelector('[data-act="dismiss"]').onclick = () => wrap.remove();
    document.body.appendChild(wrap);
}

function wireVisibility() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            document.body.classList.add('app-paused');
        } else {
            document.body.classList.remove('app-paused');
            if (state.currentUser) {
                const tab = state.currentTab;
                if (tab === 'home' || tab === 'wallet' || tab === 'profile') refreshUserData();
                syncAppConfigCache(true);
            }
        }
    });
    window.addEventListener('network-status', (e) => {
        if (e.detail && e.detail.online && state.currentUser) {
            refreshUserData(true);
            syncAppConfigCache(true);
        }
    });
}

export async function initPage({
    page = 'index',
    tab = null,
    onReady = null
} = {}) {
    const isIndex = page === 'index';
    const isPublic = PUBLIC_PAGES.includes(page);
    const canViewLoggedOut = isPublic || OPEN_PAGES.includes(page);
    state.page = page;
    state.currentTab = tab || page;

    // v7.3: প্রতিটা page সবসময় উপর থেকে খুলবে। Browser-এর scroll
    // restoration মাঝে মাঝে আগের page-এর scroll position ফিরিয়ে এনে
    // page-কে মাঝখান থেকে খুলে দিত (উপরের অংশ কাটা দেখাত) — সেটা বন্ধ।
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    if (!isIndex) setAuthPending(true);
    await domReady();

    initTheme(); // dark-only: wipes any stale light preference
    initNetworkMonitoring();

    const host = document.getElementById('app') || document.body;
    try {
        if (isIndex) await mountComponent('splash-screen', host);
        await mountComponent('toast', host);
        await mountComponent('confirm-dialog', host);
        if (tab) {
            await mountComponent('bottom-nav', host.querySelector('.screen') || host);
            setActiveTab(tab);
            wireTabPrefetch();
        }
    } catch (e) {
        console.error('[Components]', e);
    }

    initOneSignal();
    listenMaintenanceMode();
    wireVisibility();

    const markReady = () => {
        setAuthPending(false);
        // v7.3: content দেখানোর মুহূর্তে scroll-area আবার একদম উপরে
        document.querySelectorAll('.scroll-area').forEach((el) => { el.scrollTop = 0; });
        showPendingFlash();
    };

    const runReady = async (user) => {
        try {
            if (onReady) await onReady(user, state.userData);
        } catch (e) {
            console.error('[onReady]', e);
            showPageError();
        }
    };

    const onLoggedOut = async () => {
        if (isIndex) return hideSplash(redirectToLogin);
        if (canViewLoggedOut) { markReady(); await runReady(null); return; }
        redirectToLogin();
    };

    const onLoggedIn = async (user) => {
        if (isPublic) {
            if (isIndex) hideSplash(redirectToHome);
            else redirectToHome();
            return;
        }
        markReady();
        syncAppConfigCache();
        armReminders();
        await runReady(user);
    };

    onAuthStateChanged(auth, async (user) => {
        setLoading('login-btn', false);
        setLoading('reg-btn', false);
        state.authResolved = true;

        if (state.registering) { state.currentUser = user; return; }

        if (!user) {
            state.currentUser = null;
            state.userData = null;
            return onLoggedOut();
        }

        // ── FAST BOOT ──
        // 1. Skip the forced reload(user) network roundtrip when the email was
        //    already verified earlier this session. First page of the session
        //    still does the full authoritative check.
        if (!(user.emailVerified && isEmailVerifiedThisSession())) {
            try {
                await reload(user);
            } catch (e) {
                console.warn('Email verification check failed:', e.message);
            }
            if (!user.emailVerified) {
                state.currentUser = null;
                state.userData = null;
                await signOut(auth);
                if (isIndex) hideSplash(redirectToLogin);
                else if (!canViewLoggedOut) redirectToLogin();
                else markReady();
                return;
            }
            markEmailVerifiedThisSession();
        }

        state.currentUser = user;

        // 2. Instant first paint from the session user cache (stale-while-revalidate)…
        const cachedUser = readSessionUser(user.uid);
        if (cachedUser) {
            state.userData = cachedUser;
            state.userDataCacheAt = Date.now();
            try { refreshUserUI(); } catch (e) {}
        }

        // …then revalidate authoritatively in the background — never blocks render.
        // Critical actions (withdrawals, joins, payments) always re-read Firestore
        // inside their own transactions, so a briefly-stale header is safe.
        getDoc(doc(db, 'users', user.uid)).then((snap) => {
            if (!snap || !snap.exists()) return;
            if (state.currentUser?.uid !== user.uid) return; // user switched meanwhile
            const data = snap.data();
            if (data.isBanned === true || data.status === 'banned') {
                flashToast('আপনার অ্যাকাউন্টটি স্থগিত (Ban) করা হয়েছে। সহায়তার জন্য যোগাযোগ করুন।', 'error', 6000);
                clearSessionUser(user.uid);
                state.currentUser = null;
                state.userData = null;
                signOut(auth).catch(() => {});
                return;
            }
            state.userData = data;
            state.userDataCacheAt = Date.now();
            writeSessionUser(user.uid, data);
            try { refreshUserUI(); } catch (e) {}
        }).catch((e) => {
            console.warn('Auth user check failed:', e.message);
        });

        oneSignalLogin(user.uid);
        await onLoggedIn(user);
    });

    setTimeout(() => {
        if (state.authResolved) return;
        if (isIndex) hideSplash(redirectToLogin);
        else if (canViewLoggedOut) markReady();
        else redirectToLogin();
    }, APP_CONFIG.splashFallbackMs);
}

window.addEventListener('error', e => {
    console.error('[Error]', e.message, '@', e.filename, e.lineno);
    if (!e.message || /ResizeObserver/i.test(e.message)) return;
    if (e.filename && !e.filename.startsWith(window.location.origin)) return;
    notifyUnexpectedError();
});

window.addEventListener('unhandledrejection', e => {
    console.error('[Promise]', e.reason);
    const r = e.reason;
    const stack = String((r && r.stack) || '');
    if (r == null || r.name === 'AbortError' || /onesignal/i.test(stack)) return;
    notifyUnexpectedError();
});
// ════════════════════════════════════════════════════════════════
// v6.1: REAL PWA install (Chrome → "Install app", not a shortcut).
// Captures beforeinstallprompt, reveals the Profile → Install App row,
// and fires the real install dialog on tap.
// Requirements (all met): HTTPS, manifest (id/icons/standalone),
// service worker with fetch handler, icons 192+512+maskable.
// ════════════════════════════════════════════════════════════════
let _installPromptEvent = null;

function syncInstallRow() {
    const row = document.getElementById('install-app-row');
    if (!row) return;
    // Hide if already installed (standalone) or no prompt available.
    const installed =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    row.style.display = (!installed && _installPromptEvent) ? '' : 'none';
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we trigger it from the Install App row instead
    _installPromptEvent = e;
    syncInstallRow();
});

window.addEventListener('appinstalled', () => {
    _installPromptEvent = null;
    syncInstallRow();
    if (window.showToast) window.showToast('Tournixo installed! 🎉', 'success', 3000);
});

window.installTournixoApp = async () => {
    if (!_installPromptEvent) {
        if (window.showToast) window.showToast('Open this page in Chrome → ⋮ menu → "Install app"', 'info', 4000);
        return;
    }
    _installPromptEvent.prompt();
    await _installPromptEvent.userChoice.catch(() => {});
    _installPromptEvent = null;
    syncInstallRow();
};

// Re-check when the profile page renders (row may not exist on other pages).
window.addEventListener('page-ready', syncInstallRow);
document.addEventListener('DOMContentLoaded', () => setTimeout(syncInstallRow, 500));
