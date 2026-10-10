import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import { FeatureTip } from './FeatureTip';
const GoalTracker = () => {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGoalId, setSelectedGoalId] = useState(null); // open goal popup (#30)
  const [newGoal, setNewGoal] = useState({
    name: '',
    target: '',
    current: '',
    deadline: '',
    category: 'General',
  });

  useEffect(() => {
    fetchGoals();
  }, []);

  const fetchGoals = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/goals`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setGoals(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load goals', err);
      setLoading(false);
    }
  };

  const addGoal = async (e) => {
    e.preventDefault();
    if (!newGoal.name || !newGoal.target || !newGoal.deadline) return;
    try {
      const token = localStorage.getItem('token');
      const payload = {
        name: newGoal.name,
        target: parseFloat(newGoal.target),
        current: parseFloat(newGoal.current) || 0,
        deadline: newGoal.deadline,
        category: newGoal.category,
      };
      const res = await axios.post(`${API_URL}/api/goals`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setGoals([res.data, ...goals]);
      setNewGoal({ name: '', target: '', current: '', deadline: '', category: 'General' });
    } catch (err) { console.error(err); }
  };

// Goals record money the user sets aside themselves; no money moves.
  const contributeToGoal = async (id, amount) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/goals/${id}/contribute`, { amount }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchGoals();
    } catch (err) {
      alert(err.response?.data?.message || 'Could not update this goal');
    }
  };

  const takeFromGoal = async (goal) => {
    const raw = window.prompt(`How much did you take out of "${goal.name}"? (up to ${fmtNaira(goal.current)})`, String(goal.current));
    const amount = parseFloat(raw);
    if (!amount || amount <= 0) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/goals/${goal._id}/withdraw`, { amount }, { headers: { Authorization: `Bearer ${token}` } });
      fetchGoals();
    } catch (err) { alert(err.response?.data?.message || 'Could not update this goal'); }
  };

  const removeGoal = async (id) => {
    if (!window.confirm('Delete this goal?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/goals/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setGoals(goals.filter(g => g._id !== id));
    } catch (err) { console.error(err); }
  };

const getGoalProgress = (goal) => {
    const progress = (goal.current / goal.target) * 100;
    const daysLeft = Math.ceil((new Date(goal.deadline) - new Date()) / (1000 * 60 * 60 * 24));
    const monthlyNeeded = (goal.target - goal.current) / Math.max(1, (daysLeft / 30));
    return { progress: Math.min(progress, 100), daysLeft: daysLeft > 0 ? daysLeft : 0, monthlyNeeded: monthlyNeeded > 0 ? monthlyNeeded : 0 };
  };

  const getCategoryColor = (category) => {
    const colors = {
      'General': 'var(--accent-primary)', 'Housing': '#4ECDC4', 'Travel': '#FF6B8B', 'Electronics': '#45B7D1',
      'Education': '#FFA07A', 'Vehicle': '#98D8C8', 'Emergency Fund': '#C9C9C9',
      'Retirement': '#FFD700', 'Savings': '#16a34a', 'Debt': '#e74c3c'
    };
    return colors[category] || colors.General;
  };

  const getCategoryIcon = (category) => {
    const icons = {
      'General': 'fa-bullseye', 'Housing': 'fa-home', 'Travel': 'fa-plane', 'Electronics': 'fa-laptop',
      'Education': 'fa-graduation-cap', 'Vehicle': 'fa-car', 'Emergency Fund': 'fa-shield-alt',
      'Retirement': 'fa-piggy-bank', 'Savings': 'fa-wallet', 'Debt': 'fa-credit-card'
    };
    return icons[category] || icons.General;
  };

  const totalGoals = goals.length;
  const completedGoals = goals.filter(g => g.current >= g.target).length;
  const totalTarget = goals.reduce((sum, g) => sum + g.target, 0);
  const totalCurrent = goals.reduce((sum, g) => sum + g.current, 0);
  const overallProgress = totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0;

  // Live goal shown in the popup (re-derived from `goals` so it reflects updates).
  const activeGoal = goals.find(g => g._id === selectedGoalId) || null;

  if (loading) return (
    <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>Loading goals...</p>
    </div>
  );

  return (
    <div className="goals-page">
      <FeatureTip tipKey="screen:goals" title="Track what you’re saving for">Set a target and record money as you put it aside. Automonie never moves money for you.</FeatureTip>
      <div className="section-header">
        <h2><i className="fas fa-flag-checkered"></i> Financial Goals Tracker</h2>
        <p className="section-subtitle">Set, track, and achieve your financial milestones</p>
      </div>

      {/* Overview Cards */}
      <div className="overview-grid">
        <div className="overview-card glass-effect">
          <div className="overview-icon total-goals"><i className="fas fa-bullseye"></i></div>
          <div className="overview-content"><h3>Total Goals</h3><div className="overview-amount">{totalGoals}</div></div>
        </div>
        <div className="overview-card glass-effect">
          <div className="overview-icon completed-goals"><i className="fas fa-check-circle"></i></div>
          <div className="overview-content"><h3>Completed</h3><div className="overview-amount">{completedGoals}</div></div>
        </div>
        <div className="overview-card glass-effect">
          <div className="overview-icon total-saved"><i className="fas fa-piggy-bank"></i></div>
          <div className="overview-content"><h3>Total Saved</h3><div className="overview-amount">{fmtNaira(totalCurrent)}</div></div>
        </div>
        <div className="overview-card glass-effect">
          <div className="overview-icon overall-progress"><i className="fas fa-chart-line"></i></div>
          <div className="overview-content"><h3>Overall Progress</h3><div className="overview-amount">{overallProgress.toFixed(1)}%</div></div>
        </div>
      </div>

      {/* Goals List */}
      <div className="goals-list-container glass-effect">
        <div className="list-header">
          <h3><i className="fas fa-list-alt"></i> Your Goals</h3>
          <span className="goals-count">{goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
        </div>
        {goals.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><i className="fas fa-flag"></i></div>
            <h4>No Goals Yet</h4>
            <p>Create your first financial goal to start tracking your progress.</p>
            <button className="btn-primary" onClick={() => document.querySelector('.add-goal-form')?.scrollIntoView({ behavior: 'smooth' })}>
              <i className="fas fa-plus"></i> Create First Goal
            </button>
          </div>
        ) : (
          <div className="goals-table-wrap">
            <table className="goals-table">
              <thead>
                <tr>
                  <th>Goal</th><th>Category</th><th>Progress</th><th className="num">Target</th><th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal) => {
                  const { progress } = getGoalProgress(goal);
                  const isCompleted = progress >= 100;
                  return (
                    <tr key={goal._id} className="goals-row" onClick={() => setSelectedGoalId(goal._id)} title="View goal">
                      <td>
                        <div className="gt-name">
                          <span className="gt-badge" style={{ backgroundColor: getCategoryColor(goal.category) }}>
                            <i className={`fas ${getCategoryIcon(goal.category)}`}></i>
                          </span>
                          <span>{goal.name}</span>
                        </div>
                      </td>
                      <td><span className="gt-cat" style={{ color: getCategoryColor(goal.category) }}>{goal.category}</span></td>
                      <td>
                        <div className="gt-progress">
                          <div className="gt-track"><div className="gt-fill" style={{ width: `${progress}%`, background: isCompleted ? '#16a34a' : getCategoryColor(goal.category) }}></div></div>
                          <span>{progress.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="num">{fmtNaira(goal.target)}</td>
                      <td>
                        {new Date(goal.deadline).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Goal detail popup (#30) */}
      {activeGoal && (() => {
        const { progress, daysLeft, monthlyNeeded } = getGoalProgress(activeGoal);
        const isCompleted = progress >= 100;
        return (
          <div className="goal-modal-overlay" onClick={() => setSelectedGoalId(null)}>
            <div className="goal-modal" onClick={(e) => e.stopPropagation()}>
              <div className="goal-modal-head">
                <div className="gt-name">
                  <span className="gt-badge" style={{ backgroundColor: getCategoryColor(activeGoal.category) }}>
                    <i className={`fas ${getCategoryIcon(activeGoal.category)}`}></i>
                  </span>
                  <div>
                    <h3>{activeGoal.name}</h3>
                    <span className="gt-cat" style={{ color: getCategoryColor(activeGoal.category) }}>{activeGoal.category}</span>
                  </div>
                </div>
                <button className="goal-modal-close" onClick={() => setSelectedGoalId(null)} title="Close"><i className="fas fa-times"></i></button>
              </div>

              <div className="progress-stats">
                <div className="progress-amounts">
                  <span className="current-amount">{fmtNaira(activeGoal.current)}</span>
                  <span className="target-amount">of {fmtNaira(activeGoal.target)}</span>
                </div>
                <div className="progress-percentage">{progress.toFixed(1)}%</div>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%`, background: isCompleted ? '#16a34a' : getCategoryColor(activeGoal.category) }}></div></div>
              </div>

              <div className="detail-grid" style={{ marginTop: '1rem' }}>
                <div className="detail-item"><div className="detail-label"><i className="fas fa-calendar-day"></i><span>Days Left</span></div><div className={`detail-value ${daysLeft < 30 ? 'warning' : ''}`}>{daysLeft}</div></div>
                <div className="detail-item"><div className="detail-label"><i className="fas fa-money-bill-wave"></i><span>Monthly Needed</span></div><div className="detail-value">{fmtNaira(monthlyNeeded)}</div></div>
                <div className="detail-item"><div className="detail-label"><i className="fas fa-wallet"></i><span>Remaining</span></div><div className="detail-value">{fmtNaira(activeGoal.target - activeGoal.current)}</div></div>
              </div>

