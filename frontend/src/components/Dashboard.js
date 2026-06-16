import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';
import { categoriesFor } from '../constants/categories';
import {
  FaMoneyBillWave, FaHome, FaShoppingCart, FaCar, FaUtensils, FaLightbulb, FaBriefcase,
  FaChartLine, FaCalendar, FaTag, FaPlus, FaTrophy, FaListAlt,
  FaArrowUp, FaArrowDown, FaTrash, FaEdit, FaChartPie, FaWallet, FaPiggyBank, FaRegMoneyBillAlt,
  FaFileUpload, FaTimes, FaCheck, FaSpinner, FaExclamationTriangle,
  FaCloudUploadAlt, FaPaperclip, FaMagic, FaInfoCircle, FaEye, FaEyeSlash
} from 'react-icons/fa';

const API = `${API_URL}`;

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6 } },
  exit:    { opacity: 0, y: -20 },
};
const cardVariants = {
  hidden:  { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5 } },
  hover:   { scale: 1.02, transition: { type: 'spring', stiffness: 300 } },
};
const statVariants = {
  hidden:  { opacity: 0, y: 20 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5 } }),
};

const categoryIcons = {
  Salary:        <FaMoneyBillWave style={{ color: '#38a169' }} />,
  Housing:       <FaHome          style={{ color: '#e53e3e' }} />,
  Shopping:      <FaShoppingCart  style={{ color: '#d69e2e' }} />,
  Transport:     <FaCar           style={{ color: 'var(--accent-primary)' }} />,
  Food:          <FaUtensils      style={{ color: '#ed8936' }} />,
  Utilities:     <FaLightbulb    style={{ color: '#805ad5' }} />,
  Freelance:     <FaBriefcase     style={{ color: '#0bc5ea' }} />,
  Entertainment: <FaRegMoneyBillAlt style={{ color: '#d53f8c' }} />,
  Other:         <FaTag           style={{ color: '#718096' }} />,
};

