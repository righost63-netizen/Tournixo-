import { db, collection, query, where, orderBy, limit, getDocs } from '../firebase/firebase-init.js';

const WALLET_CACHE_TTL = 30 * 1000;
const walletCache = new Map();

// Wallet ledger (prize, refund, entry fee, credit) — newest first.
// Cache is only for display optimization; balance/payment authorization must not use it.
export async function fetchWalletTransactions(uid, userData, forceRefresh = false) {
    if (!uid) return [];

    const cached = walletCache.get(uid);
    if (!forceRefresh && cached && (Date.now() - cached.at) < WALLET_CACHE_TTL) {
        return cached.items;
    }

    let transactions = [];
    try {
        const snap = await getDocs(query(
            collection(db, 'walletTransactions'),
            where('userId', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(50)
        ));

        snap.forEach(d => transactions.push({
            id: d.id,
            ...d.data()
        }));
    } catch (e) {
        // Preserve the existing compatibility path for projects whose
        // Firestore index has not yet been created.
        try {
            const snap = await getDocs(query(
                collection(db, 'walletTransactions'),
                where('userId', '==', uid),
                limit(50)
            ));
            snap.forEach(d => transactions.push({
                id: d.id,
                ...d.data()
            }));
        } catch (fallbackError) {
            console.warn('[Wallet] Transaction history fetch failed:', fallbackError.message);
            return cached?.items || [];
        }
    }

    // Legacy prizeHistory remains only as a compatibility fallback.
    if (transactions.length === 0 && userData?.prizeHistory) {
        const pHistory = userData.prizeHistory || [];
        pHistory.forEach((p, idx) => {
            transactions.push({
                id: 'prize-' + idx,
                amount: p.amount || 0,
                type: 'prize',
                title: p.tournamentName || 'Tournament Prize',
                description: `Won in ${p.tournamentName || 'Tournament'}`,
                createdAt: p.distributedAt || Date.now()
            });
        });
    }

    transactions.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return tb - ta;
    });

    walletCache.set(uid, { at: Date.now(), items: transactions });
    return transactions;
}
