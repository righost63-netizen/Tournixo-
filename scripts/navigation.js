import { goTo, goReplace, goBack, pageUrl, TAB_PAGES } from '../config/app-config.js';
import { state } from './state.js';
import { flashToast } from './toast.js';

// Marks the bottom-nav button of the current page as active
export function setActiveTab(tab) {
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('tab-btn-' + tab);
    if (btn) btn.classList.add('active');
}

// Bottom-nav tap → opens that tab's page (replace: back button doesn't pile up tabs)
export function switchTab(tab) {
    if (!TAB_PAGES.includes(tab)) return;
    if (tab === state.currentTab) return;
    goReplace(tab);
}

export function redirectToHome() {
    flashToast('Welcome back! 🔥', 'success', 2000);
    goReplace('home');
}

export function redirectToLogin() {
    goReplace('login');
}

// Legacy screen names used by the original inline handlers
export function navTo(screen) {
    if (screen === 'main') redirectToHome();
    else if (screen === 'login' || screen === 'register') goReplace(screen);
}

// ── Tab prefetch: when the user hovers / touches a bottom-nav tab, start
// loading that page's HTML in the background so the actual tap feels instant.
const _prefetchedTabs = new Set();
export function wireTabPrefetch() {
    try {
        document.querySelectorAll('.tab-item').forEach((btn) => {
            const m = (btn.id || '').match(/^tab-btn-(.+)$/);
            if (!m) return;
            const tab = m[1];
            const prefetch = () => {
                if (_prefetchedTabs.has(tab) || tab === state.currentTab) return;
                _prefetchedTabs.add(tab);
                try {
                    const l = document.createElement('link');
                    l.rel = 'prefetch';
                    l.as = 'document';
                    l.href = pageUrl(tab);
                    document.head.appendChild(l);
                } catch (e) {}
            };
            btn.addEventListener('pointerenter', prefetch);
            btn.addEventListener('touchstart', prefetch, { passive: true });
        });
    } catch (e) {}
}

window.switchTab = switchTab;
window.navTo = navTo;
window.goBack = (fallback) => goBack(fallback || 'home');
window.openPage = (name, params) => goTo(name, params);

// ─────────────────────────────────────────────────────────────
// Centralized card/page actions — SINGLE SOURCE OF TRUTH.
// (Previously openTournamentResults was defined 4×, openTournDetail 2×,
// and startTournamentJoin had 3 different meanings per page.)
// Every page gets these via app.js → navigation.js.
// ─────────────────────────────────────────────────────────────
export function openTournamentResults(id) {
    goTo('results', { id });
}

export function openTournDetail(id) {
    goTo('tournamentDetails', { id });
}

// Opens the join form directly (dynamic import — loads join code only when needed)
export async function startTournamentJoin(id) {
    try {
        const mod = await import('./join-tournament.js');
        await mod.startTournamentJoin(id);
    } catch (e) {
        flashToast('Unable to open join form. Please try again.', 'error');
    }
}

export function joinTournament(id) {
    return startTournamentJoin(id);
}

window.openTournamentResults = openTournamentResults;
window.openTournDetail = openTournDetail;
window.startTournamentJoin = startTournamentJoin;
window.joinTournament = joinTournament;