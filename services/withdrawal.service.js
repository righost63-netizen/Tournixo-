import {
    db,
    doc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDoc,
    getDocs,
    runTransaction,
    serverTimestamp
} from '../firebase/firebase-init.js';
import { APP_CONFIG } from '../config/app-config.js';

const WITHDRAWAL_CACHE_TTL = 30 * 1000;
const withdrawalCache = new Map();

// Withdrawal history (permanent audit — no deletion), newest first.
// This cache is display-only and is never used to authorize a withdrawal.
export async function fetchWithdrawals(uid, forceRefresh = false) {
    if (!uid) return [];

    const cached = withdrawalCache.get(uid);
    if (!forceRefresh && cached && (Date.now() - cached.at) < WITHDRAWAL_CACHE_TTL) {
        return cached.items;
    }

    let items = [];
    try {
        const s = await getDocs(query(
            collection(db, 'withdrawalRequests'),
            where('userId', '==', uid),
            orderBy('requestedAt', 'desc'),
            limit(50)
        ));

        s.forEach(d => items.push({
            id: d.id,
            ...d.data()
        }));
    } catch (e) {
        try {
            const s = await getDocs(query(
                collection(db, 'withdrawalRequests'),
                where('userId', '==', uid),
                limit(50)
            ));

            s.forEach(d => items.push({
                id: d.id,
                ...d.data()
            }));
        } catch (fallbackError) {
            console.warn('[Withdrawal] History fetch failed:', fallbackError.message);
            return cached?.items || [];
        }
    }

    items.sort((a, b) => {
        const ta = a.requestedAt?.toMillis ? a.requestedAt.toMillis() : new Date(a.requestedAt || 0).getTime();
        const tb = b.requestedAt?.toMillis ? b.requestedAt.toMillis() : new Date(b.requestedAt || 0).getTime();
        return tb - ta;
    });

    withdrawalCache.set(uid, { at: Date.now(), items });
    return items;
}

// Withdrawal request — Tournixo money flow (matches Staff Panel v2):
//   • Request time:  NO balance deduction. The request is created with status
//                    'pending' and the Winning Balance stays untouched.
//   • On approve:    Admin/Staff deducts the amount atomically from the panel.
//   • On reject:     status → 'rejected'. No balance is added back because
//                    nothing was ever deducted (no double-credit).
// The transaction below only VALIDATES (never writes to the user doc):
//   • amount is sane and ≥ the admin-configured minimum
//   • balance covers the amount
//   • max 3 pending requests per user (spam guard)
export async function requestWithdrawal({ uid, userName, amount, phone, method }) {
    const userRef = doc(db, 'users', uid);
    const withdrawRef = doc(collection(db, 'withdrawalRequests'));

    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error('Invalid withdrawal amount.');
    }

    // ✅ FIX: spam guard — OUTSIDE the transaction. Firestore's transaction.get()
    // accepts ONLY a DocumentReference, never a Query: running a query inside
    // runTransaction threw "Cannot read properties of undefined (reading 'path')"
    // and broke every withdrawal. (Tiny race if two tabs submit in the same
    // millisecond — acceptable for a UX spam guard; the money check below
    // stays atomic.)
    const pendingSnap = await getDocs(query(
        collection(db, 'withdrawalRequests'),
        where('userId', '==', uid),
        where('status', '==', 'pending'),
        limit(10)
    ));
    if (pendingSnap.size >= 3) {
        throw new Error('You already have 3 pending withdrawal requests. Please wait for them to be reviewed.');
    }
    // v6: the count guard alone lets a ₹500-balance user file three ₹500
    // requests (nothing is deducted until approval — staff would have to
    // manually reject the extras). Cap the TOTAL pending amount instead.
    // Advisory read (same accepted race as the count guard); the authoritative
    // per-request balance check still runs inside the transaction below.
    let pendingTotal = 0;
    pendingSnap.forEach(d => { pendingTotal += Number(d.data()?.amount || 0); });
    try {
        const uSnap = await getDoc(userRef);
        if (uSnap.exists()) {
            const u = uSnap.data();
            const avail = Math.max(0, Math.min(Number(u.walletBalance || 0), Number(u.totalEarnings || 0)));
            if (pendingTotal + amt > avail) {
                throw new Error(`Insufficient balance: you already have ₹${pendingTotal.toFixed(2)} pending, available is ₹${avail.toFixed(2)}.`);
            }
        }
    } catch (e) {
        // If our own advisory message was thrown, keep it; a failed read
        // must not block — the transaction below is authoritative.
        if (e && e.message && e.message.indexOf('Insufficient balance') === 0) throw e;
    }

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error('User account not found');

        // ✅ FIX: min-withdrawal এখন transaction-এর ভেতরে authoritative settings
        // থেকে যাচাই করা হচ্ছে — UI bypass করে কম amount পাঠানো যাবে না।
        const settingsSnap = await transaction.get(doc(db, 'settings', 'withdrawal'));
        // v6: was hard-coded 100 here while the UI used APP_CONFIG.defaultMinWithdrawal —
        // one source of truth now (same value today, can't silently diverge).
        const min = Number(settingsSnap.data()?.minAmount || APP_CONFIG.defaultMinWithdrawal);
        if (amt < min) {
            throw new Error(`Minimum withdrawal amount is ₹${min}`);
        }

        // Winning Balance can never exceed Earned Money — validate the clamped value.
        const uData = snap.data();
        const currentBalance = Math.max(0, Math.min(Number(uData.walletBalance || 0), Number(uData.totalEarnings || 0)));
        if (currentBalance < amt) {
            throw new Error(`Insufficient balance: Available ₹${currentBalance.toFixed(2)}`);
        }

        // NOTE: walletBalance is intentionally NOT touched here.
        transaction.set(withdrawRef, {
            userId: uid,
            userName: userName || 'User',
            amount: amt,
            method: method || 'UPI',
            phoneNumber: phone,
            upiId: phone,
            status: 'pending',
            requestedAt: serverTimestamp()
        });
    });

    // The newly-created history is no longer safe to display from the old cache.
    withdrawalCache.delete(uid);
}
