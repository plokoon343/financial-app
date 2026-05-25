import React, { useState } from 'react';
//import { API_URL } from '../config';
const NetWorthCalculator = () => {
  const [assets, setAssets] = useState({
    cash: '',
    investments: '',
    property: '',
    vehicles: '',
    retirement: '',
    otherAssets: ''
  });

  const [liabilities, setLiabilities] = useState({
    mortgage: '',
    carLoan: '',
    creditCards: '',
    studentLoans: '',
    personalLoans: '',
    otherLiabilities: ''
  });

  // Helper to convert empty string to 0 for calculations
  const toNumber = (val) => val === '' ? 0 : parseFloat(val);

  const updateAsset = (key, value) => {
    // Allow empty string, numbers, decimals – no leading zero problem
    setAssets({ ...assets, [key]: value === '' ? '' : value });
  };

  const updateLiability = (key, value) => {
    setLiabilities({ ...liabilities, [key]: value === '' ? '' : value });
  };

  const totalAssets = Object.values(assets).reduce((sum, val) => sum + toNumber(val), 0);
  const totalLiabilities = Object.values(liabilities).reduce((sum, val) => sum + toNumber(val), 0);
  const netWorth = totalAssets - totalLiabilities;

  const assetCategories = [
    { key: 'cash', label: 'Cash & Savings', description: 'Checking, savings, emergency fund', icon: 'fa-money-bill-wave' },
    { key: 'investments', label: 'Investments', description: 'Stocks, bonds, mutual funds', icon: 'fa-chart-line' },
    { key: 'retirement', label: 'Retirement Accounts', description: '401(k), IRA, Roth IRA', icon: 'fa-piggy-bank' },
    { key: 'property', label: 'Real Estate', description: 'Home value, investment properties', icon: 'fa-home' },
    { key: 'vehicles', label: 'Vehicles', description: 'Cars, motorcycles, boats', icon: 'fa-car' },
    { key: 'otherAssets', label: 'Other Assets', description: 'Jewelry, collectibles, etc.', icon: 'fa-gem' }
  ];

  const liabilityCategories = [
    { key: 'mortgage', label: 'Mortgage', description: 'Home mortgage balance', icon: 'fa-house-chimney' },
    { key: 'carLoan', label: 'Car Loans', description: 'Auto loan balances', icon: 'fa-car' },
    { key: 'studentLoans', label: 'Student Loans', description: 'Education loan balances', icon: 'fa-graduation-cap' },
    { key: 'creditCards', label: 'Credit Cards', description: 'Credit card balances', icon: 'fa-credit-card' },
    { key: 'personalLoans', label: 'Personal Loans', description: 'Other personal loans', icon: 'fa-hand-holding-usd' },
    { key: 'otherLiabilities', label: 'Other Liabilities', description: 'Any other debts', icon: 'fa-file-invoice-dollar' }
  ];

  return (
    <div className="networth-page">
      <div className="section-header">
        <h2><i className="fas fa-coins"></i> Net Worth Calculator</h2>
        <p className="section-subtitle">Track your assets and liabilities to calculate your financial net worth</p>
      </div>

      {/* Net Worth Summary */}
      <div className="networth-summary glass-effect">
        <div className="summary-header">
          <h3><i className="fas fa-calculator"></i> Your Net Worth Summary</h3>
          <p>Calculated as Assets minus Liabilities</p>
        </div>
        
        <div className="networth-display">
          <div className="networth-label">Current Net Worth</div>
          <div className="networth-value" style={{ color: netWorth >= 0 ? '#27ae60' : '#e74c3c', textShadow: netWorth >= 0 ? '0 0 20px rgba(39,174,96,0.3)' : '0 0 20px rgba(231,76,60,0.3)' }}>
            ₦{netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="networth-breakdown">
            <div className="breakdown-item positive">
              <div className="breakdown-label"><i className="fas fa-arrow-up"></i><span>Total Assets</span></div>
              <div className="breakdown-amount">₦{totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="breakdown-item negative">
              <div className="breakdown-label"><i className="fas fa-arrow-down"></i><span>Total Liabilities</span></div>
              <div className="breakdown-amount">₦{totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Assets and Liabilities Grid */}
      <div className="assets-liabilities-container">
        <div className="assets-section glass-effect">
          <div className="section-title">
            <h3><i className="fas fa-plus-circle"></i> Assets</h3>
            <p className="section-total">Total: ₦{totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="assets-list">
            {assetCategories.map(cat => (
              <div key={cat.key} className="asset-item">
                <div className="category-header">
                  <div className="category-icon"><i className={`fas ${cat.icon}`}></i></div>
                  <div className="category-info"><div className="category-name">{cat.label}</div><div className="category-desc">{cat.description}</div></div>
                </div>
                <div className="amount-input-container">
                  <div className="currency-symbol">₦</div>
                  <input
                    type="number"
                    value={assets[cat.key]}
                    onChange={(e) => updateAsset(cat.key, e.target.value)}
                    className="amount-input"
                    placeholder="0.00"
                    step="1000"
                    min="0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="liabilities-section glass-effect">
          <div className="section-title">
            <h3><i className="fas fa-minus-circle"></i> Liabilities</h3>
            <p className="section-total">Total: ₦{totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="liabilities-list">
            {liabilityCategories.map(cat => (
              <div key={cat.key} className="liability-item">
                <div className="category-header">
                  <div className="category-icon"><i className={`fas ${cat.icon}`}></i></div>
                  <div className="category-info"><div className="category-name">{cat.label}</div><div className="category-desc">{cat.description}</div></div>
                </div>
                <div className="amount-input-container">
                  <div className="currency-symbol">₦</div>
                  <input
                    type="number"
                    value={liabilities[cat.key]}
                    onChange={(e) => updateLiability(cat.key, e.target.value)}
                    className="amount-input"
                    placeholder="0.00"
                    step="1000"
                    min="0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tips Section (unchanged) */}
      <div className="networth-tips glass-effect">
        <div className="tips-header"><h3><i className="fas fa-lightbulb"></i> Tips for Growing Your Net Worth</h3><p>Strategies to increase your financial health</p></div>
        <div className="tips-grid">
          <div className="tip-card"><div className="tip-icon income"><i className="fas fa-money-bill-trend-up"></i></div><div className="tip-content"><h4>Increase Income</h4><p>Consider side hustles or career advancement to boost your earning potential.</p></div></div>
          <div className="tip-card"><div className="tip-icon debt"><i className="fas fa-credit-card"></i></div><div className="tip-content"><h4>Reduce High-Interest Debt</h4><p>Focus on credit cards and personal loans with high interest rates first.</p></div></div>
          <div className="tip-card"><div className="tip-icon equity"><i className="fas fa-home"></i></div><div className="tip-content"><h4>Build Home Equity</h4><p>Make extra mortgage payments when possible to increase your property value.</p></div></div>
          <div className="tip-card"><div className="tip-icon investment"><i className="fas fa-chart-line"></i></div><div className="tip-content"><h4>Invest Consistently</h4><p>Take advantage of compound growth by investing regularly over time.</p></div></div>
          <div className="tip-card"><div className="tip-icon emergency"><i className="fas fa-shield-alt"></i></div><div className="tip-content"><h4>Build Emergency Fund</h4><p>Aim for 3-6 months of expenses in liquid savings for unexpected events.</p></div></div>
        </div>
      </div>
      
      <style jsx="true">{`
        /* Net Worth Calculator Styles */
        .networth-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        
        .section-header {
          text-align: center;
          margin-bottom: 40px;
          padding: 30px 20px;
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .section-header h2 {
          font-family: var(--font-heading);
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 10px;
          background: linear-gradient(135deg, #ffa62e 0%, #ff6b8b 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 15px;
        }
        
        .section-subtitle {
          color: var(--text-secondary);
          font-size: 1.1rem;
          max-width: 600px;
          margin: 0 auto;
        }
        
        /* Net Worth Summary */
        .networth-summary {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          margin-bottom: 40px;
          text-align: center;
        }
        
        .summary-header {
          margin-bottom: 30px;
        }
        
        .summary-header h3 {
          font-family: var(--font-heading);
          font-size: 1.6rem;
          color: var(--text-primary);
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .summary-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .networth-display {
          padding: 30px;
          background: var(--glass-bg);
          border-radius: var(--radius-lg);
          border: 2px solid var(--glass-border);
        }
        
        .networth-label {
          font-size: 1.1rem;
          color: var(--text-secondary);
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 600;
        }
        
        .networth-value {
          font-size: 4rem;
          font-weight: 800;
          font-family: var(--font-accent);
          margin-bottom: 30px;
          line-height: 1;
          transition: all var(--transition-base);
        }
        
        .networth-breakdown {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-top: 30px;
        }
        
        .breakdown-item {
          padding: 25px;
          border-radius: var(--radius-md);
          background: var(--glass-bg);
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all var(--transition-base);
        }
        
        .breakdown-item:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-md);
        }
        
        .breakdown-item.positive {
          border-left: 4px solid #27ae60;
        }
        
        .breakdown-item.negative {
          border-left: 4px solid #e74c3c;
        }
        
        .breakdown-label {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 600;
          color: var(--text-primary);
        }
        
        .breakdown-label i {
          font-size: 1.3rem;
        }
        
        .breakdown-label i.fa-arrow-up {
          color: #27ae60;
        }
        
        .breakdown-label i.fa-arrow-down {
          color: #e74c3c;
        }
        
        .breakdown-amount {
          font-family: var(--font-accent);
          font-weight: 700;
          font-size: 1.8rem;
        }
        
        .breakdown-item.positive .breakdown-amount {
          color: #27ae60;
        }
        
        .breakdown-item.negative .breakdown-amount {
          color: #e74c3c;
        }
        
        /* Assets and Liabilities Container */
        .assets-liabilities-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
          gap: 30px;
          margin-bottom: 40px;
        }
        
        @media (max-width: 1100px) {
          .assets-liabilities-container {
            grid-template-columns: 1fr;
          }
        }
        
        .assets-section, .liabilities-section {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .assets-section {
          border-top: 4px solid #27ae60;
        }
        
        .liabilities-section {
          border-top: 4px solid #e74c3c;
        }
        
        .section-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 2px solid var(--glass-border);
        }
        
        .section-title h3 {
          font-family: var(--font-heading);
          font-size: 1.6rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .section-total {
          font-family: var(--font-accent);
          font-weight: 700;
          font-size: 1.3rem;
          color: var(--text-primary);
          background: var(--glass-bg);
          padding: 8px 16px;
          border-radius: var(--radius-full);
        }
        
        .assets-list, .liabilities-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .asset-item, .liability-item {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all var(--transition-base);
        }
        
        .asset-item:hover, .liability-item:hover {
          transform: translateX(10px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        .category-header {
          display: flex;
          align-items: center;
          gap: 15px;
          flex: 1;
        }
        
        .category-icon {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          color: white;
          flex-shrink: 0;
        }
        
        .liabilities-section .category-icon {
          background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%);
        }
        
        .category-info {
          flex: 1;
        }
        
        .category-name {
          font-weight: 600;
          font-size: 1.1rem;
          color: var(--text-primary);
          margin-bottom: 5px;
        }
        
        .category-desc {
          font-size: 0.85rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        
        .amount-input-container {
          position: relative;
          width: 180px;
        }
        
        .currency-symbol {
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          font-weight: 600;
          color: var(--text-secondary);
          z-index: 1;
        }
        
        .amount-input {
          width: 100%;
          padding: 15px 15px 15px 35px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 1rem;
          font-family: var(--font-accent);
          font-weight: 600;
          transition: all var(--transition-base);
        }
        
        .amount-input:focus {
          outline: none;
          border-color: var(--income-color);
          box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.15);
          background: var(--card-bg);
        }
        
        .amount-input::-webkit-inner-spin-button,
        .amount-input::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        /* Tips Section */
        .networth-tips {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .tips-header {
          margin-bottom: 30px;
        }
        
        .tips-header h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 8px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .tips-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .tips-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 25px;
        }
        
        .tip-card {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 25px;
          display: flex;
          gap: 20px;
          transition: all var(--transition-base);
        }
        
        .tip-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-md);
        }
        
        .tip-icon {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          color: white;
          flex-shrink: 0;
        }
        
        .tip-icon.income {
          background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
        }
        
        .tip-icon.debt {
          background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
        }
        
        .tip-icon.equity {
          background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
        }
        
        .tip-icon.investment {
          background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
        }
        
        .tip-icon.emergency {
          background: linear-gradient(135deg, #f39c12 0%, #d35400 100%);
        }
        
        .tip-content h4 {
          font-size: 1.2rem;
          color: var(--text-primary);
          margin-bottom: 10px;
          font-weight: 600;
        }
        
        .tip-content p {
          color: var(--text-secondary);
          font-size: 0.95rem;
          line-height: 1.5;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
          .networth-page {
            padding: 15px;
          }
          
          .section-header h2 {
            font-size: 2rem;
          }
          
          .networth-value {
            font-size: 3rem;
          }
          
          .assets-liabilities-container {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          
          .asset-item, .liability-item {
            flex-direction: column;
            align-items: stretch;
            gap: 15px;
          }
          
          .amount-input-container {
            width: 100%;
          }
          
          .tips-grid {
            grid-template-columns: 1fr;
          }
        }
        
        @media (max-width: 480px) {
          .section-header h2 {
            font-size: 1.8rem;
          }
          
          .networth-value {
            font-size: 2.5rem;
          }
          
          .networth-breakdown {
            grid-template-columns: 1fr;
          }
          
          .section-title {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          
          .tip-card {
            flex-direction: column;
            text-align: center;
          }
          
          .tip-icon {
            margin: 0 auto;
          }
        }
      `}</style>
    </div>
  );
};

export default NetWorthCalculator;