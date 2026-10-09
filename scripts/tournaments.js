// Tournament cards + tournaments page logic.
// • home.js imports buildTournamentCard from here.
// • pages/tournaments.html loads this file directly (data-page="tournaments").
import { initPage } from './app.js';
import { state } from './state.js';
import { showSkeleton } from './modal.js';
import { goTo, getParam } from '../config/app-config.js';
import { formatDateOnly, formatTimeOnly } from '../utils/formatters.js';
// v6: XSS — card fields come from Firestore (admin/staff-written); escape them.
// (escHtml alone is NOT enough inside inline onclick="" — entities decode before
// JS runs — so buttons use data-action/data-tid + listeners instead.)
import { escHtml } from '../utils/escape.js';
import { fetchTournamentList, getTournamentCapacity, ensureCaptainStatusCache, getCaptainStatus } from '../services/tournaments.service.js';

// ════════════════════════════════════════════════════════════════
// TOURNAMENT SEARCH & FILTER LOGIC
// ════════════════════════════════════════════════════════════════
state.tournSearchQuery = '';

export function onTournSearch(val) {
    state.tournSearchQuery = (val || '').trim().toLowerCase();
    filterAndRenderTournaments();
}

export function setTournFilter(filter, btn) {
    state.tournFilter = filter;
    document.querySelectorAll('#tab-tournaments .filter-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadTournaments();
}

export function filterAndRenderTournaments() {
    const container = document.getElementById('tournaments-list');
    if (!container) return;

    // FIX: a re-render replaces the card DOM, but the countdown registry
    // kept old element-id → start-time entries. The 1s ticker would then
    // find the NEW span (same id) and overwrite its text — e.g. a stale
    // "⏱ 00:00:01" stamped over the LIVE badge. Drop all stale entries
    // before rebuilding the cards.
    clearCardCountdowns();

    let items = state.tournaments || [];
    const q = state.tournSearchQuery;
    const statusFilter = state.tournFilter || 'upcoming';

    if (statusFilter !== 'all') {
        items = items.filter(t => t.status === statusFilter);
    }

    if (state.modeFilter) {
        const mf = state.modeFilter.toLowerCase();
        items = items.filter(t =>
            t.gameMode.toLowerCase().includes(mf) ||
            t.teamFormat.toLowerCase().includes(mf) ||
            t.name.toLowerCase().includes(mf)
        );
    }

    if (q) {
        items = items.filter(t =>
            t.name.toLowerCase().includes(q) ||
            t.gameMode.toLowerCase().includes(q) ||
            t.map.toLowerCase().includes(q)
        );
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏆</div>
                <div class="empty-title">No Tournaments Found</div>
                <div class="empty-sub">Try changing your search or filter options</div>
            </div>`;
        return;
    }

    container.innerHTML = '';

    items.forEach((t, i) => {
        const card = buildTournamentCard(t);
        card.style.animationDelay = (i * 0.05) + 's';
        container.appendChild(card);
    });
}

// ════════════════════════════════════════════════════════════════
// LOAD TOURNAMENTS
// ════════════════════════════════════════════════════════════════
export async function loadTournaments() {
    if (state.tournamentsLoading) {
        // A tap during a load must not be lost: remember it and reload with the
        // latest filter as soon as the current load finishes.
        state.tournamentsReloadPending = true;
        return;
    }

    state.tournamentsLoading = true;

    const container = document.getElementById('tournaments-list');

    showSkeleton('tournaments-list');

    try {
        const statusFilter = state.tournFilter || 'upcoming';

        const [list] = await Promise.all([
            fetchTournamentList(statusFilter),
            ensureCaptainStatusCache(state.currentUser?.uid, true)
        ]);

        state.tournaments = list;

        filterAndRenderTournaments();

    } catch (err) {

        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Error Loading Tournaments</div>
                    <div class="empty-sub">${err.message}</div>
                </div>`;
        }

    } finally {
        state.tournamentsLoading = false;
        if (state.tournamentsReloadPending) {
            state.tournamentsReloadPending = false;
            loadTournaments();
        }
    }
}

