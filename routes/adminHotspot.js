const express = require('express');
const router = express.Router();
const { addHotspotUser, getActiveHotspotUsers, getHotspotProfiles, getHotspotProfilesRadius, getHotspotServerProfiles, getHotspotServerProfilesRadius, deleteHotspotUser, generateHotspotVouchers, getHotspotServers, disconnectHotspotUser, getMikrotikConnectionForRouter, getHotspotUsersRadius, getUserAuthModeAsync } = require('../config/mikrotik');
const { getMikrotikConnection } = require('../config/mikrotik');
const { getRadiusConfigValue } = require('../config/radiusConfig');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const sqlite3 = require('sqlite3').verbose();

const VOUCHER_PAGE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, contextDescription) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${contextDescription} timed out after ${ms}ms`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function safeCall(promiseFactory, contextDescription, timeoutMs = VOUCHER_PAGE_TIMEOUT_MS) {
    try {
        return await withTimeout(
            Promise.resolve().then(promiseFactory),
            timeoutMs,
            contextDescription
        );
    } catch (error) {
        console.error(`[Voucher Page] ${contextDescription} gagal:`, error.message || error);
        return null;
    }
}

// Helper function untuk mengambil setting voucher online
async function getVoucherOnlineSettings() {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');

    return new Promise((resolve, reject) => {
        // Ensure table exists
        db.run(`
            CREATE TABLE IF NOT EXISTS voucher_online_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT '',
                profile TEXT NOT NULL,
                digits INTEGER NOT NULL DEFAULT 5,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating voucher_online_settings table:', err);
                resolve({});
                return;
            }

            // Insert default settings if table is empty
            db.get('SELECT COUNT(*) as count FROM voucher_online_settings', (err, row) => {
                if (err || row.count === 0) {
                    // Get first available profile from Mikrotik as default
                    const { getHotspotProfiles } = require('../config/mikrotik');
                    getHotspotProfiles().then(profilesResult => {
                        const defaultProfile = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
                            ? profilesResult.data[0].name 
                            : 'default';
                        
                        const defaultSettings = [
                            ['3k', '3rb - 1 Hari', defaultProfile, 5, 1],
                            ['5k', '5rb - 2 Hari', defaultProfile, 5, 1],
                            ['10k', '10rb - 5 Hari', defaultProfile, 5, 1],
                            ['15k', '15rb - 8 Hari', defaultProfile, 5, 1],
                            ['25k', '25rb - 15 Hari', defaultProfile, 5, 1],
                            ['50k', '50rb - 30 Hari', defaultProfile, 5, 1]
                        ];

                        const insertPromises = defaultSettings.map(([packageId, name, profile, digits, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, enabled) VALUES (?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            // Now get all settings
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting default settings:', err);
                            db.close();
                            resolve({});
                        });
                    }).catch((err) => {
                        console.error('Error getting Mikrotik profiles for default settings:', err);
                        // Fallback to hardcoded defaults
                        const fallbackSettings = [
                            ['3k', '3rb - 1 Hari', 'default', 5, 1],
                            ['5k', '5rb - 2 Hari', 'default', 5, 1],
                            ['10k', '10rb - 5 Hari', 'default', 5, 1],
                            ['15k', '15rb - 8 Hari', 'default', 5, 1],
                            ['25k', '25rb - 15 Hari', 'default', 5, 1],
                            ['50k', '50rb - 30 Hari', 'default', 5, 1]
                        ];
                        
                        const insertPromises = fallbackSettings.map(([packageId, name, profile, digits, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, enabled) VALUES (?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting fallback settings:', err);
                            db.close();
                            resolve({});
                        });
                    });
                } else {
                    // Get existing settings
                    db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                        if (err) {
                            console.error('Error getting voucher online settings:', err);
                            resolve({});
                        } else {
                            const settings = {};
                            rows.forEach(row => {
                                settings[row.package_id] = {
                                    name: row.name || `${row.package_id} - Paket`,
                                    profile: row.profile,
                                    digits: row.digits || 5,
                                    enabled: row.enabled === 1
                                };
                            });
                            db.close();
                            resolve(settings);
                        }
                    });
                }
            });
        });
    });
}

function parseDurationToSeconds(value, unit) {
    if (value === undefined || value === null || value === '') return null;
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue <= 0) return null;

    const unitLower = String(unit || '').toLowerCase();
    const unitMap = {
        's': 1,
        'detik': 1,
        'd': 86400,
        'day': 86400,
        'days': 86400,
        'hari': 86400,
        'h': 3600,
        'jam': 3600,
        'hour': 3600,
        'hours': 3600,
        'm': 60,
        'men': 60,
        'menit': 60,
        'minute': 60,
        'minutes': 60,
        'w': 604800,
        'week': 604800,
        'weeks': 604800
    };

    const multiplier = unitMap[unitLower] || 1;
    return numValue * multiplier;
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return null;
    const units = [
        { label: 'hari', value: 86400 },
        { label: 'jam', value: 3600 },
        { label: 'menit', value: 60 },
        { label: 'detik', value: 1 }
    ];
    let remaining = seconds;
    const parts = [];
    for (const unit of units) {
        if (remaining >= unit.value) {
            const count = Math.floor(remaining / unit.value);
            remaining %= unit.value;
            parts.push(`${count} ${unit.label}`);
        }
        if (parts.length >= 2) break; // tampilkan maksimal dua unit
    }
    return parts.length > 0 ? parts.join(' ') : `${seconds} detik`;
}

