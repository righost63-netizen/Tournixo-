export function tsToMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') {
        try {
            return v.toMillis();
        } catch (e) {
            return 0;
        }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
}

export function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function formatDate(ts) {
    if (!ts) return '—';
    try {
        if (typeof ts === 'string') return ts;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    } catch (e) {
        return '—';
    }
}

export function formatDateOnly(v) {
    if (!v) return '—';
    try {
        if (typeof v === 'string') return v;
        const d = v.toDate ? v.toDate() : new Date(v);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    } catch (e) {
        return '—';
    }
}

export function formatTimeOnly(v) {
    if (!v) return '—';
    try {
        if (typeof v === 'string') {
            const parts = v.split(':');
            if (parts.length >= 2) {
                let h = parseInt(parts[0], 10);
                const m = parts[1].padStart(2, '0');
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return `${h}:${m} ${ampm}`;
            }
            return v;
        }
        const d = v.toDate ? v.toDate() : new Date(v);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return '—';
    }
}

export function timeAgo(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}