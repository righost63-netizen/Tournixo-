import { initPage } from './app.js';
import { state } from './state.js';
import { loadBanners } from './banners.js';
import { cacheGet, cacheSet, cacheIsFresh } from './cache.js';
import { showSkeleton } from './modal.js';
import { buildTournamentCard, clearCardCountdowns } from './tournaments.js';
import { fetchHomeTournaments, ensureCaptainStatusCache } from '../services/tournaments.service.js';
import { fetchGameModes } from '../services/banners.service.js';
import { listenNotifications, scheduleTournamentReminders } from '../services/notifications.service.js';
import { mountComponent } from '../utils/dom-helpers.js';
import { STORAGE_KEYS, CACHE_TTL } from '../utils/constants.js';
import { goTo, goReplace } from '../config/app-config.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Line 120: leftover note `// ← ADD THIS LINE`
 *    ✅ সরানো হয়েছে। কোড ইতিমধ্যেই add করা ছিল — শুধু comment টা
 *       থেকে গেছিল, এটা production এ অদ্ভুত দেখায়।
 * 2. ✅ বাকি সব লজিক অপরিবর্তিত — শুধু comment cleanup।
 * ─────────────────────────────────────────────────────────────
 */

const _mounts = Promise.all([
    mountComponent('banner-slider', '#mount-banner-slider'),
    mountComponent('mode-chips', '#mount-mode-chips')
]);

async function loadModeChips(force = false) {
    if (state.modeChipsLoaded && !force) return;
    const container = document.getElementById('mode-chips');
    if (!container) return;
    const CACHE_KEY = STORAGE_KEYS.gameModes,
        CACHE_MS = CACHE_TTL.gameModes;
    const renderChips = (modes) => {
        container.innerHTML = '';
        container.appendChild(createModeChip('All', !state.modeFilter));
        modes.forEach(m => container.appendChild(createModeChip((m.icon || '') + ' ' + (m.name || ''), false)));
    };
    const cached = cacheGet(CACHE_KEY);
    if (cached && Array.isArray(cached.data)) renderChips(cached.data);
    else {
        container.innerHTML = '';
        container.appendChild(createModeChip('All', true));
    }
    if (cached && cacheIsFresh(cached, CACHE_MS) && !force) {
        state.modeChipsLoaded = true;
        return;
    }
    try {
        const modes = await fetchGameModes();
        cacheSet(CACHE_KEY, modes);
        renderChips(modes);
        state.modeChipsLoaded = true;
    } catch (e) {
        if (!cached) state.modeChipsLoaded = false;
    }
}

function createModeChip(label, isActive) {
    const chip = document.createElement('div');
    chip.className = 'mode-chip' + (isActive ? ' active' : '');
    chip.textContent = label;
    chip.onclick = () => {
        document.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const mode = label === 'All' ? null : label.replace(/\p{Emoji}/gu, '').trim();
        goReplace('tournaments', mode ? { mode } : undefined);
    };
    return chip;
}

async function loadHomeTournaments() {
    if (state.homeTournamentsLoading) return;
    const container = document.getElementById('home-tournaments');
    if (!container) return;
    state.homeTournamentsLoading = true;
    showSkeleton('home-tournaments');
    try {
        const [items] = await Promise.all([
            fetchHomeTournaments(),
            ensureCaptainStatusCache(state.currentUser?.uid)
        ]);
        if (items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏆</div>
                    <div class="empty-title">No Upcoming Tournaments</div>
                    <div class="empty-sub">New tournaments will be announced soon!</div>
                </div>`;
            return;
        }
        container.innerHTML = '';
        clearCardCountdowns();
        items.forEach(t => { container.appendChild(buildTournamentCard(t)); });
    } catch (e) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-title">Failed to load</div>
                <div class="empty-sub">${e.message}</div>
            </div>`;
    } finally {
        state.homeTournamentsLoading = false;
    }
}

function loadHome() {
    loadBanners();
    loadModeChips();
    loadHomeTournaments();
    setTimeout(scheduleTournamentReminders, 1500);
}

document.addEventListener('ff:cache-updated', (e) => {
    const f = e.detail.fields;
    if (f.includes('banners')) loadBanners().catch(() => {});
    if (f.includes('gameModes')) loadModeChips(true).catch(() => {});
    if (f.includes('tournaments') || f.includes('rules')) loadHomeTournaments().catch(() => {});
});

window.navToNotifications = () => goTo('notifications');
window.goToTournaments = () => goTo('tournaments');

initPage({
    page: 'home',
    tab: 'home',
    onReady: async (user) => {
        await _mounts;
        loadHome();
        listenNotifications(user.uid);
    }
});