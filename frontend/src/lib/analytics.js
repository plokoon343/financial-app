import axios from 'axios';
import { API_URL } from '../config';

// Fire-and-forget event logging for the Help Centre and support (round9 B4):
// help_opened, help_article_viewed, help_article_helpful, help_search_no_result,
// support_contacted. Never blocks the UI on failure.
export function trackEvent(name, properties = {}) {
  const token = localStorage.getItem('token');
  if (!token) return;
  axios.post(`${API_URL}/api/analytics/track`, { name, properties, platform: 'web' },
    { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}
