/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ `allowLocalhostAsSecureOrigin: true` — production এ security flaw
 *    ✅ এখন environment-aware: শুধু localhost/dev এ true,
 *       production এ false।
 * ─────────────────────────────────────────────────────────────
 */

const isLocalhost =
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' ||
     location.hostname === '127.0.0.1' ||
     location.hostname === '[::1]');

export const ONESIGNAL_CONFIG = {
    appId: '1d0c2af9-4033-4585-b1bd-198b02675a14', // Tournixo app — admin panel এর সাথে মিলিয়ে (2026-10-09)
    // ⚠️ এই ID টা OneSignal Dashboard (Tournixo app → Settings → Keys & IDs) এর সাথে
    // 100% মিলতে হবে। Admin panel যেই অ্যাপে push পাঠায়, user রা সেই একই অ্যাপেই
    // subscribe হতে হবে — নাহলে push কখনোই ফোনে পৌঁছাবে না।
    sdkUrl: 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js',
    // ✅ localhost এ true, production এ false
    allowLocalhostAsSecureOrigin: isLocalhost,
    permissionPromptDelayMs: 5000
};