// scripts/terms.js
import { initPage } from './app.js';
import { db, doc, getDoc } from '../firebase/firebase-init.js';
import { cacheGet, cacheSet, cacheIsFresh } from './cache.js';
import { state } from './state.js';
import { STORAGE_KEYS, CACHE_TTL } from '../utils/constants.js';
import { escHtml } from '../utils/escape.js';

const TERMS_CACHE_KEY = STORAGE_KEYS.terms;
const TERMS_CACHE_MS  = CACHE_TTL.terms;

// v6.2: default Terms & Conditions shown until the admin publishes their own
// via the admin panel (settings/termsAndConditions). Generic fair-play terms.
const DEFAULT_TERMS = `1. Fair Play
- No hacks, mods, emulators, or exploits of any kind.
- Teaming with opponents or stream-sniping to gain advantage is prohibited.
- Violations lead to disqualification without refund.

2. Eligibility
- You must register with your own correct Free Fire UID.
- One account per player. Fake or duplicate accounts will be removed.

3. Registration & Slots
- Slots are confirmed on a first-come, first-served basis.
- Paid tournaments require payment verification before the match starts.
- Unpaid pending registrations expire automatically after 6 hours.

4. Entry Fee & Payments
- Entry fees are paid via UPI to the official Tournixo UPI ID only.
- Always verify the UPI ID shown on the payment screen before paying.
- Tournixo is not responsible for payments sent to wrong UPI IDs.

5. Room & Match Rules
- Room ID and password are shared only with confirmed participants.
- Join the room on time. Late players may lose their slot without refund.
- Follow the room host's instructions during the match.

6. Results & Winnings
- Results are published after verification by the Tournixo team.
- Winnings are credited to your Tournixo wallet balance.
- Point disputes must be raised within 24 hours of result publication.

7. Withdrawals
- Winnings can be withdrawn to your UPI account.
- Minimum withdrawal amount applies as shown on the withdrawal screen.
- Withdrawal requests are processed after manual verification.

8. Cancellations & Refunds
- If Tournixo cancels a tournament, entry fees are refunded to the wallet.
- If you fail to join the room on time, no refund is given.
- Rejected registrations do not block you from joining other tournaments.

9. Conduct
- Abusive behaviour towards players, staff, or admins leads to a ban.
- Do not share room credentials publicly.

10. Changes
- Tournixo may update these terms anytime. Continued use of the app means you accept the latest terms.`;

async function loadTerms() {
    const el = document.getElementById('terms-content');
    if (!el) return;

    const cached = cacheGet(TERMS_CACHE_KEY);
    if (cached && cached.data) renderTerms(cached.data);
    if (cached && cacheIsFresh(cached, TERMS_CACHE_MS)) return;

    try {
        const snap = await getDoc(doc(db, 'settings', 'termsAndConditions'));
        const data = snap.exists() ? snap.data() : {};
        cacheSet(TERMS_CACHE_KEY, data);
        renderTerms(data);
    } catch (error) {
        if (!cached) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Failed to load</div>
                </div>
            `;
        }
    }
}

// ── Premium renderer: admin writes plain text, we turn it into
//    numbered gold sections, bullet cards and clean paragraphs.
//    Everything is HTML-escaped first (XSS-safe).
function renderTermsBody(raw) {
    const lines = String(raw || '').split(/\r?\n/);
    let html = '', inList = false, sectionNum = 0;

    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) { closeList(); continue; }

        // 1. Numbered section — "1. Fair Play" / "2) Payments"
        let m = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
        if (m) {
            closeList();
            sectionNum++;
            html += `<h3 class="terms-h"><span class="terms-h-num">${sectionNum}</span><span>${escHtml(m[2])}</span></h3>`;
            continue;
        }

        // 2. Bullet — "- item" / "• item"
        m = line.match(/^[-•*]\s+(.+)$/);
        if (m) {
            if (!inList) { html += '<ul class="terms-ul">'; inList = true; }
            html += `<li>${escHtml(m[1])}</li>`;
            continue;
        }

        // 3. Plain heading — short ALL-CAPS line without trailing period
        const letters = line.replace(/[^A-Za-z]/g, '');
        if (letters.length >= 4 && line.length <= 60 && line === line.toUpperCase()
            && letters === letters.toUpperCase() && !/[.!?]$/.test(line)) {
            closeList();
            html += `<h3 class="terms-h-plain">${escHtml(line)}</h3>`;
            continue;
        }

        // 4. Regular paragraph
        closeList();
        html += `<p class="terms-p">${escHtml(line)}</p>`;
    }
    closeList();
    return html;
}

function renderTerms(data) {
    const el = document.getElementById('terms-content');
    if (!el) return;

    // v6.2: bundled default terms — shown when the admin hasn't published
    // terms yet (settings/termsAndConditions missing or empty). The admin
    // panel can overwrite this anytime by writing that document.
    const content = (data?.content || '').trim() || DEFAULT_TERMS;
    el.innerHTML = renderTermsBody(content);

    // "Last updated" chip from the admin-written updatedAt
    const chip = document.getElementById('terms-updated-chip');
    if (chip) {
        const upd = data?.updatedAt?.toDate?.();
        if (upd) {
            const dstr = upd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            chip.textContent = 'Last updated: ' + dstr;
            chip.style.display = 'inline-block';
        } else {
            chip.style.display = 'none';
        }
    }
}

window.closeTerms = function () {
    if (typeof window.goBack === 'function') {
        window.goBack(state.currentUser ? 'profile' : 'register');
    } else {
        history.back();
    }
};

initPage({
    page: 'terms',
    onReady: () => { loadTerms(); }
});
