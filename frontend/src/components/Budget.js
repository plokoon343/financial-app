import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Pie } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { API_URL } from '../config';
Chart.register(...registerables);

const Budget = () => {
  const [budgets, setBudgets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    category: '',
    amount: '',
    month: new Date().toISOString().slice(0, 7)
  });

  useEffect(() => {
    fetchBudgets();
    fetchTransactions();
  }, []);

  const fetchBudgets = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/budgets`);
      setBudgets(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching budgets:', error);
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/transactions`);
      setTransactions(response.data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const addBudget = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/budgets`, {
        ...formData,
        amount: parseFloat(formData.amount)
      });
      fetchBudgets();
      setShowForm(false);
      setFormData({ category: '', amount: '', month: new Date().toISOString().slice(0, 7) });
    } catch (error) {
      console.error('Error adding budget:', error);
      alert('Error adding budget. Please try again.');
    }
  };

  const deleteBudget = async (id) => {
    if (window.confirm('Are you sure you want to delete this budget?')) {
      try {
        await axios.delete(`${API_URL}/api/budgets/${id}`);
        fetchBudgets();
      } catch (error) {
        console.error('Error deleting budget:', error);
        alert('Error deleting budget. Please try again.');
      }
    }
  };

  // Calculate budget vs actual
  const budgetData = budgets.map(budget => {
    const actualSpent = transactions
      .filter(t => t.type === 'expense' && t.category === budget.category)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const remaining = budget.amount - actualSpent;
    const spentPercentage = budget.amount > 0 ? (actualSpent / budget.amount) * 100 : 0;
    
    return {
      ...budget,
      actualSpent,
      remaining,
      spentPercentage,
      isOverBudget: actualSpent > budget.amount,
      isWarning: spentPercentage > 80 && spentPercentage <= 100
    };
  });

  const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = budgetData.reduce((sum, b) => sum + b.actualSpent, 0);
  const totalRemaining = totalBudget - totalSpent;

  const chartData = {
    labels: budgetData.map(b => b.category),
    datasets: [
      {
        label: 'Actual Spending',
        data: budgetData.map(b => b.actualSpent),
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
          '#9966FF', '#FF9F40', '#C9CBCF', '#77DD77',
          '#FF6961', '#84B6F4', '#FDFD96', '#AEC6CF'
        ],
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.8)'
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          font: {
            size: 12,
            family: 'Inter, sans-serif'
          },
          color: 'var(--text-primary)'
        }
      },
      title: {
        display: true,
        text: 'Spending by Category',
        font: {
          size: 18,
          family: 'Poppins, sans-serif',
          weight: '600'
        },
        color: 'var(--text-primary)',
        padding: {
          top: 10,
          bottom: 30
        }
      }
    }
  };

  return (
    <div className="budget-page">
      <div className="page-header">
       <h1 className="page-title">
  <i className="fas fa-chart-pie"></i> Budget Management
</h1>
        <p className="page-subtitle">Track and manage your spending across categories</p>
        <button 
          className="btn-primary add-budget-btn"
          onClick={() => setShowForm(!showForm)}
        >
          <i className={`fas ${showForm ? 'fa-times' : 'fa-plus'}`}></i>
          {showForm ? 'Cancel' : 'Add New Budget'}
        </button>
      </div>

      {/* Budget Summary Cards */}
      <div className="budget-summary-grid">
        <div className="budget-summary-card">
          <div className="summary-icon total-budget">
            <i className="fas fa-wallet"></i>
          </div>
          <div className="summary-content">
            <h3>Total Budget</h3>
            <p className="summary-amount">₦{totalBudget.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
        
        <div className="budget-summary-card">
          <div className="summary-icon total-spent">
            <i className="fas fa-money-bill-wave"></i>
          </div>
          <div className="summary-content">
            <h3>Total Spent</h3>
            <p className="summary-amount">₦{totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
        
        <div className="budget-summary-card">
          <div className="summary-icon total-remaining">
            <i className="fas fa-piggy-bank"></i>
          </div>
          <div className="summary-content">
            <h3>Total Remaining</h3>
            <p className={`summary-amount ${totalRemaining < 0 ? 'negative' : 'positive'}`}>
              ₦{totalRemaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Budget Form */}
      {showForm && (
        <div className="budget-form-container">
          <form onSubmit={addBudget} className="budget-form glass-effect">
            <div className="form-header">
              <h3><i className="fas fa-plus-circle"></i> Set New Budget</h3>
              <p>Define your spending limits for each category</p>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="category">
                  <i className="fas fa-tag"></i> Category
                </label>
                <div className="input-with-icon">
                  <i className="fas fa-tag input-icon"></i>
                  <input
                    id="category"
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    required
                    placeholder="e.g., Food, Transport, Entertainment"
                    className="form-control"
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label htmlFor="amount">
                  <i className="fas fa-money-bill"></i> Amount (₦)
                </label>
                <div className="input-with-icon">
                  <i className="fas fa-money-bill input-icon"></i>
                  <input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    required
                    placeholder="0.00"
                    className="form-control"
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label htmlFor="month">
                  <i className="fas fa-calendar-alt"></i> Month
                </label>
                <div className="input-with-icon">
                  <i className="fas fa-calendar-alt input-icon"></i>
                  <input
                    id="month"
                    type="month"
                    value={formData.month}
                    onChange={(e) => setFormData({...formData, month: e.target.value})}
                    required
                    className="form-control"
                  />
                </div>
              </div>
            </div>
            
            <div className="form-buttons">
              <button type="submit" className="btn-submit">
                <i className="fas fa-check"></i> Add Budget
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowForm(false);
                  setFormData({ category: '', amount: '', month: new Date().toISOString().slice(0, 7) });
                }} 
                className="btn-cancel"
              >
                <i className="fas fa-times"></i> Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Chart Section */}
      {budgetData.length > 0 && (
        <div className="budget-chart-section">
          <div className="chart-container glass-effect">
            <Pie data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Budget List */}
      <div className="budget-list-container">
        <h2 className="section-title">
          <i className="fas fa-list-alt"></i> Budget Overview
          <span className="budget-count">{budgetData.length} budget{budgetData.length !== 1 ? 's' : ''}</span>
        </h2>
        
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading budgets...</p>
          </div>
        ) : budgetData.length === 0 ? (
          <div className="empty-state glass-effect">
            <div className="empty-state-icon">
              <i className="fas fa-chart-pie"></i>
            </div>
            <h3>No Budgets Yet</h3>
            <p>Create your first budget to start tracking your spending!</p>
            <button 
              className="btn-primary create-budget-btn"
              onClick={() => setShowForm(true)}
            >
              <i className="fas fa-plus"></i> Create Budget
            </button>
          </div>
        ) : (
          <div className="budget-list">
            {budgetData.map(budget => (
              <div key={budget._id} className={`budget-item glass-effect ${budget.isOverBudget ? 'over-budget' : budget.isWarning ? 'warning-budget' : ''}`}>
                <div className="budget-header">
                  <div className="budget-category">
                    <i className="fas fa-tag"></i>
                    <span>{budget.category}</span>
                  </div>
                  <div className="budget-actions">
                    <span className="budget-month">
                      <i className="fas fa-calendar"></i> {budget.month}
                    </span>
                    <button 
                      className="delete-budget-btn"
                      onClick={() => deleteBudget(budget._id)}
                      title="Delete budget"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
                
                <div className="budget-progress">
                  <div className="progress-bar">
                    <div 
                      className={`progress-fill ${budget.isOverBudget ? 'over' : budget.isWarning ? 'warning' : 'normal'}`}
                      style={{ width: `${Math.min(budget.spentPercentage, 100)}%` }}
                    ></div>
                  </div>
                  <div className="progress-text">
                    <span>{budget.spentPercentage.toFixed(1)}% spent</span>
                    <span>₦{budget.actualSpent.toFixed(2)} of ₦{budget.amount.toFixed(2)}</span>
                  </div>
                </div>
                
                <div className="budget-details">
                  <div className="budget-amounts">
                    <div className="amount-item">
                      <span className="amount-label">Budget</span>
                      <span className="amount-value">₦{budget.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="amount-item">
                      <span className="amount-label">Spent</span>
                      <span className="amount-value spent">₦{budget.actualSpent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="amount-item">
                      <span className="amount-label">Remaining</span>
                      <span className={`amount-value ${budget.remaining < 0 ? 'negative' : 'positive'}`}>
                        ₦{budget.remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  
                  {budget.isOverBudget && (
                    <div className="budget-warning">
                      <i className="fas fa-exclamation-triangle"></i>
                      <span>You've exceeded your budget by ₦{Math.abs(budget.remaining).toFixed(2)}</span>
                    </div>
                  )}
                  
                  {budget.isWarning && !budget.isOverBudget && (
                    <div className="budget-warning warning">
                      <i className="fas fa-exclamation-circle"></i>
                      <span>You've used {budget.spentPercentage.toFixed(1)}% of your budget</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx="true">{`
        /* Budget Page Styles */
        .budget-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .page-header {
          text-align: center;
          margin-bottom: 40px;
          padding: 30px 20px;
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .page-title {
          font-family: var(--font-heading);
          font-size: 2.8rem;
          font-weight: 700;
          margin-bottom: 10px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
          .page-title i {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
        
        .page-subtitle {
          font-size: 1.1rem;
          color: var(--text-secondary);
          margin-bottom: 25px;
          max-width: 600px;
          margin-left: auto;
          margin-right: auto;
        }
        
        /* Button Base Styles */
        .btn-primary {
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 1rem;
          font-family: var(--font-body);
          position: relative;
          overflow: hidden;
        }
        
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
        }
        
        /* Add Budget Button */
        .add-budget-btn {
          padding: 14px 28px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        
        .add-budget-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
        }
        
        /* Create Budget Button in Empty State */
        .create-budget-btn {
          margin-top: 25px;
          padding: 16px 40px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-full);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-size: 1.1rem;
          box-shadow: var(--shadow-md);
          position: relative;
          overflow: hidden;
          animation: pulseGlow 2s ease-in-out infinite;
        }
        
        .create-budget-btn::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
          transition: left 0.7s;
        }
        
        .create-budget-btn:hover::before {
          left: 100%;
        }
        
        .create-budget-btn:hover {
          transform: translateY(-3px) scale(1.05);
          box-shadow: var(--shadow-glow);
          animation: none;
        }
        
        .create-budget-btn:active {
          transform: translateY(-1px);
        }
        
        @keyframes pulseGlow {
          0%, 100% { 
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3); 
          }
          50% { 
            box-shadow: 0 10px 40px rgba(102, 126, 234, 0.6); 
          }
        }
        
        /* Budget Summary Grid */
        .budget-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        
        .budget-summary-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 25px;
          display: flex;
          align-items: center;
          gap: 20px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }
        
        .budget-summary-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        
        .summary-icon {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          color: white;
        }
        
        .summary-icon.total-budget {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .summary-icon.total-spent {
          background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%);
        }
        
        .summary-icon.total-remaining {
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        }
        
        .summary-content h3 {
          font-size: 1rem;
          color: var(--text-secondary);
          margin-bottom: 5px;
          font-weight: 500;
        }
        
        .summary-amount {
          font-size: 1.8rem;
          font-weight: 700;
          font-family: var(--font-accent);
          color: var(--text-primary);
        }
        
        .summary-amount.negative {
          color: #ff6b8b;
        }
        
        .summary-amount.positive {
          color: #43e97b;
        }
        
        /* Budget Form Styles */
        .budget-form-container {
          margin-bottom: 40px;
        }
        
        .budget-form {
          max-width: 800px;
          margin: 0 auto;
          padding: 30px;
          border-radius: var(--radius-lg);
          animation: slideInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .form-header {
          text-align: center;
          margin-bottom: 30px;
        }
        
        .form-header h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 8px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .form-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: var(--text-primary);
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .input-with-icon {
          position: relative;
        }
        
        .input-icon {
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
          font-size: 1rem;
          z-index: 1;
        }
        
        /* TEXTBOX STYLES */
        .form-control {
          width: 100%;
          padding: 15px 15px 15px 45px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 1rem;
          transition: all var(--transition-base);
          font-family: var(--font-body);
        }
        
        .form-control:focus {
          outline: none;
          border-color: var(--income-color);
          box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.15);
          background: var(--card-bg);
        }
        
        .form-control::placeholder {
          color: var(--text-secondary);
          opacity: 0.7;
        }
        
        .form-control:hover {
          border-color: var(--gradient-primary);
        }
        
        /* Month input specific styling */
        input[type="month"].form-control {
          padding-right: 15px;
          cursor: pointer;
        }
        
        /* Number input specific styling */
        input[type="number"].form-control::-webkit-inner-spin-button,
        input[type="number"].form-control::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        input[type="number"].form-control {
          -moz-appearance: textfield;
        }
        
        /* Form Buttons */
        .form-buttons {
          display: flex;
          gap: 15px;
          justify-content: flex-end;
          margin-top: 20px;
        }
        
        .btn-submit, .btn-cancel {
          padding: 14px 28px;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 1rem;
          font-family: var(--font-body);
        }
        
        .btn-submit {
          background: var(--gradient-success);
          color: white;
        }
        
        .btn-submit:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        
        .btn-cancel {
          background: var(--glass-bg);
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
        }
        
        .btn-cancel:hover {
          background: var(--glass-bg);
          transform: translateY(-2px);
        }
        
        /* Chart Section */
        .budget-chart-section {
          margin: 40px 0;
        }
        
        .chart-container {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          height: 400px;
          position: relative;
        }
        
        /* Budget List */
        .budget-list-container {
          margin-top: 40px;
        }
        
        .section-title {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 25px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .budget-count {
          font-size: 0.9rem;
          background: var(--glass-bg);
          padding: 4px 12px;
          border-radius: var(--radius-full);
          color: var(--text-secondary);
          font-weight: 500;
        }
        
        .budget-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        
        .budget-item {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 25px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }
        
        .budget-item:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        
        .budget-item.over-budget {
          border-left: 4px solid #ff6b8b;
        }
        
        .budget-item.warning-budget {
          border-left: 4px solid #ffa62e;
        }
        
        .budget-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .budget-category {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.2rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        
        .budget-actions {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        
        .budget-month {
          font-size: 0.9rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .delete-budget-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 5px;
          border-radius: 4px;
          transition: all var(--transition-fast);
        }
        
        .delete-budget-btn:hover {
          color: #ff6b8b;
          background: rgba(255, 107, 139, 0.1);
        }
        
        .budget-progress {
          margin-bottom: 20px;
        }
        
        .progress-bar {
          height: 10px;
          background: var(--glass-bg);
          border-radius: var(--radius-full);
          overflow: hidden;
          margin-bottom: 8px;
        }
        
        .progress-fill {
          height: 100%;
          border-radius: var(--radius-full);
          transition: width 0.5s ease;
        }
        
        .progress-fill.normal {
          background: var(--gradient-success);
        }
        
        .progress-fill.warning {
          background: var(--gradient-warning);
        }
        
        .progress-fill.over {
          background: linear-gradient(135deg, #ff6b8b 0%, #ff0000 100%);
        }
        
        .progress-text {
          display: flex;
          justify-content: space-between;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
        
        .budget-details {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 15px;
        }
        
        .budget-amounts {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 15px;
        }
        
        .amount-item {
          text-align: center;
        }
        
        .amount-label {
          display: block;
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }
        
        .amount-value {
          display: block;
          font-size: 1.1rem;
          font-weight: 600;
          font-family: var(--font-accent);
          color: var(--text-primary);
        }
        
        .amount-value.spent {
          color: #ff6b8b;
        }
        
        .amount-value.negative {
          color: #ff6b8b;
        }
        
        .amount-value.positive {
          color: #43e97b;
        }
        
        .budget-warning {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 15px;
          background: rgba(255, 107, 139, 0.1);
          border-radius: var(--radius-md);
          color: #ff6b8b;
          font-size: 0.9rem;
          font-weight: 500;
        }
        
        .budget-warning.warning {
          background: rgba(255, 166, 46, 0.1);
          color: #ffa62e;
        }
        
        /* Loading and Empty States */
        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
        }
        
        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 3px solid var(--glass-border);
          border-top: 3px solid var(--income-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }
        
        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background: var(--glass-bg);
          border-radius: var(--radius-lg);
          margin: 20px 0;
          backdrop-filter: blur(20px);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }
        
        .empty-state:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        
        .empty-state-icon {
          font-size: 80px;
          margin-bottom: 20px;
          opacity: 0.8;
          color: var(--text-secondary);
          transition: all var(--transition-base);
        }
        
        .empty-state:hover .empty-state-icon {
          transform: scale(1.1);
          opacity: 1;
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
        @media (max-width: 768px) {
          .budget-page {
            padding: 15px;
          }
          
          .page-title {
            font-size: 2.2rem;
          }
          
          .budget-summary-grid {
            grid-template-columns: 1fr;
          }
          
          .budget-list {
            grid-template-columns: 1fr;
          }
          
          .budget-amounts {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          
          .form-grid {
            grid-template-columns: 1fr;
          }
          
          .form-buttons {
            flex-direction: column;
          }
          
          .btn-submit, .btn-cancel {
            width: 100%;
            justify-content: center;
          }
          
          .chart-container {
            height: 300px;
            padding: 20px;
          }
          
          .empty-state {
            padding: 40px 20px;
          }
          
          .empty-state-icon {
            font-size: 60px;
          }
          
          .empty-state h3 {
            font-size: 1.5rem;
          }
          
          .empty-state p {
            font-size: 1rem;
          }
          
          .create-budget-btn {
            padding: 14px 30px;
            font-size: 1rem;
          }
        }
        
        @media (max-width: 480px) {
          .page-title {
            font-size: 1.8rem;
          }
          
          .budget-summary-card {
            flex-direction: column;
            text-align: center;
          }
          
          .budget-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          
          .budget-actions {
            width: 100%;
            justify-content: space-between;
          }
          
          .budget-form {
            padding: 20px;
          }
          
          .empty-state {
            padding: 30px 15px;
          }
          
          .empty-state-icon {
            font-size: 50px;
          }
          
          .create-budget-btn {
            width: 100%;
            justify-content: center;
          }
        }
        
        /* Animation for form */
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Budget;