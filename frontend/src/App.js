import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Budget from './components/Budget';
import FinancialHealth from './components/FinancialHealth';
import Sidebar from './components/Sidebar';
import SuperAdminRoute from './components/SuperAdminRoute';
import AdminDashboard from './components/AdminDashboard';
import './App.css';
import './responsive.css';  // at the top with other CSS imports
import Wallet from './components/Wallet';
import GoalTracker from './components/GoalTracker';
import AutoSavings from './components/AutoSavings';
import Profile from './components/Profile';

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

function AppContent() {
  const [transactions, setTransactions] = useState([]);
  const [debts, setDebts] = useState([]);
  const [goals, setGoals] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const { darkMode } = useAuth();

  useEffect(() => {
    try {
      setTransactions(JSON.parse(localStorage.getItem('transactions') || '[]'));
      setDebts(JSON.parse(localStorage.getItem('debts') || '[]'));
      setGoals(JSON.parse(localStorage.getItem('goals') || '[]'));
      setSubscriptions(JSON.parse(localStorage.getItem('subscriptions') || '[]'));
      setBudgets(JSON.parse(localStorage.getItem('budgets') || '[]'));
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, []);

  useEffect(() => { localStorage.setItem('transactions', JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem('debts', JSON.stringify(debts)); }, [debts]);
  useEffect(() => { localStorage.setItem('goals', JSON.stringify(goals)); }, [goals]);
  useEffect(() => { localStorage.setItem('subscriptions', JSON.stringify(subscriptions)); }, [subscriptions]);
  useEffect(() => { localStorage.setItem('budgets', JSON.stringify(budgets)); }, [budgets]);

  return (
    <div className={`App ${darkMode ? 'dark-theme' : ''}`}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={
          <ProtectedLayout
            transactions={transactions}
            debts={debts}
            goals={goals}
            subscriptions={subscriptions}
            budgets={budgets}
            setTransactions={setTransactions}
            setDebts={setDebts}
            setGoals={setGoals}
            setSubscriptions={setSubscriptions}
            setBudgets={setBudgets}
          />
        }>
          <Route index element={<Dashboard transactions={transactions} setTransactions={setTransactions} />} />
          <Route path="budget" element={<Budget budgets={budgets} setBudgets={setBudgets} transactions={transactions} />} />
          <Route path="financial-health" element={
            <FinancialHealth
              transactions={transactions}
              debts={debts}
              goals={goals}
              subscriptions={subscriptions}
              setDebts={setDebts}
              setGoals={setGoals}
              setSubscriptions={setSubscriptions}
            />
          } />
          <Route path="wallet" element={<Wallet />} />
          <Route path="goals" element={<GoalTracker goals={goals} setGoals={setGoals} />} />
          <Route path="auto-savings" element={<AutoSavings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="admin" element={
            <SuperAdminRoute>
              <AdminDashboard />
            </SuperAdminRoute>
          } />
        </Route>
      </Routes>
    </div>
  );
}

const ProtectedLayout = ({ ...props }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="container">
          <Outlet context={props} />
        </div>
      </main>
    </div>
  );
};

export default App;