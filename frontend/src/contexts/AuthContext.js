import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Initialize theme from localStorage and system preference
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const initialDarkMode = savedDarkMode ? savedDarkMode === 'true' : systemPrefersDark;
    setDarkMode(initialDarkMode);
    applyTheme(initialDarkMode);
  }, []);

  const applyTheme = (isDark) => {
    const root = document.documentElement;
    const body = document.body;
    
    if (isDark) {
      root.classList.add('dark-theme');
      body.classList.add('dark-theme');
      body.style.backgroundColor = '#1a1b23';
    } else {
      root.classList.remove('dark-theme');
      body.classList.remove('dark-theme');
      body.style.backgroundColor = '#ffffff';
    }
  };

  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem('darkMode', newDarkMode);
    applyTheme(newDarkMode);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
      setUser(JSON.parse(userData));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setLoading(false);
  }, []);

  // Global handler: when the backend reports an expired/invalid session
  // (authExpired), clear it and send the user to login. PDF-password 401s
  // (passwordRequired/wrongPassword) are NOT flagged, so they're left alone.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error.response?.status === 401 && error.response?.data?.authExpired) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          delete axios.defaults.headers.common['Authorization'];
          setUser(null);
          if (window.location.pathname !== '/login') window.location.assign('/login');
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API_URL}/api/login`, {
        email,
        password
      });

      const { token, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(user);
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || 'Login failed' 
      };
    }
  };

  const register = async (name, email, password, phone) => {
    try {
      const response = await axios.post(`${API_URL}/api/register`, {
        name,
        email,
        password,
        phone
      });

      const { token, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(user);
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || 'Registration failed' 
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const updateUser = (updatedUserData) => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const newUserData = { ...currentUser, ...updatedUserData };
    localStorage.setItem('user', JSON.stringify(newUserData));
    setUser(newUserData);
  };

  const value = {
    user,
    login,
    register,
    logout,
    updateUser,
    darkMode,
    toggleDarkMode,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
// import React, { createContext, useState, useContext, useEffect } from 'react';
// import axios from 'axios';

// const AuthContext = createContext();

// export const useAuth = () => {
//   return useContext(AuthContext);
// };

// export const AuthProvider = ({ children }) => {
//   const [user, setUser] = useState(null);
//   const [loading, setLoading] = useState(true);
//   const [darkMode, setDarkMode] = useState(false);

//   // Initialize theme from localStorage and system preference
//   useEffect(() => {
//     const savedDarkMode = localStorage.getItem('darkMode');
//     const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
//     const initialDarkMode = savedDarkMode ? savedDarkMode === 'true' : systemPrefersDark;
//     setDarkMode(initialDarkMode);
//     applyTheme(initialDarkMode);
//   }, []);

//   const applyTheme = (isDark) => {
//     const root = document.documentElement;
//     if (isDark) {
//       root.classList.add('dark-theme');
//     } else {
//       root.classList.remove('dark-theme');
//     }
//   };

//   const toggleDarkMode = () => {
//     const newDarkMode = !darkMode;
//     setDarkMode(newDarkMode);
//     localStorage.setItem('darkMode', newDarkMode);
//     applyTheme(newDarkMode);
//   };

//   useEffect(() => {
//     const token = localStorage.getItem('token');
//     const userData = localStorage.getItem('user');
    
//     if (token && userData) {
//       setUser(JSON.parse(userData));
//       axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
//     }
//     setLoading(false);
//   }, []);

//   const login = async (email, password) => {
//     try {
//       const response = await axios.post('${API_URL}/api/login', {
//         email,
//         password
//       });

//       const { token, user } = response.data;
//       localStorage.setItem('token', token);
//       localStorage.setItem('user', JSON.stringify(user));
//       axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
//       setUser(user);
      
//       return { success: true };
//     } catch (error) {
//       return { 
//         success: false, 
//         message: error.response?.data?.message || 'Login failed' 
//       };
//     }
//   };

//   const register = async (name, email, password) => {
//     try {
//       const response = await axios.post('${API_URL}/api/register', {
//         name,
//         email,
//         password
//       });

//       const { token, user } = response.data;
//       localStorage.setItem('token', token);
//       localStorage.setItem('user', JSON.stringify(user));
//       axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
//       setUser(user);
      
//       return { success: true };
//     } catch (error) {
//       return { 
//         success: false, 
//         message: error.response?.data?.message || 'Registration failed' 
//       };
//     }
//   };

//   const logout = () => {
//     localStorage.removeItem('token');
//     localStorage.removeItem('user');
//     delete axios.defaults.headers.common['Authorization'];
//     setUser(null);
//   };

//   const value = {
//     user,
//     login,
//     register,
//     logout,
//     darkMode,
//     toggleDarkMode
//   };

//   return (
//     <AuthContext.Provider value={value}>
//       {!loading && children}
//     </AuthContext.Provider>
//   );
// };
