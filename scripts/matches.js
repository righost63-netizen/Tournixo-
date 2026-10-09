import { initPage } from './app.js';
import { state } from './state.js';
import { showSkeleton, showPrompt } from './modal.js';
import { showToast } from './toast.js';
import {
    db,
    doc,
    getDoc,
    getDocs,
    updateDoc,
    collection,
    query,
    where,
    documentId,
    serverTimestamp
} from '../firebase/firebase-init.js';
import { goTo } from '../config/app-config.js';
import { formatDateOnly, formatTimeOnly } from '../utils/formatters.js';
import { normalizeTournament } from '../services/tournaments.service.js';
import { sweepExpiredPendings, expiryCountdownLabel } from '../services/expiry.service.js';

// ════════════════════════════════════════════════════════════════
// XSS PROTECTION: Firestore থেকে আসা যেকোনো string innerHTML এ বসানোর আগে escape করতে হবে।
// (`??` ব্যবহার করা হয়েছে যাতে 0 মানটা খালি string না হয়ে যায়)
// ⚠️ inline onclick="fn('${...}')" এর ভেতরে এটা যথেষ্ট নয় — ওখানে data-* attribute ব্যবহার করো।
// ════════════════════════════════════════════════════════════════
import { escHtml } from '../utils/escape.js';

