import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Allows superadmins and scoped newsletter-editors; everyone else is bounced home.
const NewsletterRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'superadmin' && !user.newsletterEditor) return <Navigate to="/" replace />;
  return children;
};

export default NewsletterRoute;
