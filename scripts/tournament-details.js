import { initPage } from './app.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { db, doc, getDoc, getDocs, collection, query, where, limit, onSnapshot } from '../firebase/firebase-init.js';
import { goBack, goTo, getParam } from '../config/app-config.js';
import { formatDate, formatDateOnly, formatTimeOnly } from '../utils/formatters.js';
import { mountComponent } from '../utils/dom-helpers.js';
import { normalizeTournament, getTournamentCapacity } from '../services/tournaments.service.js';
import { sweepExpiredPendings } from '../services/expiry.service.js';

// ════════════════════════════════════════════════════════════════
// XSS PROTECTION: Firestore থেকে আসা যেকোনো string innerHTML এ বসানোর আগে escape করতে হবে।
// (`??` ব্যবহার করা হয়েছে যাতে 0 মানটা খালি string না হয়ে যায়, যেমন prizePool = 0)
// ⚠️ inline onclick="fn('${...}')" এর ভেতরে এটা যথেষ্ট নয় — ওখানে data-* attribute ব্যবহার করো।
// ════════════════════════════════════════════════════════════════
import { escHtml } from '../utils/escape.js';

// ════════════════════════════════════════════════════════════════
// REALTIME STATUS (Paid tournaments only): Pending → Confirmed/Rejected
// Listens on the existing deterministic captain-lock doc
// (tournamentCaptains/{tournamentId}_{uid}) so the User Panel updates
// instantly after Admin Confirm/Reject — no manual page refresh needed.
// Free tournaments stay untouched (already auto-confirmed on join).
// ════════════════════════════════════════════════════════════════
let _myStatusUnsub = null;
let _myStatusSeen = false;
let _lastKnownStatus = null;
let _myStatusArgs = null;   // remembered so the listener can be re-attached after a bfcache restore

function unsubscribeMyStatus() {
    if (_myStatusUnsub) {
        _myStatusUnsub();
        _myStatusUnsub = null;
    }
    _myStatusSeen = false;
    _lastKnownStatus = null;
}

function subscribeToMyStatus(tournamentId, uid) {
    // Avoid stacking multiple listeners if details are (re)loaded
    unsubscribeMyStatus();
    _myStatusArgs = { tournamentId, uid };
    const lockRef = doc(db, 'tournamentCaptains', `${tournamentId}_${uid}`);
    _myStatusUnsub = onSnapshot(lockRef, (snap) => {
        if (!snap.exists()) return;
        const status = snap.data().status;
        if (!_myStatusSeen) {
            // First snapshot just reflects what we already rendered on load
            _myStatusSeen = true;
            _lastKnownStatus = status;
            return;
        }
        if (status === _lastKnownStatus) return;
        _lastKnownStatus = status;
        if (status === 'confirmed') {
            showToast('🎉 আপনার রিকোয়েস্ট Confirmed হয়েছে!', 'success', 4500);
        } else if (status === 'rejected') {
            showToast('আপনার রিকোয়েস্ট Rejected হয়েছে। প্রয়োজনে আবার Join করুন।', 'error', 4500);
        }
        // Re-render with fresh authoritative data (room creds, participants,
        // join/pay buttons) — same render path as a normal load.
        loadTournamentDetail(tournamentId);
    }, (err) => {
        console.warn('[Realtime status] listener error:', err.message);
    });
}

// Stop listening when the user actually leaves this page
window.addEventListener('pagehide', unsubscribeMyStatus);

// Back/forward cache: the page is restored from memory (scripts do NOT re-run), so the
// listener detached on pagehide must be attached again here.
window.addEventListener('pageshow', (e) => {
    if (e.persisted && _myStatusArgs && !_myStatusUnsub) {
        subscribeToMyStatus(_myStatusArgs.tournamentId, _myStatusArgs.uid);
    }
});

