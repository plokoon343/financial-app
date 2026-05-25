import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const CurrencyConverter = () => {
  const [conversionInput, setConversionInput] = useState({
    amount: '',
    from: 'USD',
    to: 'EUR'
  });
  const [conversionResult, setConversionResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exchangeRates, setExchangeRates] = useState({});
  const [apiLogs, setApiLogs] = useState([]);
  const [retryCount, setRetryCount] = useState(0);

  // Fixed currency list
  const currencies = [
    { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
    { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
    { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
    { code: 'NGN', name: 'Nigerian Naira', flag: '🇳🇬' },
    { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
    { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
    { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
    { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳' },
    { code: 'INR', name: 'Indian Rupee', flag: '🇮🇳' },
    { code: 'GHS', name: 'Ghanaian Cedi', flag: '🇬🇭' },
    { code: 'KES', name: 'Kenyan Shilling', flag: '🇰🇪' },
    { code: 'ZAR', name: 'South African Rand', flag: '🇿🇦' }
  ];

  // Helper function to add logs - wrapped in useCallback
  const addApiLog = useCallback((type, url, data, status) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      url,
      data,
      status
    };
    console.log(`[${type.toUpperCase()}]`, logEntry);
    setApiLogs(prev => [logEntry, ...prev].slice(0, 10));
  }, []);

  // Fetch exchange rates - wrapped in useCallback
  const fetchExchangeRates = useCallback(async () => {
    // Try multiple API endpoints for reliability
    const apiEndpoints = [
      'https://api.exchangerate-api.com/v4/latest/USD',
      'https://open.er-api.com/v6/latest/USD',
      'https://api.frankfurter.app/latest?from=USD'
    ];

    for (let i = 0; i < apiEndpoints.length; i++) {
      const apiUrl = apiEndpoints[i];
      
      addApiLog('fetch_rates_attempt', apiUrl, { attempt: i + 1 }, 'pending');
      
      try {
        console.log(`🔄 Attempting to fetch from: ${apiUrl}`);
        const response = await axios.get(apiUrl, {
          timeout: 5000, // 5 second timeout
          headers: {
            'Accept': 'application/json',
          }
        });

        let rates = {};
        
        // Handle different API response formats
        if (apiUrl.includes('exchangerate-api.com')) {
          rates = response.data.rates;
        } else if (apiUrl.includes('open.er-api.com')) {
          if (response.data.result === 'success') {
            rates = response.data.rates;
          } else {
            continue; // Try next API
          }
        } else if (apiUrl.includes('frankfurter.app')) {
          rates = response.data.rates;
        }

        addApiLog('fetch_rates_success', apiUrl, {
          ratesCount: Object.keys(rates || {}).length,
          source: apiUrl
        }, 'success');

        if (Object.keys(rates).length > 0) {
          setExchangeRates(rates);
          console.log(`✅ Exchange rates loaded from ${apiUrl}`);
          return;
        }
      } catch (error) {
        addApiLog('fetch_rates_error', apiUrl, {
          error: error.message,
          attempt: i + 1
        }, 'error');
        console.warn(`⚠️ Failed API ${i + 1}: ${error.message}`);
        // Continue to next API
      }
    }

    // If all APIs fail
    setError('Unable to fetch live exchange rates. Using offline fallback.');
    console.warn('All APIs failed, using offline fallback');
    
    // Fallback exchange rates (approximate)
    const fallbackRates = {
      'USD': 1,
      'EUR': 0.92,
      'GBP': 0.79,
      'NGN': 1500,
      'CAD': 1.35,
      'AUD': 1.52,
      'JPY': 147,
      'CNY': 7.18,
      'INR': 83,
      'GHS': 12.5,
      'KES': 160,
      'ZAR': 18.7
    };
    
    setExchangeRates(fallbackRates);
    addApiLog('fallback_rates', 'offline', { rates: Object.keys(fallbackRates) }, 'warning');
  }, [addApiLog]);

  // Load exchange rates on component mount
  useEffect(() => {
    fetchExchangeRates();
  }, [fetchExchangeRates]); // Now includes the dependency

  const convertCurrency = async () => {
    const { amount, from, to } = conversionInput;
    
    if (!amount || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (from === to) {
      setConversionResult({
        original: parseFloat(amount).toFixed(2),
        converted: parseFloat(amount).toFixed(2),
        from,
        to,
        rate: 1
      });
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log(`🔄 Converting ${amount} ${from} to ${to}`);

      // If we have rates, use them
      if (exchangeRates[from] && exchangeRates[to]) {
        console.log('📈 Using available exchange rates');
        
        // Convert through USD as base
        const amountInUSD = parseFloat(amount) / exchangeRates[from];
        const convertedAmount = amountInUSD * exchangeRates[to];
        const rate = convertedAmount / parseFloat(amount);
        
        setConversionResult({
          original: parseFloat(amount).toFixed(2),
          converted: convertedAmount.toFixed(2),
          from,
          to,
          rate: rate.toFixed(4)
        });
        
        addApiLog('conversion_success', 'local_calculation', {
          from, to, amount, convertedAmount, rate
        }, 'success');
        
      } else {
        // Try direct API call as fallback
        console.log('🔄 No local rates, trying direct API...');
        const apiUrl = `https://api.exchangerate-api.com/v4/latest/${from}`;
        
        addApiLog('direct_api_call', apiUrl, { from, to, amount }, 'pending');
        
        const response = await axios.get(apiUrl, { timeout: 5000 });
        
        if (response.data && response.data.rates && response.data.rates[to]) {
          const rate = response.data.rates[to];
          const convertedAmount = parseFloat(amount) * rate;
          
          setConversionResult({
            original: parseFloat(amount).toFixed(2),
            converted: convertedAmount.toFixed(2),
            from,
            to,
            rate: rate.toFixed(4)
          });
          
          addApiLog('direct_api_success', apiUrl, {
            rate, convertedAmount, from, to
          }, 'success');
        } else {
          throw new Error('Unable to get conversion rate from API');
        }
      }
      
      console.log(`✅ Conversion successful!`);
    } catch (error) {
      console.error(`❌ Conversion error:`, error);
      
      addApiLog('conversion_error', 'convertCurrency', {
        error: error.message,
        from,
        to,
        amount
      }, 'error');
      
      // Provide a manual calculation based on common rates
      const manualRates = {
        'USD': { 'EUR': 0.92, 'GBP': 0.79, 'NGN': 1500 },
        'EUR': { 'USD': 1.09, 'GBP': 0.86, 'NGN': 1630 },
        'GBP': { 'USD': 1.27, 'EUR': 1.16, 'NGN': 1900 },
        'NGN': { 'USD': 0.00067, 'EUR': 0.00061, 'GBP': 0.00053 }
      };
      
      if (manualRates[from] && manualRates[from][to]) {
        const manualRate = manualRates[from][to];
        const convertedAmount = parseFloat(amount) * manualRate;
        
        setConversionResult({
          original: parseFloat(amount).toFixed(2),
          converted: convertedAmount.toFixed(2),
          from,
          to,
          rate: manualRate.toFixed(4),
          note: 'Using approximate offline rate'
        });
        
        setError('Using approximate rates (offline mode)');
      } else {
        setError(`Error: ${error.message}. Please check your connection.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setConversionInput({
      ...conversionInput,
      [e.target.name]: e.target.value
    });
    // Clear result when input changes
    setConversionResult(null);
  };

  const swapCurrencies = () => {
    setConversionInput({
      ...conversionInput,
      from: conversionInput.to,
      to: conversionInput.from
    });
    setConversionResult(null);
  };

  const getCurrencyFlag = (code) => {
    const currency = currencies.find(c => c.code === code);
    return currency ? currency.flag : '🏳️';
  };

  const clearLogs = () => {
    setApiLogs([]);
    console.clear();
    console.log('🧹 API logs cleared');
  };

  const retryFetchRates = () => {
    setRetryCount(prev => prev + 1);
    setError('');
    fetchExchangeRates();
  };

  return (
    <div className="currency-converter-page">
      <div className="page-header">
        <h1>Currency Converter</h1>
        <p>Real-time currency conversion using multiple reliable APIs</p>
        {retryCount > 0 && (
          <div className="retry-info">
            Retry attempt: {retryCount}
          </div>
        )}
      </div>

      <div className="converter-container">
        <div className="converter-card">
          <div className="converter-form">
            <div className="amount-section">
              <label>Amount</label>
              <input
                type="number"
                name="amount"
                value={conversionInput.amount}
                onChange={handleInputChange}
                placeholder="Enter amount"
                step="0.01"
                min="0"
              />
            </div>

            <div className="currency-selectors">
              <div className="currency-selector">
                <label>From</label>
                <select
                  name="from"
                  value={conversionInput.from}
                  onChange={handleInputChange}
                >
                  {currencies.map(currency => (
                    <option key={`from-${currency.code}`} value={currency.code}>
                      {currency.flag} {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>

              <button 
                className="swap-btn"
                onClick={swapCurrencies}
                type="button"
                title="Swap currencies"
              >
                ⇄
              </button>

              <div className="currency-selector">
                <label>To</label>
                <select
                  name="to"
                  value={conversionInput.to}
                  onChange={handleInputChange}
                >
                  {currencies.map(currency => (
                    <option key={`to-${currency.code}`} value={currency.code}>
                      {currency.flag} {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="error-message">
                {error}
                <button 
                  onClick={retryFetchRates}
                  className="retry-btn"
                  style={{marginLeft: '10px', padding: '5px 10px'}}
                >
                  Retry
                </button>
              </div>
            )}

            <div className="button-group">
              <button 
                onClick={convertCurrency}
                disabled={loading || !conversionInput.amount}
                className="convert-btn"
              >
                {loading ? 'Converting...' : 'Convert Currency'}
              </button>
              <button 
                onClick={fetchExchangeRates}
                className="refresh-rates-btn"
                title="Refresh exchange rates"
              >
                🔄 Refresh Rates
              </button>
            </div>
          </div>

          {conversionResult && (
            <div className="conversion-result">
              <h3>Conversion Result</h3>
              <div className="result-main">
                <span className="original-amount">
                  {conversionResult.original} {getCurrencyFlag(conversionResult.from)} {conversionResult.from}
                </span>
                <span className="equals">=</span>
                <span className="converted-amount">
                  {conversionResult.converted} {getCurrencyFlag(conversionResult.to)} {conversionResult.to}
                </span>
              </div>
              <div className="exchange-rate">
                1 {conversionResult.from} = {conversionResult.rate} {conversionResult.to}
              </div>
              {conversionResult.note && (
                <div className="rate-note">
                  <small>{conversionResult.note}</small>
                </div>
              )}
            </div>
          )}
        </div>

        {/* API Logs Panel */}
        <div className="api-logs-panel">
          <div className="logs-header">
            <h3>API Communication Logs</h3>
            <div>
              <button onClick={clearLogs} className="clear-logs-btn">Clear Logs</button>
              <button 
                onClick={() => console.log('Exchange Rates:', exchangeRates)}
                className="debug-btn"
                style={{marginLeft: '10px', padding: '5px 10px'}}
              >
                Debug Rates
              </button>
            </div>
          </div>
          <div className="logs-container">
            {apiLogs.length === 0 ? (
              <div className="no-logs">No API calls yet. Perform a conversion to see logs.</div>
            ) : (
              apiLogs.map((log, index) => (
                <div key={index} className={`log-entry log-${log.status}`}>
                  <div className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</div>
                  <div className="log-type">
                    <span className={`status-dot ${log.status}`}></span>
                    {log.type.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div className="log-url">{log.url || 'N/A'}</div>
                  <div className="log-data">
                    {log.data ? JSON.stringify(log.data, null, 2) : 'No data'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .currency-converter-page {
          padding: 20px;
        }
        .page-header {
          text-align: center;
          margin-bottom: 30px;
        }
        .retry-info {
          color: #666;
          font-size: 0.9rem;
          margin-top: 5px;
        }
        .converter-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .converter-card {
          background: white;
          border-radius: 10px;
          padding: 20px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .converter-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .amount-section input {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 5px;
          font-size: 16px;
        }
        .currency-selectors {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .currency-selector {
          flex: 1;
        }
        .currency-selector select {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 5px;
          font-size: 16px;
        }
        .swap-btn {
          background: #f0f0f0;
          border: none;
          border-radius: 5px;
          padding: 10px 15px;
          cursor: pointer;
          font-size: 18px;
        }
        .button-group {
          display: flex;
          gap: 10px;
        }
        .convert-btn, .refresh-rates-btn {
          flex: 1;
          padding: 12px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        }
        .convert-btn {
          background: #007bff;
          color: white;
        }
        .convert-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .refresh-rates-btn {
          background: #6c757d;
          color: white;
        }
        .conversion-result {
          margin-top: 20px;
          padding: 15px;
          background: #f8f9fa;
          border-radius: 5px;
        }
        .result-main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-size: 1.5rem;
          margin: 10px 0;
        }
        .exchange-rate {
          text-align: center;
          color: #666;
          margin-top: 10px;
        }
        .error-message {
          color: #dc3545;
          padding: 10px;
          background: #f8d7da;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .retry-btn {
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        .api-logs-panel {
          margin-top: 2rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1rem;
          background: #f8f9fa;
        }
        .logs-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        .clear-logs-btn, .debug-btn {
          padding: 0.25rem 0.5rem;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .debug-btn {
          background: #17a2b8;
        }
        .logs-container {
          max-height: 300px;
          overflow-y: auto;
        }
        .log-entry {
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          border-radius: 4px;
          background: white;
          border-left: 4px solid #ccc;
        }
        .log-entry.log-success {
          border-left-color: #28a745;
        }
        .log-entry.log-error {
          border-left-color: #dc3545;
        }
        .log-entry.log-warning {
          border-left-color: #ffc107;
        }
        .log-entry.log-pending {
          border-left-color: #17a2b8;
        }
        .log-time {
          font-size: 0.8rem;
          color: #666;
        }
        .log-type {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: bold;
          margin: 0.25rem 0;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-dot.success {
          background: #28a745;
        }
        .status-dot.error {
          background: #dc3545;
        }
        .status-dot.warning {
          background: #ffc107;
        }
        .status-dot.pending {
          background: #17a2b8;
        }
        .log-url {
          font-family: monospace;
          font-size: 0.9rem;
          color: #0066cc;
          word-break: break-all;
        }
        .log-data {
          font-family: monospace;
          font-size: 0.8rem;
          color: #666;
          margin-top: 0.5rem;
          white-space: pre-wrap;
          background: #f8f9fa;
          padding: 0.5rem;
          border-radius: 3px;
          max-height: 100px;
          overflow-y: auto;
        }
        .no-logs {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 2rem;
        }
      `}</style>
    </div>
  );
};

export default CurrencyConverter;// import React, { useState, useEffect } from 'react';
// import axios from 'axios';

// const CurrencyConverter = () => {
//   const [conversionInput, setConversionInput] = useState({
//     amount: '',
//     from: 'NGN',
//     to: 'NGN'
//   });
//   const [conversionResult, setConversionResult] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [exchangeRates, setExchangeRates] = useState({});

//   // Popular currency pairs with Naira
//   const currencies = [
//     { code: 'NGN', name: 'US Dollar', flag: '🇺🇸' },
//     { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
//     { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
//     { code: 'NGN', name: 'Nigerian Naira', flag: '🇳🇬' },
//     { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
//     { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
//     { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
//     { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳' },
//     { code: 'INR', name: 'Indian Rupee', flag: '🇮🇳' },
//     { code: 'GHS', name: 'Ghanaian Cedi', flag: '🇬🇭' },
//     { code: 'KES', name: 'Kenyan Shilling', flag: '🇰🇪' },
//     { code: 'ZAR', name: 'South African Rand', flag: '🇿🇦' }
//   ];

//   // Fetch exchange rates on component mount
//   useEffect(() => {
//     fetchExchangeRates();
//   }, []);

//   const fetchExchangeRates = async () => {
//     try {
//       // Using a free exchange rate API (you might want to use a more reliable one in production)
//       const response = await axios.get('https://api.exchangerate.host/latest?base=NGN');
//       setExchangeRates(response.data.rates);
//     } catch (error) {
//       console.error('Error fetching exchange rates:', error);
//       // Fallback rates in case API fails
//       setExchangeRates({
//         NGN: 1,
//         EUR: 0.85,
//         GBP: 0.73,
//         NGN: 1150,
//         CAD: 1.25,
//         AUD: 1.35,
//         JPY: 110,
//         CNY: 6.45,
//         INR: 74,
//         GHS: 5.8,
//         KES: 110,
//         ZAR: 14.5
//       });
//     }
//   };

//   const convertCurrency = async () => {
//     const { amount, from, to } = conversionInput;
    
//     if (!amount || amount <= 0) {
//       setError('Please enter a valid amount');
//       return;
//     }

//     if (from === to) {
//       setError('Please select different currencies');
//       return;
//     }

//     setLoading(true);
//     setError('');

//     try {
//       // Calculate conversion using fetched rates
//       let convertedAmount;
      
//       if (from === 'NGN') {
//         convertedAmount = parseFloat(amount) * (exchangeRates[to] || 1);
//       } else if (to === 'NGN') {
//         convertedAmount = parseFloat(amount) / (exchangeRates[from] || 1);
//       } else {
//         // Convert through NGN as base
//         const amountInNGN = parseFloat(amount) / (exchangeRates[from] || 1);
//         convertedAmount = amountInNGN * (exchangeRates[to] || 1);
//       }

//       setConversionResult({
//         original: parseFloat(amount).toFixed(2),
//         converted: convertedAmount.toFixed(2),
//         from,
//         to,
//         rate: (convertedAmount / parseFloat(amount)).toFixed(4)
//       });
//     } catch (error) {
//       console.error('Conversion error:', error);
//       setError('Error converting currency. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleInputChange = (e) => {
//     setConversionInput({
//       ...conversionInput,
//       [e.target.name]: e.target.value
//     });
//   };

//   const swapCurrencies = () => {
//     setConversionInput({
//       ...conversionInput,
//       from: conversionInput.to,
//       to: conversionInput.from
//     });
//   };

//   const getCurrencyFlag = (code) => {
//     const currency = currencies.find(c => c.code === code);
//     return currency ? currency.flag : '';
//   };

//   const getCurrencyName = (code) => {
//     const currency = currencies.find(c => c.code === code);
//     return currency ? currency.name : code;
//   };

//   return (
//     <div className="currency-converter-page">
//       <div className="page-header">
//         <h1>Currency Converter</h1>
//         <p>Real-time currency conversion with Naira support</p>
//       </div>

//       <div className="converter-container">
//         <div className="converter-card">
//           <div className="converter-form">
//             <div className="amount-section">
//               <label>Amount</label>
//               <input
//                 type="number"
//                 name="amount"
//                 value={conversionInput.amount}
//                 onChange={handleInputChange}
//                 placeholder="Enter amount"
//                 step="0.01"
//                 min="0"
//               />
//             </div>

//             <div className="currency-selectors">
//               <div className="currency-selector">
//                 <label>From</label>
//                 <select
//                   name="from"
//                   value={conversionInput.from}
//                   onChange={handleInputChange}
//                 >
//                   {currencies.map(currency => (
//                     <option key={`from-₦{currency.code}`} value={currency.code}>
//                       {currency.flag} {currency.code} - {currency.name}
//                     </option>
//                   ))}
//                 </select>
//               </div>

//               <button 
//                 className="swap-btn"
//                 onClick={swapCurrencies}
//                 type="button"
//                 title="Swap currencies"
//               >
//                 ⇄
//               </button>

//               <div className="currency-selector">
//                 <label>To</label>
//                 <select
//                   name="to"
//                   value={conversionInput.to}
//                   onChange={handleInputChange}
//                 >
//                   {currencies.map(currency => (
//                     <option key={`to-₦{currency.code}`} value={currency.code}>
//                       {currency.flag} {currency.code} - {currency.name}
//                     </option>
//                   ))}
//                 </select>
//               </div>
//             </div>

//             {error && <div className="error-message">{error}</div>}

//             <button 
//               onClick={convertCurrency}
//               disabled={loading}
//               className="convert-btn"
//             >
//               {loading ? 'Converting...' : 'Convert Currency'}
//             </button>
//           </div>

//           {conversionResult && (
//             <div className="conversion-result">
//               <h3>Conversion Result</h3>
//               <div className="result-main">
//                 <span className="original-amount">
//                   {conversionResult.original} {getCurrencyFlag(conversionResult.from)} {conversionResult.from}
//                 </span>
//                 <span className="equals">=</span>
//                 <span className="converted-amount">
//                   {conversionResult.converted} {getCurrencyFlag(conversionResult.to)} {conversionResult.to}
//                 </span>
//               </div>
//               <div className="exchange-rate">
//                 1 {conversionResult.from} = {conversionResult.rate} {conversionResult.to}
//               </div>
//             </div>
//           )}
//         </div>

//         <div className="popular-conversions">
//           <h3>Popular Naira Conversions</h3>
//           <div className="conversion-grid">
//             <div className="conversion-item">
//               <span>NGN → NGN</span>
//               <span>₦{(exchangeRates.NGN || 1150).toLocaleString()}</span>
//             </div>
//             <div className="conversion-item">
//               <span>EUR → NGN</span>
//               <span>₦{((exchangeRates.NGN || 1150) * (exchangeRates.EUR || 0.85)).toLocaleString()}</span>
//             </div>
//             <div className="conversion-item">
//               <span>GBP → NGN</span>
//               <span>₦{((exchangeRates.NGN || 1150) * (exchangeRates.GBP || 0.73)).toLocaleString()}</span>
//             </div>
//             <div className="conversion-item">
//               <span>CAD → NGN</span>
//               <span>₦{((exchangeRates.NGN || 1150) * (exchangeRates.CAD || 1.25)).toLocaleString()}</span>
//             </div>
//           </div>
//         </div>
//       </div>

//       <div className="currency-info">
//         <h3>About Nigerian Naira (NGN)</h3>
//         <div className="info-grid">
//           <div className="info-item">
//             <strong>Currency Code:</strong> NGN
//           </div>
//           <div className="info-item">
//             <strong>Symbol:</strong> ₦
//           </div>
//           <div className="info-item">
//             <strong>Central Bank:</strong> Central Bank of Nigeria
//           </div>
//           <div className="info-item">
//             <strong>Commonly Used In:</strong> Nigeria
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default CurrencyConverter;