// ─── Import Tab Component (UPDATED with PDF password support) ────────────────
const ImportTab = ({ onImportComplete, darkMode, theme }) => {
  const [file,            setFile]            = useState(null);
  const [uploading,       setUploading]       = useState(false);
  const [transactions,    setTransactions]    = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [meta,            setMeta]            = useState(null);
  const [step,            setStep]            = useState('upload');
  const [message,         setMessage]         = useState(null);
  const [pdfPassword,     setPdfPassword]     = useState('');  // NEW
  const [bank,            setBank]            = useState('');   // confirmed bank for this statement
  const [banks,           setBanks]           = useState([]);   // Paystack bank list for override

  // Load the Paystack bank list once for the confirm dropdown.
  useEffect(() => {
    const loadBanks = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API}/api/banks`, { headers: { Authorization: `Bearer ${token}` } });
        setBanks(res.data || []);
      } catch (err) { /* non-fatal: detected bank / free text still works */ }
    };
    loadBanks();
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setMessage(null);
    setPdfPassword(''); // reset password when file changes
  };

  const isPdf = file && file.name.split('.').pop().toLowerCase() === 'pdf';

  const handleUpload = async () => {
    if (!file) {
      setMessage({ text: 'Please select a file', type: 'error' });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    // Append password only if it's a PDF and the user entered one
    if (isPdf && pdfPassword.trim()) {
      formData.append('pdfPassword', pdfPassword.trim());
    }

    setUploading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/api/upload-statement`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
      const txns = res.data.transactions || [];
      setTransactions(txns);
      setMeta(res.data.meta || null);
      setBank(res.data.meta?.detectedBank || '');
      setSelectedIndices(
        txns.reduce((acc, tx, i) => { if (!tx.duplicate) acc.push(i); return acc; }, [])
      );
      setStep('review');
      setMessage({ text: `Found ${txns.length} transaction${txns.length !== 1 ? 's' : ''}`, type: 'success' });
    } catch (err) {
      const msg = err.response?.data?.message || 'Upload failed. Please try again.';
      // If the backend tells us a password is required, show a specific hint
      if (err.response?.status === 401 && err.response?.data?.passwordRequired) {
        setMessage({ text: 'This PDF is password protected. Please enter the password.', type: 'error' });
      } else if (err.response?.status === 401 && err.response?.data?.wrongPassword) {
        setMessage({ text: 'Incorrect password. Please try again.', type: 'error' });
      } else {
        setMessage({ text: msg, type: 'error' });
      }
    } finally {
      setUploading(false);
    }
  };

  const toggleAll = () =>
    setSelectedIndices(
      selectedIndices.length === transactions.length
        ? []
        : transactions.map((_, i) => i)
    );

  const toggleOne = (i) =>
    setSelectedIndices((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );

  // Edit a transaction's category on the review screen. The chosen category is saved
  // (and learned by the backend) when the user imports.
  const updateTxCategory = (idx, category) =>
    setTransactions((prev) => prev.map((t, i) => (i === idx ? { ...t, category } : t)));

  const handleImport = async () => {
    const toImport = selectedIndices.map((i) => transactions[i]);
    if (!toImport.length) {
      setMessage({ text: 'No transactions selected', type: 'error' });
      return;
    }
    setStep('importing');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API}/api/import-transactions`,
        { transactions: toImport, bank },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onImportComplete(toImport);
      setMessage({ text: res.data.message || `Imported ${toImport.length} transactions!`, type: 'success' });
      setStep('upload');
      setTransactions([]);
      setSelectedIndices([]);
      setFile(null);
      setMeta(null);
      setPdfPassword('');
      setBank('');
    } catch (err) {
      setMessage({ text: 'Import failed. Please try again.', type: 'error' });
      setStep('review');
    }
  };

  const reset = () => {
    setStep('upload');
    setTransactions([]);
    setSelectedIndices([]);
    setFile(null);
    setMessage(null);
    setMeta(null);
    setPdfPassword('');
    setBank('');
  };

  return (
    <div>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            background:
              message.type === 'success'
                ? 'rgba(56,161,105,0.12)'
                : 'rgba(229,62,62,0.12)',
            color: message.type === 'success' ? '#38a169' : '#e53e3e',
            border: `1px solid ${
              message.type === 'success' ? '#38a169' : '#e53e3e'
            }`,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem',
          }}
        >
          {message.type === 'success' ? <FaCheck /> : <FaExclamationTriangle />}
          {message.text}
        </div>
      )}

      {step === 'upload' && (
        <>
          <div
            onClick={() => document.getElementById('importFileInput').click()}
            style={{
              border: `2px dashed ${theme.inputBorder}`,
              borderRadius: '12px',
              padding: '2.5rem 1.5rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: theme.inputBg,
              marginBottom: '1rem',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = theme.inputBorder)}
          >
            <FaCloudUploadAlt
              style={{
                fontSize: '2.5rem',
                color: 'var(--accent-primary)',
                marginBottom: '0.75rem',
                display: 'block',
                margin: '0 auto 0.75rem',
              }}
            />
            <p style={{ color: theme.labelColor, fontWeight: 600, margin: '0 0 0.25rem' }}>
              Click to select your bank statement
            </p>
            <p style={{ color: darkMode ? '#a0aec0' : '#718096', fontSize: '0.85rem', margin: 0 }}>
              CSV, Excel (.xlsx / .xls), or PDF (with password support)
            </p>
            <input
              id="importFileInput"
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {file && (
              <p style={{ marginTop: '0.75rem', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                <FaPaperclip style={{ marginRight: '0.4rem' }} />
                {file.name}
              </p>
            )}
          </div>

          {/* Show password field only for PDFs */}
          {isPdf && (
            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontWeight: 600,
                  color: theme.labelColor,
                  fontSize: '0.9rem',
                }}
              >
                PDF Password (optional)
              </label>
              <input
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Enter password if protected"
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  backgroundColor: theme.inputBg,
                  border: `2px solid ${theme.inputBorder}`,
                  borderRadius: '10px',
                  fontSize: '1rem',
                  color: theme.inputText,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = theme.focusBorder;
                  e.target.style.boxShadow = theme.focusShadow;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = theme.inputBorder;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          )}

          <motion.button
            onClick={handleUpload}
            disabled={uploading || !file}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              width: '100%',
              padding: '0.9rem',
              borderRadius: '10px',
              border: 'none',
              background: !file
                ? darkMode
                  ? '#4a5568'
                  : '#e2e8f0'
                : 'var(--gradient-primary)',
              color: !file ? (darkMode ? '#718096' : '#a0aec0') : 'white',
              fontWeight: 600,
              cursor: file ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            {uploading ? (
              <>
                <FaSpinner /> Processing…
              </>
            ) : (
              <>
                <FaMagic /> Analyse Statement
              </>
            )}
          </motion.button>
        </>
      )}
      {step === 'review' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <span style={{ fontWeight: 700, color: theme.labelColor }}>{transactions.length} transactions found</span>
              {meta?.duplicateCount > 0 && (
                <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: '#f59e0b' }}>
                  <FaInfoCircle style={{ marginRight: '0.3rem' }} />{meta.duplicateCount} already imported (pre-deselected)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: theme.labelColor }}>
                <FaWallet style={{ opacity: 0.7 }} /> Bank:
                <input
                  list="bank-options"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  placeholder="e.g. GTBank"
                  style={{ padding: '0.4rem 0.6rem', borderRadius: '8px', border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.labelColor, fontSize: '0.8rem', minWidth: '140px' }}
                />
                <datalist id="bank-options">
                  {banks.map((b) => <option key={b.code || b.name} value={b.name} />)}
                </datalist>
              </label>
              <button onClick={toggleAll} style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: `1px solid ${theme.inputBorder}`, background: 'transparent', color: theme.labelColor, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                {selectedIndices.length === transactions.length ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={reset} style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: `1px solid ${theme.inputBorder}`, background: 'transparent', color: theme.labelColor, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>← Back</button>
            </div>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: `1px solid ${theme.inputBorder}`, borderRadius: '10px', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ background: darkMode ? '#2d3748' : '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['', 'Date', 'Description', 'Amount', 'Type', 'Category'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 0.7rem', textAlign: 'left', color: darkMode ? '#a0aec0' : '#718096', fontWeight: 600, borderBottom: `1px solid ${theme.inputBorder}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => (
                  <tr key={idx} onClick={() => toggleOne(idx)} style={{
                    background: selectedIndices.includes(idx) ? (darkMode ? 'rgba(66,153,225,0.12)' : 'rgba(66,153,225,0.06)') : 'transparent',
                    cursor: 'pointer', opacity: tx.duplicate && !selectedIndices.includes(idx) ? 0.5 : 1,
                  }}>
                    <td style={{ padding: '0.5rem 0.7rem' }}><input type="checkbox" checked={selectedIndices.includes(idx)} onChange={() => toggleOne(idx)} onClick={e => e.stopPropagation()} /></td>
                    <td style={{ padding: '0.5rem 0.7rem', color: darkMode ? '#cbd5e0' : '#4a5568', whiteSpace: 'nowrap' }}>{tx.date}</td>
                    <td style={{ padding: '0.5rem 0.7rem', color: theme.labelColor, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description}
                      {tx.duplicate && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '1px 5px', borderRadius: '4px' }}>Dup</span>}
                    </td>
                    <td style={{ padding: '0.5rem 0.7rem', fontWeight: 700, color: tx.type === 'income' ? '#38a169' : '#e53e3e', whiteSpace: 'nowrap' }}>₦{Number(tx.amount).toLocaleString()}</td>
                    <td style={{ padding: '0.5rem 0.7rem', color: tx.type === 'income' ? '#38a169' : '#e53e3e', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{tx.type === 'income' ? '↑' : '↓'} {tx.type}</td>
                    <td style={{ padding: '0.5rem 0.7rem' }} onClick={(e) => e.stopPropagation()}>
                      <select
                        value={tx.category || 'Other'}
                        onChange={(e) => updateTxCategory(idx, e.target.value)}
                        title={tx.learned ? 'Category you taught the app' : 'Auto-categorized — change to teach the app'}
                        style={{
                          background: tx.learned ? (darkMode ? '#2c5282' : '#ebf8ff') : (darkMode ? '#4a5568' : '#edf2f7'),
                          color: darkMode ? '#e2e8f0' : '#4a5568',
                          border: `1px solid ${theme.inputBorder}`, borderRadius: '8px',
                          padding: '3px 6px', fontSize: '0.73rem', cursor: 'pointer', maxWidth: '140px',
                        }}
                      >
                        {categoriesFor(tx.type).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                        {tx.category && !categoriesFor(tx.type).includes(tx.category) && (
                          <option value={tx.category}>{tx.category}</option>
                        )}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <motion.button onClick={handleImport} disabled={selectedIndices.length === 0} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            style={{
              width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
              background: selectedIndices.length === 0 ? (darkMode ? '#4a5568' : '#e2e8f0') : 'linear-gradient(135deg, #38a169, #2f855a)',
              color: selectedIndices.length === 0 ? (darkMode ? '#718096' : '#a0aec0') : 'white',
              fontWeight: 600, cursor: selectedIndices.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}>
            <FaCheck /> Import Selected ({selectedIndices.length})
          </motion.button>
        </>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <FaSpinner style={{ fontSize: '2rem', color: 'var(--accent-primary)', marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
          <p style={{ color: theme.labelColor, fontWeight: 600 }}>Importing transactions…</p>
        </div>
      )}
    </div>
  );
};

// ─── Main Dashboard Component ────────────────────────────────────────────────
const Dashboard = () => {
  const context         = useOutletContext();
  const memoCtx         = useMemo(() => context || {}, [context]);
  const transactions    = useMemo(() => memoCtx.transactions || [], [memoCtx.transactions]);
  const setTransactions = useMemo(() => memoCtx.setTransactions || (() => {}), [memoCtx.setTransactions]);
  const { darkMode, user } = useAuth();

  const [showModal,  setShowModal]  = useState(false);
  const [activeTab,  setActiveTab]  = useState('single');
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');
  const [stats,      setStats]      = useState({ totalIncome: 0, totalExpenses: 0, netBalance: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg,    setFormMsg]    = useState(null);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [formData,   setFormData]   = useState({
    description: '', amount: '', type: 'expense', category: '', date: new Date().toISOString().split('T')[0],
  });

  const theme = darkMode ? {
    inputBg: '#4a5568', inputBorder: '#718096', inputText: '#f7fafc',
    focusBorder: '#63b3ed', focusShadow: '0 0 0 3px rgba(99,179,237,0.3)',
    labelColor: '#e2e8f0', cardBg: '#2d3748', cardBorder: '#4a5568', modalBg: '#1a202c',
  } : {
    inputBg: '#f8fafc', inputBorder: '#e2e8f0', inputText: '#2d3748',
    focusBorder: 'var(--accent-primary)', focusShadow: '0 0 0 3px rgba(66,153,225,0.15)',
    labelColor: '#4a5568', cardBg: 'white', cardBorder: 'rgba(0,82,204,0.1)', modalBg: 'white',
  };

  const formatAmount = (value) => {
    if (hideAmounts) return '••••';
    return `₦${value.toLocaleString()}`;
  };

// eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API}/api/transactions`, { headers: { Authorization: `Bearer ${token}` } });
        setTransactions(res.data);
      } catch (err) {
        console.error('Failed to load transactions:', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [setTransactions]);

  useEffect(() => {
    const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
    setStats({ totalIncome, totalExpenses, netBalance: totalIncome - totalExpenses });
  }, [transactions]);

  const savingsRate = stats.totalIncome > 0 ? (stats.netBalance / stats.totalIncome) * 100 : 0;

  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.description || !formData.amount || !formData.category) return;
    setSubmitting(true); setFormMsg(null);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/api/transactions`, {
        date: formData.date, description: formData.description.trim(),
        amount: parseFloat(formData.amount), category: formData.category, type: formData.type,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setTransactions(prev => [res.data, ...prev]);
      setFormData({ description: '', amount: '', type: 'expense', category: '', date: new Date().toISOString().split('T')[0] });
      setFormMsg({ text: 'Transaction added!', type: 'success' });
      setTimeout(() => { setFormMsg(null); setShowModal(false); }, 1200);
    } catch (err) {
      setFormMsg({ text: err.response?.data?.message || 'Failed to add transaction', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportComplete = useCallback((imported) => {
    const withIds = imported.map((t, i) => ({ ...t, _id: t._id || `imp_${Date.now()}_${i}` }));
    setTransactions(prev => [...withIds, ...prev]);
    setTimeout(() => setShowModal(false), 1500);
  }, [setTransactions]);

  const deleteTransaction = useCallback(async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API}/api/transactions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setTransactions(prev => prev.filter(t => (t._id || t.id) !== id));
    } catch (err) { console.error('Delete failed:', err.message); }
  }, [setTransactions]);

  const filteredTransactions = useMemo(() => {
    if (filter === 'income')  return transactions.filter(t => t.type === 'income');
    if (filter === 'expense') return transactions.filter(t => t.type === 'expense');
    return transactions;
  }, [transactions, filter]);

  const getInput = (isTextarea = false) => ({
    width: '100%', padding: isTextarea ? '0.875rem 1rem' : '0.85rem 1rem',
    backgroundColor: theme.inputBg, border: `2px solid ${theme.inputBorder}`,
    borderRadius: '10px', fontSize: '1rem', color: theme.inputText,
    outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
    resize: isTextarea ? 'vertical' : 'none', minHeight: isTextarea ? '80px' : 'auto', fontFamily: 'inherit',
  });
  const onFocus = e => { e.target.style.borderColor = theme.focusBorder; e.target.style.boxShadow = theme.focusShadow; };
  const onBlur  = e => { e.target.style.borderColor = theme.inputBorder;  e.target.style.boxShadow = 'none'; };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{ width: 60, height: 60, border: `4px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, borderTopColor: 'var(--accent-primary)', borderRadius: '50%', marginBottom: '1.5rem' }} />
        <p style={{ color: darkMode ? '#e2e8f0' : '#4a5568' }}>Loading your dashboard…</p>
      </div>
    );
  }

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit"
      className="dashboard-root"
      style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>

      {/* Header */}
      <motion.div className="dashboard-header" initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="dashboard-title" style={{ color: darkMode ? '#f7fafc' : '#1a365d', fontSize: '2.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <FaChartPie style={{ color: 'var(--accent-primary)' }} /> Financial Dashboard
          </h1>
          <p className="dashboard-subtitle" style={{ color: darkMode ? '#cbd5e0' : '#4a5568', marginTop: '0.5rem', fontSize: '1.1rem' }}>
            <FaWallet style={{ color: '#38a169', marginRight: '0.4rem' }} /> Welcome back, {user?.name || 'User'}!
          </p>
        </div>
        <div className="dashboard-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <motion.button
            onClick={() => setHideAmounts(!hideAmounts)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            style={{
              background: darkMode ? '#4a5568' : '#e2e8f0',
              border: 'none',
              borderRadius: '10px',
              padding: '0.75rem',
              cursor: 'pointer',
              color: darkMode ? '#f7fafc' : '#1a365d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {hideAmounts ? <FaEyeSlash size={20} /> : <FaEye size={20} />}
          </motion.button>
          <Link to="/transactions"
            style={{ background: darkMode ? '#4a5568' : '#e2e8f0', color: darkMode ? '#f7fafc' : '#1a365d',
              border: 'none', padding: '0.875rem 1.5rem', borderRadius: '10px', fontSize: '1rem', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none' }}>
            <FaListAlt /> View Transactions
          </Link>
          <motion.button onClick={() => { setShowModal(true); setActiveTab('single'); setFormMsg(null); }}
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            style={{ background: 'var(--gradient-primary)', color: 'white', border: 'none',
              padding: '0.875rem 1.75rem', borderRadius: '10px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.75rem', boxShadow: '0 4px 12px rgba(66,153,225,0.3)' }}>
            <FaPlus /> Add / Import Transactions
          </motion.button>
        </div>
      </motion.div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 999,
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <motion.div
              className="modal-content"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(720px, 94vw)',
                maxHeight: '88vh',
                overflowY: 'auto',
                background: theme.modalBg,
                borderRadius: '20px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                padding: '2rem',
              }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ color: darkMode ? '#f7fafc' : '#1a365d', margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Transactions</h2>
                <button onClick={() => setShowModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: darkMode ? '#a0aec0' : '#718096', fontSize: '1.3rem' }}>
                  <FaTimes />
                </button>
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', marginBottom: '1.75rem', background: darkMode ? '#4a5568' : '#f1f5f9', borderRadius: '10px', padding: '0.25rem' }}>
                {[
                  { id: 'single', label: 'Add Single', icon: <FaPlus /> },
                  { id: 'import', label: 'Import Statement', icon: <FaFileUpload /> },
                ].map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    style={{
                      flex: 1, padding: '0.75rem', border: 'none', borderRadius: '8px',
                      background: activeTab === tab.id ? (darkMode ? '#2d3748' : 'white') : 'transparent',
                      color: activeTab === tab.id ? (darkMode ? '#f7fafc' : '#1a365d') : darkMode ? '#cbd5e0' : '#718096',
                      fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                    }}>
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>
              {/* Single tab */}
              {activeTab === 'single' && (
                <form onSubmit={handleSingleSubmit}>
                  {formMsg && (
                    <div style={{
                      padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
                      background: formMsg.type === 'success' ? 'rgba(56,161,105,0.12)' : 'rgba(229,62,62,0.12)',
                      color: formMsg.type === 'success' ? '#38a169' : '#e53e3e',
                      border: `1px solid ${formMsg.type === 'success' ? '#38a169' : '#e53e3e'}`,
                      display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem',
                    }}>
                      {formMsg.type === 'success' ? <FaCheck /> : <FaExclamationTriangle />} {formMsg.text}
                    </div>
                  )}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: theme.labelColor, fontSize: '0.9rem' }}>
                      <FaEdit style={{ marginRight: '0.4rem' }} /> Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      onFocus={onFocus}
                      onBlur={onBlur}
                      required
                      placeholder="What was this transaction for?"
                      style={getInput(true)}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: theme.labelColor, fontSize: '0.9rem' }}>
                        <FaWallet style={{ marginRight: '0.4rem' }} /> Amount (₦)
                      </label>
                      <input
                        type="number"
                        value={formData.amount}
                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        required
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        style={getInput()}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: theme.labelColor, fontSize: '0.9rem' }}>
                        <FaTag style={{ marginRight: '0.4rem' }} /> Type
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', background: darkMode ? '#4a5568' : '#f1f5f9', padding: '0.25rem', borderRadius: '10px' }}>
                        {[
                          { val: 'expense', label: 'Expense', icon: <FaArrowDown size={11} /> },
                          { val: 'income', label: 'Income', icon: <FaArrowUp size={11} /> },
                        ].map(({ val, label, icon }) => (
                          <button key={val} type="button" onClick={() => setFormData({ ...formData, type: val })}
                            style={{
                              flex: 1, padding: '0.65rem', border: 'none', borderRadius: '8px',
                              background: formData.type === val ? (val === 'income' ? '#38a169' : '#e53e3e') : 'transparent',
                              color: formData.type === val ? 'white' : darkMode ? '#cbd5e0' : '#4a5568',
                              fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.9rem',
                            }}>
                            {icon} {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.75rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: theme.labelColor, fontSize: '0.9rem' }}>
                        <FaListAlt style={{ marginRight: '0.4rem' }} /> Category
                      </label>
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        required
                        style={{ ...getInput(), appearance: 'none', cursor: 'pointer' }}
                      >
                        <option value="">Select category</option>
                        {categoriesFor(formData.type).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: theme.labelColor, fontSize: '0.9rem' }}>
                        <FaCalendar style={{ marginRight: '0.4rem' }} /> Date
                      </label>
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        required
                        style={getInput()}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <motion.button
                      type="button"
                      onClick={() => setShowModal(false)}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      style={{
                        flex: 1, padding: '0.9rem', background: darkMode ? '#4a5568' : '#e2e8f0',
                        color: darkMode ? '#e2e8f0' : '#4a5568', border: 'none', borderRadius: '10px',
                        fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      type="submit"
                      disabled={submitting}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      style={{
                        flex: 2, padding: '0.9rem',
                        background: formData.type === 'income' ? 'linear-gradient(135deg,#38a169,#2f855a)' : 'linear-gradient(135deg,#e53e3e,#c53030)',
                        color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      }}
                    >
                      {submitting ? <><FaSpinner /> Saving…</> : <><FaPlus /> Add {formData.type === 'income' ? 'Income' : 'Expense'}</>}
                    </motion.button>
                  </div>
                </form>
              )}
              {/* Import tab */}
              {activeTab === 'import' && <ImportTab onImportComplete={handleImportComplete} darkMode={darkMode} theme={theme} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Stats */}
      <motion.div className="quick-stats" initial="hidden" animate="visible" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Income',   value: formatAmount(stats.totalIncome),   icon: <FaArrowUp   style={{ color: '#38a169', fontSize: '1.5rem' }} />, isPos: true },
          { label: 'Total Expenses', value: formatAmount(stats.totalExpenses), icon: <FaArrowDown style={{ color: '#e53e3e', fontSize: '1.5rem' }} />, isPos: false },
          { label: 'Net Balance',    value: formatAmount(stats.netBalance),    icon: <FaChartLine style={{ color: stats.netBalance >= 0 ? '#38a169' : '#e53e3e', fontSize: '1.5rem' }} />, isPos: stats.netBalance >= 0 },
        ].map((s, idx) => (
          <motion.div key={s.label} custom={idx} variants={statVariants} whileHover={{ scale: 1.05, y: -5 }}
            style={{ background: darkMode ? '#2d3748' : 'white', borderRadius: '16px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem',
              border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ background: s.isPos ? 'rgba(56,161,105,0.1)' : 'rgba(229,62,62,0.1)', width: 56, height: 56, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.isPos ? (darkMode ? '#68d391' : '#38a169') : (darkMode ? '#fc8181' : '#e53e3e') }}>{s.value}</div>
              <div style={{ color: darkMode ? '#a0aec0' : '#718096', fontSize: '0.9rem', fontWeight: 600 }}>{s.label}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Main grid: Financial Overview + Recent Transactions */}
      <motion.div className="dashboard-grid" initial="hidden" animate="visible" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.2 } } }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <motion.div className="card overview-card" variants={cardVariants} whileHover="hover"
          style={{ background: darkMode ? '#2d3748' : 'white', borderRadius: '16px', padding: '1.5rem', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h2 style={{ color: darkMode ? '#f7fafc' : '#1a365d', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FaChartPie style={{ color: 'var(--accent-primary)' }} /> Financial Overview
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: darkMode ? '#4a5568' : '#f8fafc', borderRadius: '12px' }}>
              <span style={{ fontWeight: 600, color: darkMode ? '#e2e8f0' : '#4a5568' }}>Total Income</span>
              <span style={{ fontWeight: 700, color: '#38a169', fontSize: '1.2rem' }}>{formatAmount(stats.totalIncome)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: darkMode ? '#4a5568' : '#f8fafc', borderRadius: '12px' }}>
              <span style={{ fontWeight: 600, color: darkMode ? '#e2e8f0' : '#4a5568' }}>Total Expenses</span>
              <span style={{ fontWeight: 700, color: '#e53e3e', fontSize: '1.2rem' }}>{formatAmount(stats.totalExpenses)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: darkMode ? '#4a5568' : '#f8fafc', borderRadius: '12px' }}>
              <span style={{ fontWeight: 600, color: darkMode ? '#e2e8f0' : '#4a5568' }}>Net Balance</span>
              <span style={{ fontWeight: 700, color: stats.netBalance >= 0 ? '#38a169' : '#e53e3e', fontSize: '1.2rem' }}>{formatAmount(stats.netBalance)}</span>
            </div>
          </div>
        </motion.div>
        <motion.div className="card transactions-card" variants={cardVariants} whileHover="hover"
          style={{ background: darkMode ? '#2d3748' : 'white', borderRadius: '16px', padding: '1.5rem', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 style={{ color: darkMode ? '#f7fafc' : '#1a365d', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FaListAlt style={{ color: 'var(--accent-primary)' }} /> Recent Transactions
            </h2>
            <div style={{ display: 'flex', gap: '0.25rem', background: darkMode ? '#4a5568' : '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
              {[{ val: 'all', label: 'All' }, { val: 'income', label: '↑' }, { val: 'expense', label: '↓' }].map(f => (
                <button key={f.val} onClick={() => setFilter(f.val)}
                  style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px',
                    background: filter === f.val ? 'var(--accent-primary)' : 'transparent',
                    color: filter === f.val ? 'white' : (darkMode ? '#cbd5e0' : '#4a5568'),
                    fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem', transition: 'all 0.2s' }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {filteredTransactions.length > 0 ? (
            <div>
              {filteredTransactions.slice(0, 6).map(tx => (
                <div key={tx._id || tx.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#f1f5f9'}` }}>
                  <div style={{ width: 36, height: 36, borderRadius: '10px', background: tx.type === 'income' ? 'rgba(56,161,105,0.12)' : 'rgba(229,62,62,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {categoryIcons[tx.category] || categoryIcons.Other}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: darkMode ? '#f7fafc' : '#1a365d', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</div>
                    <div style={{ fontSize: '0.78rem', color: darkMode ? '#a0aec0' : '#718096' }}>{new Date(tx.date).toLocaleDateString()} · {tx.category}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: tx.type === 'income' ? '#38a169' : '#e53e3e', whiteSpace: 'nowrap', fontSize: '0.92rem' }}>
                    {tx.type === 'income' ? '+' : '-'}{hideAmounts ? '••••' : `₦${Math.abs(tx.amount).toLocaleString()}`}
                  </div>
                  <button onClick={() => deleteTransaction(tx._id || tx.id)}
                    style={{ background: 'none', border: 'none', color: darkMode ? '#718096' : '#cbd5e0', cursor: 'pointer', padding: '0.25rem', borderRadius: '6px', flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e53e3e'}
                    onMouseLeave={e => e.currentTarget.style.color = darkMode ? '#718096' : '#cbd5e0'}>
                    <FaTrash size={12} />
                  </button>
                </div>
              ))}
              {filteredTransactions.length > 6 && (
                <Link to="/transactions" style={{ display: 'block', textAlign: 'center', fontSize: '0.83rem', fontWeight: 600, color: 'var(--accent-primary)', margin: '0.75rem 0 0', textDecoration: 'none' }}>
                  +{filteredTransactions.length - 6} more transactions
                </Link>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <FaChartPie style={{ fontSize: '2.5rem', color: darkMode ? '#4a5568' : '#cbd5e0', marginBottom: '0.75rem', display: 'block', margin: '0 auto 0.75rem' }} />
              <h3 style={{ color: darkMode ? '#f7fafc' : '#1a365d', marginBottom: '0.4rem' }}>No Transactions Yet</h3>
              <p style={{ color: darkMode ? '#a0aec0' : '#718096', marginBottom: '1.25rem', fontSize: '0.9rem' }}>Add one or import a bank statement.</p>
              <button onClick={() => { setShowModal(true); setActiveTab('single'); }}
                style={{ background: 'var(--gradient-primary)', color: 'white', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                <FaPlus /> Add Transaction
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Savings Rate + Quick Insights */}
      <motion.div className="insights-grid" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
        <motion.div className="card savings-card" whileHover={{ scale: 1.02, y: -5 }}
          style={{ background: darkMode ? '#2d3748' : 'white', borderRadius: '16px', padding: '1.5rem', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: darkMode ? '#f7fafc' : '#1a365d', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FaPiggyBank style={{ color: '#38a169' }} /> Savings Rate
          </h3>
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ width: 120, height: 120, borderRadius: '50%', border: `8px solid ${savingsRate >= 0 ? '#00d4aa' : '#ff6b8b'}`, margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: darkMode ? '#f7fafc' : '#1a365d' }}>
                {hideAmounts ? '••' : `${savingsRate.toFixed(1)}%`}
              </span>
            </div>
            <p style={{ color: darkMode ? '#a0aec0' : '#718096', fontSize: '0.9rem' }}>
              {savingsRate >= 30 ? 'Excellent!' : savingsRate >= 10 ? 'Good progress!' : 'Aim for at least 10%'}
            </p>
          </div>
        </motion.div>

        <motion.div className="card insights-card" whileHover={{ scale: 1.02, y: -5 }}
          style={{ background: darkMode ? '#2d3748' : 'white', borderRadius: '16px', padding: '1.5rem', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: darkMode ? '#f7fafc' : '#1a365d', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FaTrophy style={{ color: '#d69e2e' }} /> Quick Insights
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              { title: 'Top Spending Category', value: transactions.length > 0 ? (Object.entries(transactions.filter(t => t.type === 'expense').reduce((a, t) => { const c = t.category||'Other'; a[c]=(a[c]||0)+Math.abs(t.amount); return a; }, {})).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'None') : 'None', color: '#00d4aa' },
              { title: 'Avg Daily Spend', value: hideAmounts ? '••••' : `₦${(stats.totalExpenses/30).toLocaleString(undefined,{maximumFractionDigits:0})}`, color: '#4facfe' },
              { title: 'Total Transactions', value: transactions.length, color: '#fa709a' },
              { title: 'Balance Status', value: stats.netBalance >= 0 ? '✓ Positive' : '✗ Negative', color: stats.netBalance >= 0 ? '#38a169' : '#e53e3e' },
            ].map(ins => (
              <div key={ins.title} style={{ background: darkMode ? '#4a5568' : '#f8fafc', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: darkMode ? '#a0aec0' : '#718096', fontWeight: 600, marginBottom: '0.3rem' }}>{ins.title}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: ins.color }}>{ins.value}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>

      {/* RESPONSIVE STYLES */}
      <style jsx="true">{`
        /* Dashboard root padding reduced on mobile */
        @media (max-width: 768px) {
          .dashboard-root {
            padding: 1rem !important;
          }
        }
        @media (max-width: 480px) {
          .dashboard-root {
            padding: 0.8rem !important;
          }
        }

        /* Header */
        .dashboard-title {
          font-size: 2.5rem;
          margin: 0;
        }
        .dashboard-subtitle {
          font-size: 1.1rem;
        }
        @media (max-width: 768px) {
          .dashboard-title {
            font-size: 1.8rem;
          }
          .dashboard-subtitle {
            font-size: 0.95rem;
          }
        }
        @media (max-width: 480px) {
          .dashboard-title {
            font-size: 1.5rem;
          }
          .dashboard-subtitle {
            font-size: 0.85rem;
          }
          .dashboard-actions {
            flex-direction: column;
            width: 100%;
          }
          .dashboard-actions button {
            width: 100%;
          }
        }

        /* Quick Stats – reduce gap on small screens */
        .quick-stats {
          gap: 1rem;
        }
        @media (max-width: 480px) {
          .quick-stats {
            gap: 0.75rem;
            grid-template-columns: 1fr;
          }
        }

        /* Dashboard Grid */
        .dashboard-grid {
          gap: 1.5rem;
        }
        @media (max-width: 768px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }

        /* Cards – shared */
        .card {
          padding: 1.5rem;
        }
        @media (max-width: 480px) {
          .card {
            padding: 1.2rem;
          }
          .card h2 {
            font-size: 1.2rem;
          }
        }

        /* Insights grid */
        .insights-grid {
          gap: 1.5rem;
        }
        @media (max-width: 768px) {
          .insights-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
        }

        /* Modal – fullscreen on small phones */
        @media (max-width: 480px) {
          .modal-content {
            width: 100% !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
            padding: 1.2rem !important;
          }
        }

        /* Transaction item inside recent list */
        @media (max-width: 480px) {
          .transaction-item {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </motion.div>
  );
};

export default Dashboard;