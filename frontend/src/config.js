// Backend API base URL.
//
// Override per environment with REACT_APP_API_URL (Vercel → Settings →
// Environment Variables) so the backend can move domains without a code change.
// Falls back to the current Render URL, which stays live as a permanent
// fallback for older clients.
//
// NOTE: Create React App inlines REACT_APP_* at BUILD time, so changing this
// variable requires a redeploy — it is not read at runtime.
export const API_URL =
  process.env.REACT_APP_API_URL || 'https://financial-app-w2ai.onrender.com';