{!isCompleted ? (
                <div className="goal-actions">
                  <div className="quick-add-header"><i className="fas fa-bolt"></i><span>Log money set aside</span></div>
                  <div className="quick-add-buttons">
                    <button onClick={() => contributeToGoal(activeGoal._id, 100)} className="add-funds-btn"><i className="fas fa-plus"></i> ₦100</button>
                    <button onClick={() => contributeToGoal(activeGoal._id, 500)} className="add-funds-btn"><i className="fas fa-plus"></i> ₦500</button>
                    <button onClick={() => contributeToGoal(activeGoal._id, 1000)} className="add-funds-btn"><i className="fas fa-plus"></i> ₦1,000</button>
                    <div className="custom-add">
                      <input type="number" placeholder="Custom" className="custom-input"
                        onKeyPress={(e) => { if (e.key === 'Enter') { contributeToGoal(activeGoal._id, parseFloat(e.target.value) || 0); e.target.value = ''; } }} />
                      <button className="custom-btn" onClick={(e) => {
                        const input = e.target.previousElementSibling;
                        const val = parseFloat(input.value) || 0;
                        if (val > 0) contributeToGoal(activeGoal._id, val);
                        input.value = '';
                      }}>Add</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="goal-completed"><i className="fas fa-trophy"></i><span>Goal Achieved!</span></div>
              )}