// ════════════════════════════════════════════════════════════════
// MATCHES TAB FILTER & REAL DATA LOADER
// ════════════════════════════════════════════════════════════════
export function setMatchFilter(filter, btn) {
    state.matchFilter = filter;
    document.querySelectorAll('#tab-matches .filter-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadMatches();
}

export async function loadMatches() {
    const container = document.getElementById('matches-list');
    if (!container) return;
    showSkeleton('matches-list');
    const uid = state.currentUser?.uid;
    if (!uid) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎮</div>
                <div class="empty-title">Sign In Required</div>
                <div class="empty-sub">Log in to view your joined matches and room slots</div>
            </div>`;
        return;
    }
    try {
        // 1. Fetch all teams where user is captain OR a teammate.
        // Teammates are stored with userId:'' (only their ffUID is known), so they
        // are found through the flat `playerFFUIDs` array using their profile ffUID.
        const myTeams = [];
        const seenTeamIds = new Set();
        const addTeam = d => {
            if (seenTeamIds.has(d.id)) return;
            seenTeamIds.add(d.id);
            myTeams.push({
                id: d.id,
                ...d.data()
            });
        };
        const myFFUID = String(state.userData?.ffUID ?? '').trim();
        const teamQueries = [
            getDocs(query(collection(db, 'tournamentTeams'), where('captainUserId', '==', uid)))
        ];
        if (myFFUID) {
            teamQueries.push(
                getDocs(query(collection(db, 'tournamentTeams'), where('playerFFUIDs', 'array-contains', myFFUID)))
                    .catch(e => {
                        // teammate lookup must never break the captain's own list
                        console.warn('[Matches] teammate lookup failed:', e.message);
                        return null;
                    })
            );
        }
        const teamSnaps = await Promise.all(teamQueries);
        teamSnaps.forEach(snap => snap && snap.forEach(addTeam));
        // Fallback to legacy joinRequests if user has old matches
        if (myTeams.length === 0) {
            try {
                const reqSnap = await getDocs(query(collection(db, 'joinRequests'), where('userId', '==', uid)));
                reqSnap.forEach(d => {
                    const dat = d.data();
                    myTeams.push({
                        id: dat.teamId || d.id,
                        teamId: dat.teamId || ('TEAM-' + d.id.slice(0, 6).toUpperCase()),
                        teamName: dat.teamName || dat.userName || 'Solo Team',
                        tournamentId: dat.tournamentId,
                        tournamentName: dat.tournamentName,
                        teamFormat: 'SOLO',
                        captainUserId: dat.userId,
                        status: dat.status || 'confirmed',
                        paymentStatus: dat.status === 'confirmed' ? 'approved' : 'pending',
                        locked: true,
                        roomSlot: dat.roomSlot || null,
                        players: [{
                            userId: dat.userId,
                            playerName: dat.userName,
                            ffUID: dat.ffUID
                        }]
                    });
                });
            } catch (e) {}
        }
        if (myTeams.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎮</div>
                    <div class="empty-title">No Matches Yet</div>
                    <div class="empty-sub">Join an upcoming tournament to see your team and room details here</div>
                </div>`;
            return;
        }
        // 2. Fetch corresponding tournament docs in batch chunks of 30
        const tournIds = [...new Set(myTeams.map(t => t.tournamentId).filter(Boolean))];
        const tournamentMap = {};
        if (tournIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < tournIds.length; i += 30) {
                chunks.push(tournIds.slice(i, i + 30));
            }
            await Promise.all(chunks.map(async chunk => {
                try {
                    const bSnap = await getDocs(query(collection(db, 'tournaments'), where(documentId(), 'in', chunk)));
                    bSnap.forEach(d => {
                        tournamentMap[d.id] = normalizeTournament(d.data(), d.id);
                    });
                } catch (e) {
                    await Promise.all(chunk.map(async tid => {
                        try {
                            const s = await getDoc(doc(db, 'tournaments', tid));
                            if (s.exists()) tournamentMap[s.id] = normalizeTournament(s.data(), s.id);
                        } catch (err) {}
                    }));
                }
            }));
        }
        // 3. Securely batch-fetch Room Credentials for CONFIRMED teams only.
        // (Previously did one getDoc per confirmed team inside the loop — N+1.
        //  Now collects the ids first and reads them in chunked 'in' queries,
        //  same pattern already used above for tournaments.)
        const confirmedTournIds = [...new Set(
            myTeams
                .filter(tm => tm.status === 'confirmed' || tm.status === 'approved')
                .map(tm => tm.tournamentId)
                .filter(Boolean)
        )];
        const roomCredMap = {};
        if (confirmedTournIds.length > 0) {
            const rChunks = [];
            for (let i = 0; i < confirmedTournIds.length; i += 30) {
                rChunks.push(confirmedTournIds.slice(i, i + 30));
            }
            await Promise.all(rChunks.map(async chunk => {
                try {
                    const rSnap = await getDocs(query(collection(db, 'roomCredentials'), where(documentId(), 'in', chunk)));
                    rSnap.forEach(d => {
                        roomCredMap[d.id] = d.data();
                    });
                } catch (e) {
                    // Fallback only if the batched query itself fails
                    await Promise.all(chunk.map(async tid => {
                        try {
                            const s = await getDoc(doc(db, 'roomCredentials', tid));
                            if (s.exists()) roomCredMap[s.id] = s.data();
                        } catch (err) {}
                    }));
                }
            }));
        }

        // 4. Combine matches with tournaments (room data reused from the batch above)
        // FIX: when the admin deletes a tournament its doc no longer exists —
        // drop that team instead of rendering a fake fallback card, so deleted
        // tournaments disappear from Matches.
        let matchList = [];
        myTeams.forEach(tm => {
            const tourn = tm.tournamentId ? tournamentMap[tm.tournamentId] : null;
            if (tm.tournamentId && !tourn) return; // deleted by admin → hide
            const t = tourn || {
                id: tm.tournamentId,
                name: tm.tournamentName || 'Tournament',
                status: 'upcoming',
                gameMode: tm.teamFormat || 'BR Ranked',
                map: 'Bermuda',
                roomSettings: {}
            };
            if ((tm.status === 'confirmed' || tm.status === 'approved') && tm.tournamentId && roomCredMap[tm.tournamentId]) {
                t.roomSettings = {
                    ...t.roomSettings,
                    ...roomCredMap[tm.tournamentId]
                };
            }
            matchList.push({ team: tm, tournament: t });
        });
        // 5. Apply filter (All / Active / Completed)
        const filter = state.matchFilter || 'all';
        if (filter === 'active') {
            matchList = matchList.filter(m => m.tournament.status === 'upcoming' || m.tournament.status === 'ongoing');
        } else if (filter === 'completed') {
            matchList = matchList.filter(m => m.tournament.status === 'completed');
        }
        if (matchList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎮</div>
                    <div class="empty-title">No ${escHtml(filter.toUpperCase())} Matches</div>
                    <div class="empty-sub">Check back later or try another filter</div>
                </div>`;
            return;
        }
        // Render match cards — batched into one DocumentFragment so the
        // browser does a single reflow/repaint instead of one per card.
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        matchList.forEach((m, idx) => {
            const card = buildMatchCard(m);
            card.style.animationDelay = (idx * 0.05) + 's';
            frag.appendChild(card);
        });
        container.appendChild(frag);
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-title">Failed to load matches</div>
                <div class="empty-sub">${escHtml(err.message)}</div>
            </div>`;
    }
}

