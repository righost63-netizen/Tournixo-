import {
    db,
    doc,
    getDoc,
    getDocs,
    addDoc,
    collection,
    query,
    where,
    limit,
    runTransaction,
    serverTimestamp
} from '../firebase/firebase-init.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Hard-coded 'admin@upi' / payee fallback (lines 27-28) ছিল
 *    ✅ সরানো হয়েছে। এখন settings/payment না থাকলে বা অসম্পূর্ণ হলে
 *       payment সম্পূর্ণ disable — কোনো fake destination এ টাকা যাবে না।
 * 2. ✅ Dead export clearPaymentSettingsCache সরানো হয়েছে (কোথাও call হতো না)।
 * 3. ✅ Error handling আরো strict করা হয়েছে — silent fallback নেই।
 * ─────────────────────────────────────────────────────────────
 */

let paymentSettingsCache = null;
const PAYMENT_SETTINGS_TTL = 60 * 1000;

export async function fetchPaymentSettings(forceRefresh = false) {
    const now = Date.now();

    if (
        !forceRefresh &&
        paymentSettingsCache &&
        (now - paymentSettingsCache.at) < PAYMENT_SETTINGS_TTL
    ) {
        return paymentSettingsCache.value;
    }

    try {
        const paySnap = await getDoc(doc(db, 'settings', 'payment'));

        // ✅ Never use a fake/default payment destination.
        if (!paySnap.exists()) {
            paymentSettingsCache = null;
            throw new Error('Payment settings are unavailable. Payment is currently disabled.');
        }

        const pData = paySnap.data() || {};

        const adminUpiId = String(pData.upiId || pData.number || '').trim();
        const payeeName  = String(pData.payeeName || pData.accountName || '').trim();

        // ✅ Both values are required. Never allow incomplete payment config.
        if (!adminUpiId || !payeeName) {
            paymentSettingsCache = null;
            throw new Error('Payment settings are incomplete. Payment is currently disabled.');
        }

        const value = { adminUpiId, payeeName };

        paymentSettingsCache = { at: Date.now(), value };
        return value;
    } catch (e) {
        paymentSettingsCache = null;
        console.error('[Payment] Settings fetch failed:', e);

        if (e instanceof Error && e.message) throw e;
        throw new Error('Unable to load payment settings. Payment is currently disabled.');
    }
}

// Standard UPI Intent URL
export function buildUpiIntentUrl(adminUpiId, payeeName, fee, teamId) {
    const upiId  = String(adminUpiId || '').trim();
    const name   = String(payeeName || '').trim();
    const amount = Number(fee);

    if (!upiId || !name) {
        throw new Error('Payment settings are unavailable. Payment is currently disabled.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid payment amount.');
    }
    if (!teamId) {
        throw new Error('Invalid team information.');
    }

    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(teamId)}`;
}

function transactionDocId(trxId) {
    return `trx_${encodeURIComponent(String(trxId).trim().toUpperCase())}`;
}

export async function submitPaymentRequest({ t, teamData, trxId, uid, uData, authEmail }) {
    const normalizedTrxId = String(trxId || '').trim().toUpperCase();
    if (!normalizedTrxId) throw new Error('Transaction ID is required.');

    const [tournSnap, teamSnap] = await Promise.all([
        getDoc(doc(db, 'tournaments', t.id)),
        getDoc(doc(db, 'tournamentTeams', teamData.teamId))
    ]);

    if (!tournSnap.exists()) throw new Error('Tournament not found or has been removed!');

    const freshTourn = tournSnap.data();
    if (freshTourn.status !== 'upcoming') {
        throw new Error(`Cannot submit payment. Tournament is currently ${String(freshTourn.status).toUpperCase()}`);
    }

    const authoritativeFee = Number(freshTourn.entryFee || 0);
    if (authoritativeFee <= 0) throw new Error('This tournament is free and does not require payment!');

    if (!teamSnap.exists()) throw new Error('Team registration not found. Please register your team first.');

    const freshTeam = teamSnap.data();
    if (freshTeam.captainUserId !== uid) {
        throw new Error('Unauthorized: Only the team captain can submit payment.');
    }
    if (freshTeam.paymentStatus === 'approved' || freshTeam.status === 'confirmed') {
        throw new Error('This team is already confirmed and paid for!');
    }
    if (freshTeam.paymentStatus === 'pending') {
        throw new Error('You already have a payment pending verification for this team!');
    }

    const trxRef = doc(db, 'paymentRequests', transactionDocId(normalizedTrxId));
    const directTrxSnap = await getDoc(trxRef);
    if (directTrxSnap.exists()) throw new Error('This Transaction ID has already been submitted!');

    const legacyDupCheck = await getDocs(
        query(collection(db, 'paymentRequests'),
              where('transactionId', '==', normalizedTrxId),
              limit(1))
    );
    if (!legacyDupCheck.empty) throw new Error('This Transaction ID has already been submitted!');

    const paymentId =
        'PAY-' + Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).substring(2, 6).toUpperCase();

    const paymentDocPayload = {
        paymentId,
        tournamentId: t.id,
        tournamentName: freshTourn.name || t.name,
        teamId: teamData.teamId,
        teamName: freshTeam.teamName || teamData.teamName,
        userId: uid,
        userName: uData.name || 'User',
        userEmail: uData.email || authEmail || '',
        entryFee: authoritativeFee,
        amount: authoritativeFee,
        transactionId: normalizedTrxId,
        paymentMethod: 'upi',
        status: 'pending',
        submittedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null
    };

    try {
        await runTransaction(db, async (transaction) => {
            const latestTeamSnap = await transaction.get(teamSnap.ref);
            if (!latestTeamSnap.exists()) {
                throw new Error('Team registration not found. Please register your team first.');
            }
            const latestTeam = latestTeamSnap.data();
            if (latestTeam.paymentStatus === 'approved' || latestTeam.status === 'confirmed') {
                throw new Error('This team is already confirmed and paid for!');
            }
            if (latestTeam.paymentStatus === 'pending') {
                throw new Error('You already have a payment pending verification for this team!');
            }

            // Authoritative duplicate-UTR check INSIDE the transaction.
            // The pre-checks above are only a fast-path; without this, two
            // concurrent submissions with the same UTR could both pass.
            const trxSnap = await transaction.get(trxRef);
            if (trxSnap.exists()) {
                throw new Error('This Transaction ID has already been submitted!');
            }

            transaction.set(trxRef, paymentDocPayload);
            transaction.update(teamSnap.ref, {
                paymentId,
                transactionId: normalizedTrxId,
                paymentStatus: 'pending',
                updatedAt: serverTimestamp()
            });
        });
    } catch (e) {
        if (e && (e.code === 'permission-denied' || e.code === 'already-exists')) {
            throw new Error('This Transaction ID has already been submitted!');
        }
        throw e;
    }

    try {
        await addDoc(collection(db, 'users', uid, 'notifications'), {
            type: 'payment_pending',
            title: 'Payment Submitted ⏳',
            body: `Payment of ₹${authoritativeFee} for "${freshTourn.name}" (Team: ${teamData.teamId}) is waiting for admin verification.`,
            read: false,
            createdAt: serverTimestamp()
        });
    } catch (e) {}

    return authoritativeFee;
}