// ════════════════════════════════════════════════════════════════
// TOURNAMENT DETAILS (page: tournament-details.html?id=<tournamentId>[&join=1])
// ════════════════════════════════════════════════════════════════
async function loadTournamentDetail(id) {
    const modalTitle = document.getElementById('detail-modal-title');
    const modalContent = document.getElementById('detail-modal-content');
    if (modalTitle) modalTitle.textContent = 'Loading...';
    if (modalContent) modalContent.innerHTML = `
        <div style="padding:60px 20px; text-align:center;">
            <div class="spinner" style="margin:0 auto 12px; width:36px; height:36px;"></div>
            <div style="font-size:13px; color:var(--text2);">Loading tournament details...</div>
        </div>`;
    if (!id) {
        showToast('Tournament not found', 'error');
        goBack('tournaments');
        return;
    }
    try {
        const snap = await getDoc(doc(db, 'tournaments', id));
        if (!snap.exists()) {
            showToast('Tournament not found', 'error');
            goBack('tournaments');
            return;
        }
        const t = normalizeTournament(snap.data(), snap.id);
        if (modalTitle) modalTitle.textContent = t.name;
        const uid = state.currentUser?.uid;
        const cap = getTournamentCapacity(t);
        const isFree = t.entryType === 'FREE' || t.entryFee === 0;
        const myFfUID = state.userData?.ffUID;
        // v6.1: participant list is ON-DEMAND now (refresh button) — the old code
        // fetched EVERY team (up to ~48 reads) on each details view.
        // myTeam detection uses two cheap targeted queries instead (≤2 docs each).
        // Join state is unaffected: the join flow reads what it needs itself.
        let myTeam = null;
        try {
            const capSnap = await getDocs(query(
                collection(db, 'tournamentTeams'),
                where('tournamentId', '==', id),
                where('captainUserId', '==', uid)
            ));
            if (!capSnap.empty) {
                const d = capSnap.docs[0];
                myTeam = { id: d.id, ...d.data() };
            }
        } catch (e) {
            console.warn('[Details] my-team lookup failed:', e.message);
        }
        if (!myTeam && myFfUID) {
            try {
                const tmSnap = await getDocs(query(
                    collection(db, 'tournamentTeams'),
                    where('tournamentId', '==', id),
                    where('playerFFUIDs', 'array-contains', String(myFfUID).trim()),
                    limit(1)
                ));
                if (!tmSnap.empty) {
                    const d = tmSnap.docs[0];
                    myTeam = { id: d.id, ...d.data() };
                }
            } catch (e) { /* teammate lookup must never break the page */ }
        }
        // v6.1: keep an already-loaded participant list across re-renders of the
        // SAME tournament (e.g. lock-status change) — otherwise show the prompt.
        const keepList = state.detailParticipantsLoaded === true
            && state.currentDetailId === id
            && Array.isArray(state.currentDetailTeams)
            && state.currentDetailTeams.length > 0;
        if (!keepList) {
            state.currentDetailTeams = [];
            state.detailParticipantsLoaded = false;
        }
        state.currentDetailId = id;
        const isConfirmed = myTeam && (myTeam.status === 'confirmed' || myTeam.status === 'approved');
        const isPending = myTeam && myTeam.status === 'pending';
        // ── SECURITY FIX: Fetch Secure Room Credentials Only if Confirmed ──
        if (isConfirmed) {
            try {
                const roomSnap = await getDoc(doc(db, 'roomCredentials', id));
                if (roomSnap.exists()) {
                    t.roomSettings = {
                        ...t.roomSettings,
                        ...roomSnap.data()
                    };
                }
            } catch (e) {
                console.warn('[Security] Could not fetch room credentials:', e);
            }
        }
        // Cancellation Block (if cancelled)
        let cancellationHtml = '';
        if (t.status === 'cancelled') {
            cancellationHtml = `
                <div style="background: rgba(255, 69, 58, 0.1); border: 1px solid rgba(255, 69, 58, 0.3); border-radius: 14px; padding: 14px; margin-bottom: 16px;">
                    <div style="font-size: 15px; font-weight: 800; color: var(--error); margin-bottom: 6px;">⚠️ Tournament Cancelled</div>
                    <div style="font-size: 13px; color: var(--text2); margin-bottom: 6px;">
                        <strong>Reason:</strong> ${escHtml(t.cancellationReason || 'Cancelled by admin due to technical reasons.')}
                    </div>
                    <div style="font-size: 13px; color: var(--text2); margin-bottom: 6px;">
                        <strong>Rescheduled:</strong> ${escHtml(t.rescheduledDateTime ? formatDate(t.rescheduledDateTime) : 'Rescheduled date will be announced.')}
                    </div>
                    ${!isFree ? `<div style="font-size: 12px; color: var(--gold); font-weight: 600;">💰 Refund: Processing to your wallet ledger.</div>` : ''}
                </div>`;
        }
        // Room Section (Strict eligibility check)
        let roomSectionHtml = '';
        const roomSettings = t.roomSettings || {};
        const isRoomPublished = roomSettings.isPublished === true;
        if (isConfirmed) {
            if (isRoomPublished && roomSettings.roomId) {
                const assignedSlot = myTeam.roomSlot || (roomSettings.slotAssignments && roomSettings.slotAssignments[myTeam.id]) || 'Not Assigned';
                roomSectionHtml = `
                    <div style="background: rgba(0, 200, 83, 0.08); border: 1.5px solid rgba(0, 200, 83, 0.35); border-radius: 16px; padding: 16px; margin: 16px 0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <div style="font-size: 15px; font-weight: 800; color: var(--success);">🔑 Room Details (Live)</div>
                            <span class="badge badge-ongoing">PUBLISHED</span>
                        </div>
                        <div class="room-row" style="margin-bottom:8px;">
                            <span class="room-label">Room ID</span>
                            <span class="room-val">${escHtml(roomSettings.roomId)} <button class="copy-btn" data-copy="${escHtml(roomSettings.roomId)}" onclick="copyText(this.dataset.copy,'Room ID')">Copy</button></span>
                        </div>
                        <div class="room-row" style="margin-bottom:8px;">
                            <span class="room-label">Password</span>
                            <span class="room-val">${escHtml(roomSettings.password || roomSettings.roomPassword || 'No Password')} <button class="copy-btn" data-copy="${escHtml(roomSettings.password || roomSettings.roomPassword || '')}" onclick="copyText(this.dataset.copy,'Password')">Copy</button></span>
                        </div>
                        <div class="room-row">
                            <span class="room-label">Your Room Slot</span>
                            <span class="room-val" style="color:var(--gold); font-weight:800; font-size:15px;">Slot ${escHtml(assignedSlot)}</span>
                        </div>
                    </div>`;
            } else {
                roomSectionHtml = `
                    <div style="background: var(--bg3); border-radius: 14px; padding: 14px; margin: 16px 0; text-align: center;">
                        <div style="font-size: 13px; font-weight: 700; color: var(--warning);">🔑 Room Credentials</div>
                        <div style="font-size: 12px; color: var(--text2); margin-top: 4px;">Room ID ও পাসওয়ার্ড ম্যাচ শুরুর ১৫ মিনিট আগে এখানে দেখতে পাবেন।</div>
                    </div>`;
            }
        }
        // Dynamic Prize Distribution
        let prizeDistHtml = '';
        if (t.prizeDistribution.length > 0) {
            const medals = ['🥇', '🥈', '🥉'];
            const rows = t.prizeDistribution.map((p, i) => {
                const pos = p.rank || p.position || (i + 1);
                const medal = pos <= 3 ? medals[pos - 1] : `#${escHtml(pos)}`;
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px 14px; background: var(--bg3); border-radius: 10px; margin-bottom: 6px;">
                        <span style="font-size: 14px; font-weight: 700;">${medal} ${pos > 3 ? 'Place' : ''}</span>
                        <span style="font-size: 14px; font-weight: 800; color: var(--gold);">₹${Number(p.amount || 0).toLocaleString()}</span>
                    </div>`;
            }).join('');
            prizeDistHtml = `
                <div style="margin: 18px 0;">
                    <div style="font-size: 16px; font-weight: 800; margin-bottom: 10px;">🏅 Prize Distribution</div>
                    ${rows}
                </div>`;
        }
        // Rules Formatting (Preserve exact breaks)
        const rulesText = t.rules && t.rules.trim() ? t.rules : 'Rules not available.';
        // Join Action Button at the bottom
        let bottomActionHtml = '';
        let canJoin = false;
        if (t.status === 'cancelled') {
            bottomActionHtml = `<button class="btn btn-secondary" disabled style="color:var(--error);">Tournament Cancelled</button>`;
        } else if (t.status === 'completed') {
            bottomActionHtml = `<button class="btn btn-primary" data-id="${escHtml(t.id)}" onclick="openTournamentResults(this.dataset.id)">View Results & Leaderboard 🏆</button>`;
        } else if (myTeam) {
            if (isConfirmed) {
                bottomActionHtml = `<button class="btn btn-success" disabled>Team Confirmed ✓</button>`;
            } else if (isPending) {
                bottomActionHtml = `<button class="btn" style="background:rgba(255,149,0,0.15); color:var(--warning); border:1px solid rgba(255,149,0,0.3);" disabled>Payment / Join Pending ⏳</button>`;
            } else {
                bottomActionHtml = `<button class="btn btn-danger" disabled>Registration Rejected</button>`;
            }
        } else if (cap.isFull) {
            bottomActionHtml = `<button class="btn btn-danger" disabled>Tournament Full 🔒</button>`;
        } else if (t.status === 'upcoming') {
            canJoin = true;
            bottomActionHtml = `<button class="btn-join-card" style="width:100%;" data-id="${escHtml(t.id)}" onclick="startTournamentJoin(this.dataset.id)">Join Tournament</button>`;
        }
// Build Main HTML
// Banner is optional.
// If admin did not upload an image, do not show
// any trophy placeholder or empty banner area.

const detailBannerHtml = t.bannerUrl
    ? `<img
        class="detail-banner"
        src="${escHtml(t.bannerUrl)}"
        alt="Banner"
        loading="lazy">`
    : '';

modalContent.innerHTML = `
    ${detailBannerHtml}
    <div class="detail-content">
                ${cancellationHtml}
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">
                    <span class="badge badge-mode">${escHtml(t.gameMode)}</span>
                    <span class="badge" style="background:rgba(0,200,255,0.12); color:#00C8FF;">${escHtml(t.teamFormat)}</span>
                    <span class="badge badge-map">${escHtml(t.map)}</span>
                    <span class="badge badge-${escHtml(t.status)}">${escHtml(t.status.toUpperCase())}</span>
                    <span class="badge badge-${isFree ? 'free' : 'paid'}">${isFree ? 'FREE' : 'Entry: ₹' + escHtml(t.entryFee)}</span>
                </div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-item-label">📅 Date</div><div class="detail-item-val">${t.dateObj ? formatDateOnly(t.dateObj) : '—'}</div></div>
                    <div class="detail-item"><div class="detail-item-label">⏰ Time</div><div class="detail-item-val">${t.dateObj ? formatTimeOnly(t.dateObj) : '—'}</div></div>
                    <div class="detail-item"><div class="detail-item-label">🏆 Prize Pool</div><div class="detail-item-val gold">₹${escHtml(t.prizePool)}</div></div>
                    <div class="detail-item"><div class="detail-item-label">💀 Per Kill</div><div class="detail-item-val green">₹${escHtml(t.perKill)}</div></div>
                    <div class="detail-item" style="grid-column: span 2;"><div class="detail-item-label">👥 Capacity</div><div class="detail-item-val">${cap.label}</div></div>
                </div>
                ${roomSectionHtml}
                ${prizeDistHtml}
                <!-- Tournament Rules Section -->
                <div style="margin: 18px 0;">
                    <div style="font-size: 16px; font-weight: 800; margin-bottom: 8px;">📋 Tournament Rules</div>
                    <div class="rules-list" style="white-space: pre-line; font-size: 13px; line-height: 1.6; color: var(--text2); background: var(--bg4); border-radius: 14px; padding: 14px;">${escHtml(rulesText)}</div>
                </div>
                <!-- Participants (components/participant-list.html) -->
                <div id="mount-participant-list"></div>
                <div style="margin-top: 24px;">
                    ${bottomActionHtml}
                </div>
            </div>`;
        await mountComponent('participant-list', '#mount-participant-list');
        // v6.1: participant list loads ONLY on refresh tap (see loadParticipants).
        // The count shown comes from the tournament counters (fresh, 0 extra reads).
        if (keepList) {
            renderParticipantsList(state.currentDetailTeams);
            const countEl = document.getElementById('participants-count');
            if (countEl) countEl.textContent = state.currentDetailTeams.length;
        } else {
            renderParticipantRefreshPrompt(t, cap);
        }

        // Live status for PAID tournaments only — FREE ones are already
        // instantly confirmed on join, so no pending state ever exists there.
        if (uid && !isFree) {
            subscribeToMyStatus(id, uid);
        } else {
            unsubscribeMyStatus();
            _myStatusArgs = null;
        }

        // Arrived from a card's "Join" button (?join=1) → open the join form
        if (getParam('join') === '1') {
            history.replaceState(null, '', window.location.pathname + '?id=' + encodeURIComponent(id));
            // v7: ?manual=1 bypasses the My Team page ("join without saved team")
            if (getParam('manual') === '1' && window.setJoinManualBypass) window.setJoinManualBypass();
            if (canJoin) window.startTournamentJoin(t.id);
        }
    } catch (err) {
        modalContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-title">Failed to load details</div>
                <div class="empty-sub">${escHtml(err.message)}</div>
            </div>`;
    }
}

// ════════════════════════════════════════════════════════════════
// PARTICIPANT SEARCH & RENDER HELPERS (SOLO, DUO, SQUAD ACCURATE)
// ════════════════════════════════════════════════════════════════
export function onParticipantSearch(queryText) {
    // v6.1: if the list isn't loaded yet, load it first, then filter.
    if (!state.detailParticipantsLoaded) {
        const tid = state.currentDetailId;
        if (tid) loadParticipants(tid).then(() => onParticipantSearch(queryText));
        return;
    }
    const q = (queryText || '').trim().toLowerCase();
    const teams = state.currentDetailTeams || [];
    if (!q) {
        renderParticipantsList(teams);
        return;
    }
    const filtered = teams.filter(tm => {
        const matchTeam = (tm.teamName || '').toLowerCase().includes(q) || (tm.teamId || '').toLowerCase().includes(q);
        const matchPlayer = tm.players && tm.players.some(p =>
            (p.playerName || '').toLowerCase().includes(q) ||
            String(p.ffUID || '').includes(q)
        );
        return matchTeam || matchPlayer;
    });
    renderParticipantsList(filtered);
}

function renderParticipantsList(teams) {
    const container = document.getElementById('detail-participants-list');
    if (!container) return;
    if (!teams || teams.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 20px; color:var(--text3); font-size:13px; background:var(--bg3); border-radius:12px;">
                No participants yet.
            </div>`;
        return;
    }
    container.innerHTML = teams.map((tm, idx) => {
        const isSolo = tm.teamFormat === 'SOLO' || !tm.players || tm.players.length === 1;
        const isConfirmed = tm.status === 'confirmed' || tm.status === 'approved';
        if (isSolo) {
            const player = (tm.players && tm.players[0]) || {
                playerName: tm.teamName,
                ffUID: '—'
            };
            return `
                <div style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg3); border-radius:12px; border:1px solid var(--border);">
                    <div style="font-family:monospace; font-weight:800; font-size:13px; color:var(--accent); width:24px;">
                        ${String(idx + 1).padStart(2, '0')}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:14px; font-weight:700; color:var(--text);">${escHtml(player.playerName || 'Player')}</div>
                        <div style="font-size:11px; color:var(--text2); font-family:monospace;">Gaming UID: ${escHtml(player.ffUID)}</div>
                    </div>
                    <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; ${isConfirmed ? 'background:rgba(0,230,118,0.12);color:var(--success);' : 'background:rgba(255,149,0,0.12);color:var(--warning);'}">
                        ${isConfirmed ? 'Confirmed' : 'Pending'}
                    </span>
                </div>`;
        } else {
            // DUO or SQUAD card
            const playersListHtml = (tm.players || []).map((p, pIdx) => `
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0; border-bottom:0.5px solid rgba(255,255,255,0.04);">
                    <span style="color:var(--text2);">${pIdx === 0 ? '👑 ' : ''}${escHtml(p.playerName || ('Player ' + (pIdx + 1)))}</span>
                    <span style="font-family:monospace; color:var(--text); font-weight:600;">UID: ${escHtml(p.ffUID)}</span>
                </div>
            `).join('');
            return `
                <div style="background:var(--bg3); border-radius:14px; padding:12px 14px; border:1px solid var(--border); margin-bottom:4px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div>
                            <div style="font-size:14px; font-weight:800; color:var(--text);">${escHtml(tm.teamName || 'Team')}</div>
                            <div style="font-size:11px; font-family:monospace; color:var(--accent); display:flex; align-items:center; gap:6px; margin-top:2px;">
                                ${escHtml(tm.teamId)} 
                                ${tm.teamId ? `<button class="copy-btn" style="padding:1px 6px; font-size:9px;" data-copy="${escHtml(tm.teamId)}" onclick="copyText(this.dataset.copy,'Team ID')">Copy</button>` : ''}
                            </div>
                        </div>
                        <span style="font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; ${isConfirmed ? 'background:rgba(0,230,118,0.12);color:var(--success);' : 'background:rgba(255,149,0,0.12);color:var(--warning);'}">
                            ${isConfirmed ? 'Confirmed' : 'Pending'}
                        </span>
                    </div>
                    <div style="background:rgba(0,0,0,0.2); border-radius:10px; padding:8px 10px;">
                        ${playersListHtml}
                    </div>
                </div>`;
        }
    }).join('');
}

// ════════════════════════════════════════════════════════════════
// v6.1: ON-DEMAND participant list (refresh button).
// The old code fetched EVERY team on each details view (~48 reads).
// Now the list loads only when the user taps refresh (or searches).
// ─═══════════════════════════════════════════════════════════════
function renderParticipantRefreshPrompt(t, cap) {
    const container = document.getElementById('detail-participants-list');
    const countEl = document.getElementById('participants-count');
    // Count from the tournament counters — fresh on every page open, 0 extra reads.
    if (countEl) countEl.textContent = cap.current;
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state" style="padding:18px 12px;">
            <div class="empty-icon">👥</div>
            <div class="empty-title">See who's joined</div>
            <div class="empty-sub">Tap refresh to load the participant list</div>
            <button class="btn btn-secondary btn-sm" id="participants-refresh-btn" style="margin-top:10px;">🔄 Load Participants</button>
        </div>`;
    const btn = document.getElementById('participants-refresh-btn');
    if (btn) btn.addEventListener('click', () => loadParticipants(t.id));
}

async function loadParticipants(tournamentId) {
    const container = document.getElementById('detail-participants-list');
    const btn = document.getElementById('participants-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading...'; }
    try {
        let teams = [];
        const tSnap = await getDocs(query(
            collection(db, 'tournamentTeams'),
            where('tournamentId', '==', tournamentId)
        ));
        tSnap.forEach(d => teams.push({ id: d.id, ...d.data() }));
        // Legacy fallback (kept from the old eager load)
        if (teams.length === 0) {
            const reqSnap = await getDocs(query(
                collection(db, 'joinRequests'),
                where('tournamentId', '==', tournamentId)
            ));
            reqSnap.forEach(d => {
                const dat = d.data();
                if (dat.status !== 'rejected') {
                    teams.push({
                        id: dat.teamId || d.id,
                        teamId: dat.teamId || ('TEAM-' + d.id.slice(0, 6).toUpperCase()),
                        teamName: dat.teamName || dat.userName || 'Team',
                        captainUserId: dat.userId,
                        players: [{ userId: dat.userId, playerName: dat.userName, ffUID: dat.ffUID }],
                        status: dat.status || 'confirmed',
                        roomSlot: dat.roomSlot || null
                    });
                }
            });
        }
        state.currentDetailTeams = teams;
        state.detailParticipantsLoaded = true;
        const countEl = document.getElementById('participants-count');
        if (countEl) countEl.textContent = teams.length;
        renderParticipantsList(teams);
    } catch (e) {
        console.warn('[Details] loadParticipants failed:', e.message);
        if (container) {
            container.innerHTML = `
                <div class="empty-state" style="padding:18px 12px;">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Couldn't load participants</div>
                    <div class="empty-sub">${escHtml(e.message)}</div>
                    <button class="btn btn-secondary btn-sm" id="participants-retry-btn" style="margin-top:10px;">🔄 Try Again</button>
                </div>`;
            const retry = document.getElementById('participants-retry-btn');
            if (retry) retry.addEventListener('click', () => loadParticipants(tournamentId));
        }
    }
}
window.loadParticipants = loadParticipants;

// ════════════════════════════════════════════════════════════════
// Window bindings (inline onclick handlers)
// ════════════════════════════════════════════════════════════════
window.onParticipantSearch = onParticipantSearch;
// (openTournamentResults / startTournamentJoin / joinTournament now centralized in navigation.js)

initPage({
    page: 'tournamentDetails',
    onReady: () => {
        loadTournamentDetail(getParam('id'));
        // v6: release seats held by expired unpaid pendings (throttled, silent).
        sweepExpiredPendings();
    }
});