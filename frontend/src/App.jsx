import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { API_URL } from './config';
import './App.css';
import './responsive.css';  // at the top with other CSS imports
// Eager: auth pages + the persistent shell (needed on first paint)
import Login from './components/Login';
import Register from './components/Register';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Sidebar from './components/Sidebar';
import SuperAdminRoute from './components/SuperAdminRoute';
import NewsletterRoute from './components/NewsletterRoute';
import NotificationBell from './components/NotificationBell';
import GlobalBanner from './components/GlobalBanner';
import BottomNav from './components/BottomNav';
import ServerWaker from './components/ServerWaker';
import InstallPrompt from './components/InstallPrompt';
import Onboarding from './components/Onboarding';
import ErrorBoundary from './components/ErrorBoundary';
import { AccountScopeProvider } from './contexts/AccountScope';
import { Loader } from './components/Logo';

// Lazy: page bodies are loaded on demand to shrink the initial bundle.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Budget = lazy(() => import('./components/Budget'));
const InsightsHub = lazy(() => import('./components/InsightsHub'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const GoalTracker = lazy(() => import('./components/GoalTracker'));
const SubscriptionManager = lazy(() => import('./components/SubscriptionManager'));
const BillsManager = lazy(() => import('./components/BillsManager'));
const AccountsHub = lazy(() => import('./components/AccountsHub'));
const FirstInsight = lazy(() => import('./components/FirstInsight'));
const SmartCategorize = lazy(() => import('./components/SmartCategorize'));
const CashTracking = lazy(() => import('./components/CashTracking'));
const MoneyWrapped = lazy(() => import('./components/MoneyWrapped'));
const Recap = lazy(() => import('./components/Recap'));
const SharedExpenses = lazy(() => import('./components/SharedExpenses'));
const People = lazy(() => import('./components/People'));
const NewsletterComposer = lazy(() => import('./components/NewsletterComposer'));
const Transactions = lazy(() => import('./components/Transactions'));
const AiAssistant = lazy(() => import('./components/AiAssistant'));
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
  const [goals, setGoals] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const { user, darkMode } = useAuth();
  const userId = user?.id || user?._id || null;

  // Financial data lives in memory only. Older builds cached it in localStorage,
  // which leaves it readable on shared devices, so clear any leftover copies.
  useEffect(() => {
    ['transactions', 'goals', 'subscriptions', 'budgets', 'debts'].forEach((k) => localStorage.removeItem(k));
  }, []);

  // Load the signed-in user's transactions once so every page has them; drop
  // everything on sign-out so the next user never sees the previous one's data.
  useEffect(() => {
    setGoals([]); setSubscriptions([]); setBudgets([]); setTransactions([]);
    if (!userId) return undefined;
    let alive = true;
    axios.get(`${API_URL}/api/transactions`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((res) => { if (alive) setTransactions(res.data || []); })
      .catch(() => { /* pages show their own empty or error states */ });
    return () => { alive = false; };
  }, [userId]);

  return (
    <div className={`App ${darkMode ? 'dark-theme' : ''}`}>
      <ServerWaker />
      <InstallPrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={
          <ProtectedLayout
            transactions={transactions}
            goals={goals}
            subscriptions={subscriptions}
            budgets={budgets}
            setTransactions={setTransactions}
            setGoals={setGoals}
            setSubscriptions={setSubscriptions}
            setBudgets={setBudgets}
          />
        }>
          <Route index element={<Dashboard transactions={transactions} setTransactions={setTransactions} />} />
          {/* Deep links used by the backend reminders + the notification bell (and
              mirrored by the mobile app). They open the Dashboard with the import
              modal already on the right tab, instead of hitting a dead route. */}
          <Route path="import-statement" element={<Dashboard initialImport="file" />} />
          <Route path="sms-import" element={<Dashboard initialImport="paste" />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="assistant" element={<AiAssistant />} />
          <Route path="budget" element={<Budget budgets={budgets} setBudgets={setBudgets} transactions={transactions} />} />
          {/* Analysis pages folded into one "Insights" hub; old routes redirect to
              the matching tab so deep links keep working. */}
          <Route path="insights" element={<InsightsHub />} />
          <Route path="financial-health" element={<Navigate to="/insights?tab=health" replace />} />
          <Route path="cashflow" element={<Navigate to="/insights?tab=cashflow" replace />} />
          <Route path="networth" element={<Navigate to="/insights?tab=networth" replace />} />
          <Route path="goals" element={<GoalTracker goals={goals} setGoals={setGoals} />} />
          <Route path="subscriptions" element={<SubscriptionManager subscriptions={subscriptions} setSubscriptions={setSubscriptions} />} />
          <Route path="bills" element={<BillsManager />} />
          {/* Banking pages folded into one "Accounts & alerts" hub; old routes
              redirect to the matching tab so deep links keep working. */}
          <Route path="accounts" element={<AccountsHub />} />
          <Route path="connect-bank" element={<Navigate to="/accounts?tab=bank" replace />} />
          <Route path="email-forwarding" element={<Navigate to="/accounts?tab=email" replace />} />
          <Route path="smart-categorize" element={<SmartCategorize />} />
          <Route path="cash" element={<CashTracking />} />
          <Route path="first-insight" element={<FirstInsight />} />
          <Route path="wrapped" element={<MoneyWrapped />} />
          <Route path="recap" element={<Recap />} />
          <Route path="shared" element={<SharedExpenses />} />
          <Route path="people" element={<People />} />
          <Route path="support" element={<Support />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="admin" element={
            <SuperAdminRoute>
              <AdminDashboard />
            </SuperAdminRoute>
          } />
          <Route path="newsletter" element={
            <NewsletterRoute>
              <NewsletterComposer />
            </NewsletterRoute>
          } />
          {/* Safety net: any unknown in-app path (stale links, old reminder:* bell
              targets, mistyped URLs) lands on the dashboard instead of a blank page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>
  );
}

const ProtectedLayout = ({ ...props }) => {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AccountScopeProvider>
    <div className="app-layout">
      <Onboarding />
      <NotificationBell />
      <Sidebar />
      <main className="main-content">
        <GlobalBanner />
        <div className="container">
          {/* resetKey clears the boundary automatically when the user navigates,
              so one crashed page doesn't wedge the whole app. */}
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Outlet context={props} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <BottomNav />
    </div>
    </AccountScopeProvider>
  );
};

export default App;