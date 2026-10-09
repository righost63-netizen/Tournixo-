import { db, collection, query, where, orderBy, limit, getDocs } from '../firebase/firebase-init.js';
import { state } from '../scripts/state.js';

// Short-lived tournament cache for UI/read optimization only.
// Critical join/payment/room authorization must use authoritative Firestore data.
const TOURNAMENT_CACHE_TTL = 45 * 1000;
const tournamentListCache = new Map();
const homeTournamentCache = { at: 0, items: null };
const upcomingRawCache = { at: 0, items: null };

// TOURNAMENT SCHEMA NORMALIZER & HELPERS
export function normalizeTournament(d, id) {
    const teamFormat = (d.teamFormat || (d.mode?.toUpperCase().includes('SOLO') ? 'SOLO' : d.mode?.toUpperCase().includes('DUO') ? 'DUO' : 'SQUAD') || 'SQUAD').toUpperCase();
    const entryFee = Number(d.entryFee || 0);
    const entryType = (d.entryType || (entryFee > 0 ? 'PAID' : 'FREE')).toUpperCase();
    const gameMode = d.gameMode || d.mode || 'BR Ranked';
    const status = (d.status || 'upcoming').toLowerCase();

    let dateObj = null;
    if (d.dateTime) {
        dateObj = d.dateTime.toDate ? d.dateTime.toDate() : new Date(d.dateTime);
    } else if (d.date) {
        dateObj = d.date.toDate ? d.date.toDate() : new Date(d.date);
    }

    const rawRoom = d.roomSettings || {};
    const roomId = rawRoom.roomId || d.roomId || '';
    const roomPassword = rawRoom.roomPassword || rawRoom.password || d.roomPass || '';
    const isRoomPublished = Boolean(rawRoom.roomVisible === true || rawRoom.isPublished === true || d.roomVisible === true);
    const roomSettings = {
        roomId,
        password: roomPassword,
        roomPassword,
        isPublished: isRoomPublished,
        roomVisible: isRoomPublished,
        slotAssignments: rawRoom.slotAssignments || {}
    };

    return {
        id: id || d.tournamentId || d.id,
        tournamentId: id || d.tournamentId || d.id,
        name: d.name || 'Free Fire Tournament',
        gameMode,
        teamFormat,
        entryType,
        entryFee,
        maxTeams: Number(d.maxTeams || (teamFormat === 'SOLO' ? (d.maxPlayers || d.totalSlots || 48) : (d.maxTeams || d.totalSlots || (teamFormat === 'DUO' ? 24 : 12)))),
        maxPlayers: Number(d.maxPlayers || (teamFormat === 'SOLO' ? 48 : teamFormat === 'DUO' ? 48 : 48)),
        filledTeams: Number(d.filledTeams || d.filledSlots || (d.teams ? d.teams.length : (d.participants ? d.participants.length : 0))),
        // v6: pending (unpaid) teams hold seats — the join guard counts them,
        // so the card must too, otherwise "5/12" + Join → "FULL" on submit.
        pendingTeams: Number(d.pendingTeams || 0),
        status,
        map: d.map || 'Bermuda',
        prizePool: Number(d.prizePool || 0),
        perKill: Number(d.perKill || 0),
        prizeDistribution: (Array.isArray(d.prizeDistribution) && d.prizeDistribution.length > 0) ?
            d.prizeDistribution : [
                ...(d.firstPrize ? [{ rank: 1, position: 1, label: '1st', amount: Number(d.firstPrize) }] : []),
                ...(d.secondPrize ? [{ rank: 2, position: 2, label: '2nd', amount: Number(d.secondPrize) }] : []),
                ...(d.thirdPrize ? [{ rank: 3, position: 3, label: '3rd', amount: Number(d.thirdPrize) }] : [])
            ],
        rules: d.rules || '',
        bannerUrl: d.bannerUrl || '',
        roomSettings,
        cancellationReason: d.cancellationReason || '',
        rescheduledDateTime: d.rescheduledDateTime || null,
        dateObj,
        raw: d
    };
}

