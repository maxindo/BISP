const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const logger = require('../config/logger'); // Add logger
const { 
    addPPPoEUser, 
    editPPPoEUser, 
    deletePPPoEUser, 
    getPPPoEProfiles, 
    addPPPoEProfile, 
    editPPPoEProfile, 
    deletePPPoEProfile, 
    getPPPoEProfileDetail,
    getHotspotProfiles,
    addHotspotProfile,
    editHotspotProfile,
    deleteHotspotProfile,
    getHotspotProfileDetail,
    saveHotspotProfileMetadata,
    deleteHotspotProfileMetadata,
    getHotspotServerProfiles,
    addHotspotServerProfileMikrotik,
    editHotspotServerProfileMikrotik,
    deleteHotspotServerProfileMikrotik,
    getHotspotServers,
    addHotspotServer,
    editHotspotServer,
    deleteHotspotServer,
    getHotspotServerDetail,
    getMikrotikConnectionForRouter
} = require('../config/mikrotik');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Helper function untuk konversi timeout ke detik (untuk RADIUS)
function convertToSeconds(value, unit) {
  const numValue = parseInt(value);
  if (isNaN(numValue) || numValue <= 0) return 0;
  
  const unitLower = String(unit).toLowerCase();
  const unitMap = {
    's': 1,           // detik (standar Mikrotik)
    'detik': 1,       // kompatibilitas backward
    'm': 60,          // menit (standar Mikrotik) - lowercase untuk waktu
    'menit': 60,      // kompatibilitas backward
    'men': 60,        // kompatibilitas backward
    'h': 3600,        // jam (standar Mikrotik)
    'jam': 3600,      // kompatibilitas backward
    'd': 86400,       // hari (standar Mikrotik)
    'hari': 86400     // kompatibilitas backward
  };
  
  const multiplier = unitMap[unitLower] || 1;
  return numValue * multiplier;
}

// GET: List User PPPoE
router.get('/mikrotik', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getUserAuthModeAsync, getPPPoEUsersRadius, getActivePPPoEConnectionsRadius } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    logger.info(`Loading PPPoE users in ${authMode} mode`);
    
    let combined = [];
    let routers = [];
    
    if (authMode === 'radius') {
      // RADIUS mode: Get users from RADIUS database
      logger.info('RADIUS mode: Loading users from RADIUS database');
      try {
        const users = await getPPPoEUsersRadius();
        logger.info(`Found ${users.length} users in RADIUS database`);
        
        const activeConnections = await getActivePPPoEConnectionsRadius();
        logger.info(`Found ${activeConnections.length} active connections in RADIUS`);
        
        const activeNames = new Set(activeConnections.map(a => a.name));
        
        combined = users.map(user => ({
          id: user.name, // Use username as ID for RADIUS
          name: user.name,
          password: user.password,
          profile: user.profile || 'default',
          active: activeNames.has(user.name),
          nas_name: 'RADIUS',
          nas_ip: 'RADIUS Server'
        }));
        
        logger.info(`Mapped ${combined.length} users for display`);
      } catch (radiusError) {
        logger.error(`Error loading users from RADIUS: ${radiusError.message}`, radiusError);
        // Return empty array but log the error
        combined = [];
      }
      // No routers needed for RADIUS mode
    } else {
      // Mikrotik API mode: Get users from routers
      logger.info('Mikrotik API mode: Loading users from routers');
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
      db.close();

      logger.info(`Found ${routers.length} routers configured`);

      // OPTIMASI: Query semua router secara parallel (bukan sequential)
      // Sebelum: 5 router × 2 detik = 10 detik
      // Sesudah: Max(2 detik) = 2 detik (5x lebih cepat)
      const routerQueries = routers.map(async (r) => {
        try {
          const conn = await getMikrotikConnectionForRouter(r);
          const [secrets, active] = await Promise.all([
            conn.write('/ppp/secret/print'),
            conn.write('/ppp/active/print')
          ]);
          const activeNames = new Set((active || []).map(a => a.name));
          const routerUsers = (secrets || []).map(sec => ({
            id: sec['.id'],
            name: sec.name,
            password: sec.password,
            profile: sec.profile,
            active: activeNames.has(sec.name),
            nas_name: r.name,
            nas_ip: r.nas_ip
          }));
          logger.info(`Loaded ${routerUsers.length} users from router ${r.name}`);
          return routerUsers;
        } catch (e) {
          logger.error(`Error getting users from router ${r.name}:`, e.message);
          // Return empty array jika router gagal, bukan throw error
          return [];
        }
      });

      // Tunggu semua query selesai secara parallel
      const allRouterResults = await Promise.all(routerQueries);
      
      // Flatten hasil dari semua router
      combined = allRouterResults.flat();
    }
    
    logger.info(`Total users to display: ${combined.length}`);
    
    // Debug: Log first few users
    if (combined.length > 0) {
      logger.info(`Sample users: ${JSON.stringify(combined.slice(0, 3).map(u => ({ name: u.name, profile: u.profile })))}`);
    } else {
      logger.warn('No users found to display!');
    }
    
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', { 
      users: combined, 
      routers: routers,
      authMode: authMode, // Pass auth mode to view
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    logger.error('Error loading PPPoE users:', err);
    logger.error('Error stack:', err.stack);
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', { 
      users: [], 
      routers: [],
      authMode: 'mikrotik',
      error: `Gagal mengambil data user PPPoE: ${err.message}`, 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// POST: Tambah User PPPoE
