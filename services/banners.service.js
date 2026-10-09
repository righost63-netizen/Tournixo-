import { db, collection, query, where, limit, getDocs } from '../firebase/firebase-init.js';

// ── Home page banner slider (Firestore: banners/{id}) ──
// ইউজার প্যানেলে শুধু Active (isActive !== false) ব্যানারগুলো দেখাবে.
// createdAt/order field-এর উপর Firestore composite index dependency নেই.
export async function fetchBanners() {
    try {
        const snap = await getDocs(
            query(
                collection(db, 'banners'),
                where('isActive', '==', true),
                limit(50)
            )
        );

        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => b.isActive !== false)
            .sort((a, b) => {
                const aTime = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds ?? 0;
                const bTime = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds ?? 0;
                return bTime - aTime;
            })
            .slice(0, 10);
    } catch (e) {
        console.warn('Banners: active query failed. Trying all banners...', e);

        try {
            const snap = await getDocs(
                query(collection(db, 'banners'), limit(50))
            );

            return snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(b => b.isActive !== false)
                .sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds ?? 0;
                    const bTime = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds ?? 0;
                    return bTime - aTime;
                })
                .slice(0, 10);
        } catch (e2) {
            console.error('Banners: all queries failed.', e2);
            throw e2;
        }
    }
}

// ── Home page mode chips (Firestore: gameModes/{id} — admin writes: name, icon, isActive, createdAt)
// NOTE: admin panel never writes an `order` field, and Firestore orderBy()
// SILENTLY EXCLUDES documents missing the ordered field — so ordering by
// 'order' returned zero modes. Read without orderBy, filter inactive modes,
// and sort client-side (by `order` when present, otherwise by name).
export async function fetchGameModes() {
    const snap = await getDocs(query(collection(db, 'gameModes'), limit(100)));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m && m.name && m.isActive !== false)
        .sort((a, b) => {
            const ao = typeof a.order === 'number' ? a.order : 9999;
            const bo = typeof b.order === 'number' ? b.order : 9999;
            if (ao !== bo) return ao - bo;
            return String(a.name).localeCompare(String(b.name));
        });
}
