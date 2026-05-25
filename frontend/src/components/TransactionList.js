import React from 'react';

const TransactionList = ({ transactions, onDelete }) => {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatAmount = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'NGN'
    }).format(amount);
  };

  if (!transactions || transactions.length === 0) {
    return (
      <div className="transaction-list">
        <div className="empty-state">
          <p>No transactions in this category.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="transaction-list">
      <div className="transactions">
        {transactions.map(transaction => (
          <div key={transaction.id} className="transaction-item" style={{
            display: 'grid',
            gridTemplateColumns: '100px 1fr auto auto auto',
            gap: '16px',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            transition: 'background 0.2s',
            width: '100%'
          }}>
            <div className="transaction-date" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {formatDate(transaction.date)}
            </div>
            <div className="transaction-description" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
              {transaction.description}
            </div>
            <div className={`transaction-amount ${transaction.type}`} style={{
              fontWeight: 700,
              color: transaction.type === 'income' ? '#38a169' : '#e53e3e',
              textAlign: 'right'
            }}>
              {formatAmount(transaction.amount)}
            </div>
            <div className="transaction-category" style={{
              backgroundColor: 'var(--glass-bg)',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap'
            }}>
              {transaction.category}
            </div>
            {onDelete && (
              <button 
                className="delete-btn"
                onClick={() => onDelete(transaction.id)}
                aria-label="Delete transaction"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '8px',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(229, 62, 62, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <i className="fas fa-trash"></i>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TransactionList;