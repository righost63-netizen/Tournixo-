// Same rules as the original inline checks

export const MIN_PASSWORD_LENGTH = 6;

export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Free Fire UID / player UIDs: digits only
export function isNumeric(value) {
    return /^\d+$/.test(value);
}

// UPI Transaction / UTR ID: min 8 chars, letters+digits only, no spaces
export function isValidTrxId(id) {
    return id.length >= 8 && /^[a-zA-Z0-9]+$/.test(id);
}

// UPI ID (VPA): name@bank — e.g. 9876543210@upi, name@okhdfcbank
export function isValidUpiId(id) {
    return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(id || '').trim());
}