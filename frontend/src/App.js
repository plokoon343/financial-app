import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './App.css';
import './responsive.css';  // at the top with other CSS imports
// Eager: auth pages + the persistent shell (needed on first paint)
import Login from './components/Login';
import Register from './components/Register';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Sidebar from './components/Sidebar';
import SuperAdminRoute from './components/SuperAdminRoute';
import NotificationBell from './components/NotificationBell';
import BottomNav from './components/BottomNav';
import ServerWaker from './components/ServerWaker';
import Walkthrough from './components/Walkthrough';
import Onboarding from './components/Onboarding';
import { Loader, Splash } from './components/Logo';

// Lazy: page bodies are loaded on demand to shrink the initial bundle.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Budget = lazy(() => import('./components/Budget'));
const FinancialHealth = lazy(() => import('./components/FinancialHealth'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const Wallet = lazy(() => import('./components/Wallet'));
const GoalTracker = lazy(() => import('./components/GoalTracker'));
const DebtManager = lazy(() => import('./components/DebtManager'));
const SubscriptionManager = lazy(() => import('./components/SubscriptionManager'));
const BillsManager = lazy(() => import('./components/BillsManager'));
const PayBills = lazy(() => import('./components/PayBills'));
const NetWorthCalculator = lazy(() => import('./components/NetWorthCalculator'));
const AutoSavings = lazy(() => import('./components/AutoSavings'));
const ConnectBank = lazy(() => import('./components/ConnectBank'));
const Transactions = lazy(() => import('./components/Transactions'));
const Profile = lazy(() => import('./components/Profile'));
const Settings = lazy(() => import('./components/Settings'));
const Support = lazy(() => import('./components/Support'));

const PageLoader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
    <Loader size={56} />
  </div>
);

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
      <Splash />
      <ServerWaker />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
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
          <Route path="transactions" element={<Transactions />} />
          <Route path="budget" element={<Budget budgets={budgets} setBudgets={setBudgets} transactions={transactions} />} />
          <Route path="financial-health" element={<FinancialHealth transactions={transactions} />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="goals" element={<GoalTracker goals={goals} setGoals={setGoals} />} />
          <Route path="debt" element={<DebtManager debts={debts} setDebts={setDebts} />} />
          <Route path="subscriptions" element={<SubscriptionManager subscriptions={subscriptions} setSubscriptions={setSubscriptions} />} />
          <Route path="bills" element={<BillsManager />} />
          <Route path="pay-bills" element={<PayBills />} />
          <Route path="networth" element={<NetWorthCalculator />} />
          <Route path="auto-savings" element={<AutoSavings />} />
          <Route path="connect-bank" element={<ConnectBank />} />
          <Route path="support" element={<Support />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
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
      <Onboarding />
      <Walkthrough />
      <NotificationBell />
      <Sidebar />
      <main className="main-content">
        <div className="container">
          <Suspense fallback={<PageLoader />}>
            <Outlet context={props} />
          </Suspense>
        </div>
      </main>
      <BottomNav />
    </div>
  );
};

export default App;