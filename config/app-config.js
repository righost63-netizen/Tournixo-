// ════════════════════════════════════════════════════════════════
// App-wide configuration. No secrets here.
// All URLs are resolved from this file's location (import.meta.url),
// so they work on Netlify, in a sub-folder, and in Acode preview.
// ════════════════════════════════════════════════════════════════

export const APP_CONFIG = {
    name: 'Tournixo',
    splashFallbackMs: 5000,      // original: hide splash after 5s if auth never resolves
    bannerIntervalMs: 3500,      // original: banner auto-rotation
    defaultMinWithdrawal: 100,  // original: fallback when settings/withdrawal is missing
    bannerImageWidth: 900,       // Cloudinary banner width (was hard-coded w_900 in banners.js)
    pendingExpiryHours: 6        // v6: unpaid pending teams auto-expire after this long
};

const ROOT = new URL('../', import.meta.url);

// Route name → file path (relative to project root)
export const ROUTES = {
    index: 'index.html',
    login: 'pages/login.html',
    register: 'pages/register.html',
    home: 'pages/home.html',
    tournaments: 'pages/tournaments.html',
    tournamentDetails: 'pages/tournament-details.html',
    matches: 'pages/matches.html',
    wallet: 'pages/wallet.html',
    withdrawal: 'pages/withdrawal.html',
    payment: 'pages/payment.html',
    leaderboard: 'pages/leaderboard.html',
    profile: 'pages/profile.html',
    accountSettings: 'pages/account-settings.html',
    myTeam: 'pages/my-team.html',
    reportPlayer: 'pages/report-player.html',
    notifications: 'pages/notifications.html',
    results: 'pages/results.html',
    terms: 'pages/terms.html',
    helpSupport: 'pages/help-support.html'
};

// Pages a logged-out user may open
export const PUBLIC_PAGES = ['index', 'login', 'register'];

// Pages anyone may read, logged in or not. Unlike PUBLIC_PAGES, a logged-in
// user is NOT redirected to home from these (e.g. Terms link on the register page).
export const OPEN_PAGES = ['terms', 'helpSupport'];

// Pages shown in the bottom navigation (same 5 tabs as the original)
export const TAB_PAGES = ['home', 'tournaments', 'matches', 'wallet', 'profile'];

export function assetUrl(path) {
    return new URL(path, ROOT).href;
}

export function pageUrl(name, params) {
    const u = new URL(ROUTES[name] || ROUTES.index, ROOT);
    if (params) {
        Object.keys(params).forEach(k => {
            if (params[k] !== undefined && params[k] !== null) u.searchParams.set(k, params[k]);
        });
    }
    return u.href;
}

// Normal navigation (adds a history entry)
export function goTo(name, params) {
    window.location.href = pageUrl(name, params);
}

// Navigation that replaces the current entry (use after login/logout)
export function goReplace(name, params) {
    window.location.replace(pageUrl(name, params));
}

// Back button: real history back if we came from this app, else fallback page
export function goBack(fallback = 'home') {
    let sameOrigin = false;
    try {
        sameOrigin = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch (e) {}
    if (sameOrigin && window.history.length > 1) window.history.back();
    else goReplace(fallback);
}

// Reads ?key=value from the current URL
export function getParam(key) {
    return new URLSearchParams(window.location.search).get(key);
}

// ── (duplicate APP_CONFIG block removed; merged into the single export above) ──