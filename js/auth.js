/**
 * vg-task-manager: Authentication & User Management Client
 * Handles user registration, login, logout, session persistence,
 * and user list synchronization with MongoDB Atlas backend.
 */
(function() {
  window.VG = window.VG || {};

  const STORAGE_KEY_USER = 'vg_current_user';
  let currentUser = null;
  let cachedUsers = [];
  const authListeners = [];

  // Restore stored user if available
  try {
    const stored = localStorage.getItem(STORAGE_KEY_USER);
    if (stored) {
      currentUser = JSON.parse(stored);
    }
  } catch (e) {
    currentUser = null;
  }

  function getApiUrl(path) {
    if (window.VG.MongoSync && window.VG.MongoSync.apiUrl) {
      return window.VG.MongoSync.apiUrl(path);
    }
    return path;
  }

  function onAuthChange(fn) {
    if (typeof fn === 'function') {
      authListeners.push(fn);
    }
  }

  function notifyAuthChange() {
    authListeners.forEach(fn => {
      try { fn(currentUser); } catch (e) { console.error(e); }
    });
  }

  function getCurrentUser() {
    return currentUser;
  }

  function setCurrentUser(user) {
    currentUser = user || null;
    try {
      if (user) {
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEY_USER);
      }
    } catch (e) {}
    notifyAuthChange();
  }

  async function register(username, password) {
    const cleanUser = (username || '').trim();
    if (!cleanUser) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');

    const res = await fetch(getApiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Registration failed (HTTP ${res.status})`);
    }

    setCurrentUser(data.user);
    await fetchUsers().catch(() => {});
    return data.user;
  }

  async function login(username, password) {
    const cleanUser = (username || '').trim();
    if (!cleanUser) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');

    const res = await fetch(getApiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Login failed (HTTP ${res.status})`);
    }

    setCurrentUser(data.user);
    await fetchUsers().catch(() => {});
    return data.user;
  }

  function logout() {
    setCurrentUser(null);
  }

  async function fetchUsers() {
    try {
      const res = await fetch(getApiUrl('/api/users'), { cache: 'no-store' });
      if (!res.ok) return cachedUsers;
      const data = await res.json();
      if (data && Array.isArray(data.users)) {
        cachedUsers = data.users;
      }
      return cachedUsers;
    } catch (err) {
      console.warn('Could not fetch users list:', err);
      return cachedUsers;
    }
  }

  function getCachedUsers() {
    return cachedUsers;
  }

  window.VG.Auth = {
    getCurrentUser,
    setCurrentUser,
    register,
    login,
    logout,
    fetchUsers,
    getCachedUsers,
    onAuthChange
  };
})();
