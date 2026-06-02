import React, { useState, useEffect, useCallback } from 'react';
import FinancialTrends from './FinancialTrends';
import DebtManager from './DebtManager';
import GoalTracker from './GoalTracker';
import SpendingAlerts from './SpendingAlerts';
import NetWorthCalculator from './NetWorthCalculator';
import SubscriptionManager from './SubscriptionManager';
import BillsManager from './BillsManager';
//import { API_URL } from '../config';
const FinancialHealth = ({ 
  transactions = [], 
  debts = [], 
  goals = [], 
  subscriptions = [],
  setDebts,
  setGoals, 
  setSubscriptions 
}) => {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const calculateFinancialHealth = useCallback(() => {
    if (transactions.length === 0) {
      setHealthData(null);
      setLoading(false);
      return;
    }

    const incomeTransactions = transactions.filter(t => t.type === 'income');
    const expenseTransactions = transactions.filter(t => t.type === 'expense');
    
    const totalIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const netIncome = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;

    const calculatedData = {
      totalIncome,
      totalExpenses,
      netIncome,
      savingsRate,
      transactions
    };

    setHealthData(calculatedData);
    setLoading(false);
  }, [transactions]);

  useEffect(() => {
    calculateFinancialHealth();
  }, [calculateFinancialHealth]);

  const getSavingsRateColor = (rate) => {
    if (rate >= 20) return '#27ae60';
    if (rate >= 10) return '#f39c12';
    if (rate >= 0) return '#e74c3c';
    return '#c0392b';
  };

  const getHealthAdvice = (data) => {
    const advice = [];
    
    if (data.netIncome < 0) {
      advice.push("🚨 CRITICAL: Your expenses exceed your income by ₦" + Math.abs(data.netIncome).toLocaleString() + ". You're accumulating debt!");
      advice.push("Immediately review your expenses and identify areas to cut back.");
      advice.push("Consider finding additional income sources to cover the deficit.");
    } else if (data.savingsRate < 10) {
      advice.push("Try to increase your savings rate to at least 10% of your income.");
    }
    
    if (data.netIncome > 0 && data.netIncome < 500) {
      advice.push("You have a positive cash flow. Consider increasing your emergency fund.");
    }
    
    if (data.netIncome > 0 && data.savingsRate >= 20) {
      advice.push("Excellent! You're saving a healthy portion of your income.");
    }
    
    if (advice.length === 0 && data.netIncome >= 0) {
      advice.push("Maintain your current financial habits.");
    }
    
    return advice;
  };

  if (loading && transactions.length === 0) {
    return <div className="loading">Loading financial health data...</div>;
  }

  if (!healthData && transactions.length === 0) {
    return (
      <div className="empty-state">
        <h3>No Financial Data Available</h3>
        <p>Add some transactions in the Dashboard to see your financial health analysis.</p>
      </div>
    );
  }

  const advice = healthData ? getHealthAdvice(healthData) : [];

  return (
    <div className="financial-health-page">
      <div className="page-header">
        <h1>Financial Health Dashboard</h1>
        <div className="tab-navigation">
          <button 
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <i className="fas fa-chart-line"></i>
            <span>Overview</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'trends' ? 'active' : ''}`}
            onClick={() => setActiveTab('trends')}
          >
            <i className="fas fa-chart-bar"></i>
            <span>Trends</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'debt' ? 'active' : ''}`}
            onClick={() => setActiveTab('debt')}
          >
            <i className="fas fa-credit-card"></i>
            <span>Debt Management</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'goals' ? 'active' : ''}`}
            onClick={() => setActiveTab('goals')}
          >
            <i className="fas fa-flag-checkered"></i>
            <span>Goals</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'networth' ? 'active' : ''}`}
            onClick={() => setActiveTab('networth')}
          >
            <i className="fas fa-coins"></i>
            <span>Net Worth</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'subscriptions' ? 'active' : ''}`}
            onClick={() => setActiveTab('subscriptions')}
          >
            <i className="fas fa-calendar-alt"></i>
            <span>Subscriptions</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'bills' ? 'active' : ''}`}
            onClick={() => setActiveTab('bills')}
          >
            <i className="fas fa-receipt"></i>
            <span>Bills</span>
          </button>
        </div>
      </div>

      {activeTab === 'overview' && healthData && (
        <>
          <div className="health-cards">
            <div className="health-card">
              <h3>Income & Expenses</h3>
              <div className="health-metrics">
                <div className="metric">
                  <span className="label">Total Income:</span>
                  <span className="value income">₦{healthData.totalIncome.toLocaleString()}</span>
                </div>
                <div className="metric">
                  <span className="label">Total Expenses:</span>
                  <span className="value expense">-₦{healthData.totalExpenses.toLocaleString()}</span>
                </div>
                <div className="metric">
                  <span className="label">Net Income:</span>
                  <span 
                    className="value" 
                    style={{ 
                      color: healthData.netIncome >= 0 ? '#27ae60' : '#e74c3c',
                      fontWeight: healthData.netIncome < 0 ? 'bold' : 'normal'
                    }}
                  >
                    {healthData.netIncome >= 0 ? '+' : ''}₦{healthData.netIncome.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="health-card">
              <h3>Savings Rate</h3>
              <div className="savings-rate">
                <div 
                  className="rate-circle"
                  style={{ 
                    borderColor: getSavingsRateColor(healthData.savingsRate),
                    color: getSavingsRateColor(healthData.savingsRate),
                    backgroundColor: healthData.savingsRate < 0 ? '#fff0f0' : 'transparent'
                  }}
                >
                  {healthData.savingsRate.toFixed(1)}%
                </div>
                <p className="rate-description" style={{ 
                  color: healthData.savingsRate < 0 ? '#e74c3c' : 'inherit',
                  fontWeight: healthData.savingsRate < 0 ? 'bold' : 'normal'
                }}>
                  {healthData.netIncome < 0 ? "You're spending more than you earn!" :
                   healthData.savingsRate >= 20 ? "Excellent savings rate!" :
                   healthData.savingsRate >= 10 ? "Good savings rate" :
                   "Consider increasing savings"}
                </p>
              </div>
            </div>

            <div className="health-card">
              <h3>Financial Advice</h3>
              <div className="advice-list">
                {advice.map((item, index) => (
                  <div key={index} className="advice-item" style={{
                    color: healthData.netIncome < 0 && index === 0 ? '#e74c3c' : 'inherit',
                    fontWeight: healthData.netIncome < 0 && index === 0 ? 'bold' : 'normal'
                  }}>
                    {healthData.netIncome < 0 && index === 0 ? '⚠️' : '💡'} {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <SpendingAlerts transactions={transactions} />
        </>
      )}

      {activeTab === 'trends' && <FinancialTrends transactions={transactions} />}
      {activeTab === 'debt' && <DebtManager debts={debts} setDebts={setDebts} />}
      {activeTab === 'goals' && <GoalTracker goals={goals} setGoals={setGoals} />}
      {activeTab === 'networth' && <NetWorthCalculator />}
      {activeTab === 'subscriptions' && <SubscriptionManager subscriptions={subscriptions} setSubscriptions={setSubscriptions} />}
      {activeTab === 'bills' && <BillsManager />}  {/* ← UPDATED: now uses BillsManager */}

      <style jsx="true">{`
        /* Financial Health Page Styles */
        .financial-health-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .page-header {
          text-align: center;
          margin-bottom: 24px;
          padding: 18px 14px;
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .page-header h1 {
          font-family: var(--font-heading);
          font-size: 2.8rem;
          font-weight: 700;
          margin-bottom: 30px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        /* Tab Navigation */
        .tab-navigation {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 12px;
          background: var(--glass-bg);
          padding: 15px;
          border-radius: var(--radius-lg);
          backdrop-filter: blur(10px);
          border: 1px solid var(--glass-border);
          margin-top: 20px;
        }
        
        .tab-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 24px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-full);
          color: var(--text-primary);
          font-weight: 600;
          font-size: 1rem;
          font-family: var(--font-body);
          cursor: pointer;
          transition: all var(--transition-base);
          position: relative;
          overflow: hidden;
          white-space: nowrap;
        }
        
        .tab-btn:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-sm);
          background: rgba(255, 255, 255, 0.1);
          border-color: var(--gradient-primary);
        }
        
        .tab-btn.active {
          background: var(--gradient-primary);
          color: white;
          border-color: transparent;
          box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
          transform: translateY(-2px);
        }
        
        .tab-btn.active:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        
        .tab-btn i {
          font-size: 1.1rem;
          transition: transform var(--transition-base);
        }
        
        .tab-btn:hover i {
          transform: scale(1.2);
        }
        
        .tab-btn.active i {
          transform: scale(1.2);
        }
        
        /* Ripple effect for tab buttons */
        .tab-btn::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 5px;
          height: 5px;
          background: rgba(255, 255, 255, 0.5);
          opacity: 0;
          border-radius: 100%;
          transform: scale(1, 1) translate(-50%);
          transform-origin: 50% 50%;
        }
        
        .tab-btn:focus:not(:active)::after {
          animation: ripple 1s ease-out;
        }
        
        @keyframes ripple {
          0% {
            transform: scale(0, 0);
            opacity: 0.5;
          }
          100% {
            transform: scale(20, 20);
            opacity: 0;
          }
        }
        
        /* Health Cards */
        .health-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        
        .health-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }
        
        .health-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        
        .health-card h3 {
          font-family: var(--font-heading);
          font-size: 1.5rem;
          margin-bottom: 20px;
          color: var(--text-primary);
          border-bottom: 2px solid var(--glass-border);
          padding-bottom: 10px;
        }
        
        .health-metrics {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .metric {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }
        
        .metric:hover {
          transform: translateX(5px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        .metric .label {
          font-weight: 500;
          color: var(--text-secondary);
        }
        
        .metric .value {
          font-family: var(--font-accent);
          font-weight: 700;
          font-size: 1.2rem;
        }
        
        .metric .value.income {
          color: #27ae60;
        }
        
        .metric .value.expense {
          color: #e74c3c;
        }
        
        /* Savings Rate */
        .savings-rate {
          text-align: center;
          padding: 20px 0;
        }
        
        .rate-circle {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          border: 6px solid;
          font-size: 2rem;
          font-weight: 700;
          font-family: var(--font-accent);
          transition: all var(--transition-base);
        }
        
        .rate-circle:hover {
          transform: scale(1.1);
          box-shadow: var(--shadow-md);
        }
        
        .rate-description {
          font-size: 1.1rem;
          line-height: 1.6;
          max-width: 300px;
          margin: 0 auto;
          padding: 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
        }
        
        /* Advice List */
        .advice-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 300px;
          overflow-y: auto;
          padding-right: 10px;
        }
        
        .advice-item {
          padding: 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          line-height: 1.6;
          transition: all var(--transition-fast);
          border-left: 4px solid var(--gradient-primary);
        }
        
        .advice-item:hover {
          transform: translateX(5px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        /* Loading and Empty States */
        .loading {
          text-align: center;
          padding: 60px 20px;
          font-size: 1.2rem;
          color: var(--text-secondary);
        }
        
        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background: var(--glass-bg);
          border-radius: var(--radius-lg);
          margin: 20px 0;
          backdrop-filter: blur(20px);
          border: 1px solid var(--glass-border);
        }
        
        .empty-state h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 10px;
          color: var(--text-primary);
        }
        
        .empty-state p {
          color: var(--text-secondary);
          max-width: 400px;
          margin: 0 auto 30px;
          font-size: 1.1rem;
          line-height: 1.6;
        }
        
        /* Responsive Design */
        @media (max-width: 1200px) {
          .health-cards {
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          }
        }
        
        @media (max-width: 992px) {
          .tab-navigation {
            flex-wrap: wrap;
          }
          
          .tab-btn {
            padding: 12px 20px;
            font-size: 0.9rem;
          }
          
          .page-header h1 {
            font-size: 2.2rem;
          }
        }
        
        @media (max-width: 768px) {
          .financial-health-page {
            padding: 15px;
          }
          
          .page-header {
            padding: 20px 15px;
          }
          
          .page-header h1 {
            font-size: 2rem;
          }
          
          .tab-navigation {
            gap: 8px;
            padding: 10px;
          }
          
          .tab-btn {
            padding: 10px 16px;
            font-size: 0.85rem;
          }
          
          .health-cards {
            grid-template-columns: 1fr;
          }
          
          .tab-btn span {
            display: none;
          }
          
          .tab-btn i {
            font-size: 1.3rem;
            margin: 0;
          }
          
          .tab-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            justify-content: center;
            padding: 0;
          }
        }
        
        @media (max-width: 480px) {
          .page-header h1 {
            font-size: 1.8rem;
          }
          
          .tab-navigation {
            justify-content: space-between;
          }
          
          .tab-btn {
            width: 45px;
            height: 45px;
          }
          
          .tab-btn i {
            font-size: 1.2rem;
          }
          
          .health-card {
            padding: 20px;
          }
          
          .rate-circle {
            width: 100px;
            height: 100px;
            font-size: 1.7rem;
          }
        }
        
        /* Scrollbar for advice list */
        .advice-list::-webkit-scrollbar {
          width: 6px;
        }
        
        .advice-list::-webkit-scrollbar-track {
          background: var(--glass-bg);
          border-radius: var(--radius-full);
        }
        
        .advice-list::-webkit-scrollbar-thumb {
          background: var(--gradient-primary);
          border-radius: var(--radius-full);
        }
      `}</style>
    </div>
  );
};

export default FinancialHealth;