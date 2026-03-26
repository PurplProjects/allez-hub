const API = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('allez_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('allez_token');
    window.location.href = '/login';
    return;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ─────────────────────────────────────────────────────
export const sendOTP   = email => request('/auth/send-otp',    { method:'POST', body: JSON.stringify({ email }) });
export const verifyOTP = (email, code) => request('/auth/verify-otp', { method:'POST', body: JSON.stringify({ email, code }) });
export const getMe     = () => request('/auth/me');

// ── Fencer ───────────────────────────────────────────────────
export const getMyProfile = ()             => request('/fencers/me');
export const getMyBouts   = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/fencers/me/bouts${qs ? '?' + qs : ''}`);
};
export const getChecklist  = date => request(`/fencers/me/checklist?date=${date}`);
export const saveChecklist = (date, itemIndex, completed) =>
  request('/fencers/me/checklist', { method:'POST', body: JSON.stringify({ date, itemIndex, completed }) });

// ── Coach ────────────────────────────────────────────────────
export const getSquad        = ()          => request('/coach/squad');
export const getFencerDetail = id          => request(`/coach/fencer/${id}`);
export const addCoachNote    = (fencerId, note) =>
  request('/coach/notes', { method:'POST', body: JSON.stringify({ fencerId, note }) });
export const addFencer = data =>
  request('/coach/fencers', { method:'POST', body: JSON.stringify(data) });

// ── Scrape ───────────────────────────────────────────────────
export const triggerScrape   = fencerId => request(`/scrape/${fencerId}`,        { method:'POST' });
export const getScrapeStatus = fencerId => request(`/scrape/${fencerId}/status`);

// ── Poll scrape until complete ────────────────────────────────
export async function pollScrapeUntilDone(fencerId, onUpdate, intervalMs = 5000) {
  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const status = await getScrapeStatus(fencerId);
        if (onUpdate) onUpdate(status);
        if (!status.inProgress) {
          resolve(status);
        } else {
          setTimeout(poll, intervalMs);
        }
      } catch {
        setTimeout(poll, intervalMs);
      }
    };
    poll();
  });
}