{activeGoal.current > 0 && (
                <button type="button" className="goal-take-btn" onClick={() => takeFromGoal(activeGoal)}>
                  <i className="fas fa-minus-circle"></i> Record money taken out
                </button>
              )}

              <button type="button" className="goal-modal-delete" onClick={() => removeGoal(activeGoal._id)}>
                <i className="fas fa-trash"></i> Delete goal
              </button>
            </div>
          </div>
        );
      })()}

      {/* Add Goal Form */}
      <div className="add-goal-form glass-effect">
        <div className="form-header">
          <h3><i className="fas fa-plus-circle"></i> Create New Goal</h3>
          <p>Set a new financial milestone to work towards</p>
        </div>
        <form onSubmit={addGoal}>
          <div className="form-grid">
            <div className="form-group">
              <label><i className="fas fa-bullseye"></i> Goal Name</label>
              <div className="input-with-icon">
                <i className="fas fa-bullseye input-icon"></i>
                <input
                  type="text"
                  value={newGoal.name}
                  onChange={(e) => setNewGoal({...newGoal, name: e.target.value})}
                  placeholder="e.g., New Car, Vacation, Emergency Fund"
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label><i className="fas fa-flag-checkered"></i> Target Amount (₦)</label>
              <div className="input-with-icon">
                <i className="fas fa-flag-checkered input-icon"></i>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newGoal.target}
                  onChange={(e) => setNewGoal({...newGoal, target: e.target.value})}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label><i className="fas fa-wallet"></i> Current Amount (₦)</label>
              <div className="input-with-icon">
                <i className="fas fa-wallet input-icon"></i>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newGoal.current}
                  onChange={(e) => setNewGoal({...newGoal, current: e.target.value})}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="form-group">
              <label><i className="fas fa-calendar-alt"></i> Deadline</label>
              <div className="input-with-icon">
                <i className="fas fa-calendar-alt input-icon"></i>
                <input
                  type="date"
                  value={newGoal.deadline}
                  onChange={(e) => setNewGoal({...newGoal, deadline: e.target.value})}
                  required
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
            <div className="form-group">
              <label><i className="fas fa-tag"></i> Category</label>
              <div className="input-with-icon">
                <i className="fas fa-tag input-icon"></i>
                <select value={newGoal.category} onChange={(e) => setNewGoal({...newGoal, category: e.target.value})}>
                  <option value="General">General</option><option value="Housing">Housing</option>
                  <option value="Travel">Travel</option><option value="Electronics">Electronics</option>
                  <option value="Education">Education</option><option value="Vehicle">Vehicle</option>
                  <option value="Emergency Fund">Emergency Fund</option>
                  <option value="Retirement">Retirement</option><option value="Savings">Savings</option>
                  <option value="Debt">Debt Repayment</option>
                </select>
              </div>
            </div>
          </div>
          <div className="form-buttons">
            <button type="submit" className="btn-submit"><i className="fas fa-plus"></i> Create Goal</button>
            <button type="button" onClick={() => setNewGoal({ name: '', target: '', current: '', deadline: '', category: 'General' })} className="btn-cancel">
              <i className="fas fa-times"></i> Clear
            </button>
          </div>
        </form>
      </div>

      {/* Tips Section */}
      <div className="goals-tips glass-effect">
        <div className="tips-header">
          <h3><i className="fas fa-lightbulb"></i> Goal Setting Tips</h3>
          <p>Smart strategies to achieve your financial goals</p>
        </div>
        <div className="tips-list">
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-bullseye"></i></div><div className="tip-content"><h4>Be Specific</h4><p>Clearly define what you want to achieve with specific amounts and deadlines.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-calendar-check"></i></div><div className="tip-content"><h4>Set Realistic Deadlines</h4><p>Break large goals into smaller milestones with achievable timeframes.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-chart-line"></i></div><div className="tip-content"><h4>Track Progress</h4><p>Regularly update your progress to stay motivated and make adjustments.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-piggy-bank"></i></div><div className="tip-content"><h4>Log as you go</h4><p>Set money aside yourself, then log each contribution to keep your progress accurate.</p></div></div>
        </div>
      </div>