router.post('/mikrotik/add-user', adminAuth, async (req, res) => {
  try {
    const { username, password, profile, router_id } = req.body;
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Save to radcheck and radusergroup
      logger.info('RADIUS mode: Adding user to RADIUS database');
      const result = await addPPPoEUser({ username, password, profile });
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode: Need router_id
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const router = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => resolve(row || null)));
    db.close();
    if (!router) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    
    await addPPPoEUser({ username, password, profile, routerObj: router });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error adding PPPoE user:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit User PPPoE
router.post('/mikrotik/edit-user', adminAuth, async (req, res) => {
  try {
    const { id, username, password, profile } = req.body;
    
    // Validasi: id harus ada untuk edit
    if (!id) {
      return res.json({ success: false, message: 'ID user tidak ditemukan. Pastikan Anda mengedit user yang sudah ada.' });
    }
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Update in radcheck and radusergroup
      // id adalah username lama di mode RADIUS
      logger.info(`RADIUS mode: Updating user in RADIUS database. Old username: ${id}, New username: ${username}`);
      const result = await editPPPoEUser({ id, username, password, profile });
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode: id adalah Mikrotik ID
    logger.info(`Mikrotik API mode: Updating user. ID: ${id}, Username: ${username}`);
    const result = await editPPPoEUser({ id, username, password, profile });
    if (result.success) {
      return res.json({ success: true, message: result.message || 'User berhasil di-update' });
    } else {
      return res.json({ success: false, message: result.message || 'Gagal mengupdate user' });
    }
  } catch (err) {
    logger.error('Error editing PPPoE user:', err);
    logger.error('Error stack:', err.stack);
    res.json({ success: false, message: err.message || 'Terjadi kesalahan saat mengupdate user' });
  }
});

// POST: Hapus User PPPoE
router.post('/mikrotik/delete-user', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Delete from radcheck and radusergroup
      logger.info('RADIUS mode: Deleting user from RADIUS database');
      const result = await deletePPPoEUser(id); // In RADIUS mode, id is username
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode
    await deletePPPoEUser(id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting PPPoE user:', err);
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile PPPoE
router.get('/mikrotik/profiles', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    let profiles = [];
    let routers = [];
    
    if (authMode === 'radius') {
      // RADIUS mode: Get profiles from RADIUS database
      logger.info('RADIUS mode: Loading profiles from RADIUS database');
      const result = await getPPPoEProfiles();
      if (result.success) {
        profiles = result.data || [];
      }
      // No routers needed for RADIUS mode
    } else {
      // Mikrotik API mode: Get profiles from routers
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
      db.close();

      // Aggregate profiles from all NAS
      for (const router of routers) {
        try {
          const result = await getPPPoEProfiles(router);
          if (result.success && Array.isArray(result.data)) {
            result.data.forEach(prof => {
              profiles.push({
                ...prof,
                nas_id: router.id,
                nas_name: router.name,
                nas_ip: router.nas_ip
              });
            });
          }
        } catch (e) {
          logger.error(`Error getting profiles from ${router.name}:`, e.message);
        }
      }
    }

    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', { 
      profiles: profiles, 
      routers: routers,
      authMode: authMode, // Pass auth mode to view
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    logger.error('Error loading PPPoE profiles:', err);
    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', { 
      profiles: [], 
      routers: [],
      authMode: 'mikrotik',
      error: 'Gagal mengambil data profile PPPoE.', 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile PPPoE (untuk dropdown)
router.get('/mikrotik/profiles/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    // Check if system is in RADIUS mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // In RADIUS mode, return profiles from RADIUS database
      logger.info('RADIUS mode: Returning profiles from RADIUS database');
      const result = await getPPPoEProfiles();
      if (result.success) {
        return res.json({ 
          success: true, 
          profiles: result.data || [],
          message: `Ditemukan ${result.data?.length || 0} profile dari RADIUS`
        });
      } else {
        return res.json({ 
          success: true, 
          profiles: [], 
          message: result.message || 'Tidak ada profile ditemukan di RADIUS'
        });
      }
    }
    
    // If router_id is provided, only fetch from that router
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      
      if (!routerObj) {
        return res.json({ success: false, profiles: [], message: 'Router tidak ditemukan' });
      }
      
      try {
        const result = await getPPPoEProfiles(routerObj);
        if (result.success) {
          return res.json({ success: true, profiles: result.data || [] });
        } else {
          // Return empty array instead of error to prevent UI blocking
          logger.warn(`Failed to get profiles from router ${routerObj.name}: ${result.message}`);
          return res.json({ success: true, profiles: [], message: `Tidak dapat mengambil profile dari ${routerObj.name}. Pastikan router dapat diakses.` });
        }
      } catch (profileError) {
        logger.error(`Error getting profiles from router ${routerObj.name}:`, profileError.message);
        return res.json({ success: true, profiles: [], message: `Error: ${profileError.message}` });
      }
    } else {
      // Fetch from all routers (aggregate)
      // First, check if there are any routers configured
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
        db.close();
        resolve(rows || []);
      }));
      
      if (!routers || routers.length === 0) {
        return res.json({ 
          success: true, 
          profiles: [], 
          message: 'Tidak ada router yang dikonfigurasi. Silakan tambahkan router terlebih dahulu.' 
        });
      }
      
      // Try to fetch from routers, aggregate results
      let allProfiles = [];
      let errors = [];
      
      for (const router of routers) {
        try {
          const result = await getPPPoEProfiles(router);
          if (result.success && Array.isArray(result.data)) {
            allProfiles = allProfiles.concat(result.data.map(prof => ({
              ...prof,
              nas_id: router.id,
              nas_name: router.name,
              nas_ip: router.nas_ip
            })));
          } else {
            errors.push(`${router.name}: ${result.message || 'Unknown error'}`);
          }
        } catch (routerError) {
          logger.warn(`Error getting profiles from router ${router.name}:`, routerError.message);
          errors.push(`${router.name}: ${routerError.message}`);
        }
      }
      
      // Return profiles even if some routers failed
      if (allProfiles.length > 0 || errors.length === 0) {
        return res.json({ 
          success: true, 
          profiles: allProfiles,
          message: errors.length > 0 ? `Beberapa router tidak dapat diakses: ${errors.join(', ')}` : undefined
        });
      } else {
        // All routers failed, but return empty array to prevent UI blocking
        return res.json({ 
          success: true, 
          profiles: [], 
          message: `Tidak dapat mengambil profile dari router: ${errors.join(', ')}. Pastikan router dapat diakses dan kredensial benar.` 
        });
      }
    }
  } catch (err) {
    logger.error('Error in /mikrotik/profiles/api:', err);
    // Return empty array instead of error to prevent UI blocking
    res.json({ 
      success: true, 
      profiles: [], 
      message: `Error: ${err.message || 'Gagal mengambil daftar profile PPPOE'}` 
    });
  }
});