// ════════════════════════════════════════════════════════════════
// BUILD MATCH CARD (TEAM DETAILS, LOCK STATUS & ROOM CREDENTIALS)
// ════════════════════════════════════════════════════════════════
function buildMatchCard(m) {
    const {
        team: tm,
        tournament: t
    } = m;
    const isConfirmed = tm.status === 'confirmed' || tm.status === 'approved';
    const isPending = tm.status === 'pending';
    const isExpired = tm.status === 'expired';
    const isLocked = tm.locked === true;
    // Room settings & publication state
    const roomSettings = t.roomSettings || {};
    const isRoomPublished = roomSettings.isPublished === true;
    const assignedSlot = tm.roomSlot || (roomSettings.slotAssignments && roomSettings.slotAssignments[tm.id]) || null;

    // Status badge (top-right, first pill)
    const statusBadge = isConfirmed
        ? `<div class="badge confirmed">✅ Confirmed</div>`
        : isPending
            ? `<div class="badge pending">⏳ Pending</div>`
            : isExpired
                ? `<div class="badge expired">⌛ Expired</div>`
                : `<div class="badge rejected">❌ Rejected</div>`;
    const lockBadge = `<div class="badge ${isLocked ? 'locked' : 'unlocked'}">${isLocked ? '🔒 Locked' : '🔓 Unlocked'}</div>`;

    // Note box (room info / status explanation)
    let noteHtml = '';
    if (isConfirmed) {
        if (isRoomPublished && roomSettings.roomId) {
            noteHtml = `
                <div class="note ready">
                    <div class="room-row" style="margin-bottom:8px;">
                        <span class="room-label">🔑 Room Published</span>
                        <span class="slot">Slot: ${assignedSlot ? escHtml(assignedSlot) : 'Assigned in-game'}</span>
                    </div>
                    <div class="room-row">
                        <span class="room-label">Room ID</span>
                        <span class="room-val">${escHtml(roomSettings.roomId)} <button class="copy-btn" data-copy="${escHtml(roomSettings.roomId)}" onclick="copyText(this.dataset.copy,'Room ID')">Copy</button></span>
                    </div>
                    <div class="room-row">
                        <span class="room-label">Password</span>
                        <span class="room-val">${escHtml(roomSettings.password || roomSettings.roomPassword || 'No Password')} <button class="copy-btn" data-copy="${escHtml(roomSettings.password || roomSettings.roomPassword || '')}" onclick="copyText(this.dataset.copy,'Password')">Copy</button></span>
                    </div>
                </div>`;
        } else {
            noteHtml = `
                <div class="note wait">
                    🔑 Room ID ও পাসওয়ার্ড admin publish করলেই এখানে দেখা যাবে। ${assignedSlot ? `<span class="slot">Your Slot: ${escHtml(assignedSlot)}</span>` : ''}
                </div>`;
        }
    } else if (isPending) {
        // v6: show the payment deadline countdown (unpaid pendings auto-expire).
        const expiryLabel = tm.expiresAt ? expiryCountdownLabel(tm.expiresAt) : '';
        noteHtml = `
            <div class="note wait">
                ⏳ পেমেন্ট বা জয়েন রিকোয়েস্ট অ্যাডমিন ভেরিফাই করলে টিম কনফার্ম হবে ও রুম তথ্য আনলক হবে।
                ${expiryLabel ? `<div style="margin-top:6px;font-weight:700;">⏱️ Payment expires in ${escHtml(expiryLabel)} — complete payment before time runs out!</div>` : ''}
            </div>`;
    } else if (isExpired) {
        noteHtml = `
            <div class="note reject">
                ⌛ এই জয়েন রিকোয়েস্টের পেমেন্ট সময় শেষ হয়ে গেছে। আবার join করতে চাইলে নতুন করে join করো।
            </div>`;
    } else {
        noteHtml = `
            <div class="note reject">
                ❌ দুঃখিত, আপনার জয়েন রিকোয়েস্ট/পেমেন্ট অ্যাডমিন কর্তৃক রিজেক্ট করা হয়েছে।
            </div>`;
    }

    // Players preview
    const playersPreview = (tm.players || []).map((p, i) =>
        `${i === 0 ? '👑 ' : ''}${escHtml(p.playerName || 'P')} — <b>${escHtml(p.ffUID)}</b>`
    ).join(' &nbsp;·&nbsp; ');

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
        <div class="m-top">
            <div>
                <div class="m-title">${escHtml(t.name)}</div>
                <div class="m-sub">${escHtml(t.gameMode)} · ${t.dateObj ? formatDateOnly(t.dateObj) : ''} ${t.dateObj ? formatTimeOnly(t.dateObj) : ''}</div>
            </div>
            <div class="badges">
                ${statusBadge}
                ${lockBadge}
            </div>
        </div>
        <div class="team-row">
            <div class="team-top">
                <div class="team-name">${escHtml(tm.teamName || 'Team')}</div>
                <div class="team-code">
                    <span class="code">${escHtml(tm.teamId)}</span>
                    <span class="copy" data-copy="${escHtml(tm.teamId)}" onclick="copyText(this.dataset.copy,'Team ID')">Copy</span>
                </div>
            </div>
            <div class="member">${playersPreview}</div>
        </div>
        ${noteHtml}
        <div class="btn-row">
            <button class="btn ghost" data-id="${escHtml(t.id)}" onclick="openTournDetail(this.dataset.id)">View Details</button>
            ${isPending && tm.paymentStatus === 'unpaid' && t.entryFee > 0 && tm.captainUserId === state.currentUser?.uid ? `
                <button class="btn primary" data-tid="${escHtml(t.id)}" data-team="${escHtml(tm.teamId)}" onclick="resumeTeamPayment(this.dataset.tid, this.dataset.team)">💳 Pay / Submit UTR</button>
            ` : ''}
            ${!isLocked && tm.captainUserId === state.currentUser?.uid ? `
                <button class="btn ghost" data-team-id="${escHtml(tm.teamId)}" data-team-name="${escHtml(tm.teamName || '')}" onclick="promptEditTeamName(this.dataset.teamId, this.dataset.teamName)">Edit Name ✏️</button>
            ` : ''}
            ${t.status === 'completed' ? `
                <button class="btn primary" data-id="${escHtml(t.id)}" onclick="openTournamentResults(this.dataset.id)">View Results 🏆</button>
            ` : ''}
        </div>
    `;
    return card;
}

// ════════════════════════════════════════════════════════════════
// SYNCHRONIZED TEAM EDIT & LOCK RESTRICTION
// ════════════════════════════════════════════════════════════════
export async function promptEditTeamName(teamId, currentName) {
    const rawName = await showPrompt('Edit Team Name', 'Allowed only before match lock (max 25 characters).', {
        value: currentName || '',
        placeholder: 'Team name',
        maxLength: 25
    });
    if (!rawName || rawName === currentName) return;
    const newName = rawName;
    if (newName.length > 25) {
        showToast('Team name cannot exceed 25 characters', 'warning');
        return;
    }
    try {
        const teamRef = doc(db, 'tournamentTeams', teamId);
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists()) {
            showToast('Team not found', 'error');
            return;
        }
        const teamData = teamSnap.data();
        // ১. শুধুমাত্র ক্যাপ্টেনই নাম এডিট করতে পারবে
        if (teamData.captainUserId !== state.currentUser?.uid) {
            showToast('Unauthorized: Only the team captain can edit team name', 'error');
            return;
        }
        // ২. টিম লক করা থাকলে কোনো এডিট চলবে না
        if (teamData.locked === true) {
            showToast('🔒 Cannot edit. Your team has been LOCKED by admin!', 'error', 4500);
            return;
        }
        // ৩. টুর্নামেন্ট যদি শুরু (ongoing) বা শেষ (completed) হয়ে গিয়ে থাকে তবে এডিট বন্ধ
        if (teamData.tournamentId) {
            const tournSnap = await getDoc(doc(db, 'tournaments', teamData.tournamentId));
            if (tournSnap.exists()) {
                const tStatus = tournSnap.data().status;
                if (tStatus !== 'upcoming') {
                    showToast(`Cannot edit team. Tournament is already ${String(tStatus).toUpperCase()}!`, 'error', 4500);
                    return;
                }
            }
        }
        // ৪. টিমের নাম আপডেট করা
        await updateDoc(teamRef, {
            teamName: newName,
            updatedAt: serverTimestamp()
        });
        // v6: paymentRequests name-sync removed — that collection is admin-only
        // write, so the sync could never succeed (it failed silently in catch).
        // The admin panel reads the team name from the team doc itself.
        showToast('Team name updated successfully! ✅', 'success');
        loadMatches();
    } catch (e) {
        showToast('Failed to update team: ' + e.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// Buttons that open other pages (multi-page navigation)
// ════════════════════════════════════════════════════════════════
window.setMatchFilter = setMatchFilter;
window.promptEditTeamName = promptEditTeamName;
// (openTournDetail / openTournamentResults now centralized in navigation.js)
// Unpaid team → payment page (payment page loads tournament + team by id)
window.resumeTeamPayment = (tournId, teamId) => goTo('payment', { id: tournId, team: teamId });

initPage({
    page: 'matches',
    tab: 'matches',
    onReady: () => {
        loadMatches();
        // v6: opportunistically release seats held by expired unpaid pendings.
        sweepExpiredPendings().then(n => { if (n > 0) loadMatches(); });
    }
});