function buildHotspotUserStatus(allUsers = [], activeUsers = [], defaultServerName = null) {
    const activeMap = new Map((activeUsers || []).map(user => {
        const key = (user.user || user.name || user.username || '').toString().trim();
        return [key, user];
    }));
    const now = Date.now();

    return (allUsers || []).map(user => {
        const username = (user.name || user.username || '').toString().trim();
        const activeInfo = activeMap.get(username);
        const isOnline = Boolean(activeInfo);

        const chosenServerName = (user.server_metadata && user.server_metadata.name)
            || user.server_name
            || user.server_hotspot
            || user.server_identifier
            || defaultServerName
            || (user.comment && user.comment.toLowerCase() === 'voucher' ? null : user.comment)
            || null;

        const parsePositiveNumber = (value) => {
            if (value === undefined || value === null) return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        };

        const totalSessionSeconds = Number(user.total_session_seconds ?? user.total_session ?? 0) || 0;
        let limitSeconds = parsePositiveNumber(user.limit_seconds ?? user.max_all_session);
        let validitySeconds = parsePositiveNumber(user.validity_seconds ?? user.expire_after);
        const firstLogin = user.first_login ? new Date(user.first_login) : null;

        let validityRemainingSeconds = null;
        if (validitySeconds) {
            if (firstLogin) {
                validityRemainingSeconds = Math.floor((firstLogin.getTime() + validitySeconds * 1000 - now) / 1000);
            } else {
                validityRemainingSeconds = validitySeconds;
            }
        }

        let uptimeRemainingSeconds = limitSeconds !== null ? limitSeconds - totalSessionSeconds : null;

        const expiredByValidity = firstLogin && validityRemainingSeconds !== null && validityRemainingSeconds <= 0;
        const expiredByUptime = limitSeconds !== null && uptimeRemainingSeconds !== null && uptimeRemainingSeconds <= 0;

        let statusVoucher = 'Offline';
        if (expiredByValidity || expiredByUptime) {
            statusVoucher = 'Expired';
        } else if (isOnline) {
            statusVoucher = 'Online';
        } else if ((validitySeconds && (!firstLogin || validityRemainingSeconds > 0)) || (limitSeconds !== null && totalSessionSeconds < limitSeconds)) {
            statusVoucher = 'Stand by';
        } else {
            statusVoucher = 'Offline';
        }

        let validityLabel = '-';
        if (validitySeconds) {
            const limitLabel = formatDuration(validitySeconds) || `${validitySeconds} detik`;
            if (!firstLogin) {
                validityLabel = `Belum digunakan (${limitLabel})`;
            } else if (validityRemainingSeconds !== null && validityRemainingSeconds <= 0) {
                validityLabel = `Expired (${limitLabel})`;
            } else if (validityRemainingSeconds !== null) {
                const positiveRemaining = Math.max(0, validityRemainingSeconds);
                const remainingLabel = formatDuration(positiveRemaining) || `${positiveRemaining} detik`;
                validityLabel = `Sisa ${remainingLabel} dari ${limitLabel}`;
            } else {
                validityLabel = limitLabel;
            }
        }

        let uptimeLabel = '-';
        if (limitSeconds !== null) {
            const usedLabel = formatSecondsToHHMMSS(totalSessionSeconds);
            const limitLabel = formatSecondsToHHMMSS(limitSeconds);
            uptimeLabel = `${usedLabel} / ${limitLabel}`;
        } else if (totalSessionSeconds > 0) {
            uptimeLabel = formatSecondsToHHMMSS(totalSessionSeconds);
        } else {
            uptimeLabel = '00:00:00';
        }

        const lastUpdate = user.last_update || user.last_logout || user.last_login || null;
        const startTime = user.start_time || user.first_login || user.last_login || null;
        const routerNas = user.active_router || user.nas_name || (user.router_ip ? `NAS ${user.router_ip}` : null);
        const serverHotspot = chosenServerName
            || user.server_hotspot
            || user.server_identifier
            || user.active_server
            || user.comment
            || null;

        const ipAddress = (activeInfo && (activeInfo.address || activeInfo['framed-address'] || activeInfo['ip-address'] || activeInfo['remote-address']))
            || user.ip_address
            || user.last_ip
            || '-';

        return {
            ...user,
            total_session_seconds: totalSessionSeconds,
            limit_seconds: limitSeconds,
            validity_seconds: validitySeconds,
            status_voucher: statusVoucher,
            validity_label: validityLabel,
            validity_seconds_remaining: validityRemainingSeconds,
            uptime_label: uptimeLabel,
            uptime_seconds_remaining: uptimeRemainingSeconds,
            ip_address: ipAddress,
            total_upload_mb: user.total_upload_mb || 0,
            total_download_mb: user.total_download_mb || 0,
            last_update: lastUpdate,
            start_time: startTime,
            router_nas: routerNas,
            server_hotspot: serverHotspot
        };
    });
}

async function loadHotspotPageData() {
    let userAuthMode = 'mikrotik';
    try {
        const mode = await getRadiusConfigValue('user_auth_mode', null);
        if (mode !== null && mode !== undefined) {
            userAuthMode = mode;
        }
    } catch (error) {
        // fallback to mikrotik
    }

    const db = new sqlite3.Database('./data/billing.db');
    const routers = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
    db.close();

    const settings = getSettingsWithCache();
    const company_header = settings.company_header || 'Voucher Hotspot';
    const adminKontak = settings['admins.0'] || '-';

    const data = {
        userAuthMode,
        routers,
        settings,
        company_header,
        adminKontak
    };

    if (userAuthMode === 'radius') {
        try {
            const activeResult = await getActiveHotspotUsers();
            let activeUsersList = [];

            if (routers && routers.length > 0) {
                for (const router of routers) {
                    let conn = null;
                    try {
                        conn = await getMikrotikConnectionForRouter(router);
                        if (!conn) continue;
                        const activeUsers = await conn.write('/ip/hotspot/active/print');
                        if (Array.isArray(activeUsers) && activeUsers.length > 0) {
                            activeUsers.forEach(active => {
                                const username = active.user || active.name || active.username;
                                if (!username) return;
                                activeUsersList.push({
                                    ...active,
                                    user: username,
                                    name: username,
                                    nas_name: router.name,
                                    nas_ip: router.nas_ip
                                });
                            });
                        }
                    } catch (routerErr) {
                        console.error(`Error fetching active hotspot users from router ${router.name}:`, routerErr.message);
                    } finally {
                        if (conn && typeof conn.close === 'function') {
                            try { await conn.close(); } catch (closeErr) { /* ignore */ }
                        }
                    }
                }
            }

            if ((!activeUsersList || activeUsersList.length === 0) && activeResult.success && Array.isArray(activeResult.data)) {
                activeUsersList = activeResult.data.map(user => {
                    const username = user.user || user.name || user.username;
                    return {
                        ...user,
                        user: username,
                        name: username,
                        nas_name: user.nas_name || 'RADIUS',
                        nas_ip: user.nas_ip || 'RADIUS'
                    };
                });
            }

            let profiles = [];
            try {
                const hotspotProfilesResult = await getHotspotProfilesRadius();
                if (hotspotProfilesResult.success && Array.isArray(hotspotProfilesResult.data)) {
                    profiles = hotspotProfilesResult.data.map(profile => ({
                        ...profile,
                        nas_id: null,
                        nas_name: 'RADIUS',
                        nas_ip: 'RADIUS'
                    }));
                }
            } catch (profileErr) {
                console.error('Error fetching hotspot profiles from RADIUS:', profileErr.message);
            }

            const allUsersResult = await getHotspotUsersRadius();
            const allUsers = allUsersResult.success && Array.isArray(allUsersResult.data)
                ? allUsersResult.data
                : [];

            const serverHotspot = typeof data.serverHotspot === 'string' ? data.serverHotspot.trim() : null;
            const enrichedUsers = buildHotspotUserStatus(allUsers, activeUsersList, serverHotspot);

            data.users = activeUsersList;
            data.profiles = profiles;
            data.allUsers = enrichedUsers;
            data.voucherOnlineSettings = await getVoucherOnlineSettings();
            data.routers = [];
        } catch (error) {
            throw error;
        }
    } else {
        const activeUsersList = [];
        for (const router of routers) {
            try {
                const result = await getActiveHotspotUsers(router);
                if (result.success && Array.isArray(result.data)) {
                    result.data.forEach(user => {
                        activeUsersList.push({
                            ...user,
                            nas_name: router.name,
                            nas_ip: router.nas_ip
                        });
                    });
                }
            } catch (e) {
                console.error(`Error getting active users from ${router.name}:`, e.message);
            }
        }

        let profiles = [];
        const profileResults = await Promise.all(
            routers.map(router =>
                safeCall(
                    () => getHotspotProfiles(router),
                    `Mengambil hotspot profile dari ${router.name}`
                ).then(result => ({ router, result }))
            )
        );
        profileResults.forEach(({ router, result }) => {
            if (!result || !result.success || !Array.isArray(result.data)) return;
            result.data.forEach(prof => {
                const existing = profiles.find(p => p.name === prof.name && p.nas_id === router.id);
                if (!existing) {
                    profiles.push({
                        ...prof,
                        nas_id: router.id,
                        nas_name: router.name,
                        nas_ip: router.nas_ip
                    });
                }
            });
        });

        let allUsers = [];
        for (const router of routers) {
            try {
                const conn = await getMikrotikConnectionForRouter(router);
                const users = await conn.write('/ip/hotspot/user/print');
                allUsers = allUsers.concat(users.map(u => ({
                    name: u.name || '',
                    password: u.password || '',
                    profile: u.profile || '',
                    created_at: u['last-logged-in'] || u['last-logged-out'] || u['last-seen'] || null,
                    nas_id: router.id,
                    nas_name: router.name,
                    nas_ip: router.nas_ip
                })));
            } catch (e) {
                console.error(`Error getting users from ${router.name}:`, e.message);
            }
        }

        const serverHotspot = typeof data.serverHotspot === 'string' ? data.serverHotspot.trim() : null;
        const enrichedUsers = buildHotspotUserStatus(allUsers, activeUsersList, serverHotspot);

        data.users = activeUsersList;
        data.profiles = profiles;
        data.allUsers = enrichedUsers;
        data.voucherOnlineSettings = await getVoucherOnlineSettings();
        data.routers = routers;
    }

    return data;
}

