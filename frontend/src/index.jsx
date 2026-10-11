import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme.css';
import './ui.css';
import axios from 'axios';
import App from './App';

// Tells the API which app a request comes from (used for signup metrics).
axios.defaults.headers.common['X-Client'] = 'web';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker so the app is installable as a PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
