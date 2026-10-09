import { initPage } from './app.js';
import { state } from './state.js';
import { showToast, flashToast } from './toast.js';
import { db, doc, getDoc } from '../firebase/firebase-init.js';
import { goBack, goReplace, getParam } from '../config/app-config.js';
import { isValidTrxId } from '../utils/validators.js';
import { normalizeTournament } from '../services/tournaments.service.js';
import { fetchPaymentSettings, buildUpiIntentUrl, submitPaymentRequest } from '../services/payment.service.js';

// ════════════════════════════════════════════════════════════════
// PAYMENT PAGE (payment.html?id=<tournamentId>&team=<teamId>)
// Fetch payment settings & build dynamic UPI intent link
// ════════════════════════════════════════════════════════════════
async function openTournamentPaymentSheet(t, teamData) {
    state.activePaymentTournament = t;
    state.activePaymentTeam = teamData;
    const fee = Number(t.entryFee || 0);

    // Loading state while admin UPI config loads
    const submitBtn = document.getElementById('pay-submit-btn');
    const upiDisplay = document.getElementById('pay-upi-id-display');
    const loadError = document.getElementById('pay-load-error');
    if (loadError) loadError.style.display = 'none';
    if (submitBtn) { submitBtn.disabled = true; }
    if (upiDisplay) upiDisplay.textContent = 'Loading…';

    // 1. Fetch live admin UPI configuration
    // Payment authorization/duplicate validation remains in submitPaymentRequest().
    let adminUpiId, payeeName;
    try {
        ({ adminUpiId, payeeName } = await fetchPaymentSettings());
    } catch (e) {
        // Error state (instead of an empty sheet): toast + inline retry
        showToast('Couldn\'t load payment details. Please try again.', 'error');
        if (loadError) loadError.style.display = 'block';
        if (upiDisplay) upiDisplay.textContent = '—';
        const upiCopyBtnErr = document.getElementById('pay-upi-copy');
        if (upiCopyBtnErr) upiCopyBtnErr.hidden = true;
        return;
    }
    // If tournament doc has its own UPI ID, prioritize it
    if (t.raw && t.raw.upiId) adminUpiId = t.raw.upiId;

    if (submitBtn) { submitBtn.disabled = false; }

    // 2. Set Badges & Text
    document.getElementById('pay-tournament-name').textContent = t.name;
    document.getElementById('pay-team-name').textContent = teamData.teamName || 'My Team';
    document.getElementById('pay-team-id').textContent = teamData.teamId;
    document.getElementById('pay-fee').textContent = '₹' + fee;
    document.getElementById('pay-upi-id-display').textContent = adminUpiId;
    // v6: copy button for the UPI ID (manual-pay fallback when no UPI app handles the intent)
    const upiCopyBtn = document.getElementById('pay-upi-copy');
    if (upiCopyBtn) {
        upiCopyBtn.hidden = false;
        upiCopyBtn.onclick = () => window.copyText(adminUpiId, 'UPI ID');
    }

    // Set pre-filled exact entry fee (read-only)
    const amtInput = document.getElementById('pay-amount-input');
    amtInput.value = fee;

    // Reset Transaction ID
    const trxInput = document.getElementById('pay-trxid');
    trxInput.value = '';

    // 3. Build Standard UPI Intent URL
    const upiIntentUrl = buildUpiIntentUrl(adminUpiId, payeeName, fee, teamData.teamId);
    const intentBtn = document.getElementById('pay-upi-intent-link');
    if (intentBtn) {
        intentBtn.href = upiIntentUrl;
    }
}

// ════════════════════════════════════════════════════════════════
// SECURE PAYMENT SUBMISSION
// ════════════════════════════════════════════════════════════════
export async function submitTournamentPayment() {
    const t = state.activePaymentTournament;
    const teamData = state.activePaymentTeam;
    const uid = state.currentUser?.uid;
    const uData = state.userData || {};
    if (!t || !teamData || !uid) {
        showToast('Payment session expired. Please try joining again.', 'error');
        return;
    }
    const trxId = document.getElementById('pay-trxid').value.trim();

    // ১. Transaction / UTR ID কঠোর ভ্যালিডেশন (স্পেস ও স্পেশাল ক্যারেক্টার প্রতিরোধ)
    if (!trxId) {
        showToast('Please enter your UPI Transaction / UTR ID', 'error');
        return;
    }
    if (!isValidTrxId(trxId)) {
        showToast('Please enter a valid alphanumeric Transaction / UTR ID (min 8 characters, no spaces)', 'error');
        return;
    }

    const submitBtn = document.getElementById('pay-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;"></div> Verifying & Submitting...';

    try {
        await submitPaymentRequest({
            t,
            teamData,
            trxId,
            uid,
            uData,
            authEmail: state.currentUser?.email
        });
        // সফল হলে মেসেজ পরের পেজে দেখানো হবে; My Matches এ টিমের Pending স্ট্যাটাস দেখা যাবে
        flashToast('Payment submitted successfully! Waiting for admin approval ⏳', 'success', 5000);
        goReplace('matches');
    } catch (err) {
        showToast(err.message, 'error', 5000);
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit Payment';
    }
}

export function closePaymentSheet() {
    goBack('matches');
}

async function loadPaymentPage() {
    const tid = getParam('id');
    const teamId = getParam('team');
    if (!tid || !teamId) {
        flashToast('Tournament or Team not found', 'error');
        goBack('matches');
        return;
    }
    try {
        const tSnap = await getDoc(doc(db, 'tournaments', tid));
        const teamSnap = await getDoc(doc(db, 'tournamentTeams', teamId));
        if (!tSnap.exists() || !teamSnap.exists()) {
            flashToast('Tournament or Team not found', 'error');
            goBack('matches');
            return;
        }
        // 🛡️ Ownership check: শুধু এই টিমের ক্যাপ্টেনই পেমেন্ট পেজ খুলতে পারবে
        if (teamSnap.data().captainUserId !== state.currentUser?.uid) {
            flashToast('Unauthorized: This team does not belong to you.', 'error');
            goBack('matches');
            return;
        }
        const tournObj = normalizeTournament(tSnap.data(), tSnap.id);
        await openTournamentPaymentSheet(tournObj, teamSnap.data());
    } catch (e) {
        showToast('Error opening payment: ' + e.message, 'error');
    }
}

window.submitTournamentPayment = submitTournamentPayment;
window.closePaymentSheet = closePaymentSheet;
window.retryPaymentLoad = () => {
    const err = document.getElementById('pay-load-error');
    if (err) err.style.display = 'none';
    loadPaymentPage();
};

initPage({
    page: 'payment',
    onReady: () => {
        loadPaymentPage();
    }
});