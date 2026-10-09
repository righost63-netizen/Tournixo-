import { db, doc, getDoc, collection, query, orderBy, limit, getDocs } from '../firebase/firebase-init.js';

// ────────────────────────────────────────────────────────────────
// v6.1: DAILY PUBLISHED LEADERBOARD.
// The admin publishes the ranking once a day from the admin panel into
// `leaderboard/current` (one small doc). Every user-app view then costs
// exactly 1 read instead of 50 full user docs.
//
// Doc shape (written by admin):
//   leaderboard/current = {
//     updatedAt: Timestamp,          // when it was published
//     publishedBy: 'admin-uid',
//     totalPlayers: 1234,            // players considered (for context)
//     entries: [                     // top 50, rank precomputed, sorted
//       { rank: 1, name, ffUID, totalEarnings }, ...
//     ]
//   }
// If the doc doesn't exist yet (admin hasn't published), we fall back to
// the live query so the page never breaks.
// ────────────────────────────────────────────────────────────────

export async function fetchPublishedLeaderboard() {
    const snap = await getDoc(doc(db, 'leaderboard', 'current'));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    const entries = Array.isArray(d.entries) ? d.entries : [];
    return {
        entries: entries
            .filter(e => e && typeof e === 'object')
            .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999)),
        updatedAt: d.updatedAt || null,
        totalPlayers: Number(d.totalPlayers || 0)
    };
}

// Fallback: live top-50 query (used only until the first admin publish).
// The user with the highest winning balance is rank #1.
// Query failures THROW — the caller renders a distinct error state.
export async function fetchTopUsers() {
    const users = [];

    const s = await getDocs(
        query(
            collection(db, 'users'),
            orderBy('totalEarnings', 'desc'),
            limit(50)
        )
    );

    s.forEach(d => users.push({
        id: d.id,
        ...d.data()
    }));

    return users;
}
