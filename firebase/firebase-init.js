// ════════════════════════════════════════════════════════════════
// Single Firebase entry point. Every other file imports Firebase
// functions from HERE (never directly from gstatic), so the app is
// initialized exactly once per page.
// ════════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    initializeFirestore,
    getFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Offline persistence (IndexedDB) — same as the original.
// NOTE: the original used persistentSingleTabManager (one page). Now that the
// app is multi-page, the multiple-tab manager is used so moving from one page
// to the next never fights over the IndexedDB lock. Cache behavior is unchanged.
// Falls back to plain in-memory Firestore if IndexedDB is unavailable.
let db;
try {
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (e) {
    console.warn('[Firestore] Offline persistence unavailable, using default cache:', e.message);
    // initializeFirestore() must not be called twice on the same app (it throws
    // "already initialized"). getFirestore() reuses the existing instance, or
    // creates a default in-memory one if none was registered yet.
    db = getFirestore(app);
}

export { app, auth, db };

// ── Auth functions used by the app ──
export {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    sendEmailVerification,
    reload,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Firestore functions used by the app ──
export {
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    onSnapshot,
    addDoc,
    deleteDoc,
    serverTimestamp,
    increment,
    arrayUnion,
    runTransaction,
    documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";