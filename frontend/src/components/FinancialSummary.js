import React from 'react';

const FinancialSummary = ({ transactions }) => {
  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const netIncome = totalIncome - totalExpenses;

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'NGN'
    }).format(amount);
  };

  return (
    <div className="financial-summary">
      <div className="summary-card income">
        <h3>Total Income</h3>
        <div className="amount">{formatCurrency(totalIncome)}</div>
      </div>
      
      <div className="summary-card expenses">
        <h3>Total Expenses</h3>
        <div className="amount">{formatCurrency(totalExpenses)}</div>
      </div>
      
      <div className="summary-card net">
        <h3>Net Income</h3>
        <div className="amount" style={{ color: netIncome >= 0 ? '#27ae60' : '#e74c3c' }}>
          {formatCurrency(netIncome)}
        </div>
      </div>
    </div>
  );
};

export default FinancialSummary;