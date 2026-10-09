import { initPage } from './app.js';
import { state } from './state.js';
import { getInitials } from '../utils/formatters.js';
import { escHtml } from '../utils/escape.js';
import { fetchPublishedLeaderboard, fetchTopUsers } from '../services/leaderboard.service.js';

// ════════════════════════════════════════════════════════════════
// LEADERBOARD — ranked by Total Earnings (totalEarnings)
// v6.1: reads the admin-published `leaderboard/current` doc (1 read).
// Falls back to the live top-50 query until the first publish.
// "You" is matched by FF UID (published entries carry no Firebase uid).
// ════════════════════════════════════════════════════════════════
function renderLeaderboard(users, meta) {
    const myFfUID = String(state.userData?.ffUID || '').trim();
    const podiumArea = document.getElementById('podium-area');
    const lbList = document.getElementById('lb-list');
    const youBanner = document.getElementById('lb-you-banner');
    const updatedNote = document.getElementById('lb-updated-note');

    if (updatedNote) {
        // v6.1: show when the ranking was published (daily by admin).
        const upd = meta && meta.updatedAt;
        const d = upd && typeof upd.toDate === 'function' ? upd.toDate() : (upd ? new Date(upd) : null);
        updatedNote.textContent = d && !isNaN(d.getTime())
            ? `Updated ${d.toLocaleDateString()} · refreshed daily`
            : '';
        updatedNote.style.display = updatedNote.textContent ? 'block' : 'none';
    }

    if (!podiumArea || !lbList) return;

    if (!users || users.length === 0) {
        podiumArea.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏆</div>
                <div class="empty-title">No Rankings Available</div>
                <div class="empty-sub">Leaderboard rankings will be updated after tournament matches</div>
            </div>`;

        if (youBanner) youBanner.innerHTML = '';
        lbList.innerHTML = '';
        return;
    }

    const top3 = users.slice(0, 3);

    let po = [],
        pc = [],
        pk = [],
        pr = [];

    if (top3.length >= 3) {
        po = [top3[1], top3[0], top3[2]];
        pc = ['g2', 'g1', 'g3'];
        pk = ['🥈', '🥇', '🥉'];
        pr = [2, 1, 3];
    } else if (top3.length === 2) {
        po = [top3[1], top3[0]];
        pc = ['g2', 'g1'];
        pk = ['🥈', '🥇'];
        pr = [2, 1];
    } else {
        po = [top3[0]];
        pc = ['g1'];
        pk = ['🥇'];
        pr = [1];
    }

    podiumArea.innerHTML = `
        <div class="podium">
            ${po.map((u, i) => `
                <div class="p-col ${pc[i]}">
                    <div class="p-av">
                        <span class="medal">${pk[i]}</span>${escHtml(getInitials(u.name))}
                    </div>
                    <div class="p-name">${escHtml((u.name || 'Player').split(' ')[0])}</div>
                    <div class="p-uid">UID: ${escHtml(u.ffUID || '—')}</div>
                    <div class="p-amt">₹${Number(u.totalEarnings || 0).toFixed(0)}</div>
                    <div class="p-bar">${pr[i]}</div>
                </div>
            `).join('')}
        </div>`;

    lbList.innerHTML = '';

    // v6.1: match "you" by FF UID (published entries have no Firebase uid).
    const myRank = myFfUID
        ? users.findIndex(u => String(u.ffUID || '').trim() === myFfUID)
        : -1;

    if (youBanner) {
        youBanner.innerHTML = (myRank >= 0 && myRank < 3)
            ? `<div class="you-banner">🏆 You are ranked <b>#${myRank + 1}</b> · Total earnings <b>₹${Number(users[myRank].totalEarnings || 0).toFixed(0)}</b></div>`
            : (myRank >= 3
                ? `<div class="you-banner">🏆 You are ranked <b>#${myRank + 1}</b> · keep climbing!</div>`
                : '');
    }

    const lbFragment = document.createDocumentFragment();

    users.slice(3).forEach((u, i) => {
        const isMe = myFfUID !== '' && String(u.ffUID || '').trim() === myFfUID;

        const item = document.createElement('div');
        item.className = 'l-row' + (isMe ? ' me' : '');

        item.innerHTML = `
            <div class="l-rank">${i + 4}</div>
            <div class="l-av">${escHtml(getInitials(u.name))}</div>
            <div class="l-body">
                <div class="l-name">${escHtml(u.name || 'Player')}${isMe ? ' (You)' : ''}</div>
                <div class="l-uid">Gaming UID: ${escHtml(u.ffUID || '—')}</div>
            </div>
            <div class="l-amt">₹${Number(u.totalEarnings || 0).toFixed(0)}</div>`;

        lbFragment.appendChild(item);
    });

    lbList.appendChild(lbFragment);
}

async function loadLeaderboard() {
    const podiumArea = document.getElementById('podium-area');
    const lbList = document.getElementById('lb-list');

    if (podiumArea) {
        podiumArea.innerHTML =
            '<div class="empty-state"><div class="spinner"></div></div>';
    }

    if (lbList) lbList.innerHTML = '';

    try {
        // v6.1: published doc first (1 read). Live query only until the admin
        // publishes for the first time.
        let users = [], meta = null;
        try {
            const pub = await fetchPublishedLeaderboard();
            if (pub && pub.entries.length) {
                users = pub.entries;
                meta = pub;
            }
        } catch (e) {
            console.warn('[Leaderboard] published read failed, using live query:', e?.message);
        }
        if (!users.length) {
            users = await fetchTopUsers();
        }
        renderLeaderboard(users, meta);
    } catch (err) {
        // v6: real failures (permission / network) surface here, distinctly from
        // the "No Rankings Available" empty state that renderLeaderboard shows
        // when the query legitimately returns zero users.
        const msg = err && err.code === 'permission-denied'
            ? 'Permission denied. Please sign in again — if this persists, contact support.'
            : (err && err.message) ? err.message : 'Unknown error';
        if (podiumArea) {
            podiumArea.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Failed to load leaderboard</div>
                    <div class="empty-sub">${escHtml(msg)}</div>
                </div>`;
        }
    }
}

initPage({
    page: 'leaderboard',
    tab: 'leaderboard',
    onReady: async () => {
        await loadLeaderboard();
    }
});