// GET: Tampilkan form tambah user hotspot dan daftar user hotspot
router.get('/', async (req, res) => {
    try {
        const data = await loadHotspotPageData();
        res.render('adminHotspot', {
            users: data.users || [],
            profiles: data.profiles || [],
            allUsers: data.allUsers || [],
            routers: data.routers || [],
            voucherOnlineSettings: data.voucherOnlineSettings || {},
            success: req.query.success,
            error: req.query.error,
            company_header: data.company_header,
            adminKontak: data.adminKontak,
            settings: data.settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: data.userAuthMode,
            page: 'hotspot-master'
        });
    } catch (error) {
        console.error('Error in hotspot GET route:', error);
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['admins.0'] || '-';
        res.render('adminHotspot', {
            users: [],
            profiles: [],
            allUsers: [],
            routers: [],
            voucherOnlineSettings: {},
            success: null,
            error: 'Gagal mengambil data user hotspot: ' + error.message,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: 'mikrotik',
            page: 'hotspot-master'
        });
    }
});

router.get('/users', async (req, res) => {
    try {
        const data = await loadHotspotPageData();
        res.render('adminHotspotUsers', {
            users: data.users || [],
            profiles: data.profiles || [],
            allUsers: data.allUsers || [],
            routers: data.routers || [],
            success: req.query.success,
            error: req.query.error,
            company_header: data.company_header,
            adminKontak: data.adminKontak,
            settings: data.settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: data.userAuthMode,
            page: 'hotspot-users'
        });
    } catch (error) {
        console.error('Error rendering hotspot users page:', error);
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['admins.0'] || '-';
        res.render('adminHotspotUsers', {
            users: [],
            profiles: [],
            allUsers: [],
            routers: [],
            success: null,
            error: 'Gagal memuat daftar user hotspot: ' + error.message,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: 'mikrotik',
            page: 'hotspot-users'
        });
    }
});

// POST: Hapus user hotspot
router.post('/delete', async (req, res) => {
    const { username, router_id } = req.body;
    try {
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
        }
        await deleteHotspotUser(username, routerObj);
        res.redirect('/admin/hotspot/users?success=User+Hotspot+berhasil+dihapus');
    } catch (error) {
        res.redirect('/admin/hotspot/users?error=Gagal+hapus+user:+' + encodeURIComponent(error.message));
    }
});

// POST: Hapus beberapa voucher sekaligus
router.post('/delete-selected', async (req, res) => {
    const vouchers = Array.isArray(req.body.vouchers) ? req.body.vouchers : [];
    if (!vouchers.length) {
        return res.status(400).json({ success: false, message: 'Tidak ada voucher yang dipilih.' });
    }

    const db = new sqlite3.Database('./data/billing.db');
    const routerCache = new Map();
    const getRouterById = async (id) => {
        if (!id) return null;
        const numericId = parseInt(id, 10);
        if (Number.isNaN(numericId)) return null;
        if (routerCache.has(numericId)) {
            return routerCache.get(numericId);
        }
        return await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [numericId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    routerCache.set(numericId, row || null);
                    resolve(row || null);
                }
            });
        });
    };

    const failures = [];
    let deletedCount = 0;

    try {
        for (const item of vouchers) {
            const username = (item && item.username ? item.username : '').trim();
            if (!username) {
                continue;
            }
            try {
                const routerObj = await getRouterById(item.router_id);
                await deleteHotspotUser(username, routerObj);
                deletedCount += 1;
            } catch (err) {
                failures.push({ username, message: err.message });
            }
        }
    } catch (outerErr) {
        failures.push({ username: '-', message: outerErr.message });
    } finally {
        db.close();
    }

    if (failures.length && deletedCount === 0) {
        return res.status(500).json({ success: false, message: 'Gagal menghapus voucher.', details: failures });
    }

    const baseMessage = `Berhasil menghapus ${deletedCount} voucher.`;
    if (failures.length) {
        return res.status(207).json({ success: true, message: baseMessage + ` ${failures.length} voucher gagal dihapus.`, details: failures });
    }

    return res.json({ success: true, message: baseMessage });
});

// POST: Proses penambahan user hotspot
router.post('/', async (req, res) => {
    const { username, password, profile, router_id, server_hotspot } = req.body;
    try {
        // Check auth mode
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        // Untuk mode RADIUS, router_id tidak diperlukan
        if (userAuthMode === 'radius') {
            // Mode RADIUS: Gunakan server_hotspot jika ada
            const server = server_hotspot && server_hotspot.trim() !== '' ? server_hotspot.trim() : null;
            const serverMetadata = server ? { name: server } : null;
            await addHotspotUser(username, password, profile, null, null, null, null, server, serverMetadata);
            return res.redirect('/admin/hotspot/users?success=User+Hotspot+berhasil+ditambahkan');
        }

        // Untuk mode Mikrotik API, router_id diperlukan
        if (!router_id) {
            return res.redirect('/admin/hotspot/users?error=Pilih+NAS+(router)+terlebih+dahulu');
        }
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });
        if (!routerObj) {
            return res.redirect('/admin/hotspot/users?error=Router+tidak+ditemukan');
        }
        await addHotspotUser(username, password, profile, null, null, routerObj);
        // Redirect agar tidak double submit, tampilkan pesan sukses
        res.redirect('/admin/hotspot/users?success=User+Hotspot+berhasil+ditambahkan');
    } catch (error) {
        res.redirect('/admin/hotspot/users?error=Gagal+menambah+user:+"'+encodeURIComponent(error.message)+'"');
    }
});

// POST: Edit user hotspot
router.post('/edit', async (req, res) => {
    const { username, password, profile, router_id, originalUsername, server_hotspot } = req.body;
    try {
        // Check auth mode
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        // Untuk mode RADIUS, router_id tidak diperlukan
        if (userAuthMode === 'radius') {
            const { deleteHotspotUser, addHotspotUser } = require('../config/mikrotik');
            // Mode RADIUS: Gunakan server_hotspot jika ada
            const server = server_hotspot && server_hotspot.trim() !== '' ? server_hotspot.trim() : null;
            const serverMetadata = server ? { name: server } : null;
            await deleteHotspotUser(originalUsername || username, null);
            await addHotspotUser(username, password, profile, null, null, null, null, server, serverMetadata);
            return res.redirect('/admin/hotspot/users?success=User+Hotspot+berhasil+diupdate');
        }

        // Untuk mode Mikrotik API, router_id diperlukan
        if (!router_id) {
            return res.redirect('/admin/hotspot/users?error=Pilih+NAS+(router)+terlebih+dahulu');
        }
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });
        if (!routerObj) {
            return res.redirect('/admin/hotspot/users?error=Router+tidak+ditemukan');
        }
        // Delete old user and add new one (Mikrotik doesn't have direct edit for hotspot user)
        const { deleteHotspotUser, addHotspotUser } = require('../config/mikrotik');
        await deleteHotspotUser(originalUsername || username, routerObj);
        await addHotspotUser(username, password, profile, null, null, routerObj);
        res.redirect('/admin/hotspot/users?success=User+Hotspot+berhasil+diupdate');
    } catch (error) {
        res.redirect('/admin/hotspot/users?error=Gagal+update+user:+' + encodeURIComponent(error.message));
    }
});

