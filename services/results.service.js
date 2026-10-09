import { db, doc, getDoc, getDocs, collection, query, where, limit } from '../firebase/firebase-init.js';
import { normalizeTournament } from './tournaments.service.js';

// Tournament doc + its published-results doc.
// Returns { tourn, resData } (resData is null if there is no results document).
export async function fetchTournamentResults(tournamentId) {
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    const tourn = tSnap.exists() ? normalizeTournament(tSnap.data(), tSnap.id) : {
        name: 'Tournament',
        perKill: 0,
        teamFormat: 'SQUAD'
    };

    // tournamentResults/{tournamentId} is the authoritative result document.
    // Do not issue a second collection query when it does not exist.
    const directResSnap = await getDoc(doc(db, 'tournamentResults', tournamentId));
    const resData = directResSnap.exists() ? directResSnap.data() : null;

    return { tourn, resData };
}

// Completed tournaments (results list from the Profile menu)
// v6: sorted newest-first client-side (no composite index needed) so recent
// tournaments can't be crowded out of the limit(20) window.
export async function fetchCompletedTournaments() {
    const snap = await getDocs(query(
        collection(db, 'tournaments'),
        where('status', '==', 'completed'),
        limit(30)
    ));
    const list = [];
    snap.forEach(d => list.push(normalizeTournament(d.data(), d.id)));
    list.sort((a, b) => {
        const ta = a.dateObj ? a.dateObj.getTime() : 0;
        const tb = b.dateObj ? b.dateObj.getTime() : 0;
        return tb - ta;
    });
    return list.slice(0, 20);
}