<style>{`
        .goals-page { padding: 20px; max-width: 1200px; margin: 0 auto; }

.goals-page .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .goals-page .overview-card { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; gap: 20px; box-shadow: var(--shadow-md); border: 1px solid var(--glass-border); transition: all var(--transition-base); }
        .goals-page .overview-card:hover { transform: translateY(-5px); box-shadow: var(--shadow-lg); }
        .goals-page .overview-icon { width: 70px; height: 70px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; color: white; }
        .goals-page .overview-icon.total-goals { background: var(--gradient-primary); }
        .goals-page .overview-icon.completed-goals { background: linear-gradient(135deg, #44BC7E 0%, #1DD3A8 100%); }
        .goals-page .overview-icon.total-saved { background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%); }
        .goals-page .overview-icon.overall-progress { background: linear-gradient(135deg, #139DA0 0%, #1DD3A8 100%); }
        .goals-page .overview-content h3 { font-size: 1rem; color: var(--text-secondary); margin-bottom: 5px; font-weight: 500; }
        .goals-page .overview-amount { font-size: 1.8rem; font-weight: 700; font-family: var(--font-accent); color: var(--text-primary); }
        .goals-list-container { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--glass-border); margin-bottom: 24px; }
        .goals-page .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid var(--glass-border); }
        .goals-page .list-header h3 { font-family: var(--font-heading); font-size: 1.6rem; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .goals-count { font-size: 0.9rem; background: var(--glass-bg); padding: 6px 15px; border-radius: var(--radius-full); color: var(--text-secondary); font-weight: 600; }

/* Goals table (#30) */
        .goals-table-wrap { overflow-x: auto; }
        .goals-table { width: 100%; border-collapse: collapse; }
        .goals-table th { text-align: left; font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
        .goals-table th.num, .goals-table td.num { text-align: right; }
        .goals-row { cursor: pointer; transition: background var(--transition-fast); }
        .goals-row:hover { background: var(--glass-bg); }
        .goals-table td { padding: 12px; border-bottom: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.92rem; vertical-align: middle; }
        .gt-name { display: flex; align-items: center; gap: 10px; font-weight: 600; }
        .gt-badge { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.85rem; flex-shrink: 0; }
        .gt-cat { font-size: 0.85rem; font-weight: 600; }
        .gt-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
        .gt-track { flex: 1; height: 7px; border-radius: 4px; background: var(--glass-bg); overflow: hidden; }
        .gt-fill { height: 100%; border-radius: 4px; }

        /* Goal detail popup (#30) */
        .goal-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem; }
        .goal-modal { width: min(560px, 95vw); max-height: 88vh; overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; padding: 1.5rem; color: var(--text-primary); }
        .goal-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 1.25rem; }
        .goal-modal-head h3 { font-size: 1.3rem; color: var(--text-primary); margin: 0; }
        .goal-modal-close { background: none; border: none; color: var(--text-secondary); font-size: 1.2rem; cursor: pointer; }
        .goal-modal-delete { margin-top: 1.25rem; width: 100%; padding: 0.8rem; border-radius: 10px; background: transparent; border: 1px solid #ef4444; color: #ef4444; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .goal-modal-delete:hover { background: rgba(239,68,68,0.1); }
        .goal-take-btn { margin-top: 1.25rem; width: 100%; padding: 0.8rem; border-radius: 10px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .progress-stats { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .progress-amounts { display: flex; align-items: baseline; gap: 10px; }
        .current-amount { font-family: var(--font-accent); font-size: 1.8rem; font-weight: 700; color: var(--text-primary); }
        .target-amount { font-size: 1.1rem; color: var(--text-secondary); font-weight: 500; }
        .progress-percentage { font-family: var(--font-accent); font-size: 1.8rem; font-weight: 700; color: var(--text-primary); background: var(--glass-bg); padding: 6px 15px; border-radius: var(--radius-full); }
        .progress-bar-container { margin-top: 10px; }

.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .detail-item { text-align: center; }
        .detail-label { display: flex; flex-direction: column; align-items: center; gap: 5px; margin-bottom: 8px; }
        .detail-label i { font-size: 1.2rem; color: var(--text-secondary); }
        .detail-label span { font-size: 0.85rem; color: var(--text-secondary); }
        .detail-value { font-family: var(--font-accent); font-size: 1.3rem; font-weight: 700; color: var(--text-primary); }
        .detail-value.warning { color: #f39c12; }
        .detail-value.danger { color: #e74c3c; }
        .goal-actions { background: rgba(255, 255, 255, 0.05); border-radius: var(--radius-md); padding: 20px; }
        .quick-add-header { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; color: var(--text-primary); font-weight: 600; }
        .quick-add-header i { color: #f39c12; }
        .quick-add-buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .add-funds-btn { padding: 10px 15px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-md); color: var(--text-primary); font-weight: 600; cursor: pointer; transition: all var(--transition-fast); display: flex; align-items: center; justify-content: center; gap: 8px; }
        .add-funds-btn:hover { background: rgba(0, 212, 170, 0.1); border-color: #1DD3A8; transform: translateY(-2px); }
        .custom-add { display: flex; gap: 5px; grid-column: span 2; }
        .custom-input { flex: 1; padding: 10px 15px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-md); color: var(--text-primary); font-family: var(--font-body); }
        .custom-input:focus { outline: none; border-color: var(--income-color); }
        .custom-btn { padding: 10px 20px; background: var(--gradient-primary); border: none; border-radius: var(--radius-md); color: white; font-weight: 600; cursor: pointer; transition: all var(--transition-fast); }
        .custom-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        .goal-completed { display: flex; align-items: center; justify-content: center; gap: 15px; padding: 20px; background: rgba(39, 174, 96, 0.1); border-radius: var(--radius-md); color: #16a34a; font-weight: 600; font-size: 1.2rem; }
        .goal-completed i { font-size: 1.5rem; }
        .add-goal-form { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--glass-border); margin-bottom: 24px; }
        .goals-page .form-header { text-align: center; margin-bottom: 30px; }
        .goals-page .form-header h3 { font-family: var(--font-heading); font-size: 1.8rem; margin-bottom: 8px; color: var(--text-primary); display: flex; align-items: center; justify-content: center; gap: 10px; }
        .goals-page .form-header p { color: var(--text-secondary); font-size: 0.95rem; }

.goals-page .input-with-icon { position: relative; }
        .goals-page .input-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); font-size: 1rem; z-index: 1; pointer-events: none; }
        .goals-page .input-with-icon input, .goals-page .input-with-icon select { width: 100%; padding: 14px 15px 14px 45px; background: var(--glass-bg); border: 1.5px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); font-size: 1rem; transition: all 0.2s ease; }
        .goals-page .input-with-icon input:focus, .goals-page .input-with-icon select:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(19, 157, 160, 0.2); background: var(--card-bg); }

.goals-tips { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--glass-border); }
        .goals-page .tips-header { margin-bottom: 30px; }
        .goals-page .tips-header h3 { font-family: var(--font-heading); font-size: 1.8rem; margin-bottom: 8px; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .goals-page .tips-header p { color: var(--text-secondary); font-size: 0.95rem; }
        .tips-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
        .tip-item { background: var(--glass-bg); border-radius: var(--radius-md); padding: 16px; display: flex; gap: 20px; transition: all var(--transition-base); }
        .tip-item:hover { transform: translateY(-5px); background: rgba(255, 255, 255, 0.05); }
        .goals-page .tip-icon { width: 60px; height: 60px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; flex-shrink: 0; }
        .goals-page .tip-content h4 { font-size: 1.1rem; color: var(--text-primary); margin-bottom: 10px; font-weight: 600; }
        .goals-page .tip-content p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; }
        @media (max-width: 768px) { .goals-page .overview-grid { grid-template-columns: repeat(2, 1fr); } .goals-grid { grid-template-columns: 1fr; } .detail-grid { grid-template-columns: repeat(2, 1fr); } .quick-add-buttons { grid-template-columns: repeat(2, 1fr); } .custom-add { grid-column: span 2; } .tips-list { grid-template-columns: 1fr; } }
        @media (max-width: 480px) { .goals-page .overview-grid { grid-template-columns: 1fr; } .detail-grid { grid-template-columns: 1fr; } .quick-add-buttons { grid-template-columns: 1fr; } .custom-add { grid-column: span 1; } .progress-stats { flex-direction: column; align-items: flex-start; gap: 10px; } .goal-meta { flex-direction: column; align-items: flex-start; gap: 8px; } }
      `}</style>
    </div>
  );
};

export default GoalTracker;