// POST: Generate user hotspot voucher
router.post('/generate', async (req, res) => {
    const jumlah = parseInt(req.body.jumlah) || 10;
    const profile = req.body.profile || 'default';
    const panjangPassword = parseInt(req.body.panjangPassword) || 6;
    const generated = [];

    // Ambil nama hotspot dan nomor admin dari settings.json
    const settings = getSettingsWithCache();
    const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
    const adminKontak = settings['admins.0'] || '-';

    // Fungsi pembuat string random
    function randomString(length) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let str = '';
        for (let i = 0; i < length; i++) {
            str += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return str;
    }

    // Generate user dan tambahkan ke Mikrotik
    const { addHotspotUser } = require('../config/mikrotik');
    for (let i = 0; i < jumlah; i++) {
        const username = randomString(6) + randomString(2); // 8 karakter unik
        const password = randomString(panjangPassword);
        try {
            await addHotspotUser(username, password, profile);
            generated.push({ username, password, profile });
        } catch (e) {
            // Lewati user gagal
        }
    }

    // Render voucher dalam grid 4 baris per A4
    res.render('voucherHotspot', {
        vouchers: generated,
        namaHotspot,
        adminKontak,
        profile,
    });
});

// POST: Generate user hotspot vouchers (JSON response)
router.post('/generate-vouchers', async (req, res) => {
    const { quantity, length, profile, type, charType, router_id, price, voucherModel } = req.body;

    try {
        // Fetch router object if router_id is provided
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
            if (!routerObj) {
                return res.status(400).json({
                    success: false,
                    message: 'Router/NAS tidak ditemukan'
                });
            }
        }
        
        // Gunakan fungsi generateHotspotVouchers dengan parameter yang benar
        const count = parseInt(quantity) || parseInt(req.body.count) || 5;
        const prefix = req.body.prefix || 'wifi-'; // Default prefix
        // MODE HYBRID: Ambil Server Hotspot dari form (field "server")
        // Server Profile tetap bisa digunakan untuk konfigurasi, tapi Server Hotspot adalah yang utama
        let server = req.body.server || req.body.serverProfile || 'all';
        // Jika server kosong atau 'all', gunakan 'all'
        if (!server || server.trim() === '' || server === 'all') {
            server = 'all';
        }

        const serverMetadata = {
            name: server,
            nasId: req.body.serverNasId ? parseInt(req.body.serverNasId, 10) : null,
            nasName: req.body.serverNasName || '',
            nasIp: req.body.serverNasIp || '',
            nasIdentifier: req.body.serverNasIdentifier || '',
            interface: req.body.serverInterface || ''
        };

        // Jika router belum ditentukan tapi metadata menyediakan nasId, ambil dari database
        if (!routerObj && serverMetadata.nasId) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [serverMetadata.nasId], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
            if (routerObj) {
                if (!serverMetadata.nasName) serverMetadata.nasName = routerObj.name || '';
                if (!serverMetadata.nasIp) serverMetadata.nasIp = routerObj.nas_ip || '';
                if (!serverMetadata.nasIdentifier) serverMetadata.nasIdentifier = routerObj.nas_identifier || '';
            }
        }

        // Pastikan metadata memiliki identifier utama bila routerObj tersedia
        if (routerObj) {
            if (!serverMetadata.nasIdentifier) serverMetadata.nasIdentifier = routerObj.nas_identifier || '';
            if (!serverMetadata.nasIp) serverMetadata.nasIp = routerObj.nas_ip || '';
            if (!serverMetadata.nasName) serverMetadata.nasName = routerObj.name || '';
        }
 
        const voucherPrice = price || req.body.price || '';
        const charTypeValue = charType || req.body.charType || 'alphanumeric';

        const validitySeconds = parseDurationToSeconds(req.body.validityValue, req.body.validityUnit);
        const uptimeSeconds = parseDurationToSeconds(req.body.uptimeValue, req.body.uptimeUnit);
        const limits = { validitySeconds, uptimeSeconds };
        
        logger.info(`Generating vouchers with server hotspot: ${server} (from server: ${req.body.server || 'not provided'}, serverProfile: ${req.body.serverProfile || 'not provided'})`);
        
        const result = await generateHotspotVouchers(count, prefix, profile, serverMetadata, limits, voucherPrice, charTypeValue, routerObj);
        
        if (result.success) {
            res.json({ 
                success: true, 
                vouchers: result.vouchers,
                router: routerObj ? { name: routerObj.name, ip: routerObj.nas_ip } : null,
                validitySeconds,
                uptimeSeconds,
                validityText: formatDuration(validitySeconds),
                uptimeText: formatDuration(uptimeSeconds)
            });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error in generate-vouchers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users count for statistics
router.get('/active-users', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            // Hitung jumlah user yang aktif dari data array
            const activeCount = Array.isArray(result.data) ? result.data.length : 0;
            res.json({ success: true, activeUsers: activeCount, activeUsersList: result.data });
        } else {
            console.error('Failed to get active hotspot users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users detail for table
router.get('/active-users-detail', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            res.json({ success: true, activeUsers: result.data });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users detail:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST: Disconnect hotspot user
router.post('/disconnect-user', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username diperlukan' });
    }
    
    try {
        const result = await disconnectHotspotUser(username);
        if (result.success) {
            res.json({ success: true, message: `User ${username} berhasil diputus` });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error disconnecting hotspot user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Ambil data user hotspot aktif untuk AJAX
router.get('/active-users', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            // Log data untuk debugging
            console.log('Active users data:', JSON.stringify(result.data).substring(0, 200) + '...');
            res.json({ success: true, activeUsersList: result.data });
        } else {
            console.error('Failed to get active users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Tampilkan halaman voucher hotspot
router.get('/voucher', async (req, res) => {
    try {
        // Check auth mode - RADIUS atau Mikrotik API
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        // Fetch routers from database
        const db = new sqlite3.Database('./data/billing.db');
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Untuk mode RADIUS, ambil dari RADIUS database
        if (userAuthMode === 'radius') {
            try {
                // Get HOTSPOT profiles from RADIUS (hanya Hotspot Profiles, bukan PPPoE)
                // Fungsi getHotspotProfilesRadius() sudah memfilter hanya profil yang memiliki Session-Timeout
                // atau profil yang digunakan oleh voucher users
                const hotspotProfilesResult = await getHotspotProfilesRadius();
                
                let profiles = [];
                if (hotspotProfilesResult.success && Array.isArray(hotspotProfilesResult.data)) {
                    profiles = hotspotProfilesResult.data.map(prof => ({
                        name: prof.name || prof.groupname || '',
                        'rate-limit': prof['rate-limit'] || '',
                        'session-timeout': prof['session-timeout'] || '',
                        'idle-timeout': prof['idle-timeout'] || '',
                        nas_id: null,
                        nas_name: 'RADIUS',
                        nas_ip: 'RADIUS'
                    }));
                }

                // Get Server Profiles from RADIUS
                const serverProfilesResult = await getHotspotServerProfilesRadius();
                let serverProfiles = [];
                if (serverProfilesResult.success && Array.isArray(serverProfilesResult.data)) {
                    serverProfiles = serverProfilesResult.data.map(prof => ({
                        name: prof.name || '',
                        nas_id: null,
                        nas_name: 'RADIUS',
                        nas_ip: 'RADIUS'
                    }));
                }

                // Ambil Server Hotspot dari Database (prioritas utama)
                // Pastikan table hotspot_servers ada
                await new Promise((resolve, reject) => {
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
                
                // Ambil server hotspot dari database
                const hotspotServersDB = await new Promise((resolve, reject) => {
                    db.all('SELECT * FROM hotspot_servers ORDER BY name', [], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });
                
                // Konversi ke format yang sama dengan servers dari API
                let servers = hotspotServersDB.map(server => ({
                    name: server.name,
                    nas_id: null,
                    nas_name: 'Database',
                    nas_ip: 'Database',
                    description: server.description || ''
                }));

                // Get active users untuk check status
                const activeResult = await getActiveHotspotUsers();
                const activeUsernames = activeResult.success && Array.isArray(activeResult.data)
                    ? activeResult.data.map(u => u.user || u.name || '').filter(Boolean)
                    : [];

                // Get all hotspot users from RADIUS (filter voucher)
                const allUsersResult = await getHotspotUsersRadius();
                const allUsers = allUsersResult.success && Array.isArray(allUsersResult.data)
                    ? allUsersResult.data
                    : [];

                // Query SEMUA invoice voucher terlebih dahulu (tidak perlu filter by username)
                const invoiceDates = await new Promise((resolve, reject) => {
                    const query = `
                        SELECT notes, created_at 
                        FROM invoices 
                        WHERE invoice_type = 'voucher' 
                        AND notes LIKE 'Voucher Hotspot %'
                    `;
                    
                    db.all(query, [], (err, rows) => {
                        if (err) {
                            console.error('Error fetching invoice dates:', err);
                            resolve({});
                        } else {
                            const dateMap = {};
                            rows.forEach(row => {
                                // Extract username from notes: "Voucher Hotspot {username} - Profile: {profile}"
                                const match = row.notes.match(/Voucher Hotspot\s+(\S+)/i);
                                if (match && match[1]) {
                                    dateMap[match[1]] = row.created_at;
                                    console.log(`Found invoice date for ${match[1]}: ${row.created_at}`);
                                }
                            });
                            console.log(`Invoice dates map:`, Object.keys(dateMap).length, 'vouchers have invoices');
                            resolve(dateMap);
                        }
                    });
                });

                // Filter voucher: ambil SEMUA user yang punya invoice, atau semua yang cocok dengan pattern voucher umum
                // Pattern voucher umum: prefix seperti wifi-, eee, fff, ggg, dll, atau comment = 'voucher'
                const voucherHistory = allUsers
                    .filter(user => {
                        if (!user.name) return false;
                        // Jika punya invoice, SELALU tampilkan
                        if (invoiceDates[user.name]) return true;
                        // Jika cocok dengan pattern voucher umum, tampilkan juga
                        const isVoucherPattern = 
                            user.name.startsWith('wifi-') || 
                            user.name.startsWith('eee') || 
                            user.name.startsWith('fff') || 
                            user.name.startsWith('ggg') ||
                            user.name.startsWith('aaa') ||
                            user.name.startsWith('bbb') ||
                            user.name.startsWith('ccc') ||
                            user.name.startsWith('ddd') ||
                            user.name.startsWith('hhh') ||
                            user.name.startsWith('iii') ||
                            user.name.startsWith('jjj') ||
                            user.name.startsWith('kkk') ||
                            user.name.startsWith('lll') ||
                            user.name.startsWith('mmm') ||
                            user.name.startsWith('nnn') ||
                            user.name.startsWith('ooo') ||
                            user.name.startsWith('ppp') ||
                            user.name.startsWith('qqq') ||
                            user.name.startsWith('rrr') ||
                            user.name.startsWith('sss') ||
                            user.name.startsWith('ttt') ||
                            user.name.startsWith('uuu') ||
                            user.name.startsWith('vvv') ||
                            user.name.startsWith('www') ||
                            user.name.startsWith('xxx') ||
                            user.name.startsWith('yyy') ||
                            user.name.startsWith('zzz') ||
                            user.comment === 'voucher';
                        return isVoucherPattern;
                    })
                    .map(user => {
                        // Ambil created_at dari invoice jika ada, jika tidak gunakan metadata voucher
                        const invoiceDate = invoiceDates[user.name] || null;
                        const voucherCreatedAt = user.created_at || user.createdAt || null;
                        const passwordValue = user.password || user.passwordValue || user.name || '';

                        return {
                            username: user.name || '',
                            password: passwordValue,
                            profile: user.profile || 'default',
                            server: 'all',
                            createdAt: invoiceDate || voucherCreatedAt || null,
                            active: activeUsernames.includes(user.name),
                            comment: user.comment || '',
                            nas_id: null,
                            nas_name: 'RADIUS',
                            nas_ip: 'RADIUS'
                        };
                    });

                const settings = getSettingsWithCache();
                const company_header = settings.company_header || 'Voucher Hotspot';
                const adminKontak = settings['footer_info'] || '-';
                db.close();

                return res.render('adminVoucher', {
                    profiles,
                    serverProfiles: serverProfiles,
                    servers: servers, // Server Hotspot dari Mikrotik API (mode hybrid)
                    voucherHistory,
                    routers: routers, // Pass routers untuk dropdown NAS selection jika diperlukan
                    success: req.query.success,
                    error: req.query.error,
                    company_header,
                    adminKontak,
                    settings,
                    versionInfo: getVersionInfo(),
                    versionBadge: getVersionBadge(),
                    userAuthMode: 'radius',
                    page: 'hotspot-settings'
                });
            } catch (radiusError) {
                console.error('Error fetching voucher data from RADIUS:', radiusError);
                const settings = getSettingsWithCache();
                const company_header = settings.company_header || 'Voucher Hotspot';
                const adminKontak = settings['footer_info'] || '-';
                db.close();
                return res.render('adminVoucher', {
                    profiles: [],
                    serverProfiles: [],
                    servers: [],
                    voucherHistory: [],
                    routers: [],
                    success: null,
                    error: `Gagal mengambil data dari RADIUS: ${radiusError.message}`,
                    company_header,
                    adminKontak,
                    settings,
                    versionInfo: getVersionInfo(),
                    versionBadge: getVersionBadge(),
                    userAuthMode: 'radius',
                    page: 'hotspot-settings'
                });
            }
        }

        // Untuk mode Mikrotik API, ambil dari semua router
        // Aggregate profiles from all NAS
        let profiles = [];
        for (const router of routers) {
            try {
                const profilesResult = await getHotspotProfiles(router);
                if (profilesResult.success && Array.isArray(profilesResult.data)) {
                    profilesResult.data.forEach(prof => {
                        const existing = profiles.find(p => p.name === prof.name && p.nas_id === router.id);
                        if (!existing) {
                            profiles.push({
                                ...prof,
                                nas_id: router.id,
                                nas_name: router.name,
                                nas_ip: router.nas_ip
                            });
                        }
                    });
                }
            } catch (e) {
                console.error(`Error getting profiles from ${router.name}:`, e.message);
            }
        }
        
        // Aggregate server profiles from all NAS
        let serverProfiles = [];
        const serverProfileResults = await Promise.all(
            routers.map(router =>
                safeCall(
                    () => getHotspotServerProfiles(router),
                    `Mengambil hotspot server profile dari ${router.name}`
                ).then(result => ({ router, result }))
            )
        );
        serverProfileResults.forEach(({ router, result }) => {
            if (!result || !result.success || !Array.isArray(result.data)) return;
            result.data.forEach(prof => {
                const existing = serverProfiles.find(p => p.name === prof.name && p.nas_id === router.id);
                if (!existing) {
                    serverProfiles.push({
                        ...prof,
                        nas_id: router.id,
                        nas_name: router.name,
                        nas_ip: router.nas_ip
                    });
                }
            });
        });
        
        // Ambil Server Hotspot dari Database (prioritas utama)
        // Pastikan table hotspot_servers ada
        await new Promise((resolve, reject) => {
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
        
        // Ambil server hotspot dari database
        const hotspotServersDB = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM hotspot_servers ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Konversi ke format yang sama dengan servers dari API
        let servers = hotspotServersDB.map(server => ({
            name: server.name,
            nas_id: null,
            nas_name: 'Database',
            nas_ip: 'Database',
            description: server.description || ''
        }));
        
        // Aggregate all hotspot users from all NAS for voucher history
        let allUsers = [];
        const activeUsernames = [];
        
        const routerSnapshots = await Promise.all(
            routers.map(async router => {
                const conn = await safeCall(
                    () => getMikrotikConnectionForRouter(router),
                    `Membuka koneksi ke ${router.name}`
                );
                if (!conn) {
                    return { router, users: [], active: [] };
                }
                const [usersRaw, activeRaw] = await Promise.all([
                    safeCall(() => conn.write('/ip/hotspot/user/print'), `Mengambil data user hotspot dari ${router.name}`),
                    safeCall(() => conn.write('/ip/hotspot/active/print'), `Mengambil data user aktif hotspot dari ${router.name}`)
                ]);
                try {
                    if (typeof conn.close === 'function') {
                        await conn.close();
                    } else if (typeof conn.disconnect === 'function') {
                        await conn.disconnect();
                    }
                } catch (closeErr) {
                    console.warn(`Gagal menutup koneksi Mikrotik ${router.name}:`, closeErr.message || closeErr);
                }
                return {
                    router,
                    users: Array.isArray(usersRaw) ? usersRaw : [],
                    active: Array.isArray(activeRaw) ? activeRaw : []
                };
            })
        );

        routerSnapshots.forEach(snapshot => {
            if (!snapshot) return;
            const { router, users, active } = snapshot;
            const mappedRouter = router || {};
            if (Array.isArray(users) && users.length > 0) {
                allUsers = allUsers.concat(users.map(u => ({
                    name: u.name || '',
                    password: u.password || '',
                    profile: u.profile || 'default',
                    server: u.server || 'all',
                    comment: u.comment || '',
                    nas_id: mappedRouter.id,
                    nas_name: mappedRouter.name,
                    nas_ip: mappedRouter.nas_ip
                })));
            }
            if (Array.isArray(active) && active.length > 0) {
                active.forEach(user => {
                    const username = user.user || user.name || user.username || '';
                    if (username) {
                        activeUsernames.push(username);
                    }
                });
            }
        });
        
        // Query SEMUA invoice voucher terlebih dahulu (tidak perlu filter by username)
        const invoiceDates = await new Promise((resolve, reject) => {
            const query = `
                SELECT notes, created_at 
                FROM invoices 
                WHERE invoice_type = 'voucher' 
                AND notes LIKE 'Voucher Hotspot %'
            `;
            
            db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error fetching invoice dates:', err);
                    resolve({});
                } else {
                    const dateMap = {};
                    rows.forEach(row => {
                        // Extract username from notes: "Voucher Hotspot {username} - Profile: {profile}"
                        const match = row.notes.match(/Voucher Hotspot\s+(\S+)/i);
                        if (match && match[1]) {
                            dateMap[match[1]] = row.created_at;
                            console.log(`Found invoice date for ${match[1]}: ${row.created_at}`);
                        }
                    });
                    console.log(`Invoice dates map (Mikrotik):`, dateMap);
                    resolve(dateMap);
                }
            });
        });

        // Filter hanya voucher (berdasarkan prefix atau kriteria lain)
        // Pattern voucher umum: prefix seperti wifi-, eee, fff, ggg, dll, atau comment = 'voucher'
        const voucherHistory = allUsers.filter(user => {
            if (!user.name) return false;
            // Jika punya invoice, SELALU tampilkan
            if (invoiceDates[user.name]) return true;
            // Jika cocok dengan pattern voucher umum, tampilkan juga
            const isVoucherPattern = 
                user.name.startsWith('wifi-') || 
                user.name.startsWith('eee') || 
                user.name.startsWith('fff') || 
                user.name.startsWith('ggg') ||
                user.name.startsWith('aaa') ||
                user.name.startsWith('bbb') ||
                user.name.startsWith('ccc') ||
                user.name.startsWith('ddd') ||
                user.name.startsWith('hhh') ||
                user.name.startsWith('iii') ||
                user.name.startsWith('jjj') ||
                user.name.startsWith('kkk') ||
                user.name.startsWith('lll') ||
                user.name.startsWith('mmm') ||
                user.name.startsWith('nnn') ||
                user.name.startsWith('ooo') ||
                user.name.startsWith('ppp') ||
                user.name.startsWith('qqq') ||
                user.name.startsWith('rrr') ||
                user.name.startsWith('sss') ||
                user.name.startsWith('ttt') ||
                user.name.startsWith('uuu') ||
                user.name.startsWith('vvv') ||
                user.name.startsWith('www') ||
                user.name.startsWith('xxx') ||
                user.name.startsWith('yyy') ||
                user.name.startsWith('zzz') ||
                user.comment === 'voucher';
            return isVoucherPattern;
        }).map(user => {
            // Ambil created_at dari invoice jika ada, jika tidak gunakan null (akan di-handle di frontend)
            const invoiceDate = invoiceDates[user.name] || null;
            return {
                username: user.name || '',
                password: user.password || '',
                profile: user.profile || 'default',
                server: user.server || 'all',
                createdAt: invoiceDate || null, // Simpan sebagai string, bukan Date object
                active: activeUsernames.includes(user.name),
                comment: user.comment || '',
                nas_id: user.nas_id,
                nas_name: user.nas_name,
                nas_ip: user.nas_ip
            };
        });
        
        console.log(`Loaded ${voucherHistory.length} vouchers for history table`);
        
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['footer_info'] || '-';
        
        db.close();

        res.render('adminVoucher', {
            profiles,
            serverProfiles: serverProfiles,
            servers,
            voucherHistory,
            routers,
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: userAuthMode,
            page: 'hotspot-settings'
        });
    } catch (error) {
        console.error('Error rendering voucher page:', error);
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['footer_info'] || '-';
        res.render('adminVoucher', {
            profiles: [],
            serverProfiles: [],
            servers: [],
            voucherHistory: [],
            routers: [],
            success: null,
            error: 'Gagal memuat halaman voucher: ' + error.message,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge(),
            userAuthMode: 'mikrotik',
            page: 'hotspot-settings'
        });
    }
});

// POST: Generate voucher dengan JSON response
router.post('/generate-voucher', async (req, res) => {
    try {
        // Check auth mode - RADIUS atau Mikrotik API
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        // Log request untuk debugging
        console.log('Generate voucher request:', req.body);
        console.log('Auth Mode:', userAuthMode);
        console.log('Count from request:', req.body.count);
        console.log('Profile from request:', req.body.profile);
        console.log('Server Hotspot from request:', req.body.server || 'not provided (will use "all")');
        console.log('Server Profile from request:', req.body.serverProfile || 'not provided');
        console.log('Router ID from request:', req.body.router_id);
        console.log('Price from request:', req.body.price);
        console.log('CharType from request:', req.body.charType);
        
        const count = parseInt(req.body.count) || 5;
        const prefix = req.body.prefix || 'wifi-';
        const profile = req.body.profile || 'default';
        const router_id = req.body.router_id || req.body.routerId;
        // MODE HYBRID: Prioritaskan Server Hotspot dari form, fallback ke Server Profile atau 'all'
        const server = req.body.server || req.body.serverProfile || 'all';
        // Parse price dengan lebih robust: handle string, number, null, undefined, empty string
        let price = 0;
        if (req.body.price !== null && req.body.price !== undefined && req.body.price !== '') {
            const parsedPrice = parseFloat(req.body.price);
            if (!isNaN(parsedPrice)) {
                price = parsedPrice;
            }
        }
        console.log(`Price parsing: req.body.price = ${req.body.price} (type: ${typeof req.body.price}) -> parsed price = ${price} (type: ${typeof price})`);
        const voucherModel = req.body.voucherModel || 'standard';
        const charType = req.body.charType || 'alphanumeric';
        
        // MODE HYBRID: Untuk mode RADIUS, jika Server Hotspot dipilih (bukan "all"),
        // kita perlu mendapatkan router yang memiliki server hotspot tersebut
        // Ini penting untuk memastikan konfigurasi RADIUS benar
        let routerObj = null;
        
        if (userAuthMode === 'radius') {
            // Mode RADIUS: Jika Server Hotspot dipilih (bukan "all"), cari router yang memiliki server tersebut
            if (server && server !== 'all' && server.trim() !== '') {
                // Cari router yang memiliki server hotspot ini
                const db = new sqlite3.Database('./data/billing.db');
                try {
                    // Ambil semua router dan cek server hotspot mereka
                    const routers = await new Promise((resolve, reject) => {
                        db.all('SELECT * FROM routers ORDER BY name', [], (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        });
                    });
                    
                    // Cari router yang memiliki server hotspot dengan nama yang dipilih
                    for (const router of routers) {
                        try {
                            const { getHotspotServers } = require('../config/mikrotik');
                            const serversResult = await getHotspotServers(router);
                            if (serversResult.success && Array.isArray(serversResult.data)) {
                                const foundServer = serversResult.data.find(s => s.name === server);
                                if (foundServer) {
                                    routerObj = router;
                                    console.log(`Found router for server hotspot "${server}": ${router.name} (${router.nas_ip})`);
                                    break;
                                }
                            }
                        } catch (e) {
                            // Skip router yang error
                            console.warn(`Error checking router ${router.name} for server hotspot:`, e.message);
                        }
                    }
                    db.close();
                } catch (e) {
                    console.error('Error finding router for server hotspot:', e.message);
                    db.close();
                }
            }
            // Jika tidak ada router ditemukan atau server = "all", routerObj tetap null (default RADIUS)
        } else {
            // Mode Mikrotik API: router_id diperlukan
            if (!router_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Pilih NAS (Router) terlebih dahulu'
                });
            }
            
            // Fetch router object dari database
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
            if (!routerObj) {
                return res.status(400).json({
                    success: false,
                    message: 'Router/NAS tidak ditemukan'
                });
            }
            console.log('Router selected:', routerObj.name, routerObj.nas_ip);
        }
        
        console.log('Parsed values:');
        console.log('- Count:', count);
        console.log('- Profile:', profile);
        console.log('- Server Hotspot:', server);
        console.log('- Router:', routerObj ? routerObj.name : 'RADIUS (default)');
        console.log('- Price:', price);
        console.log('- CharType:', charType);
        
        // Gunakan fungsi generateHotspotVouchers yang sudah diimport di atas
        const serverMetadata = {
            name: server,
            nasId: req.body.serverNasId ? parseInt(req.body.serverNasId, 10) : null,
            nasName: req.body.serverNasName || '',
            nasIp: req.body.serverNasIp || '',
            nasIdentifier: req.body.serverNasIdentifier || '',
            interface: req.body.serverInterface || ''
        };

        if (routerObj) {
            if (!serverMetadata.nasName) serverMetadata.nasName = routerObj.name || '';
            if (!serverMetadata.nasIp) serverMetadata.nasIp = routerObj.nas_ip || '';
            if (!serverMetadata.nasIdentifier) serverMetadata.nasIdentifier = routerObj.nas_identifier || '';
        }

        const validitySeconds = parseDurationToSeconds(req.body.validityValue, req.body.validityUnit);
        const uptimeSeconds = parseDurationToSeconds(req.body.uptimeValue, req.body.uptimeUnit);
        const limits = { validitySeconds, uptimeSeconds };

        const result = await generateHotspotVouchers(count, prefix, profile, serverMetadata, limits, price, charType, routerObj);
        
        if (!result.success) {
            throw new Error(result.message || 'Gagal generate voucher');
        }
        
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminKontak = settings['footer_info'] || '-';
        
        // Log response untuk debugging
        console.log(`Generated ${result.vouchers.length} vouchers successfully`);
        
        // Harga voucher diambil dari input form "Harga" di /admin/hotspot/voucher
        // Tidak menggunakan harga dari paket PPPoE
        const response = {
            success: true,
            vouchers: result.vouchers.map(voucher => ({
                ...voucher,
                profile: profile, // Pastikan profile ada di setiap voucher
                price: price || voucher.price || null, // Harga dari input form /admin/hotspot/voucher
                validitySeconds: limits.validitySeconds || null,
                uptimeSeconds: limits.uptimeSeconds || null
            })),
            server,
            profile,
            validitySeconds,
            uptimeSeconds,
            validityValue: req.body.validityValue ? parseInt(req.body.validityValue, 10) || null : null,
            validityUnit: req.body.validityUnit || null,
            uptimeValue: req.body.uptimeValue ? parseInt(req.body.uptimeValue, 10) || null : null,
            uptimeUnit: req.body.uptimeUnit || null,
            price: price || null, // Harga dari input form /admin/hotspot/voucher
            voucherModel: voucherModel,
            namaHotspot,
            adminKontak,
            validityText: formatDuration(limits.validitySeconds),
            uptimeText: formatDuration(limits.uptimeSeconds)
        };
        
        console.log('Response:', JSON.stringify(response));
        res.json(response);
    } catch (error) {
        console.error('Error generating vouchers:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate voucher: ' + error.message
        });
    }
});

// GET: Print vouchers page
router.get('/print-vouchers', async (req, res) => {
    try {
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminKontak = settings['admins.0'] || '-';
        
        res.render('voucherHotspot', {
            vouchers: [], // Voucher akan dikirim via postMessage
            namaHotspot,
            adminKontak
        });
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// POST: Delete voucher
router.post('/delete-voucher', async (req, res) => {
    const { username, router_id } = req.body;
    if (!username) {
        return res.redirect('/admin/hotspot/voucher?error=Username+diperlukan');
    }

    try {
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
        }
        await deleteHotspotUser(username, routerObj);
        res.redirect('/admin/hotspot/voucher?success=Voucher+berhasil+dihapus');
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.redirect('/admin/hotspot/voucher?error=' + encodeURIComponent('Gagal menghapus voucher: ' + error.message));
    }
});

// POST: Generate manual voucher for online settings
router.post('/generate-manual-voucher', async (req, res) => {
    try {
        const { username, password, profile, router_id, price } = req.body;

        if (!username || !password || !profile) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, dan profile harus diisi'
            });
        }

        // Check auth mode
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        // Untuk mode RADIUS, router_id tidak diperlukan
        if (userAuthMode === 'radius') {
            const result = await addHotspotUser(username, password, profile, 'voucher', null, null, price || null);
            if (result.success) {
                return res.json({
                    success: true,
                    message: 'Voucher manual berhasil dibuat',
                    voucher: {
                        username,
                        password,
                        profile,
                        nas_name: 'RADIUS',
                        nas_ip: 'RADIUS'
                    }
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: 'Gagal membuat voucher: ' + (result.message || 'Unknown error')
                });
            }
        }

        // Untuk mode Mikrotik API, router_id diperlukan
        if (!router_id) {
            return res.status(400).json({
                success: false,
                message: 'Pilih NAS (Router) terlebih dahulu'
            });
        }

        // Fetch router object
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (!routerObj) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS tidak ditemukan'
            });
        }

        // Add user to Mikrotik with routerObj
        const result = await addHotspotUser(username, password, profile, 'voucher', null, routerObj);

        if (result.success) {
            res.json({
                success: true,
                message: 'Voucher manual berhasil dibuat',
                voucher: {
                    username,
                    password,
                    profile,
                    nas_name: routerObj.name,
                    nas_ip: routerObj.nas_ip
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Gagal membuat voucher: ' + (result.message || 'Unknown error')
            });
        }

    } catch (error) {
        console.error('Error generating manual voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error membuat voucher manual: ' + error.message
        });
    }
});

// POST: Generate auto voucher for online settings
router.post('/generate-auto-voucher', async (req, res) => {
    try {
        const { count, profile, router_id, numericOnly, price } = req.body;
        const numVouchers = parseInt(count) || 1;

        if (numVouchers > 10) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal 10 voucher per generate'
            });
        }

        // Check auth mode
        let userAuthMode = 'mikrotik';
        try {
            const mode = await getRadiusConfigValue('user_auth_mode', null);
            userAuthMode = mode !== null && mode !== undefined ? mode : 'mikrotik';
        } catch (e) {
            // Fallback
        }

        let routerObj = null;
        // Untuk mode Mikrotik API, router_id diperlukan
        if (userAuthMode !== 'radius') {
        if (!router_id) {
            return res.status(400).json({
                success: false,
                message: 'Pilih NAS (Router) terlebih dahulu'
            });
        }

        // Fetch router object
        const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (!routerObj) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS tidak ditemukan'
            });
            }
        }

        const generatedVouchers = [];

        // Function to generate random string
        function randomString(length, numeric = false) {
            const chars = numeric ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }

        // Generate vouchers
        for (let i = 0; i < numVouchers; i++) {
            let username, password;

            if (numericOnly) {
                // Username dan password sama, angka saja
                const randomNum = randomString(8, true);
                username = randomNum;
                password = randomNum;
            } else {
                // Username dan password berbeda
                username = randomString(6) + randomString(2);
                password = randomString(8);
            }

            try {
                const result = await addHotspotUser(username, password, profile, 'voucher', null, routerObj, price || null);
                if (result.success) {
                    generatedVouchers.push({
                        username,
                        password,
                        profile,
                        nas_name: userAuthMode === 'radius' ? 'RADIUS' : routerObj.name,
                        nas_ip: userAuthMode === 'radius' ? 'RADIUS' : routerObj.nas_ip
                    });
                }
            } catch (e) {
                console.error(`Failed to create voucher ${i + 1}:`, e.message);
            }
        }

        res.json({
            success: true,
            message: `${generatedVouchers.length} voucher otomatis berhasil dibuat`,
            vouchers: generatedVouchers
        });

    } catch (error) {
        console.error('Error generating auto voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error membuat voucher otomatis: ' + error.message
        });
    }
});

