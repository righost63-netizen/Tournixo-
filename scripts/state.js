// Shared in-memory state (same fields as the original window._state).
// window._state is kept so any inline/legacy code keeps working.
export const state = {
    currentUser: null,
    userData: null,
    currentTab: 'home',
    tournFilter: 'upcoming',
    matchFilter: 'all',
    txTab: 'prize',
    paymentTournament: null,
    payMethod: 'upi',
    wdMethod: 'upi',
    confirmCallback: null,
    bannerInterval: null,
    bannerIndex: 0,
    bannerCount: 0,
    listeners: [],
    tournaments: [],
    tournamentsLoading: false,
    homeTournamentsLoading: false,
    notifListenerActive: false,
    leaderboardCache: null,
    leaderboardCacheTime: null,
    joinRequestCache: null,
    captainStatusCache: null,  // per-tournament join status for current user (Fix #1) — see services/tournaments.service.js
    userPollInterval: null,   // kept for back-compat, unused
    modeChipsLoaded: false,
    countdownIntervals: [],
    reminderTimers: [],
    minWithdrawal: null,
    // multi-page additions
    page: null,
    authResolved: false,
    registering: false        // true while registration transaction is running
};

window._state = state;