// GET: API Detail Profile PPPoE
router.get('/mikrotik/profile/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getPPPoEProfileDetail(id);
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile PPPoE
router.post('/mikrotik/add-profile', adminAuth, async (req, res) => {
  try {
    const { router_id, ...profileData } = req.body;
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Save to radgroupreply
      logger.info('RADIUS mode: Adding profile to RADIUS database');
      const result = await addPPPoEProfile(profileData);
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode: Need router_id
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    
    const result = await addPPPoEProfile(profileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    logger.error('Error adding PPPoE profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile PPPoE
router.post('/mikrotik/edit-profile', adminAuth, async (req, res) => {
  try {
    const { router_id, ...profileData } = req.body;
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Update in radgroupreply
      logger.info('RADIUS mode: Updating profile in RADIUS database');
      logger.info(`📝 Data yang diterima untuk edit profile:`, {
        name: profileData.name,
        'remote-address': profileData['remote-address'],
        'local-address': profileData['local-address'],
        'rate-limit': profileData['rate-limit'],
        'dns-server': profileData['dns-server']
      });
      const result = await editPPPoEProfile(profileData);
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode: Need router_id
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    
    const result = await editPPPoEProfile(profileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    logger.error('Error editing PPPoE profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile PPPoE
router.post('/mikrotik/delete-profile', adminAuth, async (req, res) => {
  try {
    const { id, router_id } = req.body;
    
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Delete from radgroupreply
      logger.info('RADIUS mode: Deleting profile from RADIUS database');
      const result = await deletePPPoEProfile(id);
      if (result.success) {
        return res.json({ success: true, message: result.message });
      } else {
        return res.json({ success: false, message: result.message });
      }
    }
    
    // Mikrotik API mode
    let routerObj = null;
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
    }
    const result = await deletePPPoEProfile(id, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    logger.error('Error deleting PPPoE profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile Hotspot
router.get('/mikrotik/hotspot-profiles', adminAuth, async (req, res) => {
  try {
    // Check auth mode - RADIUS atau Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const { getRadiusConfigValue } = require('../config/radiusConfig');
    let userAuthMode = 'mikrotik';
    try {
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));
    db.close();

    // Store userAuthMode untuk digunakan di render
    const userAuthModeForRender = userAuthMode;

    // Untuk mode RADIUS, tidak perlu router - ambil dari RADIUS database
    if (userAuthMode === 'radius') {
      try {
        const { getHotspotProfilesRadius } = require('../config/mikrotik');
        logger.info('RADIUS mode: Loading hotspot profiles from RADIUS database');
        const result = await getHotspotProfilesRadius();
        if (result.success) {
          const profiles = result.data || [];
          const settings = getSettingsWithCache();
          return res.render('adminMikrotikHotspotProfiles', { 
            profiles: profiles, 
            routers: [],
            error: null,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: 'radius'
          });
        } else {
          throw new Error(result.message || 'Failed to get hotspot profiles');
        }
      } catch (radiusError) {
        logger.error('Error fetching hotspot profiles from RADIUS:', radiusError);
        const settings = getSettingsWithCache();
        return res.render('adminMikrotikHotspotProfiles', { 
          profiles: [], 
          routers: [],
          error: `Gagal mengambil data profile hotspot dari RADIUS: ${radiusError.message}`, 
          settings,
          versionInfo: getVersionInfo(),
          versionBadge: getVersionBadge(),
          userAuthMode: 'radius'
        });
      }
    }

    // Untuk mode Mikrotik API, perlu router
    if (!routers || routers.length === 0) {
      console.warn('No routers found in database');
      const settings = getSettingsWithCache();
      return res.render('adminMikrotikHotspotProfiles', { 
        profiles: [], 
        routers: [],
        error: 'Tidak ada router/NAS yang dikonfigurasi. Silakan tambahkan router terlebih dahulu di menu NAS (RADIUS).', 
        settings,
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge(),
        userAuthMode: 'mikrotik'
      });
    }

    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        console.log(`=== Attempting to get hotspot profiles from router: ${r.name} (${r.nas_ip}:${r.port || 8728}) ===`);
        console.log(`Router data:`, JSON.stringify({
          id: r.id,
          name: r.name,
          nas_ip: r.nas_ip,
          port: r.port,
          user: r.user ? '***' : 'missing',
          password: r.password ? '***' : 'missing'
        }));
        
        const result = await getHotspotProfiles(r);
        console.log(`Result from ${r.name}:`, {
          success: result.success,
          message: result.message,
          dataCount: result.data ? result.data.length : 0
        });
        
        if (result.success && Array.isArray(result.data)) {
          console.log(`✓ Successfully retrieved ${result.data.length} profiles from ${r.name}`);
          if (result.data.length > 0) {
            console.log(`Profile names:`, result.data.map(p => p.name || p['name'] || 'unnamed').join(', '));
          }
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(profileObj);
            console.log(`  - Added profile: ${prof.name || prof['name'] || 'unnamed'} from ${r.name}`);
          });
        } else {
          console.warn(`✗ Failed to get profiles from ${r.name}:`, result.message);
          errorMessages.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`✗ Error getting hotspot profiles from ${r.name} (${r.nas_ip}:${r.port || 8728}):`, e.message);
        console.error('Full error:', e);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }
    
    console.log(`=== Total profiles collected: ${combined.length} ===`);
    
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', { 
      profiles: combined, 
      routers,
      settings,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge(),
      userAuthMode: userAuthModeForRender
    });
  } catch (err) {
    console.error('Error in hotspot profiles GET route:', err);
    // Try to get userAuthMode for error page
    let userAuthMode = 'mikrotik';
    try {
      const { getRadiusConfigValue } = require('../config/radiusConfig');
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }
    
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', { 
      profiles: [], 
      routers: [],
      error: `Gagal mengambil data profile Hotspot: ${err.message}`, 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge(),
      userAuthMode: userAuthMode
    });
  }
});

// GET: API Daftar Profile Hotspot
router.get('/mikrotik/hotspot-profiles/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    // If router_id is provided, only fetch from that router
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      if (!routerObj) {
        return res.json({ success: false, profiles: [], message: 'Router tidak ditemukan' });
      }
      const result = await getHotspotProfiles(routerObj);
      if (result.success) {
        // Ensure router info is attached
        const profilesWithRouter = result.data.map(prof => ({
          ...prof,
          nas_id: routerObj.id,
          nas_name: routerObj.name,
          nas_ip: routerObj.nas_ip
        }));
        return res.json({ success: true, profiles: profilesWithRouter });
      } else {
        return res.json({ success: false, profiles: [], message: result.message });
      }
    }
    
    // If no router_id, fetch from ALL routers (same logic as GET route)
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));
    db.close();
    
    // Check auth mode untuk API endpoint juga
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const { getRadiusConfigValue } = require('../config/radiusConfig');
    let userAuthMode = 'mikrotik';
    try {
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }

    // Untuk mode RADIUS, ambil dari RADIUS database (hotspot profiles)
    if (userAuthMode === 'radius') {
      try {
        const { getHotspotProfilesRadius } = require('../config/mikrotik');
        logger.info('RADIUS mode: Loading hotspot profiles from RADIUS database (API)');
        const result = await getHotspotProfilesRadius();
        if (result.success) {
          return res.json({ success: true, profiles: result.data || [] });
        } else {
          throw new Error(result.message || 'Failed to get hotspot profiles');
        }
      } catch (radiusError) {
        logger.error('Error fetching hotspot profiles from RADIUS (API):', radiusError);
        return res.json({ success: false, profiles: [], message: `Gagal mengambil data profile hotspot dari RADIUS: ${radiusError.message}` });
      }
    }

    // Untuk mode Mikrotik API, perlu router
    if (!routers || routers.length === 0) {
      return res.json({ success: false, profiles: [], message: 'Tidak ada router/NAS yang dikonfigurasi' });
    }
    
    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        console.log(`=== API: Attempting to get hotspot profiles from router: ${r.name} (${r.nas_ip}:${r.port || 8728}) ===`);
        const result = await getHotspotProfiles(r);
        console.log(`=== API: Result from ${r.name}:`, {
          success: result.success,
          message: result.message,
          dataCount: result.data ? result.data.length : 0
        });
        
        if (result.success && Array.isArray(result.data)) {
          console.log(`✓ API: Successfully retrieved ${result.data.length} profiles from ${r.name}`);
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(profileObj);
            console.log(`  - API: Added profile: ${prof.name || prof['name'] || 'unnamed'} from ${r.name} (nas_id: ${r.id}, nas_name: ${r.name}, nas_ip: ${r.nas_ip})`);
          });
        } else {
          console.warn(`✗ API: Failed to get profiles from ${r.name}:`, result.message);
          errorMessages.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`✗ API: Error getting hotspot profiles from ${r.name} (${r.nas_ip}:${r.port || 8728}):`, e.message);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }
    
    console.log(`=== API: Total profiles collected: ${combined.length} ===`);
    
    res.json({ 
      success: true, 
      profiles: combined,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null
    });
  } catch (err) {
    console.error('Error in hotspot profiles API route:', err);
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profile Hotspot
router.get('/mikrotik/hotspot-profiles/detail/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { router_id } = req.query;
    let routerObj = null;
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
    }
    const result = await getHotspotProfileDetail(id, routerObj);
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile Hotspot
router.post('/mikrotik/hotspot-profiles/add', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getRadiusConfigValue } = require('../config/radiusConfig');
    let userAuthMode = 'mikrotik';
    try {
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }

    const { router_id, id, name, rateLimit, rateLimitUnit, burstLimit, burstLimitUnit, sessionTimeout, sessionTimeoutUnit, idleTimeout, idleTimeoutUnit, limitUptime, limitUptimeUnit, validity, validityUnit, sharedUsers, comment, localAddress, remoteAddress, dnsServer, parentQueue, addressList } = req.body;

    // Untuk mode RADIUS, simpan ke RADIUS database
    if (userAuthMode === 'radius') {
      if (!name) {
        return res.json({ success: false, message: 'Nama profile harus diisi' });
      }

      try {
        const { getRadiusConnection } = require('../config/mikrotik');
        const conn = await getRadiusConnection();
        const groupname = name.toLowerCase().replace(/\s+/g, '_');

        // Build rate limit string dengan burst limit (jika ada)
        const sanitize = (value) => {
          if (value === undefined || value === null) return null;
          const trimmed = String(value).trim();
          return trimmed === '' ? null : trimmed;
        };

        const normalizedRateValue = sanitize(rateLimit);
        const normalizedRateUnit = sanitize(rateLimitUnit) ? sanitize(rateLimitUnit).toUpperCase() : null;
        const normalizedBurstValue = sanitize(burstLimit);
        const normalizedBurstUnit = sanitize(burstLimitUnit) ? sanitize(burstLimitUnit).toUpperCase() : null;
        const normalizedSessionValue = sanitize(sessionTimeout);
        const normalizedSessionUnit = sanitize(sessionTimeoutUnit) ? sanitize(sessionTimeoutUnit).toLowerCase() : null;
        const normalizedIdleValue = sanitize(idleTimeout);
        const normalizedIdleUnit = sanitize(idleTimeoutUnit) ? sanitize(idleTimeoutUnit).toLowerCase() : null;
        const normalizedLimitUptimeValue = sanitize(limitUptime);
        const normalizedLimitUptimeUnit = sanitize(limitUptimeUnit) ? sanitize(limitUptimeUnit).toLowerCase() : null;
        const normalizedValidityValue = sanitize(validity);
        const normalizedValidityUnit = sanitize(validityUnit) ? sanitize(validityUnit).toLowerCase() : null;
        const normalizedSharedUsers = sanitize(sharedUsers);

        let rateLimitStr = '';
        if (normalizedRateValue && normalizedRateUnit) {
          const download = `${normalizedRateValue}${normalizedRateUnit}`;
          const upload = `${normalizedRateValue}${normalizedRateUnit}`;
          rateLimitStr = `${download}/${upload}`;
          
          // Tambahkan burst limit jika ada
          if (normalizedBurstValue && normalizedBurstUnit) {
            const burstDownload = `${normalizedBurstValue}${normalizedBurstUnit}`;
            const burstUpload = `${normalizedBurstValue}${normalizedBurstUnit}`;
            rateLimitStr += `:${burstDownload}/${burstUpload}`;
          }
        }

        // Insert rate limit ke radgroupreply
        if (rateLimitStr) {
          await conn.execute(
            "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'MikroTik-Rate-Limit', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [groupname, rateLimitStr, rateLimitStr]
          );
        }

        // Session timeout - konversi ke detik untuk RADIUS
        if (normalizedSessionValue && normalizedSessionUnit) {
          const timeoutValue = convertToSeconds(normalizedSessionValue, normalizedSessionUnit);
          if (timeoutValue > 0) {
            await conn.execute(
              "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
              [groupname, timeoutValue.toString(), timeoutValue.toString()]
            );
          }
        } else {
          await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute = 'Session-Timeout'",
            [groupname]
          );
        }

        // Idle timeout - konversi ke detik untuk RADIUS
        if (normalizedIdleValue && normalizedIdleUnit) {
          const timeoutValue = convertToSeconds(normalizedIdleValue, normalizedIdleUnit);
          if (timeoutValue > 0) {
            await conn.execute(
              "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Idle-Timeout', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
              [groupname, timeoutValue.toString(), timeoutValue.toString()]
            );
          }
        }

        // Shared users (Simultaneous-Use & Mikrotik-Shared-Users)
        const sharedUsersValid = normalizedSharedUsers && !isNaN(parseInt(normalizedSharedUsers)) && parseInt(normalizedSharedUsers) > 0;
        if (sharedUsersValid) {
          await conn.execute(
            "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Simultaneous-Use', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [groupname, normalizedSharedUsers, normalizedSharedUsers]
          );
        }

        await saveHotspotProfileMetadata(conn, {
          groupname,
          displayName: sanitize(name) || groupname,
          comment: sanitize(comment),
          rateLimitValue: normalizedRateValue,
          rateLimitUnit: normalizedRateUnit,
          burstLimitValue: normalizedBurstValue,
          burstLimitUnit: normalizedBurstUnit,
          sessionTimeoutValue: normalizedSessionValue || null,
          sessionTimeoutUnit: normalizedSessionUnit || null,
          idleTimeoutValue: normalizedIdleValue || null,
          idleTimeoutUnit: normalizedIdleUnit || null,
          limitUptimeValue: normalizedLimitUptimeValue || null,
          limitUptimeUnit: normalizedLimitUptimeUnit || null,
          validityValue: normalizedValidityValue || null,
          validityUnit: normalizedValidityUnit || null,
          sharedUsers: sharedUsersValid ? normalizedSharedUsers : null,
          localAddress: sanitize(localAddress),
          remoteAddress: sanitize(remoteAddress),
          dnsServer: sanitize(dnsServer),
          parentQueue: sanitize(parentQueue),
          addressList: sanitize(addressList)
        });

        await conn.end();
        return res.json({ success: true, message: 'Profile hotspot berhasil ditambahkan ke RADIUS' });
      } catch (radiusError) {
        console.error('Error adding hotspot profile to RADIUS:', radiusError);
        return res.json({ success: false, message: `Gagal menambah profile ke RADIUS: ${radiusError.message}` });
      }
    }

    // Untuk mode Mikrotik API, perlu router
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    // Clean profileData: remove undefined, null, empty strings, and unsupported parameters
    // Note: local-address, remote-address, dns-server, parent-queue, address-list
    // are NOT supported for hotspot user profile in Mikrotik
    const cleanProfileData = {};
    const unsupportedParams = ['local-address', 'remote-address', 'dns-server', 'parent-queue', 'address-list', 'limitUptime', 'limitUptimeUnit', 'validity', 'validityUnit'];
    Object.keys(req.body).forEach(key => {
      if (key === 'router_id' || key === 'id') return;
      const value = req.body[key];
      // Skip unsupported parameters and null/undefined values
      // Empty strings are OK for optional fields, they will be filtered in addHotspotProfile
      if (value !== undefined && value !== null && !unsupportedParams.includes(key)) {
        cleanProfileData[key] = value;
      }
    });
    console.log('Cleaned profileData for add:', cleanProfileData);
    const result = await addHotspotProfile(cleanProfileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile Hotspot
router.post('/mikrotik/hotspot-profiles/edit', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getRadiusConfigValue } = require('../config/radiusConfig');
    let userAuthMode = 'mikrotik';
    try {
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }

    const { router_id, id, name, rateLimit, rateLimitUnit, burstLimit, burstLimitUnit, sessionTimeout, sessionTimeoutUnit, idleTimeout, idleTimeoutUnit, limitUptime, limitUptimeUnit, validity, validityUnit, sharedUsers, comment, localAddress, remoteAddress, dnsServer, parentQueue, addressList } = req.body;

    // Untuk mode RADIUS, update di RADIUS database
    if (userAuthMode === 'radius') {
      if (!id && !name) {
        return res.json({ success: false, message: 'ID atau nama profile tidak ditemukan' });
      }

      try {
        const { getRadiusConnection } = require('../config/mikrotik');
        const conn = await getRadiusConnection();
        // Gunakan id (yang adalah name) atau name sebagai groupname
        const groupname = (id || name).toLowerCase().replace(/\s+/g, '_');

        // Build rate limit string dengan burst limit (jika ada)
        const sanitize = (value) => {
          if (value === undefined || value === null) return null;
          const trimmed = String(value).trim();
          return trimmed === '' ? null : trimmed;
        };

        const normalizedRateValue = sanitize(rateLimit);
        const normalizedRateUnit = sanitize(rateLimitUnit) ? sanitize(rateLimitUnit).toUpperCase() : null;
        const normalizedBurstValue = sanitize(burstLimit);
        const normalizedBurstUnit = sanitize(burstLimitUnit) ? sanitize(burstLimitUnit).toUpperCase() : null;
        const normalizedSessionValue = sanitize(sessionTimeout);
        const normalizedSessionUnit = sanitize(sessionTimeoutUnit) ? sanitize(sessionTimeoutUnit).toLowerCase() : null;
        const normalizedIdleValue = sanitize(idleTimeout);
        const normalizedIdleUnit = sanitize(idleTimeoutUnit) ? sanitize(idleTimeoutUnit).toLowerCase() : null;
        const normalizedLimitUptimeValue = sanitize(limitUptime);
        const normalizedLimitUptimeUnit = sanitize(limitUptimeUnit) ? sanitize(limitUptimeUnit).toLowerCase() : null;
        const normalizedValidityValue = sanitize(validity);
        const normalizedValidityUnit = sanitize(validityUnit) ? sanitize(validityUnit).toLowerCase() : null;
        const normalizedSharedUsers = sanitize(sharedUsers);

        let rateLimitStr = '';
        if (normalizedRateValue && normalizedRateUnit) {
          const download = `${normalizedRateValue}${normalizedRateUnit}`;
          const upload = `${normalizedRateValue}${normalizedRateUnit}`;
          rateLimitStr = `${download}/${upload}`;
          
          // Tambahkan burst limit jika ada
          if (normalizedBurstValue && normalizedBurstUnit) {
            const burstDownload = `${normalizedBurstValue}${normalizedBurstUnit}`;
            const burstUpload = `${normalizedBurstValue}${normalizedBurstUnit}`;
            rateLimitStr += `:${burstDownload}/${burstUpload}`;
          }
        }
        if (rateLimitStr) {
          await conn.execute(
            "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'MikroTik-Rate-Limit', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [groupname, rateLimitStr, rateLimitStr]
          );
        } else {
          // Hapus rate limit jika tidak diisi
          await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute = 'MikroTik-Rate-Limit'",
            [groupname]
          );
        }

        // Session timeout - konversi ke detik untuk RADIUS
        if (normalizedSessionValue && normalizedSessionUnit) {
          const timeoutValue = convertToSeconds(normalizedSessionValue, normalizedSessionUnit);
          if (timeoutValue > 0) {
            await conn.execute(
              "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
              [groupname, timeoutValue.toString(), timeoutValue.toString()]
            );
          }
        } else {
          await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute = 'Session-Timeout'",
            [groupname]
          );
        }

        // Idle timeout - konversi ke detik untuk RADIUS
        if (normalizedIdleValue && normalizedIdleUnit) {
          const timeoutValue = convertToSeconds(normalizedIdleValue, normalizedIdleUnit);
          if (timeoutValue > 0) {
            await conn.execute(
              "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Idle-Timeout', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
              [groupname, timeoutValue.toString(), timeoutValue.toString()]
            );
          }
        } else {
          await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute = 'Idle-Timeout'",
            [groupname]
          );
        }

        const sharedUsersValid = normalizedSharedUsers && !isNaN(parseInt(normalizedSharedUsers)) && parseInt(normalizedSharedUsers) > 0;
        if (sharedUsersValid) {
          await conn.execute(
            "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Simultaneous-Use', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [groupname, normalizedSharedUsers, normalizedSharedUsers]
          );
        } else {
          await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute IN ('Simultaneous-Use', 'Mikrotik-Shared-Users', 'MikroTik-Shared-Users')",
            [groupname]
          );
        }

        await saveHotspotProfileMetadata(conn, {
          groupname,
          displayName: sanitize(name) || groupname,
          comment: sanitize(comment),
          rateLimitValue: normalizedRateValue,
          rateLimitUnit: normalizedRateUnit,
          burstLimitValue: normalizedBurstValue,
          burstLimitUnit: normalizedBurstUnit,
          sessionTimeoutValue: normalizedSessionValue || null,
          sessionTimeoutUnit: normalizedSessionUnit || null,
          idleTimeoutValue: normalizedIdleValue || null,
          idleTimeoutUnit: normalizedIdleUnit || null,
          limitUptimeValue: normalizedLimitUptimeValue || null,
          limitUptimeUnit: normalizedLimitUptimeUnit || null,
          validityValue: normalizedValidityValue || null,
          validityUnit: normalizedValidityUnit || null,
          sharedUsers: sharedUsersValid ? normalizedSharedUsers : null,
          localAddress: sanitize(localAddress),
          remoteAddress: sanitize(remoteAddress),
          dnsServer: sanitize(dnsServer),
          parentQueue: sanitize(parentQueue),
          addressList: sanitize(addressList)
        });

        await conn.end();
        return res.json({ success: true, message: 'Profile hotspot berhasil diupdate di RADIUS' });
      } catch (radiusError) {
        console.error('Error updating hotspot profile in RADIUS:', radiusError);
        return res.json({ success: false, message: `Gagal update profile di RADIUS: ${radiusError.message}` });
      }
    }

    // Untuk mode Mikrotik API, perlu router
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    if (!id) {
      return res.json({ success: false, message: 'ID profile tidak ditemukan' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    // Clean profileData: remove undefined, null values, and unsupported parameters
    // Note: local-address, remote-address, dns-server, parent-queue, address-list
    // are NOT supported for hotspot user profile in Mikrotik
    const cleanProfileData = {};
    const unsupportedParams = ['local-address', 'remote-address', 'dns-server', 'parent-queue', 'address-list', 'limitUptime', 'limitUptimeUnit', 'validity', 'validityUnit'];
    Object.keys(req.body).forEach(key => {
      if (key === 'router_id') return;
      const value = req.body[key];
      // Skip unsupported parameters and null/undefined values
      if (value !== undefined && value !== null && !unsupportedParams.includes(key)) {
        cleanProfileData[key] = value;
      }
    });
    console.log('Cleaned profileData for edit:', cleanProfileData);
    const result = await editHotspotProfile(cleanProfileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile Hotspot
router.post('/mikrotik/hotspot-profiles/delete', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getRadiusConfigValue } = require('../config/radiusConfig');
    let userAuthMode = 'mikrotik';
    try {
      const mode = await getRadiusConfigValue('user_auth_mode', null);
      userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
    } catch (e) {
      // Fallback
    }

    const { id, router_id, name } = req.body;

    // Untuk mode RADIUS, hapus dari RADIUS database
    if (userAuthMode === 'radius') {
      if (!id && !name) {
        return res.json({ success: false, message: 'ID atau nama profile tidak ditemukan' });
      }

      let conn;
      try {
        const { getRadiusConnection } = require('../config/mikrotik');
        conn = await getRadiusConnection();

        const rawIdentifier = id || name;
        const groupname = typeof rawIdentifier === 'string'
          ? rawIdentifier.trim().toLowerCase().replace(/\s+/g, '_')
          : '';

        if (!groupname) {
          return res.json({ success: false, message: 'Nama profile tidak valid' });
        }

        // Hapus semua attributes untuk groupname ini dari radgroupreply & radgroupcheck
        await conn.execute(
          "DELETE FROM radgroupreply WHERE groupname = ?",
          [groupname]
        );
        await conn.execute(
          "DELETE FROM radgroupcheck WHERE groupname = ?",
          [groupname]
        );

        // Bersihkan assignment user yang masih menunjuk ke profile ini
        await conn.execute(
          "DELETE FROM radusergroup WHERE groupname = ?",
          [groupname]
        );

        await deleteHotspotProfileMetadata(conn, groupname);

        return res.json({ success: true, message: 'Profile hotspot berhasil dihapus dari RADIUS' });
      } catch (radiusError) {
        console.error('Error deleting hotspot profile from RADIUS:', radiusError);
        return res.json({ success: false, message: `Gagal hapus profile dari RADIUS: ${radiusError.message}` });
      } finally {
        if (conn) {
          try {
            await conn.end();
          } catch (closeError) {
            logger.warn(`Gagal menutup koneksi RADIUS setelah hapus profile: ${closeError.message}`);
          }
        }
      }
    }

    // Untuk mode Mikrotik API, perlu router
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    if (!id) {
      return res.json({ success: false, message: 'ID profile tidak ditemukan' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    const result = await deleteHotspotProfile(id, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Putuskan sesi PPPoE user
router.post('/mikrotik/disconnect-session', adminAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Username tidak boleh kosong' });
    
    // Check auth mode
    const { getUserAuthModeAsync, disconnectPPPoEUser, getMikrotikConnectionForRouter } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    logger.info(`${authMode} mode: Disconnecting session for user ${username}`);
    
    // Ambil daftar router
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
    db.close();
    
    if (!routers || routers.length === 0) {
      return res.json({ success: false, message: 'Tidak ada router yang dikonfigurasi' });
    }
    
    // Cari router yang memiliki user aktif
    let foundRouter = null;
    let foundActiveSession = false;
    
    for (const router of routers) {
      try {
        const conn = await getMikrotikConnectionForRouter(router);
        const activeSessions = await conn.write('/ppp/active/print', [`?name=${username}`]);
        
        if (activeSessions && activeSessions.length > 0) {
          foundRouter = router;
          foundActiveSession = true;
          logger.info(`Found active session for ${username} on router ${router.name}`);
          break;
        }
      } catch (routerError) {
        logger.warn(`Error checking router ${router.name}: ${routerError.message}`);
        // Continue to next router
      }
    }
    
    // Jika tidak ditemukan user aktif di router manapun, return success dengan message
    if (!foundActiveSession) {
      logger.info(`No active session found for ${username} on any router`);
      return res.json({ 
        success: true, 
        message: `User ${username} tidak sedang online`, 
        disconnected: 0 
      });
    }
    
    // Disconnect menggunakan router yang ditemukan (hanya jika ada session aktif)
    const result = await disconnectPPPoEUser(username, foundRouter);
    return res.json(result);
  } catch (err) {
    logger.error(`Error disconnecting session for ${req.body.username}:`, err);
    res.json({ success: false, message: err.message || 'Gagal memutuskan sesi' });
  }
});

// GET: Get PPPoE user statistics
router.get('/mikrotik/user-stats', adminAuth, async (req, res) => {
  try {
    // Check auth mode
    const { getUserAuthModeAsync, getRadiusStatistics } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      // RADIUS mode: Get statistics from RADIUS database
      logger.info('RADIUS mode: Getting user statistics from RADIUS database');
      try {
        const stats = await getRadiusStatistics();
        return res.json({ 
          success: true, 
          totalUsers: stats.total || 0, 
          activeUsers: stats.active || 0, 
          offlineUsers: stats.offline || 0
        });
      } catch (radiusError) {
        logger.error(`Error getting RADIUS statistics: ${radiusError.message}`);
        return res.json({ 
          success: true, 
          totalUsers: 0, 
          activeUsers: 0, 
          offlineUsers: 0 
        });
      }
    }
    
    // Mikrotik API mode: Get statistics from routers
    logger.info('Mikrotik API mode: Getting user statistics from routers');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
    db.close();
    let totalUsers = 0, activeUsers = 0;
    for (const r of routers) {
      try {
        const conn = await getMikrotikConnectionForRouter(r);
        const [secrets, active] = await Promise.all([
          conn.write('/ppp/secret/print'),
          conn.write('/ppp/active/print')
        ]);
        totalUsers += Array.isArray(secrets) ? secrets.length : 0;
        activeUsers += Array.isArray(active) ? active.length : 0;
      } catch (_) {}
    }
    const offlineUsers = Math.max(totalUsers - activeUsers, 0);
    
    res.json({ 
      success: true, 
      totalUsers, 
      activeUsers, 
      offlineUsers 
    });
  } catch (err) {
    logger.error('Error getting PPPoE user stats:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      totalUsers: 0,
      activeUsers: 0,
      offlineUsers: 0
    });
  }
});

// POST: Restart Mikrotik
router.post('/mikrotik/restart', adminAuth, async (req, res) => {
  try {
    const { restartRouter } = require('../config/mikrotik');
    const result = await restartRouter();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ============================================
// HOTSPOT SERVER PROFILES ROUTES
// ============================================

// GET: List Server Hotspot dan Server Profile Hotspot (Mikrotik API Only)
// Helper function untuk membuat table hotspot_servers jika belum ada
function ensureHotspotServersTable(db) {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS hotspot_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Helper function untuk mendapatkan semua server hotspot dari database
function getHotspotServersFromDB(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM hotspot_servers ORDER BY name', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

router.get('/mikrotik/hotspot-server-profiles', adminAuth, async (req, res) => {
  let db = null;
  try {
    // Check auth mode
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    
    // Pastikan table hotspot_servers ada
    await ensureHotspotServersTable(db);
    
    // Ambil daftar server hotspot dari database
    let hotspotServersDB = [];
    try {
      hotspotServersDB = await getHotspotServersFromDB(db);
    } catch (dbErr) {
      console.error('Error fetching hotspot servers from DB:', dbErr);
      hotspotServersDB = [];
    }
    
    if (authMode === 'radius') {
      // Mode RADIUS: Hanya tampilkan daftar server hotspot dari database (tidak perlu API)
      const settings = getSettingsWithCache();
      if (db) db.close();
      return res.render('admin/mikrotik/hotspot-server-profiles', {
        servers: [],
        profiles: [],
        routers: [],
        hotspotServersDB: hotspotServersDB || [], // Server hotspot dari database
        error: null,
        settings: settings || getSettingsWithCache(),
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge(),
        userAuthMode: 'radius',
        radiusMode: true // Flag untuk view
      });
    }
    
    // Mode Mikrotik API: Ambil routers
    const routers = await new Promise((resolve) => {
      db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
        if (err) {
          console.error('Error fetching routers:', err);
          resolve([]);
        } else {
          resolve(rows || []);
        }
      });
    });

    // Untuk mode Mikrotik API, perlu router
    if (!routers || routers.length === 0) {
      console.warn('No routers found in database');
      const settings = getSettingsWithCache();
      // Ambil server hotspot dari database sebelum menutup db
      let hotspotServersDBFinal = [];
      try {
        hotspotServersDBFinal = await getHotspotServersFromDB(db);
      } catch (dbErr) {
        console.error('Error fetching hotspot servers from DB:', dbErr);
        hotspotServersDBFinal = [];
      }
      if (db) db.close();
      return res.render('admin/mikrotik/hotspot-server-profiles', {
        servers: [],
        profiles: [], 
        routers: [],
        hotspotServersDB: hotspotServersDBFinal || [], // Server hotspot dari database
        error: 'Tidak ada router/NAS yang dikonfigurasi. Silakan tambahkan router terlebih dahulu di menu NAS (RADIUS).', 
        settings: settings || getSettingsWithCache(),
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge(),
        userAuthMode: 'mikrotik',
        radiusMode: false
      });
    }

    // Ambil Server Hotspot dari semua router
    let servers = [];
    let serverErrors = [];
    for (const r of routers) {
      try {
        const result = await getHotspotServers(r);
        if (result.success && Array.isArray(result.data)) {
          servers = servers.concat(result.data.map(server => ({
            ...server,
            nas_id: r.id,
            nas_name: r.name,
            nas_ip: r.nas_ip
          })));
        } else {
          serverErrors.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`Error getting hotspot servers from ${r.name}:`, e.message);
        serverErrors.push(`${r.name}: ${e.message}`);
      }
    }

    // Ambil Server Profile Hotspot dari semua router
    let profiles = [];
    let profileErrors = [];
    for (const r of routers) {
      try {
        const result = await getHotspotServerProfiles(r);
        if (result.success && Array.isArray(result.data)) {
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            profiles.push(profileObj);
          });
        } else {
          // Skip error jika router tidak mendukung fitur ini (bukan error kritis)
          const errorMsg = result.message || 'Unknown error';
          if (errorMsg.includes('tidak mendukung') || errorMsg.includes('tidak kompatibel')) {
            logger.warn(`${r.name}: ${errorMsg} - Fitur Server Profile Hotspot tidak tersedia`);
            // Tidak menambahkan ke errorMessages karena ini bukan error kritis
          } else {
            profileErrors.push(`${r.name}: ${errorMsg}`);
          }
        }
      } catch (e) {
        console.error(`Error getting server profiles from ${r.name}:`, e.message);
        profileErrors.push(`${r.name}: ${e.message}`);
      }
    }

    const allErrors = [...serverErrors, ...profileErrors];
    const settings = getSettingsWithCache();
    
    // Ambil daftar server hotspot dari database untuk mode Mikrotik API juga
    let hotspotServersDBFinal = [];
    try {
      hotspotServersDBFinal = await getHotspotServersFromDB(db);
    } catch (dbErr) {
      console.error('Error fetching hotspot servers from DB (Mikrotik API mode):', dbErr);
      hotspotServersDBFinal = [];
    }
    if (db) db.close();
    
    // Sanitize data untuk memastikan JSON valid (menghilangkan undefined, null, circular references)
    const sanitizedServers = servers.map(server => ({
      id: server.id || server['.id'] || '',
      name: server.name || '',
      interface: server.interface || '',
      profile: server.profile || '',
      addressPool: server.addressPool || server.address || '',
      disabled: server.disabled === true || server.disabled === 'true',
      nas_id: server.nas_id || null,
      nas_name: server.nas_name || '',
      nas_ip: server.nas_ip || ''
    }));
    
    const sanitizedProfiles = profiles.map(prof => ({
      id: prof.id || prof['.id'] || '',
      name: prof.name || '',
      'rate-limit': prof['rate-limit'] || '',
      'session-timeout': prof['session-timeout'] || '',
      'idle-timeout': prof['idle-timeout'] || '',
      'shared-users': prof['shared-users'] || '1',
      'open-status-page': prof['open-status-page'] || 'http-login',
      comment: prof.comment || '',
      nas_id: prof.nas_id || null,
      nas_name: prof.nas_name || '',
      nas_ip: prof.nas_ip || ''
    }));
    
    return res.render('admin/mikrotik/hotspot-server-profiles', {
      servers: sanitizedServers,
      profiles: sanitizedProfiles, 
      routers: routers || [],
      hotspotServersDB: hotspotServersDBFinal || [], // Server hotspot dari database
      settings: settings || getSettingsWithCache(),
      error: allErrors.length > 0 ? `Beberapa router gagal: ${allErrors.join('; ')}` : null,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge(),
      userAuthMode: 'mikrotik',
      radiusMode: false
    });
  } catch (err) {
    console.error('Error in hotspot server/profiles GET route:', err);
    console.error('Error stack:', err.stack);
    
    // Pastikan database ditutup jika masih terbuka
    if (db) {
      try {
        db.close();
      } catch (closeErr) {
        console.error('Error closing database:', closeErr);
      }
    }
    
    const settings = getSettingsWithCache();
    // Check auth mode untuk error handler juga
    let userAuthMode = 'mikrotik';
    let hotspotServersDB = [];
    try {
      const { getUserAuthModeAsync } = require('../config/mikrotik');
      userAuthMode = await getUserAuthModeAsync();
      
      // Coba ambil server hotspot dari database jika memungkinkan
      try {
        const sqlite3 = require('sqlite3').verbose();
        const errorDb = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
        await ensureHotspotServersTable(errorDb);
        hotspotServersDB = await getHotspotServersFromDB(errorDb);
        errorDb.close();
      } catch (dbErr) {
        console.error('Error fetching hotspot servers from DB in error handler:', dbErr);
      }
    } catch (e) {
      console.error('Error in error handler:', e);
    }
    
    try {
      return res.render('admin/mikrotik/hotspot-server-profiles', {
        servers: [],
        profiles: [], 
        routers: [],
        hotspotServersDB: hotspotServersDB || [], // Server hotspot dari database
        error: `Gagal mengambil data: ${err.message}`, 
        settings: settings || getSettingsWithCache(),
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge(),
        userAuthMode: userAuthMode,
        radiusMode: userAuthMode === 'radius'
      });
    } catch (renderErr) {
      console.error('Error rendering error page:', renderErr);
      return res.status(500).send(`Error: ${err.message}<br><pre>${err.stack}</pre>`);
    }
  }
});

// GET: API Daftar Server Profile Hotspot (Mikrotik API Only)
router.get('/mikrotik/hotspot-server-profiles/api', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        profiles: [], 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Profile Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { router_id } = req.query;

    // Untuk mode Mikrotik API, ambil dari Mikrotik router
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      if (!routerObj) {
        return res.json({ success: false, profiles: [], message: 'Router tidak ditemukan' });
      }

      const result = await getHotspotServerProfiles(routerObj);
      if (result.success) {
        const profilesWithRouter = result.data.map(prof => ({
          ...prof,
          nas_id: routerObj.id,
          nas_name: routerObj.name,
          nas_ip: routerObj.nas_ip
        }));
        return res.json({ success: true, profiles: profilesWithRouter });
      } else {
        return res.json({ success: false, profiles: [], message: result.message });
      }
    }

    // Fetch from all routers
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      db.close();
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));

    if (!routers || routers.length === 0) {
      return res.json({ success: false, profiles: [], message: 'Tidak ada router/NAS yang dikonfigurasi' });
    }
    
    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        const result = await getHotspotServerProfiles(r);
        if (result.success && Array.isArray(result.data)) {
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(profileObj);
          });
        } else {
          // Skip error jika router tidak mendukung fitur ini (bukan error kritis)
          const errorMsg = result.message || 'Unknown error';
          if (errorMsg.includes('tidak mendukung') || errorMsg.includes('tidak kompatibel')) {
            logger.warn(`${r.name}: ${errorMsg} - Fitur Server Profile Hotspot tidak tersedia`);
            // Tidak menambahkan ke errorMessages karena ini bukan error kritis
          } else {
            errorMessages.push(`${r.name}: ${errorMsg}`);
          }
        }
      } catch (e) {
        console.error(`Error getting server profiles from ${r.name}:`, e.message);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }

    return res.json({ 
      success: true, 
      profiles: combined,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null
    });
  } catch (err) {
    console.error('Error in server profiles API route:', err);
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// POST: Tambah Server Profile Hotspot (Mikrotik API Only)
router.post('/mikrotik/hotspot-server-profiles/add', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Profile Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const profileData = req.body;
    const { router_id } = req.body;
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await addHotspotServerProfileMikrotik(profileData, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error adding server profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Server Profile Hotspot (Mikrotik API Only)
router.post('/mikrotik/hotspot-server-profiles/edit', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Profile Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { id } = req.body;
    const profileData = req.body;
    const { router_id } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server profile harus diisi' });
    }
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await editHotspotServerProfileMikrotik(id, profileData, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error editing server profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Server Profile Hotspot (Mikrotik API Only)
router.post('/mikrotik/hotspot-server-profiles/delete', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Profile Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { id } = req.body;
    const { router_id } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server profile harus diisi' });
    }
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await deleteHotspotServerProfileMikrotik(id, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error deleting server profile:', err);
    res.json({ success: false, message: err.message });
  }
});

// ============================================
// HOTSPOT SERVER DATABASE ROUTES (Untuk semua mode)
// ============================================

// POST: Tambah Server Hotspot ke Database
router.post('/mikrotik/hotspot-server-profiles/add-server', adminAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.json({ success: false, message: 'Nama server hotspot harus diisi' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    
    // Pastikan table ada
    await ensureHotspotServersTable(db);
    
    // Cek apakah nama sudah ada
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM hotspot_servers WHERE name = ?', [name.trim()], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (existing) {
      db.close();
      return res.json({ success: false, message: 'Nama server hotspot sudah ada' });
    }
    
    // Insert server hotspot baru
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO hotspot_servers (name, description) VALUES (?, ?)',
        [name.trim(), description ? description.trim() : null],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    db.close();
    return res.json({ success: true, message: 'Server hotspot berhasil ditambahkan' });
  } catch (err) {
    console.error('Error adding hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Server Hotspot di Database
router.post('/mikrotik/hotspot-server-profiles/edit-server', adminAuth, async (req, res) => {
  try {
    const { id, name, description } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server hotspot harus diisi' });
    }
    
    if (!name || !name.trim()) {
      return res.json({ success: false, message: 'Nama server hotspot harus diisi' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    
    // Pastikan table ada
    await ensureHotspotServersTable(db);
    
    // Cek apakah server dengan ID ini ada
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM hotspot_servers WHERE id = ?', [parseInt(id)], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!existing) {
      db.close();
      return res.json({ success: false, message: 'Server hotspot tidak ditemukan' });
    }
    
    // Cek apakah nama sudah digunakan oleh server lain
    const nameExists = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM hotspot_servers WHERE name = ? AND id != ?', [name.trim(), parseInt(id)], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (nameExists) {
      db.close();
      return res.json({ success: false, message: 'Nama server hotspot sudah digunakan oleh server lain' });
    }
    
    // Update server hotspot
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE hotspot_servers SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name.trim(), description ? description.trim() : null, parseInt(id)],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    db.close();
    return res.json({ success: true, message: 'Server hotspot berhasil diupdate' });
  } catch (err) {
    console.error('Error editing hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Server Hotspot dari Database
router.post('/mikrotik/hotspot-server-profiles/delete-server', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server hotspot harus diisi' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    
    // Pastikan table ada
    await ensureHotspotServersTable(db);
    
    // Cek apakah server dengan ID ini ada
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM hotspot_servers WHERE id = ?', [parseInt(id)], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!existing) {
      db.close();
      return res.json({ success: false, message: 'Server hotspot tidak ditemukan' });
    }
    
    // Hapus server hotspot
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM hotspot_servers WHERE id = ?', [parseInt(id)], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    db.close();
    return res.json({ success: true, message: 'Server hotspot berhasil dihapus' });
  } catch (err) {
    console.error('Error deleting hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

// ============================================
// HOTSPOT SERVER ROUTES (Mikrotik API Only)
// ============================================

// GET: API Daftar Interfaces untuk Router
router.get('/mikrotik/interfaces/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    if (!router_id) {
      return res.json({ success: false, interfaces: [], message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, interfaces: [], message: 'Router tidak ditemukan' });
    }

    const { getInterfacesForRouter } = require('../config/mikrotik');
    const result = await getInterfacesForRouter(routerObj);
    
    if (result.success) {
      return res.json({ success: true, interfaces: result.data || [] });
    } else {
      return res.json({ success: false, interfaces: [], message: result.message });
    }
  } catch (err) {
    console.error('Error in interfaces API:', err);
    res.json({ success: false, interfaces: [], message: err.message });
  }
});

// GET: API Daftar Address Pools untuk Router
router.get('/mikrotik/address-pools/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    if (!router_id) {
      return res.json({ success: false, pools: [], message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, pools: [], message: 'Router tidak ditemukan' });
    }

    const { getAddressPoolsForRouter } = require('../config/mikrotik');
    const result = await getAddressPoolsForRouter(routerObj);
    
    if (result.success) {
      return res.json({ success: true, pools: result.data || [] });
    } else {
      return res.json({ success: false, pools: [], message: result.message });
    }
  } catch (err) {
    console.error('Error in address pools API:', err);
    res.json({ success: false, pools: [], message: err.message });
  }
});

// GET: API Daftar Server Hotspot
router.get('/mikrotik/hotspot-servers/api', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        servers: [], 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { router_id } = req.query;
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    
    if (router_id) {
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      if (!routerObj) {
        return res.json({ success: false, servers: [], message: 'Router tidak ditemukan' });
      }

      const result = await getHotspotServers(routerObj);
      if (result.success) {
        const serversWithRouter = result.data.map(server => ({
          ...server,
          nas_id: routerObj.id,
          nas_name: routerObj.name,
          nas_ip: routerObj.nas_ip
        }));
        return res.json({ success: true, servers: serversWithRouter });
      } else {
        return res.json({ success: false, servers: [], message: result.message });
      }
    }

    // Ambil dari semua router
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      db.close();
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));
    
    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        const result = await getHotspotServers(r);
        if (result.success && Array.isArray(result.data)) {
          result.data.forEach(server => {
            const serverObj = {
              ...server,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(serverObj);
          });
        } else {
          errorMessages.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`Error getting servers from ${r.name}:`, e.message);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }
    
    res.json({ 
      success: true, 
      servers: combined,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null
    });
  } catch (err) {
    console.error('Error in hotspot servers API:', err);
    res.json({ success: false, servers: [], message: err.message });
  }
});

