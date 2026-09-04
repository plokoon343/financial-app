import axios from 'axios';
import { API_URL } from '../config';

// Web Pro-checkout helpers (monetization). Launch-gated on the server; these only
// run when billing status reports checkoutAvailable.
const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const PENDING_KEY = 'pro_pending_ref';

// Start checkout: get the Paystack URL, remember the reference, and redirect. On
// return, Paystack appends ?reference=… and verifyPendingPro() finalises it.
export async function startProCheckout(months = 1) {
  const { data } = await axios.post(`${API_URL}/api/billing/checkout`, { months }, authHeaders());
  if (!data.authorization_url) throw new Error('No checkout URL');
  try { localStorage.setItem(PENDING_KEY, data.reference); } catch { /* ignore */ }
  window.location.href = data.authorization_url;
}

// After returning from Paystack, verify the pending (or URL-provided) reference and
// grant Pro. Returns true when Pro is now active. Safe to call on any page load.
export async function verifyPendingPro() {
  let ref = null;
  try { ref = localStorage.getItem(PENDING_KEY); } catch { /* ignore */ }
  if (!ref) {
    const p = new URLSearchParams(window.location.search);
    ref = p.get('reference') || p.get('trxref');
  }
  if (!ref) return false;
  try {
    const { data } = await axios.post(`${API_URL}/api/billing/verify`, { reference: ref }, authHeaders());
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    return !!data.isPro;
  } catch {
    // A non-success (e.g. 402 not completed) — clear so we don't retry forever.
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    return false;
  }
}
