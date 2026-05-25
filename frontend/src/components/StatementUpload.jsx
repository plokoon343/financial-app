import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const StatementUpload = () => {
  const { darkMode } = useAuth();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [message, setMessage] = useState(null);
  const [step, setStep] = useState('upload'); // 'upload' | 'review' | 'importing'
  const [meta, setMeta] = useState(null);

  // Password modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pendingFile, setPendingFile] = useState(null); // store file for password retry

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setMessage(null);
    // Clear any pending password modal
    setShowPasswordModal(false);
    setPdfPassword('');
    setPasswordError('');
  };

  const uploadFile = async (fileToUpload, password = '') => {
    const formData = new FormData();
    formData.append('file', fileToUpload);
    if (password) formData.append('pdfPassword', password);

    const token = localStorage.getItem('token');
    const res = await axios.post('${API_URL}/api/upload-statement', formData, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage({ text: 'Please select a file', type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);
    setPasswordError('');
    setShowPasswordModal(false);

    try {
      // First attempt: send without password (even for PDFs)
      const data = await uploadFile(file, '');

      // If we get here, the file was processed successfully (no password or password not needed)
      const txns = data.transactions || [];
      setTransactions(txns);
      setMeta(data.meta || null);

      setSelectedIndices(
        txns.reduce((acc, tx, i) => {
          if (!tx.duplicate) acc.push(i);
          return acc;
        }, [])
      );

      setStep('review');
      setMessage({ text: `Found ${txns.length} transaction${txns.length !== 1 ? 's' : ''}`, type: 'success' });
    } catch (err) {
      const errorData = err.response?.data;
      const status = err.response?.status;

      // PDF password required
      if (status === 401 && errorData?.passwordRequired) {
        // Show password modal and remember the file for retry
        setPendingFile(file);
        setShowPasswordModal(true);
        setUploading(false);
        return;
      }

      // Wrong password (user already entered one but it failed)
      if (status === 401 && errorData?.wrongPassword) {
        setPasswordError(errorData.message || 'Incorrect password. Please try again.');
        // Keep modal open
        setUploading(false);
        return;
      }

      // Other errors (unsupported format, no transactions, etc.)
      setMessage({ text: errorData?.message || 'Upload failed. Please try again.', type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!pendingFile) return;
    if (!pdfPassword.trim()) {
      setPasswordError('Please enter the PDF password');
      return;
    }

    setUploading(true);
    setPasswordError('');
    try {
      // Second attempt: send with the provided password
      const data = await uploadFile(pendingFile, pdfPassword);

      // Success: close modal and show transactions
      const txns = data.transactions || [];
      setTransactions(txns);
      setMeta(data.meta || null);
      setSelectedIndices(
        txns.reduce((acc, tx, i) => {
          if (!tx.duplicate) acc.push(i);
          return acc;
        }, [])
      );
      setStep('review');
      setMessage({ text: `Found ${txns.length} transaction${txns.length !== 1 ? 's' : ''}`, type: 'success' });

      // Reset modal and file state
      setShowPasswordModal(false);
      setPdfPassword('');
      setPendingFile(null);
      // Keep the original file reference (for UI)
      setFile(pendingFile);
    } catch (err) {
      const errorData = err.response?.data;
      if (err.response?.status === 401 && errorData?.wrongPassword) {
        setPasswordError(errorData.message || 'Incorrect password. Please try again.');
      } else {
        // Some other error (e.g., still can't parse)
        setMessage({ text: errorData?.message || 'Failed to unlock PDF. Please check the file.', type: 'error' });
        setShowPasswordModal(false);
        setPendingFile(null);
      }
    } finally {
      setUploading(false);
    }
  };

  const cancelPasswordModal = () => {
    setShowPasswordModal(false);
    setPdfPassword('');
    setPasswordError('');
    setPendingFile(null);
    // Optionally clear the selected file
    setFile(null);
  };

  const toggleSelectAll = () => {
    if (selectedIndices.length === transactions.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(transactions.map((_, i) => i));
    }
  };

  const toggleSelect = (index) => {
    setSelectedIndices(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleImport = async () => {
    const toImport = selectedIndices.map(i => transactions[i]);
    if (toImport.length === 0) {
      setMessage({ text: 'No transactions selected', type: 'error' });
      return;
    }
    setStep('importing');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(
        '${API_URL}/api/import-transactions',
        { transactions: toImport },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage({
        text: res.data.message || `Imported ${toImport.length} transactions successfully!`,
        type: 'success',
      });
      // Reset everything
      setStep('upload');
      setTransactions([]);
      setSelectedIndices([]);
      setFile(null);
      setMeta(null);
    } catch (err) {
      setMessage({ text: 'Import failed. Please try again.', type: 'error' });
      setStep('review');
    }
  };

  const resetUpload = () => {
    setStep('upload');
    setTransactions([]);
    setSelectedIndices([]);
    setFile(null);
    setMessage(null);
    setMeta(null);
    setShowPasswordModal(false);
    setPdfPassword('');
    setPasswordError('');
    setPendingFile(null);
  };

  const selectedCount = selectedIndices.length;
  const dupCount = transactions.filter(t => t.duplicate).length;

  return (
    <div className="statement-upload-page">
      {/* Page header */}
      <div className="section-header">
        <h2><i className="fas fa-file-upload"></i> Bank Statement Analysis</h2>
        <p className="section-subtitle">
          Upload your bank statement (CSV, Excel, or PDF) and we'll extract & categorise
          transactions automatically.
        </p>
      </div>

      {/* Status message */}
      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="upload-card glass-effect">
          <div className="upload-area" onClick={() => document.getElementById('fileInput').click()}>
            <i className="fas fa-cloud-upload-alt"></i>
            <p>Click to select your bank statement</p>
            <p className="upload-hint">Supports CSV, Excel (.xlsx / .xls), PDF</p>
            <input
              id="fileInput"
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {file && <p className="file-name"><i className="fas fa-paperclip"></i> {file.name}</p>}
          </div>
          <button className="btn-primary" onClick={handleUpload} disabled={uploading || !file}>
            {uploading
              ? <><i className="fas fa-spinner fa-spin"></i> Processing…</>
              : <><i className="fas fa-magic"></i> Analyse Statement</>
            }
          </button>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 'review' && (
        <div className="review-card glass-effect">
          <div className="review-header">
            <div className="review-title">
              <h3>Extracted Transactions ({transactions.length})</h3>
              {dupCount > 0 && (
                <span className="duplicate-notice">
                  <i className="fas fa-exclamation-triangle"></i> {dupCount} already imported — pre-deselected
                </span>
              )}
            </div>
            <div className="review-actions">
              <button className="btn-secondary" onClick={toggleSelectAll}>
                {selectedCount === transactions.length ? 'Deselect All' : 'Select All'}
              </button>
              <button className="btn-primary" onClick={handleImport} disabled={selectedCount === 0}>
                Import Selected ({selectedCount})
              </button>
              <button className="btn-secondary" onClick={resetUpload}>Cancel</button>
            </div>
          </div>

          {meta?.warnings?.length > 0 && (
            <div className="parse-warnings">
              {meta.warnings.map((w, i) => <p key={i}><i className="fas fa-info-circle"></i> {w}</p>)}
            </div>
          )}

          <div className="transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount (₦)</th>
                  <th>Type</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => (
                  <tr
                    key={idx}
                    className={[
                      selectedIndices.includes(idx) ? 'selected' : '',
                      tx.duplicate ? 'duplicate-row' : '',
                    ].join(' ').trim()}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIndices.includes(idx)}
                        onChange={() => toggleSelect(idx)}
                      />
                    </td>
                    <td>{tx.date}</td>
                    <td>
                      {tx.description}
                      {tx.duplicate && <span className="duplicate-badge">Already imported</span>}
                    </td>
                    <td className={tx.type === 'income' ? 'positive' : 'negative'}>
                      ₦{Number(tx.amount).toLocaleString()}
                    </td>
                    <td>{tx.type === 'income' ? 'Income' : 'Expense'}</td>
                    <td><span className="category-badge">{tx.category}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Importing spinner */}
      {step === 'importing' && (
        <div className="importing-card glass-effect">
          <i className="fas fa-spinner fa-spin"></i>
          <p>Importing {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}…</p>
        </div>
      )}

      {/* Password Modal (popup) */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={cancelPasswordModal}>
          <div className="modal-content glass-effect" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-lock"></i> PDF Password Required</h3>
              <button className="modal-close" onClick={cancelPasswordModal}>✕</button>
            </div>
            <div className="modal-body">
              <p>This bank statement PDF is password protected. Please enter the password to continue.</p>
              <input
                type="password"
                placeholder="Enter PDF password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                className="modal-password-input"
                autoFocus
              />
              {passwordError && <div className="modal-error">{passwordError}</div>}
              <div className="modal-hint">
                <i className="fas fa-info-circle"></i> Common passwords: date of birth (MMYYYY) or account number.
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel" onClick={cancelPasswordModal}>Cancel</button>
              <button className="modal-submit" onClick={handlePasswordSubmit} disabled={uploading}>
                {uploading ? 'Unlocking...' : 'Unlock & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx="true">{`
        .statement-upload-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
        .upload-card, .review-card, .importing-card { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 30px; border: 1px solid var(--glass-border); margin-bottom: 30px; }
        .upload-area { border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 50px; text-align: center; cursor: pointer; transition: all 0.2s; }
        .upload-area:hover { border-color: var(--accent-primary); background: var(--glass-bg); }
        .upload-area i { font-size: 48px; color: var(--text-secondary); margin-bottom: 15px; }
        .file-name { margin-top: 10px; font-weight: 500; color: var(--accent-primary); }
        .btn-primary, .btn-secondary { padding: 10px 20px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; margin-right: 10px; }
        .btn-primary { background: var(--gradient-primary); color: white; border: none; }
        .btn-secondary { background: var(--glass-bg); border: 1px solid var(--border-color); color: var(--text-primary); }
        .review-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
        .transactions-table { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border-color); }
        tr.selected { background: rgba(99,102,241,0.05); }
        .positive { color: #27ae60; font-weight: 600; }
        .negative { color: #e74c3c; font-weight: 600; }
        .category-badge { background: var(--glass-bg); padding: 4px 8px; border-radius: 20px; font-size: 0.8rem; }
        .message { padding: 12px; border-radius: var(--radius-md); margin-bottom: 20px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        .importing-card { text-align: center; padding: 60px; }
        .importing-card i { font-size: 48px; margin-bottom: 15px; color: var(--accent-primary); }

        /* Modal styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
        }
        .modal-content {
          width: 90%;
          max-width: 450px;
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          padding: 25px;
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-lg);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }
        .modal-close {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-secondary);
        }
        .modal-body p {
          margin-bottom: 15px;
        }
        .modal-password-input {
          width: 100%;
          padding: 12px;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          background: var(--input-bg);
          color: var(--text-primary);
          margin-bottom: 15px;
        }
        .modal-error {
          color: #e53e3e;
          background: rgba(229,62,62,0.1);
          padding: 8px;
          border-radius: var(--radius-sm);
          margin-bottom: 10px;
          font-size: 0.9rem;
        }
        .modal-hint {
          font-size: 0.75rem;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
        .modal-cancel, .modal-submit {
          padding: 8px 16px;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
        }
        .modal-cancel {
          background: var(--glass-bg);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
        }
        .modal-submit {
          background: var(--gradient-primary);
          border: none;
          color: white;
        }
      `}</style>
    </div>
  );
};

export default StatementUpload;