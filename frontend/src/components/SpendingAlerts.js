import React, { useState, useEffect } from 'react';
import axios from 'axios';
//import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
const SpendingAlerts = () => {
  //const { darkMode } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const fetchAlerts = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/alerts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(res.data);
    } catch (err) {
      console.error('Failed to fetch alerts', err);
    } finally {
      setLoading(false);
    }
  };

  const dismissAlert = (id) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'danger': return '⚠️';
      case 'warning': return '🔔';
      case 'success': return '✅';
      default: return 'ℹ️';
    }
  };

  const getAlertColor = (type) => {
    switch (type) {
      case 'danger': return '#e74c3c';
      case 'warning': return '#f39c12';
      case 'success': return '#27ae60';
      default: return '#3498db';
    }
  };

  if (loading) return <div className="loading">Loading alerts...</div>;

  return (
    <div className="alerts-section">
      <h3>Recent Alerts</h3>
      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="empty-state">
            <p>No alerts at the moment. Alerts will appear here when you have budget warnings, upcoming bills, or achievements.</p>
          </div>
        ) : (
          alerts.map((alert) => (
            <div 
              key={alert.id} 
              className="alert-item"
              style={{ borderLeftColor: getAlertColor(alert.type) }}
            >
              <div className="alert-icon">{getAlertIcon(alert.type)}</div>
              <div className="alert-content">
                <div className="alert-message">{alert.message}</div>
                <div className="alert-details">
                  <span className="alert-category">{alert.category}</span>
                  <span className="alert-amount">₦{alert.amount?.toLocaleString()}</span>
                  <span className="alert-timestamp">{new Date(alert.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
              <button className="alert-dismiss" onClick={() => dismissAlert(alert.id)}>×</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SpendingAlerts;