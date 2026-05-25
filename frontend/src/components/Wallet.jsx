import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const Wallet = () => {
  const { darkMode } = useAuth();
  const [balance, setBalance] = useState(0);
  const [savingsBalance, setSavingsBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('deposit');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchWallet = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('${API_URL}/api/wallet', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBalance(res.data.balance);
      setSavingsBalance(res.data.savingsBalance || 0);
      setTransactions(res.data.transactions);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchWallet();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || amount <= 0) {
      setMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const endpoint = type === 'deposit' ? '/api/wallet/deposit' : '/api/wallet/withdraw';
      const res = await axios.post(`${API_URL}${endpoint}`, {
        amount: parseFloat(amount),
        description: description || (type === 'deposit' ? 'Manual deposit' : 'Manual withdrawal')
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBalance(res.data.balance);
      // Notify sidebar that wallet balance has changed
      window.dispatchEvent(new CustomEvent('wallet-updated', { detail: { balance: res.data.balance } }));
      setAmount('');
      setDescription('');
      setMessage({ text: `${type === 'deposit' ? 'Deposit' : 'Withdrawal'} successful!`, type: 'success' });
      fetchWallet(); // refresh transaction list and savings balance
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Transaction failed', type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const getTransactionIcon = (tx) => {
    if (tx.type === 'deposit') return 'fa-arrow-down';
    if (tx.type === 'withdrawal') return 'fa-arrow-up';
    if (tx.type === 'savings_transfer') return 'fa-piggy-bank';
    return 'fa-exchange-alt';
  };

  const getTransactionAmountSign = (tx) => {
    if (tx.type === 'deposit') return '+';
    if (tx.type === 'withdrawal') return '-';
    if (tx.type === 'savings_transfer') return '→';
    return '';
  };

  const getTransactionColor = (tx) => {
    if (tx.type === 'deposit') return '#38a169';
    if (tx.type === 'withdrawal') return '#e53e3e';
    if (tx.type === 'savings_transfer') return '#f39c12';
    return 'var(--text-primary)';
  };

  return (
    <div className="wallet-page">
      <div className="page-header">
        <h1><i className="fas fa-wallet"></i> My Wallet</h1>
        <p>Manage your in-app balance. Deposits and withdrawals are manual for now.</p>
      </div>

      {/* Two balance cards side by side */}
      <div className="balance-cards">
        <div className="wallet-balance-card glass-effect">
          <div className="balance-label">Main Wallet</div>
          <div className="balance-amount">₦{balance.toLocaleString()}</div>
        </div>
        <div className="wallet-balance-card glass-effect savings">
          <div className="balance-label">Savings</div>
          <div className="balance-amount">₦{savingsBalance.toLocaleString()}</div>
          <div className="balance-note">
            <i className="fas fa-robot"></i> Auto‑saved from income
          </div>
        </div>
      </div>

      <div className="wallet-form glass-effect">
        <h3>Add / Withdraw Money</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Transaction Type</label>
            <div className="type-buttons">
              <button
                type="button"
                className={type === 'deposit' ? 'active' : ''}
                onClick={() => setType('deposit')}
              >
                <i className="fas fa-arrow-down"></i> Deposit
              </button>
              <button
                type="button"
                className={type === 'withdrawal' ? 'active' : ''}
                onClick={() => setType('withdrawal')}
              >
                <i className="fas fa-arrow-up"></i> Withdraw
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="amount">Amount (₦)</label>
            <div className="input-with-icon">
              <i className="fas fa-money-bill-wave input-icon"></i>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="description">Description (optional)</label>
            <div className="input-with-icon">
              <i className="fas fa-pen input-icon"></i>
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Top up from bank, paid for coffee"
              />
            </div>
          </div>

          {message && (
            <div className={`message ${message.type}`}>
              <i className={`fas ${message.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`}></i>
              {message.text}
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? (
              <><i className="fas fa-spinner fa-spin"></i> Processing...</>
            ) : (
              <><i className={`fas ${type === 'deposit' ? 'fa-download' : 'fa-upload'}`}></i> {type === 'deposit' ? 'Deposit' : 'Withdraw'}</>
            )}
          </button>
        </form>
      </div>

      <div className="wallet-transactions glass-effect">
        <h3>
          <i className="fas fa-history"></i> Recent Transactions
        </h3>
        {transactions.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-wallet"></i>
            <p>No transactions yet. Make a deposit to get started.</p>
          </div>
        ) : (
          <div className="transactions-list">
            {transactions.map(tx => (
              <div key={tx._id} className={`transaction ${tx.type}`}>
                <div className="tx-icon" style={{ background: `${getTransactionColor(tx)}20`, color: getTransactionColor(tx) }}>
                  <i className={`fas ${getTransactionIcon(tx)}`}></i>
                </div>
                <div className="tx-details">
                  <div className="tx-description">{tx.description}</div>
                  <div className="tx-date">{new Date(tx.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="tx-amount" style={{ color: getTransactionColor(tx) }}>
                  {getTransactionAmountSign(tx)} ₦{tx.amount.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* STYLES – must be inside the single root element */}
      <style jsx="true">{`
        .wallet-page {
          max-width: 1000px;
          margin: 0 auto;
          padding: 20px;
        }
        .page-header {
          text-align: center;
          margin-bottom: 30px;
        }
        .page-header h1 {
          font-size: 2rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .page-header p {
          color: var(--text-secondary);
        }
        .balance-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 25px;
          margin-bottom: 30px;
        }
        .wallet-balance-card {
          text-align: center;
          padding: 30px;
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-md);
          transition: all 0.3s ease;
        }
        .wallet-balance-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        .wallet-balance-card.savings {
          border-top: 4px solid #f39c12;
        }
        .balance-label {
          font-size: 1rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }
        .balance-amount {
          font-size: 2.5rem;
          font-weight: 800;
          background: linear-gradient(135deg, #38a169, #4299e1);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .wallet-balance-card.savings .balance-amount {
          background: linear-gradient(135deg, #f39c12, #e67e22);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .balance-note {
          margin-top: 12px;
          font-size: 0.8rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .wallet-form {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          margin-bottom: 30px;
          border: 1px solid var(--glass-border);
        }
        .wallet-form h3 {
          margin-bottom: 25px;
          color: var(--text-primary);
          font-size: 1.5rem;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .form-group {
          margin-bottom: 25px;
        }
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: var(--text-primary);
          font-size: 0.9rem;
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
          pointer-events: none;
        }
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 14px 15px 14px 45px;
          background: var(--glass-bg);
          border: 1.5px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 1rem;
          transition: all 0.2s ease;
        }
        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }
        .type-buttons {
          display: flex;
          gap: 15px;
        }
        .type-buttons button {
          flex: 1;
          padding: 12px;
          border: 1.5px solid var(--border-color);
          background: var(--glass-bg);
          color: var(--text-primary);
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .type-buttons button.active {
          background: var(--gradient-primary);
          color: white;
          border-color: transparent;
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
        }
        .submit-btn {
          width: 100%;
          padding: 14px;
          background: var(--gradient-success);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .message {
          padding: 12px 15px;
          border-radius: var(--radius-md);
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 500;
        }
        .message.success {
          background: rgba(56, 161, 105, 0.1);
          color: #38a169;
          border-left: 4px solid #38a169;
        }
        .message.error {
          background: rgba(229, 62, 62, 0.1);
          color: #e53e3e;
          border-left: 4px solid #e53e3e;
        }
        .wallet-transactions {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          border: 1px solid var(--glass-border);
        }
        .wallet-transactions h3 {
          margin-bottom: 20px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .transactions-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .transaction {
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          transition: transform 0.2s;
        }
        .transaction:hover {
          transform: translateX(5px);
        }
        .tx-icon {
          width: 45px;
          height: 45px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.2rem;
        }
        .tx-details {
          flex: 1;
        }
        .tx-description {
          font-weight: 600;
          color: var(--text-primary);
        }
        .tx-date {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .tx-amount {
          font-weight: 700;
          font-size: 1.1rem;
        }
        .empty-state {
          text-align: center;
          padding: 40px;
          color: var(--text-secondary);
        }
        .empty-state i {
          font-size: 3rem;
          margin-bottom: 15px;
          opacity: 0.5;
        }
        @media (max-width: 640px) {
          .balance-cards {
            grid-template-columns: 1fr;
          }
          .type-buttons {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default Wallet;