// POST: Tambah Server Hotspot
router.post('/mikrotik/hotspot-servers/add', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const serverData = req.body;
    const { router_id } = req.body;
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await addHotspotServer(serverData, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error adding hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Server Hotspot
router.post('/mikrotik/hotspot-servers/edit', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { id } = req.body;
    const serverData = req.body;
    const { router_id } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server hotspot harus diisi' });
    }
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await editHotspotServer(id, serverData, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error editing hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Server Hotspot
router.post('/mikrotik/hotspot-servers/delete', adminAuth, async (req, res) => {
  try {
    // Check auth mode - fitur ini hanya untuk mode Mikrotik API
    const { getUserAuthModeAsync } = require('../config/mikrotik');
    const authMode = await getUserAuthModeAsync();
    
    if (authMode === 'radius') {
      return res.json({ 
        success: false, 
        message: 'Fitur ini tidak tersedia di mode RADIUS. Server Hotspot harus dikonfigurasi langsung di Mikrotik router.' 
      });
    }
    
    const { id } = req.body;
    const { router_id } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: 'ID server hotspot harus diisi' });
    }
    
    if (!router_id) {
      return res.json({ success: false, message: 'Router ID harus diisi' });
    }

    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));

    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }

    const result = await deleteHotspotServer(id, routerObj);
    return res.json(result);
  } catch (err) {
    console.error('Error deleting hotspot server:', err);
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