// ════════════════════════════════════════════════════════════════
// COUNTDOWNS — ONE shared 1s ticker for every card (not one interval per card).
// Cards whose element left the DOM are dropped automatically; the ticker stops
// itself when nothing is left to update.
// ════════════════════════════════════════════════════════════════
const _countdowns = new Map();   // element id → start time (ms)
let _countdownTimer = null;

function formatCountdown(rem) {
    const d = Math.floor(rem / 86400000);
    const h = Math.floor((rem % 86400000) / 3600000);
    const m = Math.floor((rem % 3600000) / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    const p = n => String(n).padStart(2, '0');
    return '⏱ ' + (d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(s)}`);
}

function tickCountdowns() {
    _countdowns.forEach((startMs, id) => {
        const el = document.getElementById(id);
        if (!el) {
            _countdowns.delete(id);
            return;
        }
        const rem = startMs - Date.now();
        if (rem <= 0) {
            el.textContent = '🔴 Starting!';
            _countdowns.delete(id);
            return;
        }
        el.textContent = formatCountdown(rem);
    });
    if (_countdowns.size === 0) stopCountdowns();
}

function stopCountdowns() {
    if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
    }
}

// Called before any card re-render (tournaments page + home page share
// buildTournamentCard): drops stale element-id → start-time entries so the
// 1s ticker can never overwrite a freshly rendered badge.
export function clearCardCountdowns() {
    _countdowns.clear();
    stopCountdowns();
}

function registerCountdown(elId, startMs) {
    _countdowns.set(elId, startMs);
    if (!_countdownTimer) _countdownTimer = setInterval(tickCountdowns, 1000);
}

// Stop while the page is in the background / leaving; resume when it is visible again.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCountdowns();
    else if (_countdowns.size && !_countdownTimer) _countdownTimer = setInterval(tickCountdowns, 1000);
});
window.addEventListener('pagehide', () => { stopCountdowns(); _countdowns.clear(); });

// ════════════════════════════════════════════════════════════════
// BUILD TOURNAMENT CARD
// ════════════════════════════════════════════════════════════════
export function buildTournamentCard(t) {

    const uid = state.currentUser?.uid;

    const cap = getTournamentCapacity(t);

    const isFree =
        t.entryType === 'FREE' ||
        t.entryFee === 0;

    const capStatus =
        uid ? getCaptainStatus(t.id) : null;

    const myStatus =
        capStatus ? capStatus.status : null;

    const legacyJoined =
        uid && (
            (state.userData?.joinedTournaments || []).includes(t.id) ||
            (t.raw.participants || []).includes(uid)
        );

    const isConfirmed =
        myStatus === 'confirmed' ||
        legacyJoined;

    const isPending =
        myStatus === 'pending';

    const isRejected =
        myStatus === 'rejected';

    // ─────────────────────────────────────────────
    // BUTTONS
    // ─────────────────────────────────────────────

    let actionBtnHtml = '';

    if (t.status === 'cancelled') {

        actionBtnHtml =
            `<button class="btn btn-secondary btn-sm"
                disabled
                style="color:var(--error); border-color:var(--error);">
                Cancelled
            </button>`;

    } else if (t.status === 'completed') {

        actionBtnHtml =
            `<button class="btn btn-primary btn-sm"
                style="background:var(--accent-grad);"
                data-action="results"
                data-tid="${escHtml(t.id)}">
                View Results
            </button>`;

    } else if (t.status === 'ongoing') {

        if (isConfirmed) {

            actionBtnHtml =
                `<button class="btn btn-success btn-sm"
                    data-action="room"
                    data-tid="${escHtml(t.id)}">
                    View Room 🔑
                </button>`;

        } else {

            actionBtnHtml =
                `<button class="btn btn-secondary btn-sm"
                    disabled
                    style="color:var(--success);">
                    🔴 Live
                </button>`;
        }

    } else {

        if (isConfirmed) {

            actionBtnHtml =
                `<button class="btn btn-success btn-sm"
                    disabled>
                    Joined ✓
                </button>`;

        } else if (isPending) {

            actionBtnHtml =
                `<button class="btn btn-sm"
                    style="background:rgba(255,149,0,0.15);
                           color:var(--warning);
                           border:1px solid rgba(255,149,0,0.3);"
                    disabled>
                    Pending ⏳
                </button>`;

        } else if (cap.isFull) {

            actionBtnHtml =
                `<button class="btn btn-danger btn-sm"
                    disabled>
                    FULL 🔒
                </button>`;

        } else {

            actionBtnHtml =
                `<button class="btn-join-card"
                    data-action="join"
                    data-tid="${escHtml(t.id)}">
                    ${isRejected ? 'Join Again' : 'Join'}
                </button>`;
        }
    }

    // ─────────────────────────────────────────────
    // DATE / TIME
    // ─────────────────────────────────────────────

    const dateStr =
        t.dateObj
            ? formatDateOnly(t.dateObj)
            : (t.raw.date || '—');

    const timeStr =
        t.dateObj
            ? formatTimeOnly(t.dateObj)
            : (t.raw.time || '—');

    // ─────────────────────────────────────────────
    // COUNTDOWN
    // ─────────────────────────────────────────────

    const cardId =
        'card-' +
        t.id.replace(/[^a-z0-9]/gi, '');

    let countdownHtml = '';

    const tDateMs =
        t.dateObj
            ? t.dateObj.getTime()
            : 0;

    const diff =
        tDateMs - Date.now();

    if (
        t.status === 'upcoming' &&
        diff > 0
    ) {

        countdownHtml =
            `<div class="countdown-container"
                id="cd-${cardId}">
                <div class="timer-dot"></div>
                <span class="timer-text"
                    id="ct-${cardId}">
                    Loading...
                </span>
            </div>`;

    } else if (t.status === 'ongoing') {

        countdownHtml =
            `<div class="countdown-container"
                style="background:rgba(0,200,83,0.75);">
                <span class="live-badge"><span class="live-dot"></span>LIVE</span>
            </div>`;

    } else if (t.status === 'cancelled') {

        countdownHtml =
            `<div class="countdown-container"
                style="background:rgba(255,69,58,0.85);">
                <span class="timer-text">
                    ⚠️ CANCELLED
                </span>
            </div>`;
    }

    // ─────────────────────────────────────────────
    // OPTIONAL BANNER
    //
    // Image exists:
    //     image + countdown
    //
    // Image doesn't exist:
    //     compact countdown only
    //
    // NO TROPHY PLACEHOLDER
    // NO LARGE EMPTY BANNER
    // ─────────────────────────────────────────────

    // v6: banner URL is admin-written — escape it and allow only http(s).
    // (An <img> can't run javascript: URLs, but a broken-out attribute could.)
    const safeBannerUrl = /^https?:\/\//i.test(t.bannerUrl || '') ? t.bannerUrl : '';
    const bannerHtml = safeBannerUrl

        ? `
            <div class="tournament-banner-wrap">

                <img
                    class="tournament-banner"
                    src="${escHtml(safeBannerUrl)}"
                    alt="Banner"
                    loading="lazy">

                ${countdownHtml}

            </div>
          `

        : (

            countdownHtml

                ? `
                    <div class="tournament-no-banner">
                        ${countdownHtml}
                    </div>
                  `

                : ''
        );

    // ─────────────────────────────────────────────
    // CARD
    // ─────────────────────────────────────────────

    const card =
        document.createElement('div');

    card.className =
        'tournament-card';

    card.innerHTML = `

        ${bannerHtml}

        <div class="tournament-body">

            <div class="tournament-title">
                ${escHtml(t.name)}
            </div>

            <div class="tournament-meta">

                <span class="badge badge-mode">
                    ${escHtml(t.gameMode)}
                </span>

                <span
                    class="badge"
                    style="background:rgba(0,200,255,0.12);
                           color:#00C8FF;">
                    ${escHtml(t.teamFormat)}
                </span>

                <span class="badge badge-map">
                    ${escHtml(t.map)}
                </span>

                <span class="badge badge-${escHtml(t.status)}">
                    ${escHtml(String(t.status).toUpperCase())}
                </span>

                <span class="badge badge-${isFree ? 'free' : 'paid'}">
                    ${isFree ? 'FREE' : '₹' + escHtml(t.entryFee)}
                </span>

            </div>

            <div class="tournament-info">

                <div class="info-item">
                    <div class="info-label">
                        📅 Date
                    </div>
                    <div class="info-val">
                        ${dateStr}
                    </div>
                </div>

                <div class="info-item">
                    <div class="info-label">
                        ⏰ Time
                    </div>
                    <div class="info-val">
                        ${timeStr}
                    </div>
                </div>

                <div class="info-item">
                    <div class="info-label">
                        🏆 Prize Pool
                    </div>
                    <div class="info-val gold">
                        ₹${t.prizePool}
                    </div>
                </div>

                <div class="info-item">
                    <div class="info-label">
                        💀 Per Kill
                    </div>
                    <div class="info-val green">
                        ₹${t.perKill}
                    </div>
                </div>

                <div class="info-item">
                    <div class="info-label">
                        👥 Capacity
                    </div>
                    <div class="info-val">
                        ${cap.label}
                    </div>
                </div>

            </div>

            ${
                t.maxTeams > 0
                    ? `
                        <div class="slots-bar">
                            <div
                                class="slots-fill ${cap.pct >= 80 ? 'slots-hot' : ''}"
                                style="width:${cap.pct}%">
                            </div>
                        </div>

                        <div class="slots-text">
                            Capacity: ${cap.label}
                        </div>
                      `
                    : ''
            }

            <div class="card-actions">

                <button
                    class="btn btn-secondary btn-sm"
                    data-action="detail"
                    data-tid="${escHtml(t.id)}">
                    View Details
                </button>

                ${actionBtnHtml}

            </div>

        </div>
    `;

    // v6: wire card buttons via data-action (no inline onclick — see XSS note above).
    // window.* fns are centralized in navigation.js / tournaments.js.
    card.querySelectorAll('[data-action]').forEach(btn => {
        const tid = btn.getAttribute('data-tid');
        const action = btn.getAttribute('data-action');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (action === 'detail') window.openTournDetail(tid);
            else if (action === 'results') window.openTournamentResults(tid);
            else if (action === 'room') window.openRoomCredentials(tid);
            else if (action === 'join') window.startTournamentJoin(tid);
        });
    });

    // ─────────────────────────────────────────────
    // COUNTDOWN TIMER
    // ─────────────────────────────────────────────

    if (tDateMs > 0 && t.status === 'upcoming' && diff > 0) {
        registerCountdown(`ct-${cardId}`, tDateMs);
    }

    return card;
}

// ════════════════════════════════════════════════════════════════
// CARD BUTTONS → PAGES (centralized in navigation.js: openTournDetail,
// startTournamentJoin, joinTournament, openTournamentResults)
// ════════════════════════════════════════════════════════════════

window.openRoomCredentials =
    (id) => window.openTournDetail(id);

window.onTournSearch =
    onTournSearch;

window.setTournFilter =
    setTournFilter;

// ════════════════════════════════════════════════════════════════
// PAGE INIT
// ════════════════════════════════════════════════════════════════

const _page =
    document.body &&
    document.body.dataset
        ? document.body.dataset.page
        : null;

if (_page === 'tournaments') {

    const mode =
        getParam('mode');

    if (mode)
        state.modeFilter = mode;

    document.addEventListener(
        'ff:cache-updated',
        (e) => {

            const f =
                e.detail.fields;

            if (
                f.includes('tournaments') ||
                f.includes('rules')
            ) {
                loadTournaments()
                    .catch(() => {});
            }
        }
    );

    initPage({

        page: 'tournaments',

        tab: 'tournaments',

        onReady: () => {
            loadTournaments();
        }

    });
}