// POST: Reset setting voucher online ke profile pertama
router.post('/reset-voucher-online-settings', async (req, res) => {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Get first available profile from Mikrotik
        const { getHotspotProfiles } = require('../config/mikrotik');
        const profilesResult = await getHotspotProfiles();
        const defaultProfile = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
            ? profilesResult.data[0].name 
            : 'default';

        // Update all packages to use first profile
        const packages = ['3k', '5k', '10k', '15k', '25k', '50k'];
        const updatePromises = packages.map(packageId => {
            return new Promise((resolve, reject) => {
                db.run(
                    'UPDATE voucher_online_settings SET profile = ? WHERE package_id = ?',
                    [defaultProfile, packageId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        });

        await Promise.all(updatePromises);
        db.close();

        res.json({
            success: true,
            message: `Setting voucher online berhasil direset ke profile: ${defaultProfile}`,
            defaultProfile: defaultProfile
        });

    } catch (error) {
        console.error('Error resetting voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal reset setting voucher online: ' + error.message
        });
    }
});

// POST: Save voucher online settings
router.post('/save-voucher-online-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_online_settings table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_online_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    package_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    profile TEXT NOT NULL,
                    digits INTEGER NOT NULL DEFAULT 5,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings for each package
        const promises = Object.keys(settings).map(packageId => {
            const setting = settings[packageId];
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_online_settings
                    (package_id, name, profile, digits, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `;
                db.run(sql, [packageId, setting.name || `${packageId} - Paket`, setting.profile, setting.digits || 5, setting.enabled ? 1 : 0], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);

        db.close();

        res.json({
            success: true,
            message: 'Setting voucher online berhasil disimpan'
        });

    } catch (error) {
        console.error('Error saving voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan setting voucher online: ' + error.message
        });
    }
});

// POST: Save voucher generation settings
router.post('/save-voucher-generation-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_generation_settings table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_generation_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT NOT NULL UNIQUE,
                    setting_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings
        const promises = Object.keys(settings).map(key => {
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_generation_settings
                    (setting_key, setting_value, updated_at)
                    VALUES (?, ?, datetime('now'))
                `;
                db.run(sql, [key, settings[key]], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);
        db.close();

        res.json({
            success: true,
            message: 'Pengaturan generate voucher berhasil disimpan'
        });

    } catch (error) {
        console.error('Error saving voucher generation settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan pengaturan: ' + error.message
        });
    }
});

// POST: Test voucher generation
router.post('/test-voucher-generation', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        // Generate test voucher based on settings
        const { generateTestVoucher } = require('../config/mikrotik');
        const result = await generateTestVoucher(settings);

        if (result.success) {
            res.json({
                success: true,
                username: result.username,
                password: result.password,
                message: 'Test generate voucher berhasil'
            });
        } else {
            res.json({
                success: false,
                message: result.message
            });
        }

    } catch (error) {
        console.error('Error testing voucher generation:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal test generate voucher: ' + error.message
        });
    }
});

function formatSecondsToHHMMSS(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) {
        return '00:00:00';
    }
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
    const secs = (total % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
}

// GET: Halaman Buat Template Voucher
router.get('/voucher-template', async (req, res) => {
    try {
        const { adminAuth } = require('./adminAuth');
        await adminAuth(req, res, async () => {
            const settings = getSettingsWithCache();
            const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
            const versionInfo = getVersionInfo();
            const versionBadge = getVersionBadge();
            
            // Ambil data voucher dari database
            const dbPath = path.join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            
            // Ambil voucher history dari localStorage (akan diambil via frontend)
            // Atau bisa ambil dari database jika ada tabel voucher_history
            const voucherHistory = [];
            
            // Tutup database
            db.close();
            
            res.render('admin/voucher-template', {
                title: 'Buat Template Voucher',
                page: 'voucher-template',
                settings: settings,
                versionInfo: versionInfo,
                versionBadge: versionBadge,
                voucherHistory: voucherHistory
            });
        });
    } catch (error) {
        console.error('Error loading voucher template page:', error);
        res.status(500).send('Error loading page: ' + error.message);
    }
});

module.exports = router;
