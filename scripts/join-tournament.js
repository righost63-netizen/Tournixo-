// Join flow. Loaded on demand by scripts/tournament-details.js
// (window.startTournamentJoin → import('./join-tournament.js')).
import { state } from './state.js';
import { showToast, flashToast } from './toast.js';
import { openModal, closeModal } from './modal.js';
import {
    db,
    doc,
    getDoc,
    getDocs,
    collection,
    query,
    where,
    runTransaction,
    serverTimestamp,
    arrayUnion,
    increment
} from '../firebase/firebase-init.js';
import { goTo, goReplace, APP_CONFIG } from '../config/app-config.js';
import { mountComponent } from '../utils/dom-helpers.js';
import { escHtml } from '../utils/escape.js';
import { isNumeric } from '../utils/validators.js';
import { normalizeTournament, getTournamentCapacity } from '../services/tournaments.service.js';

// ════════════════════════════════════════════════════════════════
// COLLISION-PROOF UNIQUE TEAM ID GENERATOR
// ════════════════════════════════════════════════════════════════
export function generateTeamId() {
    // বর্তমান টাইমস্ট্যাম্পের Base36 + ৪ অক্ষরের র‍্যান্ডম ক্যারেক্টার
    // উদাহরণ: TEAM-M3K9P-X8F4 (কখনোই দুটি টিমের আইডি এক হবে না)
    const timePart = Date.now().toString(36).toUpperCase().slice(-5);
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // বিভ্রান্তিকর 0, 1, O, I বাদ দেওয়া হয়েছে
    let randomPart = '';
    for (let i = 0; i < 4; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `TEAM-${timePart}-${randomPart}`;
}

// The join form (components/join-tournament-modal.html) is mounted once, when first needed
async function ensureJoinModal() {
    if (document.getElementById('modal-join-tournament')) return;
    await mountComponent('join-tournament-modal', document.getElementById('app') || document.body);
}

// ════════════════════════════════════════════════════════════════
// START TOURNAMENT JOIN (SOLO / DUO / SQUAD DYNAMIC FORM)
// ════════════════════════════════════════════════════════════════
export async function startTournamentJoin(id) {
    const uid = state.currentUser?.uid;
    if (!uid) {
        showToast('Please sign in to join tournaments', 'error');
        goReplace('login');
        return;
    }
    // Fetch latest tournament document
    let t = null;
    try {
        const snap = await getDoc(doc(db, 'tournaments', id));
        if (!snap.exists()) {
            showToast('Tournament not found', 'error');
            return;
        }
        t = normalizeTournament(snap.data(), snap.id);
    } catch (e) {
        showToast('Failed to load tournament: ' + e.message, 'error');
        return;
    }
    if (t.status !== 'upcoming') {
        showToast(`Cannot join. Tournament is ${t.status.toUpperCase()}`, 'error');
        return;
    }
    const cap = getTournamentCapacity(t);
    if (cap.isFull) {
        showToast('Tournament is already FULL 🔒', 'error');
        return;
    }
    // Check duplicate active team by current captain
    try {
        const existingTeamSnap = await getDocs(query(
            collection(db, 'tournamentTeams'),
            where('tournamentId', '==', t.id),
            where('captainUserId', '==', uid)
        ));
        if (!existingTeamSnap.empty) {
            const existing = existingTeamSnap.docs[0].data();
            // 🛡️ যদি রেজিস্ট্রেশন হয়েছে কিন্তু পেমেন্ট বাকি থাকে, তবে সরাসরি পেমেন্ট পেজ ওপেন হবে
            if (existing.status === 'pending' && existing.paymentStatus === 'unpaid' && t.entryFee > 0) {
                showToast(`Resuming payment for Team ${existing.teamName || existing.teamId}...`, 'info', 3000);
                goTo('payment', { id: t.id, team: existing.teamId });
                return;
            }
            // যদি ইতোমধ্যে পেমেন্ট সাবমিট করা থাকে
            if (existing.status === 'pending' && existing.paymentStatus === 'pending') {
                showToast(`Payment for Team ${existing.teamId} is pending admin verification.`, 'info', 4000);
                return;
            }
            if (existing.status !== 'rejected') {
                showToast(`You have already registered (${existing.teamId})`, 'info', 4000);
                return;
            }
        }
    } catch (e) {}

    // v7: SQUAD/DUO go through the persistent My Team page first.
    // SOLO keeps the existing modal form unchanged.
    // (?manual=1 bypasses My Team — "join without saved team")
    const _fmt = String(t.teamFormat || 'SOLO').toUpperCase();
    if ((_fmt === 'SQUAD' || _fmt === 'DUO') && !state.joinManualBypass) {
        goTo('myTeam', { join: t.id });
        return;
    }
    state.joinManualBypass = false;

    await ensureJoinModal();
    state.activeJoinTournament = t;

    // Update Mini Summary in Join Modal
    const isFree = t.entryType === 'FREE' || t.entryFee === 0;
    document.getElementById('join-summary-name').textContent = t.name;
    document.getElementById('join-summary-mode').textContent = t.gameMode;
    document.getElementById('join-summary-fee').textContent = isFree ? 'FREE' : '₹' + t.entryFee;
    document.getElementById('join-summary-format').textContent = t.teamFormat;

    const formContainer = document.getElementById('join-form-container');
    const uData = state.userData || {};
    const uName = uData.name || '';
    const uFFUID = uData.ffUID || '';

    if (t.teamFormat === 'SOLO') {
        formContainer.innerHTML = `
            <div style="background:var(--bg3); border-radius:14px; padding:16px; border:1px solid var(--border);">
                <div style="font-size:14px; font-weight:800; margin-bottom:14px; color:var(--accent);">🎮 Player Details (Solo)</div>
                <label class="auth-label">Player Name</label>
                <div class="input-group">
                    <span class="input-icon">👤</span>
                    <input id="solo-player-name" type="text" value="${escHtml(uName)}" placeholder="Your Full Name">
                </div>
                <label class="auth-label">Free Fire Gaming UID <span style="color:var(--error)">*</span></label>
                <div class="input-group">
                    <span class="input-icon">🎯</span>
                    <input id="solo-player-uid" type="number" value="${escHtml(uFFUID)}" placeholder="Numeric Gaming UID" inputmode="numeric">
                </div>
            </div>`;
    } else if (t.teamFormat === 'DUO') {
        formContainer.innerHTML = `
            <div style="background:var(--bg3); border-radius:14px; padding:16px; border:1px solid var(--border); margin-bottom:12px;">
                <label class="auth-label">Team Name <span style="color:var(--error)">*</span></label>
                <div class="input-group">
                    <span class="input-icon">🛡️</span>
                    <input id="duo-team-name" type="text" placeholder="Enter Team Name">
                </div>
            </div>
            <!-- Captain (You) -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border); margin-bottom:10px;">
                <div style="font-size:13px; font-weight:800; color:var(--gold); margin-bottom:8px;">👑 Captain (Player 1)</div>
                <div style="font-size:13px; color:var(--text); font-weight:600;">${escHtml(uName)}</div>
                <div style="font-size:12px; color:var(--text2); font-family:monospace;">Gaming UID: ${escHtml(uFFUID)}</div>
                <input id="duo-p1-uid" type="hidden" value="${escHtml(uFFUID)}">
                <input id="duo-p1-name" type="hidden" value="${escHtml(uName)}">
            </div>
            <!-- Teammate 2 -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border);">
                <div style="font-size:13px; font-weight:800; color:var(--accent); margin-bottom:8px;">Player 2</div>
                <label class="auth-label">Player 2 Name</label>
                <div class="input-group">
                    <span class="input-icon">👤</span>
                    <input id="duo-p2-name" type="text" placeholder="Teammate 2 Name">
                </div>
                <label class="auth-label">Player 2 Gaming UID <span style="color:var(--error)">*</span></label>
                <div class="input-group">
                    <span class="input-icon">🎯</span>
                    <input id="duo-p2-uid" type="number" placeholder="Numeric Gaming UID" inputmode="numeric">
                </div>
            </div>`;
    } else {
        // SQUAD (4 Players Required)
        formContainer.innerHTML = `
            <div style="background:var(--bg3); border-radius:14px; padding:16px; border:1px solid var(--border); margin-bottom:12px;">
                <label class="auth-label">Squad Team Name <span style="color:var(--error)">*</span></label>
                <div class="input-group">
                    <span class="input-icon">🛡️</span>
                    <input id="squad-team-name" type="text" placeholder="Enter Squad Name">
                </div>
            </div>
            <!-- Captain (You) -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border); margin-bottom:10px;">
                <div style="font-size:13px; font-weight:800; color:var(--gold); margin-bottom:8px;">👑 Squad Captain (Player 1)</div>
                <div style="font-size:13px; color:var(--text); font-weight:600;">${escHtml(uName)}</div>
                <div style="font-size:12px; color:var(--text2); font-family:monospace;">Gaming UID: ${escHtml(uFFUID)}</div>
                <input id="squad-p1-uid" type="hidden" value="${escHtml(uFFUID)}">
                <input id="squad-p1-name" type="hidden" value="${escHtml(uName)}">
            </div>
            <!-- Player 2 -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border); margin-bottom:10px;">
                <div style="font-size:13px; font-weight:800; color:var(--accent); margin-bottom:8px;">Player 2</div>
                <div class="input-group" style="height:46px; margin-bottom:8px;">
                    <input id="squad-p2-name" type="text" placeholder="Player 2 Name">
                </div>
                <div class="input-group" style="height:46px; margin-bottom:0;">
                    <input id="squad-p2-uid" type="number" placeholder="Player 2 Gaming UID" inputmode="numeric">
                </div>
            </div>
            <!-- Player 3 -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border); margin-bottom:10px;">
                <div style="font-size:13px; font-weight:800; color:var(--accent); margin-bottom:8px;">Player 3</div>
                <div class="input-group" style="height:46px; margin-bottom:8px;">
                    <input id="squad-p3-name" type="text" placeholder="Player 3 Name">
                </div>
                <div class="input-group" style="height:46px; margin-bottom:0;">
                    <input id="squad-p3-uid" type="number" placeholder="Player 3 Gaming UID" inputmode="numeric">
                </div>
            </div>
            <!-- Player 4 -->
            <div style="background:var(--bg3); border-radius:14px; padding:14px; border:1px solid var(--border);">
                <div style="font-size:13px; font-weight:800; color:var(--accent); margin-bottom:8px;">Player 4</div>
                <div class="input-group" style="height:46px; margin-bottom:8px;">
                    <input id="squad-p4-name" type="text" placeholder="Player 4 Name">
                </div>
                <div class="input-group" style="height:46px; margin-bottom:0;">
                    <input id="squad-p4-uid" type="number" placeholder="Player 4 Gaming UID" inputmode="numeric">
                </div>
            </div>`;
    }
    openModal('modal-join-tournament');
}

// ════════════════════════════════════════════════════════════════
// TOURNAMENT REGISTRATION SUBMISSION (SOLO, DUO, SQUAD)
// Handles both FREE (Instant Confirm) & PAID (Proceed to UPI Payment page)
// ════════════════════════════════════════════════════════════════
export async function submitTournamentRegistration() {
    const t = state.activeJoinTournament;
    const uid = state.currentUser?.uid;
    const uData = state.userData || {};
    if (!t || !uid) {
        showToast('Session expired. Please re-open the tournament.', 'error');
        return;
    }
    const submitBtn = document.getElementById('join-submit-btn');
    const originalBtnText = submitBtn.innerHTML;
    try {
        let teamName = '';
        let players = [];
        const format = t.teamFormat || 'SOLO';

        // ── ১. ভ্যালিডেশন এবং ডেটা সংগ্রহ (Solo, Duo, Squad) ──
        if (format === 'SOLO') {
            const pName = document.getElementById('solo-player-name')?.value.trim() || uData.name || 'Player';
            const pUid = document.getElementById('solo-player-uid')?.value.trim();
            if (!pUid) {
                showToast('Please enter your Free Fire Gaming UID', 'warning');
                return;
            }
            if (!isNumeric(pUid)) {
                showToast('Free Fire UID must be numeric only', 'warning');
                return;
            }
            teamName = pName;
            players.push({
                userId: uid,
                playerName: pName,
                ffUID: pUid
            });
        } else if (format === 'DUO') {
            teamName = document.getElementById('duo-team-name')?.value.trim();
            if (!teamName) {
                showToast('Please enter your Duo Team Name', 'warning');
                return;
            }
            const p1Uid = document.getElementById('duo-p1-uid')?.value.trim() || uData.ffUID;
            const p1Name = document.getElementById('duo-p1-name')?.value.trim() || uData.name || 'Captain';
            const p2Name = document.getElementById('duo-p2-name')?.value.trim() || 'Player 2';
            const p2Uid = document.getElementById('duo-p2-uid')?.value.trim();
            if (!p2Uid) {
                showToast('Please enter Player 2 Gaming UID', 'warning');
                return;
            }
            if (!isNumeric(p2Uid)) {
                showToast('Player 2 UID must be numeric', 'warning');
                return;
            }
            if (p1Uid === p2Uid) {
                showToast('Captain and Teammate cannot have the same Free Fire UID!', 'error');
                return;
            }
            players.push({
                userId: uid,
                playerName: p1Name,
                ffUID: p1Uid
            });
            players.push({
                userId: '',
                playerName: p2Name,
                ffUID: p2Uid
            });
        } else {
            // SQUAD (4 Players)
            teamName = document.getElementById('squad-team-name')?.value.trim();
            if (!teamName) {
                showToast('Please enter your Squad Team Name', 'warning');
                return;
            }
            const p1Uid = document.getElementById('squad-p1-uid')?.value.trim() || uData.ffUID;
            const p1Name = document.getElementById('squad-p1-name')?.value.trim() || uData.name || 'Captain';
            const p2Name = document.getElementById('squad-p2-name')?.value.trim() || 'Player 2';
            const p2Uid = document.getElementById('squad-p2-uid')?.value.trim();
            const p3Name = document.getElementById('squad-p3-name')?.value.trim() || 'Player 3';
            const p3Uid = document.getElementById('squad-p3-uid')?.value.trim();
            const p4Name = document.getElementById('squad-p4-name')?.value.trim() || 'Player 4';
            const p4Uid = document.getElementById('squad-p4-uid')?.value.trim();
            if (!p2Uid || !p3Uid || !p4Uid) {
                showToast('All 4 players Free Fire UIDs are required for Squad', 'warning');
                return;
            }
            const uids = [p1Uid, p2Uid, p3Uid, p4Uid];
            if (uids.some(id => !isNumeric(id))) {
                showToast('All Free Fire UIDs must be numeric', 'warning');
                return;
            }
            // স্কোয়াডে কোনো ডুপ্লিকেট UID রয়েছে কি না যাচাই
            const uniqueUids = new Set(uids);
            if (uniqueUids.size !== 4) {
                showToast('Duplicate Free Fire UIDs detected in your Squad!', 'error');
                return;
            }
            players.push({
                userId: uid,
                playerName: p1Name,
                ffUID: p1Uid
            });
            players.push({
                userId: '',
                playerName: p2Name,
                ffUID: p2Uid
            });
            players.push({
                userId: '',
                playerName: p3Name,
                ffUID: p3Uid
            });
            players.push({
                userId: '',
                playerName: p4Name,
                ffUID: p4Uid
            });
        }

        // ── সব প্লেয়ারের FF UID নরমালাইজ + ভ্যালিডেট (lock doc ID এর জন্য জরুরি) ──
        players.forEach(p => { p.ffUID = String(p.ffUID ?? '').trim(); });
        if (players.some(p => !p.ffUID || !isNumeric(p.ffUID))) {
            showToast('All players must have a valid numeric Free Fire UID (check your profile UID)', 'warning');
            return;
        }
        if (new Set(players.map(p => p.ffUID)).size !== players.length) {
            showToast('Duplicate Free Fire UIDs detected in your team!', 'error');
            return;
        }

        // বাটন লোডিং স্টেট
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;"></div> Processing...';

        // ── v6.1: ADVISORY PRE-CHECK REMOVED ──
        // The old code downloaded EVERY team of the tournament here (up to ~48
        // reads per join) for a friendly duplicate error. The atomic duplicate
        // check inside the transaction below (tournamentPlayerUIDs locks) gives
        // the same friendly error — so this scan was pure waste. Removed.

        // ── v7: the rest runs through the shared executor ──
        await runJoinTransaction(t, teamName, players, null, { submitBtn, fromModal: true });
    } catch (err) {
        // errors are toasted inside runJoinTransaction
    }
}

// ── v7: shared join executor — manual form AND My Team use this ──
// persistentTeamId: links the entry to a saved team (null for manual joins).
export async function runJoinTransaction(t, teamName, players, persistentTeamId, opts = {}) {
    const uid = state.currentUser?.uid;
    const uData = state.userData || {};
    const submitBtn = opts.submitBtn || null;
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
    const format = t.teamFormat || 'SOLO';
    const fromModal = opts.fromModal !== false;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;"></div> Processing...';
    }
    try {
            const teamId = generateTeamId();
            const isFree = (t.entryType === 'FREE' || Number(t.entryFee || 0) === 0);

            // ════════════════════════════════════════════════════════════════
    // TEAM PAYLOAD
    // FREE tournament:
    //   - immediately confirmed
    //   - automatically locked
    //   - roomSlot will be assigned inside the transaction
    //
    // PAID tournament:
    //   - existing pending/payment flow remains unchanged
    // ════════════════════════════════════════════════════════════════
    const teamPayload = {
        teamId: teamId,
        tournamentId: t.id,
        tournamentName: t.name,
        teamName: teamName,
        teamFormat: format,
        persistentTeamId: persistentTeamId || null, // v7: link to saved team
        captainUserId: uid,
        captainName: uData.name || 'User',
        captainEmail: uData.email || state.currentUser?.email || '',
        players: players,

        // ✅ টিমমেটরা (userId: '') যাতে নিজেদের Matches পেজে টিম দেখতে পায়:
        // ffUID এর flat array — Firestore এ array-of-objects এর ভেতরে query করা যায় না,
        // তাই matches.js এই ফিল্ডে array-contains দিয়ে খোঁজে।
        playerFFUIDs: players.map(p => String(p.ffUID).trim()),

        // FREE = immediately confirmed
        // PAID = pending until payment/admin verification
        status: isFree ? 'confirmed' : 'pending',

        paymentStatus: isFree ? 'free' : 'unpaid',

        // FREE tournament will be locked automatically.
        // PAID tournament keeps the existing unlocked state.
        locked: isFree,

        // IMPORTANT:
        // Free tournament roomSlot is calculated from the latest
        // filledTeams value INSIDE the Firestore transaction.
        roomSlot: null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

            const tournRef = doc(db, 'tournaments', t.id);
            const teamRef = doc(db, 'tournamentTeams', teamId);
            const userRef = doc(db, 'users', uid);
            // 🛡️ ক্যাপ্টেনের জন্য ইউনিক লক ডকুমেন্ট (ডাবল ক্লিক ও ডুপ্লিকেট টিম রোধ)
            const captainLockRef = doc(db, 'tournamentCaptains', `${t.id}_${uid}`);
            // 🛡️ প্রতিটি FF UID এর জন্য ইউনিক লক ডকুমেন্ট (cross-team duplicate UID atomic ভাবে ব্লক)
            const playerUidLocks = players.map(p => ({
                player: p,
                ref: doc(db, 'tournamentPlayerUIDs', `${t.id}_${p.ffUID}`)
            }));

    // ════════════════════════════════════════════════════════════════
    // ATOMIC TOURNAMENT REGISTRATION
    //
    // FREE:
    //   Join → Confirmed → Auto Lock → Auto Slot → Joined
    //
    // PAID:
    //   Existing Pending → Payment flow remains unchanged
    //
    // Firestore transaction guarantees that if multiple users join
    // at nearly the same time, each user receives a different slot.
    // ════════════════════════════════════════════════════════════════
    await runTransaction(db, async (transaction) => {

        // ────────────────────────────────────────────────────────────
        // 1. DUPLICATE CAPTAIN CHECK
        // ────────────────────────────────────────────────────────────
        const lockSnap = await transaction.get(captainLockRef);

        if (
            lockSnap.exists() &&
            lockSnap.data().status !== 'rejected'
        ) {
            throw new Error(
                'You already have an active team registered in this tournament!'
            );
        }


        // ────────────────────────────────────────────────────────────
        // 2. READ LATEST TOURNAMENT DATA
        //
        // IMPORTANT:
        // We MUST calculate the slot from this transaction's latest
        // filledTeams value, not from the old page data.
        // ────────────────────────────────────────────────────────────
        const tournSnap = await transaction.get(tournRef);

        if (!tournSnap.exists()) {
            throw new Error('Tournament not found!');
        }

        const tournData = tournSnap.data();

        // Use the SAME capacity rule as the UI (normalizeTournament), so a
        // tournament without an explicit maxTeams gets the same default
        // (SOLO 48 / DUO 24 / SQUAD 12) here as on the screen, instead of
        // being treated as unlimited.
        const maxTeams = normalizeTournament(tournData, t.id).maxTeams;

        const filledTeams = Number(
            tournData.filledTeams ||
            tournData.filledSlots ||
            0
        );

        // Paid registrations waiting for payment verification. They hold a
        // seat so pending registrations can never exceed maxTeams.
        const pendingTeams = Number(tournData.pendingTeams || 0);


        // ────────────────────────────────────────────────────────────
        // 3. CAPACITY CHECK (confirmed seats + reserved pending seats)
        // ────────────────────────────────────────────────────────────
        if (
            maxTeams > 0 &&
            filledTeams + pendingTeams >= maxTeams
        ) {
            throw new Error('Tournament is already FULL! 🔒');
        }


        // ────────────────────────────────────────────────────────────
        // 4. TEAM ID COLLISION CHECK
        // ────────────────────────────────────────────────────────────
        const teamCollisionSnap = await transaction.get(teamRef);

        if (teamCollisionSnap.exists()) {
            throw new Error(
                'Team ID collision detected. Please tap Confirm again!'
            );
        }


        // ────────────────────────────────────────────────────────────
        // 4b. DUPLICATE FF UID CHECK (ATOMIC, CROSS-TEAM)
        //
        // Firestore requires ALL reads before ANY write, so every UID
        // lock is read here. If two users race with the same UID, one
        // transaction will be retried/aborted and will see the lock
        // written by the other → throws below.
        // 'rejected' lock = UID released (same rule as captain lock).
        // ────────────────────────────────────────────────────────────
        const uidLockSnaps = await Promise.all(
            playerUidLocks.map(l => transaction.get(l.ref))
        );
        uidLockSnaps.forEach((snap, i) => {
            if (snap.exists() && snap.data().status !== 'rejected') {
                const err = new Error(
                    `Free Fire UID (${playerUidLocks[i].player.ffUID}) is already registered in this tournament!`
                );
                err.code = 'duplicate-ff-uid';
                throw err;
            }
        });


        // ════════════════════════════════════════════════════════════
        // 5. FREE TOURNAMENT AUTO-JOIN
        // ════════════════════════════════════════════════════════════
        if (isFree) {

            // The next slot is calculated from the LATEST Firestore
            // filledTeams value. This makes the slot transaction-safe.
            const assignedSlot = filledTeams + 1;


            // Determine players per team.
            const playersPerTeam =
                format === 'SOLO' ? 1 :
                format === 'DUO'  ? 2 :
                4;


            // ────────────────────────────────────────────────────────
            // Update tournament counters
            // ────────────────────────────────────────────────────────
            transaction.update(tournRef, {

                // Number of teams / solo players registered
                filledTeams: assignedSlot,

                // Keep the existing filledSlots field synchronized
                filledSlots: assignedSlot,

                // Total player count
                filledPlayers:
                    assignedSlot * playersPerTeam
            });


            // ────────────────────────────────────────────────────────
            // Update user's joined tournaments
            // ────────────────────────────────────────────────────────
            transaction.update(userRef, {
                joinedTournaments: arrayUnion(t.id)
            });


            // ────────────────────────────────────────────────────────
            // FREE TEAM = IMMEDIATELY CONFIRMED + LOCKED + SLOT
            // ────────────────────────────────────────────────────────
            transaction.set(teamRef, {

                ...teamPayload,

                // FREE tournament is instantly confirmed
                status: 'confirmed',

                // Free tournament team is automatically locked
                locked: true,

                // Automatically assigned room/participation slot
                roomSlot: assignedSlot,

                // System records why/how it was locked
                lockedAt: serverTimestamp(),
                lockedBy: 'system-auto',

                updatedAt: serverTimestamp()
            });


            // ────────────────────────────────────────────────────────
            // Captain lock
            // Prevents the same user from joining twice.
            // ────────────────────────────────────────────────────────
            transaction.set(captainLockRef, {

                tournamentId: t.id,

                captainUserId: uid,

                teamId: teamId,

                status: 'confirmed',

                // Store the assigned slot here too
                roomSlot: assignedSlot,

                createdAt: serverTimestamp(),

                updatedAt: serverTimestamp()
            });

        } else {

            // ════════════════════════════════════════════════════════
            // PAID TOURNAMENT
            //
            // KEEP EXISTING PAYMENT FLOW:
            // pending + unpaid + no automatic slot
            // ════════════════════════════════════════════════════════

            transaction.set(teamRef, {

                ...teamPayload,

                status: 'pending',

                paymentStatus: 'unpaid',

                locked: false,

                roomSlot: null,

                // v6: unpaid pendings auto-expire — the sweep (services/expiry.service.js)
                // releases the reserved seat after this. Legacy teams without expiresAt
                // are never auto-expired (admin sweeps those once manually).
                expiresAt: new Date(Date.now() + (APP_CONFIG.pendingExpiryHours || 6) * 3600 * 1000),

                updatedAt: serverTimestamp()
            });


            // Paid tournament does NOT increase filledTeams yet (that happens
            // on payment approval), but it RESERVES a seat via pendingTeams.
            // Admin approve/reject must do: pendingTeams -1 (and filledTeams +1 on approve).
            transaction.update(tournRef, {
                pendingTeams: increment(1)
            });

            transaction.set(captainLockRef, {

                tournamentId: t.id,

                captainUserId: uid,

                teamId: teamId,

                status: 'pending',

                createdAt: serverTimestamp(),

                updatedAt: serverTimestamp()
            });
        }


        // ════════════════════════════════════════════════════════════
        // 6. PLAYER UID LOCKS (FREE + PAID দুটোতেই)
        // Team doc এর সাথে একই transaction এ লেখা হয় → all-or-nothing।
        // ════════════════════════════════════════════════════════════
        playerUidLocks.forEach(({ player, ref }) => {
            transaction.set(ref, {
                tournamentId: t.id,
                ffUID: player.ffUID,
                playerName: player.playerName,
                teamId: teamId,
                captainUserId: uid,
                status: isFree ? 'confirmed' : 'pending',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
    });

            // ট্রানজেকশন সফল হওয়ার পর, ফ্রি/পেইড অনুযায়ী কাজ হবে
            if (isFree) {
                if (fromModal) { try { closeModal('modal-join-tournament'); } catch (e) {} }
                // Reload the details page so the button/participants show the new state;
                // the success toast is shown right after the reload.
                flashToast(`Successfully registered for ${t.name}! 🎉`, 'success', 5000);
                if (opts.afterFree === 'matches') goTo('matches'); else window.location.reload();
            } else {
                // পেইড টুর্নামেন্ট হলে পেমেন্ট পেজ ওপেন হবে
                if (fromModal) { try { closeModal('modal-join-tournament'); } catch (e) {} }
                goTo('payment', { id: t.id, team: teamId });
            }
        } catch (err) {
            console.error('runJoinTransaction error:', err);
            if (err.code === 'duplicate-ff-uid') {
                showToast(err.message, 'error', 5500);
            } else {
                showToast('Failed to complete registration: ' + err.message, 'error', 4500);
        throw err;
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (submitBtn) submitBtn.innerHTML = originalBtnText;
        }
    } // ── end runJoinTransaction ──

// v7: join using a saved team (called from the My Team page).
// The transaction itself guards capacity + duplicates atomically.
export async function joinWithSavedTeam(tournamentId, teamName, players, persistentTeamId, submitBtn) {
    const uid = state.currentUser?.uid;
    if (!uid) { showToast('Please sign in to join tournaments', 'error'); goTo('login'); return; }
    let t = null;
    try {
        const snap = await getDoc(doc(db, 'tournaments', tournamentId));
        if (!snap.exists()) { showToast('Tournament not found', 'error'); return; }
        t = normalizeTournament(snap.data(), snap.id);
    } catch (e) { showToast('Failed to load tournament: ' + e.message, 'error'); return; }
    if (t.status !== 'upcoming') { showToast(`Cannot join. Tournament is ${t.status.toUpperCase()}`, 'error'); return; }
    await runJoinTransaction(t, teamName, players, persistentTeamId || null, {
        submitBtn: submitBtn || null, fromModal: false, afterFree: 'matches'
    });
}

// v7: lets the details page bypass the My Team step ("join without saved team")
window.setJoinManualBypass = () => { state.joinManualBypass = true; };

// Inline onclick handler in the modal needs this on window
window.submitTournamentRegistration = submitTournamentRegistration;