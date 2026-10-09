import { db, collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp } from '../firebase/firebase-init.js';

// ────────────────────────────────────────────────────────────────
// REPORT PLAYER (v7)
// Anyone can report any player (by FF UID). Reports go to the
// `playerReports` collection for admin review — there is NO auto-ban.
// Anti-abuse: max 3 reports per user per 24h, can't report yourself.
// DB cost: 1 small query (rate-limit check) + 1 write per report.
// ────────────────────────────────────────────────────────────────

export const REPORT_REASONS = [
    'Hacking / Cheating',
    'Abusive Behaviour',
    'Fake UID',
    'Teaming with Opponents',
    'Account Sharing',
    'Other'
];

export const REPORT_DAILY_LIMIT = 3;

// How many reports has this user filed in the last 24h?
export async function countRecentReports(uid) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    let count = 0;
    try {
        const s = await getDocs(query(
            collection(db, 'playerReports'),
            where('reporterUid', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(REPORT_DAILY_LIMIT + 1)
        ));
        s.forEach(d => {
            const ts = d.data().createdAt;
            const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
            if (ms >= dayAgo) count++;
        });
    } catch (e) {
        // Fallback if the composite index isn't ready yet: unordered read.
        try {
            const s = await getDocs(query(
                collection(db, 'playerReports'),
                where('reporterUid', '==', uid),
                limit(REPORT_DAILY_LIMIT + 1)
            ));
            s.forEach(d => {
                const ts = d.data().createdAt;
                const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
                if (ms >= dayAgo) count++;
            });
        } catch (_) {}
    }
    return count;
}

export async function submitPlayerReport({ uid, reporterName, reportedFFUID, ownFFUID, reason, details, tournamentId }) {
    const ffUID = String(reportedFFUID || '').trim();
    if (!/^\d{8,12}$/.test(ffUID)) {
        throw new Error('Enter a valid 8–12 digit Free Fire UID');
    }
    if (ownFFUID && ffUID === String(ownFFUID).trim()) {
        throw new Error("You can't report yourself");
    }
    if (!REPORT_REASONS.includes(reason)) {
        throw new Error('Please choose a valid reason');
    }
    const recent = await countRecentReports(uid);
    if (recent >= REPORT_DAILY_LIMIT) {
        throw new Error(`Report limit reached (${REPORT_DAILY_LIMIT}/day). Try again tomorrow.`);
    }
    const ref = await addDoc(collection(db, 'playerReports'), {
        reporterUid: uid,
        reporterName: String(reporterName || '').trim(),
        reportedFFUID: ffUID,
        reason,
        details: String(details || '').trim().slice(0, 500),
        tournamentId: tournamentId || null,
        status: 'pending', // pending → reviewed → actioned/dismissed (admin only)
        createdAt: serverTimestamp()
    });
    return ref.id;
}
