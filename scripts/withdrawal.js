import { initPage, effectiveWinningBalance } from './app.js';
import { state } from './state.js';
import { showToast, flashToast } from './toast.js';
import { goBack, goReplace } from '../config/app-config.js';
import { loadMinWithdrawal } from '../services/settings.service.js';
import { requestWithdrawal } from '../services/withdrawal.service.js';
import { APP_CONFIG } from '../utils/constants.js';   // ✅ ADDED
import { isValidUpiId } from '../utils/validators.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Hard-coded `100` min-withdrawal fallback (line 20, 74)
 *    ✅ এখন APP_CONFIG.defaultMinWithdrawal ব্যবহার করা হচ্ছে।
 *       state.minWithdrawal না এলে সেটাই default।
 * ─────────────────────────────────────────────────────────────
 */

const DEFAULT_MIN_WITHDRAWAL = APP_CONFIG.defaultMinWithdrawal;

export function selectWdMethod(method, btn) {
    state.wdMethod = method;
    document.querySelectorAll('#overlay-withdraw .pay-method-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

export async function submitWithdraw() {
    const uid = state.currentUser?.uid;
    const u = state.userData || {};
    const rawAmount = parseFloat(document.getElementById('wd-amount').value);
    // Round to 2 decimal places to avoid floating-point dust (e.g. 100.999999)
    const amount = Math.round((Number(rawAmount) || 0) * 100) / 100;
    const upiId = document.getElementById('wd-phone').value.trim();

    // ✅ fallback now comes from APP_CONFIG, not hard-coded 100
    const min = Number(state.minWithdrawal || DEFAULT_MIN_WITHDRAWAL);

    if (!amount || isNaN(amount) || amount < min) {
        showToast(`Minimum withdrawal amount is ₹${min}`, 'error');
        return;
    }
    if (!upiId) {
        showToast('Please enter your receiving UPI ID', 'error');
        return;
    }
    if (!isValidUpiId(upiId)) {
        showToast('Please enter a valid UPI ID (e.g. 9876543210@upi)', 'error');
        return;
    }

    const submitBtn = document.querySelector('#overlay-withdraw .btn-primary');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }

    try {
        await requestWithdrawal({
            uid,
            userName: u.name,
            amount,
            phone: upiId,
            method: state.wdMethod
        });
        flashToast('Withdrawal request submitted! ⏳', 'success', 4000);
        goReplace('wallet');
    } catch (err) {
        showToast(err.message, 'error', 4500);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request Withdrawal';
        }
    }
}

export function closeWithdrawSheet() {
    goBack('wallet');
}

window.selectWdMethod = selectWdMethod;
window.submitWithdraw = submitWithdraw;
window.closeWithdrawSheet = closeWithdrawSheet;

initPage({
    page: 'withdrawal',
    onReady: async () => {
        await loadMinWithdrawal();
        // Winning Balance can never exceed Earned Money — gate on the clamped value.
        const bal = effectiveWinningBalance(state.userData);
        // ✅ same fallback constant, no more magic number
        const min = Number(state.minWithdrawal || DEFAULT_MIN_WITHDRAWAL);
        if (bal < min) {
            flashToast(`Minimum withdrawal is ₹${min}. Your available balance is ₹${bal.toFixed(2)}`, 'error', 4000);
            goBack('wallet');
        }
    }
});