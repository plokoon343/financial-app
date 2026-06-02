import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';

const FinancialTrends = ({ transactions = [] }) => {
  const [timeframe, setTimeframe] = useState('6months');
  const [monthlyData, setMonthlyData] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [activeChart, setActiveChart] = useState('line');
  const [trendMetrics, setTrendMetrics] = useState({});

  const timeframes = [
    { value: '3months', label: '3 Months', color: '#667eea' },
    { value: '6months', label: '6 Months', color: '#4facfe' },
    { value: '1year', label: '1 Year', color: '#43e97b' }
  ];

  const processTransactionData = useCallback(() => {
    const monthlySummary = {};

    transactions.forEach(transaction => {
      const date = new Date(transaction.date);
      const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      const monthName = date.toLocaleString('default', { month: 'short' });

      if (!monthlySummary[monthKey]) {
        monthlySummary[monthKey] = {
          month: monthName,
          income: 0,
          expenses: 0,
          savings: 0
        };
      }

      if (transaction.type === 'income') {
        monthlySummary[monthKey].income += transaction.amount;
      } else {
        monthlySummary[monthKey].expenses += Math.abs(transaction.amount);
      }
    });

    const data = Object.values(monthlySummary).map(month => ({
      ...month,
      savings: month.income - month.expenses,
      savingsRate: month.income > 0 ? ((month.income - month.expenses) / month.income * 100).toFixed(1) : 0
    })).sort((a, b) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months.indexOf(a.month) - months.indexOf(b.month);
    });

    let filteredData = data;
    if (timeframe === '3months') filteredData = data.slice(-3);
    else if (timeframe === '6months') filteredData = data.slice(-6);
    else if (timeframe === '1year') filteredData = data.slice(-12);

    setMonthlyData(filteredData);

    const categories = {};
    transactions
      .filter(t => t.type === 'expense')
      .forEach(transaction => {
        if (!categories[transaction.category]) {
          categories[transaction.category] = 0;
        }
        categories[transaction.category] += Math.abs(transaction.amount);
      });

    const totalExpenses = Object.values(categories).reduce((sum, amount) => sum + amount, 0);
    const categoryData = Object.entries(categories).map(([name, amount], index) => {
      const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#667eea', '#764ba2', '#f093fb', '#f5576c', '#fee140'];
      return {
        name,
        amount,
        percentage: totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(1) : 0,
        color: colors[index % colors.length]
      };
    });

    setExpenseCategories(categoryData);

    if (filteredData.length > 0) {
      const firstMonth = filteredData[0];
      const lastMonth = filteredData[filteredData.length - 1];

      const incomeChange = ((lastMonth.income - firstMonth.income) / firstMonth.income * 100).toFixed(1);
      const expenseChange = ((lastMonth.expenses - firstMonth.expenses) / firstMonth.expenses * 100).toFixed(1);
      const savingsChange = ((lastMonth.savings - firstMonth.savings) / Math.abs(firstMonth.savings || 1) * 100).toFixed(1);

      setTrendMetrics({
        incomeChange: parseFloat(incomeChange),
        expenseChange: parseFloat(expenseChange),
        savingsChange: parseFloat(savingsChange),
        averageIncome: filteredData.reduce((sum, month) => sum + month.income, 0) / filteredData.length,
        averageExpenses: filteredData.reduce((sum, month) => sum + month.expenses, 0) / filteredData.length,
        averageSavings: filteredData.reduce((sum, month) => sum + month.savings, 0) / filteredData.length,
        averageSavingsRate: filteredData.reduce((sum, month) => sum + parseFloat(month.savingsRate || 0), 0) / filteredData.length
      });
    }
  }, [transactions, timeframe]);

  useEffect(() => {
    if (transactions.length > 0) {
      processTransactionData();
    }
  }, [transactions, timeframe, processTransactionData]);

  const largestCategory = expenseCategories.length > 0
    ? expenseCategories.reduce((max, category) =>
        category.amount > max.amount ? category : max, expenseCategories[0])
    : null;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip glass-card">
          <p className="tooltip-label">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="tooltip-item" style={{ color: entry.color }}>
              {entry.name}: <span>₦{entry.value.toLocaleString()}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };
  return (
    <div className="trends-page">
      <div className="section-header">
        <div className="header-content">
          <h2>
            <i className="fas fa-chart-line"></i>
            Financial Trends & Analysis
          </h2>
          <p className="section-subtitle">Track your financial patterns and make data-driven decisions</p>
        </div>

        <div className="header-controls">
          <div className="timeframe-selectors">
            {timeframes.map((tf) => (
              <button
                key={tf.value}
                className={`timeframe-btn ${timeframe === tf.value ? 'active' : ''}`}
                onClick={() => setTimeframe(tf.value)}
                style={{ 
                  '--btn-color': tf.color,
                  borderColor: timeframe === tf.value ? tf.color : 'transparent'
                }}
              >
                <span className="timeframe-dot" style={{ backgroundColor: tf.color }}></span>
                {tf.label}
              </button>
            ))}
          </div>

          <div className="chart-selectors">
            <button
              className={`chart-btn ${activeChart === 'line' ? 'active' : ''}`}
              onClick={() => setActiveChart('line')}
            >
              <i className="fas fa-chart-line"></i>
              Line
            </button>
            <button
              className={`chart-btn ${activeChart === 'bar' ? 'active' : ''}`}
              onClick={() => setActiveChart('bar')}
            >
              <i className="fas fa-chart-bar"></i>
              Bar
            </button>
          </div>
        </div>
      </div>

      {/* Trend Overview Cards */}
      <div className="trend-overview">
        <div className="trend-card glass-card">
          <div className="trend-header">
            <div className="trend-icon" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
              <i className="fas fa-money-bill-wave"></i>
            </div>
            <div className="trend-info">
              <h3>Income Trend</h3>
              <div className="trend-value">
                <span className="amount">₦{trendMetrics.averageIncome ? trendMetrics.averageIncome.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}</span>
                <span className={`trend-change ${trendMetrics.incomeChange > 0 ? 'positive' : 'negative'}`}>
                  <i className={`fas fa-${trendMetrics.incomeChange > 0 ? 'arrow-up' : 'arrow-down'}`}></i>
                  {Math.abs(trendMetrics.incomeChange || 0)}%
                </span>
              </div>
            </div>
          </div>
          <p className="trend-description">Average monthly income over selected period</p>
        </div>

        <div className="trend-card glass-card">
          <div className="trend-header">
            <div className="trend-icon" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
              <i className="fas fa-shopping-cart"></i>
            </div>
            <div className="trend-info">
              <h3>Expense Trend</h3>
              <div className="trend-value">
                <span className="amount">₦{trendMetrics.averageExpenses ? trendMetrics.averageExpenses.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}</span>
                <span className={`trend-change ${trendMetrics.expenseChange <= 0 ? 'positive' : 'negative'}`}>
                  <i className={`fas fa-${trendMetrics.expenseChange <= 0 ? 'arrow-down' : 'arrow-up'}`}></i>
                  {Math.abs(trendMetrics.expenseChange || 0)}%
                </span>
              </div>
            </div>
          </div>
          <p className="trend-description">Average monthly expenses over selected period</p>
        </div>

        <div className="trend-card glass-card">
          <div className="trend-header">
            <div className="trend-icon" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
              <i className="fas fa-piggy-bank"></i>
            </div>
            <div className="trend-info">
              <h3>Savings Rate</h3>
              <div className="trend-value">
                <span className="amount">{trendMetrics.averageSavingsRate ? trendMetrics.averageSavingsRate.toFixed(1) : '0'}%</span>
                <span className={`trend-change ${trendMetrics.savingsChange > 0 ? 'positive' : 'negative'}`}>
                  <i className={`fas fa-${trendMetrics.savingsChange > 0 ? 'arrow-up' : 'arrow-down'}`}></i>
                  {Math.abs(trendMetrics.savingsChange || 0)}%
                </span>
              </div>
            </div>
          </div>
          <p className="trend-description">Average monthly savings rate</p>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="chart-section glass-card">
        <div className="chart-header">
          <h3>
            <i className="fas fa-chart-area"></i>
            Income vs Expenses Trend
          </h3>
          <div className="chart-legend">
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#27ae60' }}></span>
              <span>Income</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#e74c3c' }}></span>
              <span>Expenses</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: '#3498db' }}></span>
              <span>Savings</span>
            </div>
          </div>
        </div>

        {monthlyData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <i className="fas fa-chart-line"></i>
            </div>
            <h4>No Trend Data Available</h4>
            <p>Add some transactions in the Dashboard to see your financial trends.</p>
          </div>
        ) : (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={350}>
              {activeChart === 'line' ? (
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                  <XAxis 
                    dataKey="month" 
                    stroke="var(--text-secondary)"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tickFormatter={(value) => `₦${(value/1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="income" 
                    stroke="#27ae60" 
                    strokeWidth={3}
                    dot={{ stroke: '#27ae60', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#27ae60', strokeWidth: 2, fill: 'white' }}
                    name="Income" 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="expenses" 
                    stroke="#e74c3c" 
                    strokeWidth={3}
                    dot={{ stroke: '#e74c3c', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#e74c3c', strokeWidth: 2, fill: 'white' }}
                    name="Expenses" 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="savings" 
                    stroke="#3498db" 
                    strokeWidth={3}
                    strokeDasharray="5 5"
                    dot={{ stroke: '#3498db', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#3498db', strokeWidth: 2, fill: 'white' }}
                    name="Savings" 
                  />
                </LineChart>
              ) : (
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                  <XAxis 
                    dataKey="month" 
                    stroke="var(--text-secondary)"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tickFormatter={(value) => `₦${(value/1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="income" fill="#27ae60" name="Income" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" fill="#e74c3c" name="Expenses" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Bottom Grid */}
      <div className="trends-grid">
        {/* Expense Breakdown */}
        <div className="trend-card glass-card">
          <div className="card-header">
            <h3>
              <i className="fas fa-chart-pie"></i>
              Expense Breakdown
            </h3>
            {largestCategory && (
              <div className="largest-category">
                <span className="label">Largest:</span>
                <span className="value">{largestCategory.name}</span>
              </div>
            )}
          </div>

          {expenseCategories.length === 0 ? (
            <div className="empty-state small">
              <p>No expense data available</p>
            </div>
          ) : (
            <>
              <div className="pie-chart-container">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={expenseCategories}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="amount"
                    >
                      {expenseCategories.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value) => `₦${value.toLocaleString()}`}
                      contentStyle={{ 
                        background: 'var(--card-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 'var(--radius-md)'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-center">
                  <span className="total-label">Total</span>
                  <span className="total-amount">
                    ₦{expenseCategories.reduce((sum, cat) => sum + cat.amount, 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="categories-list">
                {expenseCategories.map((category, index) => (
                  <div key={index} className="category-item">
                    <div className="category-info">
                      <div className="category-color" style={{ backgroundColor: category.color }}></div>
                      <div className="category-name">
                        <span>{category.name}</span>
                        <span className="percentage">{category.percentage}%</span>
                      </div>
                    </div>
                    <div className="category-amount">₦{category.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Key Metrics */}
        <div className="trend-card glass-card">
          <div className="card-header">
            <h3>
              <i className="fas fa-chart-bar"></i>
              Key Metrics
            </h3>
          </div>

          {monthlyData.length === 0 ? (
            <div className="empty-state small">
              <p>Add financial data to see metrics</p>
            </div>
          ) : (
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-icon" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  <i className="fas fa-money-bill-wave"></i>
                </div>
                <div className="metric-content">
                  <span className="metric-label">Avg. Monthly Income</span>
                  <span className="metric-value">
                    ₦{trendMetrics.averageIncome ? trendMetrics.averageIncome.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
                  </span>
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-icon" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                  <i className="fas fa-shopping-cart"></i>
                </div>
                <div className="metric-content">
                  <span className="metric-label">Avg. Monthly Expenses</span>
                  <span className="metric-value">
                    ₦{trendMetrics.averageExpenses ? trendMetrics.averageExpenses.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
                  </span>
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-icon" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                  <i className="fas fa-piggy-bank"></i>
                </div>
                <div className="metric-content">
                  <span className="metric-label">Avg. Monthly Savings</span>
                  <span className="metric-value">
                    ₦{trendMetrics.averageSavings ? trendMetrics.averageSavings.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
                  </span>
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-icon" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
                  <i className="fas fa-percentage"></i>
                </div>
                <div className="metric-content">
                  <span className="metric-label">Avg. Savings Rate</span>
                  <span className={`metric-value ${trendMetrics.averageSavingsRate >= 0 ? 'positive' : 'negative'}`}>
                    {trendMetrics.averageSavingsRate ? trendMetrics.averageSavingsRate.toFixed(1) : '0'}%
                  </span>
                </div>
              </div>

              <div className="metric-item full-width">
                <div className="metric-content">
                  <span className="metric-label">Best Performing Month</span>
                  <div className="metric-details">
                    {(() => {
                      const bestMonth = monthlyData.reduce((best, month) => 
                        month.savings > best.savings ? month : best, monthlyData[0] || {});
                      return (
                        <>
                          <span className="month-name">{bestMonth.month}</span>
                          <span className="month-amount">₦{bestMonth.savings ? bestMonth.savings.toLocaleString() : '0'}</span>
                          <span className="month-rate">({bestMonth.savingsRate || '0'}%)</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx="true">{`
        /* Trends Page Styles */
        .trends-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
          animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Section Header */
        .section-header {
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          padding: 18px;
          margin-bottom: 30px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }

        .header-content h2 {
          font-family: var(--font-heading);
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 10px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .section-subtitle {
          color: var(--text-secondary);
          font-size: 1.1rem;
          max-width: 600px;
          line-height: 1.6;
        }

        /* Header Controls */
        .header-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 25px;
          flex-wrap: wrap;
          gap: 20px;
        }

        .timeframe-selectors {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .timeframe-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-full);
          color: var(--text-primary);
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .timeframe-btn:hover {
          transform: translateY(-2px);
          border-color: var(--btn-color);
          box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .timeframe-btn.active {
          background: var(--glass-bg);
          border-color: var(--btn-color);
          color: var(--btn-color);
        }

        .timeframe-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .chart-selectors {
          display: flex;
          gap: 10px;
        }

        .chart-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .chart-btn:hover {
          transform: translateY(-2px);
          border-color: #667eea;
        }

        .chart-btn.active {
          background: #667eea;
          color: white;
          border-color: transparent;
        }

        /* Trend Overview */
        .trend-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .trend-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 16px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }

        .trend-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }

        .trend-header {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 15px;
        }

        .trend-icon {
          width: 60px;
          height: 60px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 1.5rem;
        }

        .trend-info h3 {
          font-size: 1.2rem;
          margin-bottom: 5px;
          color: var(--text-primary);
        }

        .trend-value {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .amount {
          font-family: var(--font-accent);
          font-size: 1.8rem;
          font-weight: 700;
        }

        .trend-change {
          padding: 4px 12px;
          border-radius: var(--radius-full);
          font-size: 0.9rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .trend-change.positive {
          background: rgba(39, 174, 96, 0.1);
          color: #27ae60;
        }

        .trend-change.negative {
          background: rgba(231, 76, 60, 0.1);
          color: #e74c3c;
        }

        .trend-description {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        /* Chart Section */
        .chart-section {
          margin-bottom: 30px;
          min-height: 450px;
        }

        .chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
          padding-bottom: 15px;
          border-bottom: 2px solid var(--glass-border);
        }

        .chart-header h3 {
          font-family: var(--font-heading);
          font-size: 1.5rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .chart-legend {
          display: flex;
          gap: 20px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .chart-container {
          padding: 20px 0;
        }

        /* Custom Tooltip */
        .custom-tooltip {
          padding: 15px;
          background: var(--card-bg);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
        }

        .tooltip-label {
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--text-primary);
        }

        .tooltip-item {
          margin: 5px 0;
          font-size: 0.9rem;
        }

        .tooltip-item span {
          font-weight: 600;
          margin-left: 5px;
        }

        /* Trends Grid */
        .trends-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
        }

        /* Card Header */
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
          padding-bottom: 15px;
          border-bottom: 2px solid var(--glass-border);
        }

        .card-header h3 {
          font-family: var(--font-heading);
          font-size: 1.3rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .largest-category {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--glass-bg);
          padding: 6px 12px;
          border-radius: var(--radius-full);
          font-size: 0.9rem;
        }

        .largest-category .label {
          color: var(--text-secondary);
        }

        .largest-category .value {
          font-weight: 600;
          color: var(--text-primary);
        }

        /* Pie Chart */
        .pie-chart-container {
          position: relative;
          height: 200px;
          margin-bottom: 25px;
        }

        .pie-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          pointer-events: none;
        }

        .total-label {
          display: block;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .total-amount {
          display: block;
          font-family: var(--font-accent);
          font-size: 1.3rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Categories List */
        .categories-list {
          max-height: 250px;
          overflow-y: auto;
          padding-right: 10px;
        }

        .category-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--glass-border);
        }

        .category-item:last-child {
          border-bottom: none;
        }

        .category-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .category-color {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .category-name {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .category-name span:first-child {
          font-weight: 500;
          color: var(--text-primary);
        }

        .percentage {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        .category-amount {
          font-family: var(--font-accent);
          font-weight: 600;
          color: var(--text-primary);
        }

        /* Metrics Grid */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }

        .metric-item {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 20px;
          transition: all var(--transition-fast);
        }

        .metric-item:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-sm);
        }

        .metric-item.full-width {
          grid-column: 1 / -1;
        }

        .metric-icon {
          width: 50px;
          height: 50px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 1.2rem;
          margin-bottom: 15px;
        }

        .metric-content {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .metric-label {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .metric-value {
          font-family: var(--font-accent);
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .metric-value.positive {
          color: #27ae60;
        }

        .metric-value.negative {
          color: #e74c3c;
        }

        .metric-details {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-top: 10px;
        }

        .month-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .month-amount {
          font-family: var(--font-accent);
          font-weight: 700;
          color: #27ae60;
        }

        .month-rate {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        /* Empty States */
        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background: var(--glass-bg);
          border-radius: var(--radius-lg);
        }

        .empty-state.small {
          padding: 18px 14px;
        }

        .empty-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 2rem;
          margin: 0 auto 20px;
        }

        .empty-state h4 {
          font-size: 1.5rem;
          margin-bottom: 10px;
          color: var(--text-primary);
        }

        .empty-state p {
          color: var(--text-secondary);
          max-width: 400px;
          margin: 0 auto;
          line-height: 1.6;
        }

        /* Scrollbar */
        .categories-list::-webkit-scrollbar {
          width: 6px;
        }

        .categories-list::-webkit-scrollbar-track {
          background: var(--glass-bg);
          border-radius: var(--radius-full);
        }

        .categories-list::-webkit-scrollbar-thumb {
          background: var(--gradient-primary);
          border-radius: var(--radius-full);
        }

        /* Responsive Design */
        @media (max-width: 1200px) {
          .trends-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .trends-page {
            padding: 15px;
          }

          .section-header {
            padding: 20px 15px;
          }

          .header-content h2 {
            font-size: 2rem;
          }

          .header-controls {
            flex-direction: column;
            align-items: stretch;
          }

          .timeframe-selectors {
            justify-content: center;
          }

          .chart-selectors {
            justify-content: center;
          }

          .trend-overview {
            grid-template-columns: 1fr;
          }

          .metrics-grid {
            grid-template-columns: 1fr;
          }

          .chart-legend {
            flex-wrap: wrap;
            justify-content: center;
          }

          .card-header {
            flex-direction: column;
            gap: 15px;
            align-items: flex-start;
          }
        }

        @media (max-width: 480px) {
          .header-content h2 {
            font-size: 1.8rem;
          }

          .timeframe-btn, .chart-btn {
            padding: 8px 16px;
            font-size: 0.8rem;
          }

          .amount {
            font-size: 1.5rem;
          }

          .trend-card {
            padding: 20px;
          }
        }
      `}</style>
    </div>
  );
};

export default FinancialTrends;