export function getTournamentCapacity(t) {
    const isSolo = t.teamFormat === 'SOLO';
    // v6: reserved = confirmed + pending-unpaid (matches the join transaction guard).
    const current = Number(t.filledTeams || 0) + Number(t.pendingTeams || 0);
    const max = t.maxTeams;
    const isFull = max > 0 && current >= max;
    const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
    const label = isSolo ? `Players: ${current} / ${max}` : `Teams: ${current} / ${max}`;
    return { current, max, isFull, pct, label, isSolo };
}

// Paid/free per-user captain status cache.
export async function ensureCaptainStatusCache(uid, forceRefresh = false) {
    if (!uid) return {};
    const cachedAt = Number(state.captainStatusCacheAt || 0);
    if (state.captainStatusCache && !forceRefresh && (Date.now() - cachedAt) < TOURNAMENT_CACHE_TTL) {
        return state.captainStatusCache;
    }

    try {
        const s = await getDocs(query(collection(db, 'tournamentCaptains'), where('captainUserId', '==', uid)));
        const map = {};
        s.forEach(d => {
            map[d.data().tournamentId] = d.data();
        });
        state.captainStatusCache = map;
        state.captainStatusCacheAt = Date.now();
    } catch (e) {
        state.captainStatusCache = state.captainStatusCache || {};
    }
    return state.captainStatusCache;
}

export function getCaptainStatus(tournamentId) {
    return (state.captainStatusCache && state.captainStatusCache[tournamentId]) || null;
}

function sortByDate(list) {
    list.sort((a, b) => {
        const ta = a.dateObj ? a.dateObj.getTime() : 0;
        const tb = b.dateObj ? b.dateObj.getTime() : 0;
        return ta - tb;
    });
    return list;
}

function cacheIsFresh(entry) {
    return entry && entry.items && (Date.now() - entry.at) < TOURNAMENT_CACHE_TTL;
}

// Tournaments page list (status filter: upcoming / ongoing / completed / all).
export async function fetchTournamentList(statusFilter, forceRefresh = false) {
    const key = statusFilter || 'all';
    const cached = tournamentListCache.get(key);
    if (!forceRefresh && cacheIsFresh(cached)) return cached.items;

    let q;
    if (statusFilter === 'all') {
        q = query(collection(db, 'tournaments'), orderBy('createdAt', 'desc'), limit(50));
    } else {
        q = query(collection(db, 'tournaments'), where('status', '==', statusFilter), limit(50));
    }

    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push(normalizeTournament(d.data(), d.id)));

    const result = sortByDate(list);
    tournamentListCache.set(key, { at: Date.now(), items: result });
    return result;
}

// Home page: the 6 SOONEST upcoming tournaments.
// (v6 fix: was limit(6) with no orderBy — Firestore returned 6 arbitrary docs
// and near-term tournaments could be missing from Home. Now we fetch a wider
// window and sort client-side, so no composite index is needed.)
export async function fetchHomeTournaments(forceRefresh = false) {
    if (!forceRefresh && cacheIsFresh(homeTournamentCache)) {
        return homeTournamentCache.items;
    }

    const snap = await getDocs(query(
        collection(db, 'tournaments'),
        where('status', '==', 'upcoming'),
        limit(24)
    ));

    const items = [];
    snap.forEach(d => {
        const t = normalizeTournament(d.data(), d.id);
        if (t.status === 'upcoming') items.push(t);
    });

    const result = sortByDate(items).slice(0, 6);
    homeTournamentCache.at = Date.now();
    homeTournamentCache.items = result;
    return result;
}

// Raw upcoming docs used by the 30-minute reminders.
export async function fetchUpcomingRaw(forceRefresh = false) {
    if (!forceRefresh && cacheIsFresh(upcomingRawCache)) {
        return upcomingRawCache.items;
    }

    const upcoming = [];
    try {
        const s = await getDocs(query(
            collection(db, 'tournaments'),
            where('status', '==', 'upcoming'),
            orderBy('date', 'asc'),
            limit(20)
        ));
        s.forEach(d => upcoming.push({ id: d.id, ...d.data() }));
    } catch (e) {
        const s = await getDocs(query(
            collection(db, 'tournaments'),
            where('status', '==', 'upcoming'),
            limit(20)
        ));
        s.forEach(d => upcoming.push({ id: d.id, ...d.data() }));
    }

    upcomingRawCache.at = Date.now();
    upcomingRawCache.items = upcoming;
    return upcoming;
}
