/**
 * vg-task-manager: Authentication & User Management Client
 * Handles user registration, login, logout, session persistence,
 * and user list synchronization directly with MongoDB Atlas via vg-mongo-proxy.
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

  function bufferToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /**
   * Secure password hashing using Web Crypto API (PBKDF2-SHA256, 100,000 iterations)
   */
  async function hashPassword(password, saltBytes = null) {
    const enc = new TextEncoder();
    const salt = saltBytes || window.crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derived = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    return `pbkdf2:${bufferToHex(salt)}:${bufferToHex(derived)}`;
  }

  // Salsa20/8 core for legacy scrypt verification
  function salsa20_8(B) {
    const x = new Int32Array(16);
    for (let i = 0; i < 16; i++) x[i] = B[i];
    for (let i = 0; i < 8; i += 2) {
      x[ 4] ^= ((x[ 0] + x[12]) << 7) | ((x[ 0] + x[12]) >>> 25);
      x[ 8] ^= ((x[ 4] + x[ 0]) << 9) | ((x[ 4] + x[ 0]) >>> 23);
      x[12] ^= ((x[ 8] + x[ 4]) << 13) | ((x[ 8] + x[ 4]) >>> 19);
      x[ 0] ^= ((x[12] + x[ 8]) << 18) | ((x[12] + x[ 8]) >>> 14);
      x[ 9] ^= ((x[ 5] + x[ 1]) << 7) | ((x[ 5] + x[ 1]) >>> 25);
      x[13] ^= ((x[ 9] + x[ 5]) << 9) | ((x[ 9] + x[ 5]) >>> 23);
      x[ 1] ^= ((x[13] + x[ 9]) << 13) | ((x[13] + x[ 9]) >>> 19);
      x[ 5] ^= ((x[ 1] + x[13]) << 18) | ((x[ 1] + x[13]) >>> 14);
      x[14] ^= ((x[10] + x[ 6]) << 7) | ((x[10] + x[ 6]) >>> 25);
      x[ 2] ^= ((x[14] + x[10]) << 9) | ((x[14] + x[10]) >>> 23);
      x[ 6] ^= ((x[ 2] + x[14]) << 13) | ((x[ 2] + x[14]) >>> 19);
      x[10] ^= ((x[ 6] + x[ 2]) << 18) | ((x[ 6] + x[ 2]) >>> 14);
      x[ 3] ^= ((x[15] + x[11]) << 7) | ((x[15] + x[11]) >>> 25);
      x[ 7] ^= ((x[ 3] + x[15]) << 9) | ((x[ 3] + x[15]) >>> 23);
      x[11] ^= ((x[ 7] + x[ 3]) << 13) | ((x[ 7] + x[ 3]) >>> 19);
      x[15] ^= ((x[11] + x[ 7]) << 18) | ((x[11] + x[ 7]) >>> 14);
      x[ 1] ^= ((x[ 0] + x[ 3]) << 7) | ((x[ 0] + x[ 3]) >>> 25);
      x[ 2] ^= ((x[ 1] + x[ 0]) << 9) | ((x[ 1] + x[ 0]) >>> 23);
      x[ 3] ^= ((x[ 2] + x[ 1]) << 13) | ((x[ 2] + x[ 1]) >>> 19);
      x[ 0] ^= ((x[ 3] + x[ 2]) << 18) | ((x[ 3] + x[ 2]) >>> 14);
      x[ 6] ^= ((x[ 5] + x[ 4]) << 7) | ((x[ 5] + x[ 4]) >>> 25);
      x[ 7] ^= ((x[ 6] + x[ 5]) << 9) | ((x[ 6] + x[ 5]) >>> 23);
      x[ 4] ^= ((x[ 7] + x[ 6]) << 13) | ((x[ 7] + x[ 6]) >>> 19);
      x[ 5] ^= ((x[ 4] + x[ 7]) << 18) | ((x[ 4] + x[ 7]) >>> 14);
      x[11] ^= ((x[10] + x[ 9]) << 7) | ((x[10] + x[ 9]) >>> 25);
      x[ 8] ^= ((x[11] + x[10]) << 9) | ((x[11] + x[10]) >>> 23);
      x[ 9] ^= ((x[ 8] + x[11]) << 13) | ((x[ 8] + x[11]) >>> 19);
      x[10] ^= ((x[ 9] + x[ 8]) << 18) | ((x[ 9] + x[ 8]) >>> 14);
      x[12] ^= ((x[15] + x[14]) << 7) | ((x[15] + x[14]) >>> 25);
      x[13] ^= ((x[12] + x[15]) << 9) | ((x[12] + x[15]) >>> 23);
      x[14] ^= ((x[13] + x[12]) << 13) | ((x[13] + x[12]) >>> 19);
      x[15] ^= ((x[14] + x[13]) << 18) | ((x[14] + x[13]) >>> 14);
    }
    for (let i = 0; i < 16; i++) B[i] += x[i];
  }

  function blockmix_salsa8(B, Y, r) {
    const X = new Int32Array(16);
    for (let i = 0; i < 16; i++) X[i] = B[(2 * r - 1) * 16 + i];
    for (let i = 0; i < 2 * r; i++) {
      for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
      salsa20_8(X);
      const dest = (i % 2 === 0 ? (i / 2) : (r + (i - 1) / 2)) * 16;
      for (let j = 0; j < 16; j++) Y[dest + j] = X[j];
    }
  }

  async function scryptSyncJs(password, saltBytes, keyLen = 64, N = 16384, r = 8, p = 1) {
    const enc = new TextEncoder();
    const passBuf = typeof password === 'string' ? enc.encode(password) : password;
    const key1 = await window.crypto.subtle.importKey('raw', passBuf, { name: 'PBKDF2' }, false, ['deriveBits']);
    const B_raw = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 1, hash: 'SHA-256' }, key1, 128 * r * p * 8);
    const B = new Int32Array(B_raw);
    const Y = new Int32Array(128 * r / 4);

    const chunkSize = 128 * r / 4;
    for (let pi = 0; pi < p; pi++) {
      const B_sub = B.subarray(pi * chunkSize, (pi + 1) * chunkSize);
      const V = new Array(N);
      for (let i = 0; i < N; i++) {
        V[i] = new Int32Array(B_sub);
        blockmix_salsa8(V[i], Y, r);
        B_sub.set(Y);
      }
      for (let i = 0; i < N; i++) {
        const j = (B_sub[(2 * r - 1) * 16] & 0x7fffffff) % N;
        const Vj = V[j];
        for (let k = 0; k < chunkSize; k++) B_sub[k] ^= Vj[k];
        blockmix_salsa8(B_sub, Y, r);
        B_sub.set(Y);
      }
    }

    const key2 = await window.crypto.subtle.importKey('raw', passBuf, { name: 'PBKDF2' }, false, ['deriveBits']);
    const out = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(B.buffer), iterations: 1, hash: 'SHA-256' }, key2, keyLen * 8);
    return bufferToHex(out);
  }

  async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string') return false;
    if (stored.startsWith('pbkdf2:')) {
      const parts = stored.split(':');
      if (parts.length !== 3) return false;
      const salt = hexToBuffer(parts[1]);
      const derived = await hashPassword(password, salt);
      return derived === stored;
    }
    // Legacy server.js scrypt format (saltHex:hashHex)
    if (stored.includes(':')) {
      const parts = stored.split(':');
      if (parts.length === 2 && parts[0].length === 32 && parts[1].length === 128) {
        const salt = hexToBuffer(parts[0]);
        const computed = await scryptSyncJs(password, salt, 64);
        return computed === parts[1];
      }
    }
    return false;
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

  /**
   * Register a new user in MongoDB Atlas via vg-mongo-proxy
   */
  async function register(username, password) {
    const cleanUser = (username || '').trim();
    if (!cleanUser || cleanUser.length < 2 || cleanUser.length > 40) {
      throw new Error('Username must be between 2 and 40 characters.');
    }
    if (!/^[\w.-]+$/.test(cleanUser)) {
      throw new Error('Username can only contain letters, numbers, underscores, dots, and hyphens.');
    }
    if (!password || password.length < 3) {
      throw new Error('Password must be at least 3 characters long.');
    }

    if (!window.VG.MongoSync || !window.VG.MongoSync.isConnected()) {
      throw new Error('Not connected to MongoDB proxy. Please connect first.');
    }

    const lower = cleanUser.toLowerCase();

    // Check if username already exists
    const existing = await window.VG.MongoSync.action('findOne', 'users', {
      filter: { usernameLower: lower }
    });

    if (existing && existing.document) {
      throw new Error('Username is already taken. Please choose another or log in.');
    }

    const passwordHash = await hashPassword(password);
    const createdAtIso = new Date().toISOString();

    const userDoc = {
      username: cleanUser,
      usernameLower: lower,
      password: passwordHash,
      createdAt: { '$date': createdAtIso }
    };

    await window.VG.MongoSync.action('insertOne', 'users', {
      document: userDoc
    });

    const userObj = { username: cleanUser, createdAt: createdAtIso };
    setCurrentUser(userObj);
    await fetchUsers().catch(() => {});
    return userObj;
  }

  /**
   * Log in user by verifying credentials in MongoDB Atlas
   */
  async function login(username, password) {
    const cleanUser = (username || '').trim();
    if (!cleanUser) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');

    if (!window.VG.MongoSync || !window.VG.MongoSync.isConnected()) {
      throw new Error('Not connected to MongoDB proxy. Please connect first.');
    }

    const lower = cleanUser.toLowerCase();

    const res = await window.VG.MongoSync.action('findOne', 'users', {
      filter: { usernameLower: lower }
    });

    const userDoc = res ? res.document : null;
    if (!userDoc) {
      throw new Error('Invalid username or password.');
    }

    const valid = await verifyPassword(password, userDoc.password);
    if (!valid) {
      throw new Error('Invalid username or password.');
    }

    const createdAt = (userDoc.createdAt && userDoc.createdAt.$date)
      ? userDoc.createdAt.$date
      : (userDoc.createdAt || new Date().toISOString());

    const userObj = { username: userDoc.username, createdAt };
    setCurrentUser(userObj);
    await fetchUsers().catch(() => {});
    return userObj;
  }

  function logout() {
    setCurrentUser(null);
  }

  /**
   * Fetch all registered users for task assignment dropdowns and filters
   */
  async function fetchUsers() {
    if (!window.VG.MongoSync || !window.VG.MongoSync.isConnected()) {
      return cachedUsers;
    }

    try {
      const res = await window.VG.MongoSync.action('find', 'users', {
        filter: {},
        projection: { password: 0 },
        sort: { username: 1 },
        limit: 500
      });

      if (res && Array.isArray(res.documents)) {
        cachedUsers = res.documents.map(u => ({
          username: u.username,
          createdAt: (u.createdAt && u.createdAt.$date) ? u.createdAt.$date : u.createdAt
        }));
      }
      return cachedUsers;
    } catch (err) {
      console.warn('[Auth] Could not fetch users list:', err.message);
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
