import {
    db,
    doc,
    collection,
    query,
    where,
    limit,
    getDocs,
    runTransaction,
    serverTimestamp,
    increment
} from '../firebase/firebase-init.js';

// ────────────────────────────────────────────────────────────────
// Pending-team auto-expiry (v6).
// Paid joins reserve a seat via tournaments.pendingTeams but stay
// 'pending'/'unpaid' until the admin verifies the UPI payment. Users who
// never pay would hold seats forever — this sweep releases them.
//
// Design (no server needed):
//  • join-tournament.js stamps expiresAt (= now + APP_CONFIG.pendingExpiryHours)
//    on every paid pending team.
//  • This sweep runs opportunistically (matches page + tournament details,
//    throttled) as the signed-in user and, inside ONE transaction per team:
//      – team:            status → 'expired'
//      – tournaments/{id}: pendingTeams −1  (seat released)
//      – tournamentCaptains/{tid_uid}: status → 'rejected' (captain freed)
//      – tournamentPlayerUIDs/{tid_uid}: status → 'rejected' (UIDs freed)
//  • firestore.rules constrains every write: the team update only when
//    status=='pending' && paymentStatus=='unpaid' && now > expiresAt; the
//    counter move is exactly −1; lock releases are tied to the expired team.
//  • Legacy pendings without expiresAt are NEVER auto-expired (rule requires
//    the field) — admin sweeps those once manually.
// ────────────────────────────────────────────────────────────────

let lastSweepAt = 0;
const SWEEP_THROTTLE_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 25;

function toMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : 0;
}

export async function sweepExpiredPendings() {
    const now = Date.now();
    if (now - lastSweepAt < SWEEP_THROTTLE_MS) return 0;
    lastSweepAt = now;

    let swept = 0;
    try {
        // Single-field range query — no composite index needed.
        const snap = await getDocs(query(
            collection(db, 'tournamentTeams'),
            where('expiresAt', '<', new Date(now)),
            limit(SWEEP_BATCH)
        ));
        if (snap.empty) return 0;

        for (const teamDoc of snap.docs) {
            const tm = teamDoc.data() || {};
            // Belt & braces: only unpaid pendings (rules enforce this too).
            if (tm.status !== 'pending' || tm.paymentStatus !== 'unpaid') continue;
            if (!tm.tournamentId || !tm.captainUserId) continue;

            try {
                await runTransaction(db, async (transaction) => {
                    // 1. Team → expired
                    transaction.update(teamDoc.ref, {
                        status: 'expired',
                        updatedAt: serverTimestamp()
                    });
                    // 2. Release the reserved seat (only if the counter exists —
                    // otherwise the whole transaction would abort on the rule).
                    const tournRef = doc(db, 'tournaments', tm.tournamentId);
                    const tournSnap = await transaction.get(tournRef);
                    if (tournSnap.exists() && typeof tournSnap.data().pendingTeams === 'number') {
                        transaction.update(tournRef, {
                            pendingTeams: increment(-1)
                        });
                    }
                    // 3. Free the captain lock
                    transaction.update(
                        doc(db, 'tournamentCaptains', `${tm.tournamentId}_${tm.captainUserId}`),
                        { status: 'rejected', updatedAt: serverTimestamp() }
                    );
                    // 4. Free every player UID lock
                    const players = Array.isArray(tm.players) ? tm.players : [];
                    players.forEach(p => {
                        const ffUID = String(p?.ffUID || '').trim();
                        if (!ffUID) return;
                        transaction.update(
                            doc(db, 'tournamentPlayerUIDs', `${tm.tournamentId}_${ffUID}`),
                            { status: 'rejected', updatedAt: serverTimestamp() }
                        );
                    });
                });
                swept++;
            } catch (e) {
                // Someone else swept it first, or rules denied — skip quietly.
                console.warn('[Expiry] sweep skipped team', teamDoc.id, e?.code || e?.message);
            }
        }
    } catch (e) {
        console.warn('[Expiry] sweep failed:', e?.code || e?.message);
    }
    return swept;
}

// "5h 23m" style remaining-time label for the Matches pending note.
export function expiryCountdownLabel(expiresAt) {
    const ms = toMs(expiresAt) - Date.now();
    if (ms <= 0) return 'expiring soon';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
