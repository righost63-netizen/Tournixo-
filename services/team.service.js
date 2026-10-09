import { db, doc, getDoc, getDocs, collection, query, where, limit, addDoc, deleteDoc, serverTimestamp } from '../firebase/firebase-init.js';

// ────────────────────────────────────────────────────────────────
// PERSISTENT TEAM (v7) — "My Team"
// One saved squad roster per user (captain + up to 3 members).
// The team is a TEMPLATE: joining a tournament snapshots the roster
// into tournamentTeams (persistentTeamId links them). Editing the
// template never touches past tournament entries.
// Rules (firestore.rules v10.2): signed-in can read; only the captain
// (captainUid == auth.uid) can create/update/delete.
// ────────────────────────────────────────────────────────────────

export function generatePersistentTeamId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 'TEAM-' + s;
}

// The user's own team (captain). One team per user in v7.
export async function fetchMyTeam(uid) {
    if (!uid) return null;
    const s = await getDocs(query(
        collection(db, 'teams'),
        where('captainUid', '==', uid),
        limit(1)
    ));
    if (s.empty) return null;
    const d = s.docs[0];
    return { id: d.id, ...d.data() };
}

export async function createTeam({ uid, teamName, captainName, captainFFUID, members }) {
    // members: [{ playerName, ffUID }] — max 3, validated client-side too
    const cleanMembers = (members || []).slice(0, 3).map(m => ({
        playerName: String(m.playerName || '').trim() || 'Player',
        ffUID: String(m.ffUID || '').trim()
    }));
    const ref = await addDoc(collection(db, 'teams'), {
        teamId: generatePersistentTeamId(),
        teamName: String(teamName || '').trim(),
        teamFormat: 'squad',
        captainUid: uid,
        captainName: String(captainName || '').trim(),
        captainFFUID: String(captainFFUID || '').trim(),
        members: cleanMembers,
        memberFFUIDs: cleanMembers.map(m => m.ffUID),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    const snap = await getDoc(ref);
    return { id: snap.id, ...snap.data() };
}

// Delete guard: block while the team has ACTIVE tournament entries.
// Returns { ok: true } or { ok: false, active: [{ tournamentId, tournamentName, status }] }
export async function checkTeamDeletable(team) {
    const teamId = team.teamId || team.id;
    const active = [];
    try {
        const s = await getDocs(query(
            collection(db, 'tournamentTeams'),
            where('persistentTeamId', '==', teamId)
        ));
        const ids = [];
        s.forEach(d => {
            const st = d.data().status;
            if (st === 'pending' || st === 'confirmed' || st === 'approved') {
                ids.push({ entryId: d.id, tournamentId: d.data().tournamentId, status: st });
            }
        });
        // Resolve tournament names (cheap: only active ones, usually 0-2)
        for (const e of ids) {
            let name = 'Tournament';
            try {
                const ts = await getDoc(doc(db, 'tournaments', e.tournamentId));
                if (ts.exists()) name = ts.data().name || name;
            } catch (_) {}
            active.push({ ...e, tournamentName: name });
        }
    } catch (e) {
        console.warn('[Team] delete-guard check failed:', e.message);
    }
    return active.length ? { ok: false, active } : { ok: true, active: [] };
}

export async function deleteTeam(docId) {
    await deleteDoc(doc(db, 'teams', docId));
}

// Build the tournament-join roster from a saved team.
// duoPartnerFFUID: for DUO tournaments — the one selected partner.
export function buildRosterFromTeam(team, uid, duoPartnerFFUID = null) {
    const players = [{
        userId: uid,
        playerName: team.captainName || 'Captain',
        ffUID: String(team.captainFFUID).trim()
    }];
    const members = Array.isArray(team.members) ? team.members : [];
    if (duoPartnerFFUID) {
        const p = members.find(m => String(m.ffUID).trim() === String(duoPartnerFFUID).trim());
        if (p) players.push({ userId: '', playerName: p.playerName, ffUID: String(p.ffUID).trim() });
    } else {
        members.forEach(m => players.push({ userId: '', playerName: m.playerName, ffUID: String(m.ffUID).trim() }));
    }
    return players;
}
