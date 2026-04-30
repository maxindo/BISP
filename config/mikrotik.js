// Modul untuk koneksi dan operasi Mikrotik
const { RouterOSAPI } = require('node-routeros');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const cacheManager = require('./cacheManager');

let sock = null;
let mikrotikConnection = null;
let monitorInterval = null;

// Fungsi untuk set instance sock
function setSock(sockInstance) {
    sock = sockInstance;
}

// Fungsi untuk koneksi ke Mikrotik
async function connectToMikrotik() {
    try {
        // Dapatkan konfigurasi Mikrotik
        const host = getSetting('mikrotik_host', '192.168.8.1');
        const port = parseInt(getSetting('mikrotik_port', '8728'));
        const user = getSetting('mikrotik_user', 'admin');
        const password = getSetting('mikrotik_password', 'admin');
        
        if (!host || !user || !password) {
            logger.error('Mikrotik configuration is incomplete');
            return null;
        }
        
        // Buat koneksi ke Mikrotik
        const conn = new RouterOSAPI({
            host,
            port,
            user,
            password,
            keepalive: true,
            timeout: 5000 // 5 second timeout
        });
        
        // Connect ke Mikrotik
        await conn.connect();
        logger.info(`Connected to Mikrotik at ${host}:${port}`);
        
        // Set global connection
        mikrotikConnection = conn;
        
        return conn;
    } catch (error) {
        logger.error(`Error connecting to Mikrotik: ${error.message}`);
        return null;
    }
}

// Fungsi untuk mendapatkan koneksi Mikrotik
async function getMikrotikConnection() {
    if (!mikrotikConnection) {
        // PRIORITAS: gunakan NAS (routers) terlebih dahulu
        try {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
            const router = await new Promise((resolve) => {
                db.get('SELECT * FROM routers ORDER BY id LIMIT 1', [], (err, row) => resolve(row || null));
            });
            db.close();
            if (router) {
                const conn = await getMikrotikConnectionForRouter(router);
                mikrotikConnection = conn;
                return conn;
            }
        } catch (e) {
            logger.warn('Connect via routers table failed: ' + e.message);
        }

        // Fallback terakhir: legacy settings.json (untuk kompatibilitas)
        let conn = await connectToMikrotik();
        if (conn) {
            mikrotikConnection = conn;
            return conn;
        }
        return null;
    }
    return mikrotikConnection;
}

// === MULTI-NAS helpers ===
async function getMikrotikConnectionForRouter(routerObj) {
    const { RouterOSAPI } = require('node-routeros');
    if (!routerObj || !routerObj.nas_ip || !routerObj.id) {
        throw new Error('Router data kurang lengkap: id atau nas_ip tidak ditemukan');
    }
    const host = routerObj.nas_ip;
    const port = parseInt(routerObj.port || routerObj.nas_port || 8728);
    const user = routerObj.user || routerObj.nas_user || routerObj.username;
    const password = routerObj.secret || routerObj.password;
    
    if (!host) throw new Error('Koneksi router gagal: IP address (nas_ip) tidak ditemukan');
    if (!user) throw new Error('Koneksi router gagal: Username tidak ditemukan');
    if (!password) throw new Error('Koneksi router gagal: Password tidak ditemukan');
    
    logger.info(`Creating connection to ${host}:${port} with user ${user}`);
    const conn = new RouterOSAPI({ host, port, user, password, keepalive: true, timeout: 10000 });
    
    try {
        await conn.connect();
        logger.info(`✓ Successfully connected to ${host}:${port}`);
        return conn;
    } catch (connectError) {
        logger.error(`✗ Failed to connect to ${host}:${port}:`, connectError.message);
        throw new Error(`Gagal koneksi ke ${host}:${port} - ${connectError.message}`);
    }
}

// Fungsi untuk mendapatkan router object untuk customer (bukan connection)
async function getRouterForCustomer(customer) {
    if (!customer || !customer.id) throw new Error('Customer tidak ditemukan');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
    const router = await new Promise((resolve, reject) => {
        db.get('SELECT r.* FROM customer_router_map m JOIN routers r ON r.id = m.router_id WHERE m.customer_id = ? LIMIT 1', [customer.id], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
    db.close();
    if (!router) throw new Error('Customer belum memilih router/NAS');
    return router;
}

async function getMikrotikConnectionForCustomer(customer) {
    const router = await getRouterForCustomer(customer);
    return await getMikrotikConnectionForRouter(router);
}

// Fungsi untuk koneksi ke database RADIUS (MySQL)
async function getRadiusConnection() {
    // Prioritaskan ambil dari database (app_settings), fallback ke settings.json
    let radiusConfig;
    try {
        const { getRadiusConfig } = require('./radiusConfig');
        radiusConfig = await getRadiusConfig();
    } catch (e) {
        // Fallback ke settings.json jika database tidak bisa diakses
        logger.warn('Failed to get radius config from database, using settings.json fallback:', e.message);
        radiusConfig = {
            radius_host: getSetting('radius_host', 'localhost'),
            radius_user: getSetting('radius_user', 'radius'),
            radius_password: getSetting('radius_password', 'radius'),
            radius_database: getSetting('radius_database', 'radius')
        };
    }
    
    const host = radiusConfig.radius_host || 'localhost';
    const user = radiusConfig.radius_user || 'radius';
    const password = radiusConfig.radius_password || 'radius';
    const database = radiusConfig.radius_database || 'radius';
    
    return await mysql.createConnection({ host, user, password, database });
}

// Fungsi untuk mendapatkan seluruh user PPPoE dari RADIUS (BUKAN hotspot voucher)
async function getPPPoEUsersRadius() {
    const conn = await getRadiusConnection();
    try {
        logger.info('Fetching PPPoE users from RADIUS database (excluding hotspot vouchers)...');
        
        // Ambil daftar username yang merupakan voucher dari tabel voucher_revenue
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        logger.info(`Found ${voucherUsernames.length} voucher usernames to exclude`);
        
        // Query untuk mendapatkan PPPoE users (exclude voucher users)
        let query = `
            SELECT 
                rc.username, 
                rc.value as password,
                COALESCE(rug.groupname, 'default') as profile
            FROM radcheck rc
            LEFT JOIN radusergroup rug ON rc.username = rug.username
            WHERE rc.attribute = 'Cleartext-Password'
        `;
        
        const params = [];
        if (voucherUsernames.length > 0) {
            // Exclude voucher usernames
            const placeholders = voucherUsernames.map(() => '?').join(',');
            query += ` AND rc.username NOT IN (${placeholders})`;
            params.push(...voucherUsernames);
        }
        
        query += ` ORDER BY rc.username`;
        
        const [rows] = await conn.execute(query, params);
        
        logger.info(`Found ${rows.length} PPPoE users in radcheck table (excluding ${voucherUsernames.length} vouchers)`);
        
        await conn.end();
        
        const users = rows.map(row => ({ 
            name: row.username, 
            password: row.password,
            profile: row.profile
        }));
        
        logger.info(`Mapped ${users.length} PPPoE users successfully`);
        return users;
    } catch (error) {
        await conn.end();
        logger.error(`Error getting PPPoE users from RADIUS: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
        
        // Fallback ke query sederhana jika join gagal
        try {
            logger.info('Trying fallback query without join...');
            const conn2 = await getRadiusConnection();
            
            // Get voucher usernames for fallback
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = require('path').join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            const voucherUsernames = await new Promise((resolve, reject) => {
                db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                    if (err) resolve([]);
                    else resolve(rows.map(r => r.username));
                });
            });
            db.close();
            
            let fallbackQuery = "SELECT username, value as password FROM radcheck WHERE attribute='Cleartext-Password'";
            const params = [];
            if (voucherUsernames.length > 0) {
                const placeholders = voucherUsernames.map(() => '?').join(',');
                fallbackQuery += ` AND username NOT IN (${placeholders})`;
                params.push(...voucherUsernames);
            }
            fallbackQuery += " ORDER BY username";
            
            const [rows] = await conn2.execute(fallbackQuery, params);
            await conn2.end();
            logger.info(`Fallback query found ${rows.length} PPPoE users`);
            return rows.map(row => ({ name: row.username, password: row.password, profile: 'default' }));
        } catch (fallbackError) {
            logger.error(`Fallback query also failed: ${fallbackError.message}`);
            return [];
        }
    }
}

// Fungsi untuk mendapatkan active PPPoE connections dari RADIUS (BUKAN hotspot voucher)
async function getActivePPPoEConnectionsRadius() {
    const conn = await getRadiusConnection();
    try {
        // Ambil daftar voucher usernames untuk exclude
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames for active connections: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        // Get active sessions dari radacct (acctstoptime IS NULL), exclude vouchers
        let query = `
            SELECT 
                username,
                acctsessionid,
                acctstarttime,
                framedipaddress,
                acctinputoctets,
                acctoutputoctets,
                nasipaddress,
                TIMESTAMPDIFF(SECOND, acctstarttime, NOW()) as session_time
            FROM radacct
            WHERE acctstoptime IS NULL
        `;
        
        const params = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            query += ` AND username NOT IN (${placeholders})`;
            params.push(...voucherUsernames);
        }
        
        query += ` ORDER BY acctstarttime DESC`;
        
        const [activeRows] = await conn.execute(query, params);
        
        await conn.end();
        return activeRows.map(row => ({
            name: row.username,
            ip: row.framedipaddress || 'N/A',
            uptime: row.session_time || 0,
            'bytes-in': row.acctinputoctets || 0,
            'bytes-out': row.acctoutputoctets || 0,
            nasip: row.nasipaddress || 'N/A'
        }));
    } catch (error) {
        await conn.end();
        logger.error(`Error getting active PPPoE connections from RADIUS: ${error.message}`);
        return [];
    }
}

// Fungsi untuk mendapatkan statistik RADIUS (total users, active, offline) - HANYA PPPoE, BUKAN voucher
async function getRadiusStatistics() {
    const conn = await getRadiusConnection();
    try {
        // Ambil daftar voucher usernames untuk exclude
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames for stats: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        // Total PPPoE users (exclude vouchers)
        let totalQuery = `
            SELECT COUNT(DISTINCT username) as total
            FROM radcheck
            WHERE attribute = 'Cleartext-Password'
        `;
        const params = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            totalQuery += ` AND username NOT IN (${placeholders})`;
            params.push(...voucherUsernames);
        }
        
        const [totalRows] = await conn.execute(totalQuery, params);
        const totalUsers = totalRows[0]?.total || 0;
        
        // Active PPPoE connections (dari radacct, exclude vouchers)
        let activeQuery = `
            SELECT COUNT(DISTINCT username) as active
            FROM radacct
            WHERE acctstoptime IS NULL
        `;
        const activeParams = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            activeQuery += ` AND username NOT IN (${placeholders})`;
            activeParams.push(...voucherUsernames);
        }
        
        const [activeRows] = await conn.execute(activeQuery, activeParams);
        const activeConnections = activeRows[0]?.active || 0;
        
        // Offline users
        const offlineUsers = Math.max(totalUsers - activeConnections, 0);
        
        await conn.end();
        
        logger.info(`RADIUS Statistics - Total: ${totalUsers}, Active: ${activeConnections}, Offline: ${offlineUsers} (excluded ${voucherUsernames.length} vouchers)`);
        
        return {
            total: totalUsers,
            active: activeConnections,
            offline: offlineUsers
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting RADIUS statistics: ${error.message}`);
        return {
            total: 0,
            active: 0,
            offline: 0
        };
    }
}

// Fungsi untuk menambah user PPPoE ke RADIUS
async function addPPPoEUserRadius({ username, password, profile = null }) {
    let conn = null;
    try {
        conn = await getRadiusConnection();
        if (!conn) {
            logger.error(`[RADIUS] Failed to get RADIUS connection for user ${username}`);
            return { success: false, message: 'Koneksi ke database RADIUS gagal', error: 'Connection failed' };
        }

        logger.info(`[RADIUS] Adding PPPoE user ${username} with profile ${profile || 'default'}`);
        
        // Insert atau update password di radcheck
        await conn.execute(
            "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [username, password, password]
        );
        logger.info(`[RADIUS] Password inserted/updated for user ${username}`);
        
        // Assign user ke group/package jika profile diberikan
        if (profile) {
            // Convert profile ke format groupname (misal: "paket_10mbps" atau "default")
            const groupname = profile.toLowerCase().replace(/\s+/g, '_');
            
            logger.info(`[RADIUS] Setting groupname ${groupname} for user ${username}`);
            
            // HAPUS SEMUA groupname untuk username ini terlebih dahulu untuk menghindari duplikasi
            await conn.execute(
                "DELETE FROM radusergroup WHERE username = ?",
                [username]
            );
            
            // Insert groupname yang baru
            await conn.execute(
                "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
                [username, groupname]
            );
            logger.info(`[RADIUS] Groupname ${groupname} assigned to user ${username}`);
        }
        
        await conn.end();
        logger.info(`[RADIUS] Successfully added PPPoE user ${username} to RADIUS database`);
        return { success: true, message: 'User berhasil ditambahkan ke RADIUS' };
    } catch (error) {
        if (conn) {
            try {
                await conn.end();
            } catch (e) {
                // Ignore connection close errors
            }
        }
        logger.error(`[RADIUS] Error adding PPPoE user ${username} to RADIUS:`, error);
        logger.error(`[RADIUS] Error stack:`, error.stack);
        return { success: false, message: `Gagal menambahkan user ke RADIUS: ${error.message}`, error: error.message };
    }
}

// Fungsi untuk update password user PPPoE di RADIUS
async function updatePPPoEUserRadiusPassword({ username, password }) {
    const conn = await getRadiusConnection();
    try {
        await conn.execute(
            "UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'",
            [password, username]
        );
        await conn.end();
        return { success: true, message: 'Password user berhasil diupdate di RADIUS' };
    } catch (error) {
        await conn.end();
        logger.error(`Error updating PPPoE user password in RADIUS: ${error.message}`);
        throw error;
    }
}

// Helper: Build rate-limit string untuk Mikrotik format
function buildMikrotikRateLimit({ upload_limit, download_limit, burst_limit_upload, burst_limit_download, burst_threshold, burst_time }) {
    if (!download_limit && !upload_limit) return null;
    
    const download = download_limit || '0';
    const upload = upload_limit || '0';
    let rateLimit = `${download}/${upload}`;
    
    // Jika ada burst, format Mikrotik: "download/upload download-burst/upload-burst [threshold/threshold] time/time"
    // Contoh: "30M/30M 40M/40M 30M/30M 10/10"
    // PENTING: burst_time harus dalam format "10/10" (detik tanpa unit), bukan "10s"
    if (burst_limit_download && burst_limit_upload && burst_time) {
        rateLimit += ` ${burst_limit_download}/${burst_limit_upload}`;
        
        // Threshold opsional - format: "download-threshold/upload-threshold"
        if (burst_threshold && burst_threshold.trim() !== '') {
            if (burst_threshold.includes('/')) {
                rateLimit += ` ${burst_threshold}`;
            } else {
                rateLimit += ` ${burst_threshold}/${burst_threshold}`;
            }
        }
        
        // burst_time wajib ada dan harus dalam format "10/10" (detik tanpa unit)
        // Convert dari format "10s" atau "10" menjadi "10/10"
        let burstTimeFormatted = burst_time;
        // Remove unit jika ada (s, m, h, d)
        burstTimeFormatted = burstTimeFormatted.replace(/[smhd]$/i, '');
        // Extract numeric value
        const timeValue = parseInt(burstTimeFormatted) || 10;
        // Format sebagai "time/time" untuk download dan upload
        rateLimit += ` ${timeValue}/${timeValue}`;
    } else if (burst_limit_download && burst_limit_upload && !burst_time) {
        // Jika ada burst_limit tapi tidak ada burst_time, log warning dan skip burst
        logger.warn(`Burst limit ditemukan tapi burst_time tidak ada. Mengabaikan burst untuk menghindari error Mikrotik.`);
    }
    
    return rateLimit;
}

// Fungsi untuk sync package limits ke RADIUS (radgroupreply)
async function syncPackageLimitsToRadius({ groupname, upload_limit, download_limit, burst_limit_upload, burst_limit_download, burst_threshold, burst_time }) {
    const conn = await getRadiusConnection();
    try {
        const normalizedGroupname = groupname.toLowerCase().replace(/\s+/g, '_');
        
        // Hapus limit attributes yang lama untuk group ini
        await conn.execute(
            "DELETE FROM radgroupreply WHERE groupname = ? AND attribute IN ('MikroTik-Rate-Limit', 'MikroTik-Total-Limit')",
            [normalizedGroupname]
        );
        
        // Build rate-limit string: "download-limit/upload-limit" atau dengan burst
        let rateLimitStr = '';
        if (download_limit && upload_limit) {
            rateLimitStr = `${download_limit}/${upload_limit}`;
            
            // Jika ada burst, tambahkan burst info
            // Format Mikrotik RADIUS: "rx-rate[/tx-rate] [rx-burst-rate[/tx-burst-rate] [rx-burst-threshold[/tx-burst-threshold] [rx-burst-time[/tx-burst-time]]]]"
            // Contoh: "30M/30M 40M/40M 30M/30M 10/10"
            // PENTING: burst_time harus dalam format "10/10" (detik, tanpa unit), bukan "10s"
            if (burst_limit_download && burst_limit_upload && burst_time) {
                rateLimitStr += ` ${burst_limit_download}/${burst_limit_upload}`;
                
                // Threshold opsional - format: "download-threshold/upload-threshold"
                if (burst_threshold && burst_threshold.trim() !== '') {
                    // Jika threshold adalah single value, duplikasi untuk upload
                    if (burst_threshold.includes('/')) {
                        rateLimitStr += ` ${burst_threshold}`;
                    } else {
                        // Jika single value, gunakan untuk download dan upload
                        rateLimitStr += ` ${burst_threshold}/${burst_threshold}`;
                    }
                }
                
                // burst_time wajib ada dan harus dalam format "10/10" (detik tanpa unit)
                // Convert dari format "10s" atau "10" menjadi "10/10"
                let burstTimeFormatted = burst_time;
                // Remove unit jika ada (s, m, h, d)
                burstTimeFormatted = burstTimeFormatted.replace(/[smhd]$/i, '');
                // Extract numeric value
                const timeValue = parseInt(burstTimeFormatted) || 10;
                // Format sebagai "time/time" untuk download dan upload
                rateLimitStr += ` ${timeValue}/${timeValue}`;
            } else if (burst_limit_download && burst_limit_upload && !burst_time) {
                // Jika ada burst_limit tapi tidak ada burst_time, log warning dan skip burst
                logger.warn(`Burst limit ditemukan untuk group ${normalizedGroupname} tapi burst_time tidak ada. Mengabaikan burst untuk menghindari error Mikrotik.`);
            }
        } else if (download_limit) {
            rateLimitStr = `${download_limit}/${upload_limit || '0'}`;
        } else if (upload_limit) {
            rateLimitStr = `0/${upload_limit}`;
        }
        
        // Insert rate limit ke radgroupreply jika ada
        if (rateLimitStr) {
            await conn.execute(
                "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'MikroTik-Rate-Limit', ':=', ?)",
                [normalizedGroupname, rateLimitStr]
            );
            logger.info(`✅ Rate limit untuk group ${normalizedGroupname}: ${rateLimitStr}`);
        }
        
        await conn.end();
        return { success: true, message: `Package limits berhasil di-sync ke RADIUS group ${normalizedGroupname}` };
    } catch (error) {
        await conn.end();
        logger.error(`Error syncing package limits to RADIUS: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk assign user ke package/group di RADIUS
async function assignPackageRadius({ username, groupname }) {
    const conn = await getRadiusConnection();
    try {
        // Convert groupname ke format yang benar (lowercase, underscore)
        const normalizedGroupname = groupname.toLowerCase().replace(/\s+/g, '_');
        
        // HAPUS SEMUA groupname untuk username ini terlebih dahulu untuk menghindari duplikasi
        await conn.execute(
            "DELETE FROM radusergroup WHERE username = ?",
            [username]
        );
        
        // Insert groupname yang baru
        await conn.execute(
            "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
            [username, normalizedGroupname]
        );
        
        await conn.end();
        return { success: true, message: `User berhasil di-assign ke package ${normalizedGroupname}` };
    } catch (error) {
        await conn.end();
        logger.error(`Error assigning package in RADIUS: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk memastikan profile isolir ada di RADIUS dengan konfigurasi yang benar
async function ensureIsolirProfileRadius() {
    const conn = await getRadiusConnection();
    try {
        // Cek apakah group 'isolir' sudah ada di radgroupreply
        const [existing] = await conn.execute(
            "SELECT COUNT(*) as count FROM radgroupreply WHERE groupname = 'isolir'"
        );
        
        if (existing && existing.length > 0 && existing[0].count > 0) {
            // Profile isolir sudah ada, hapus rate-limit jika ada (biarkan loss untuk redirect web isolir)
            const [rateLimitRows] = await conn.execute(
                "SELECT value FROM radgroupreply WHERE groupname = 'isolir' AND attribute = 'MikroTik-Rate-Limit'"
            );
            
            // Hapus rate-limit jika ada (untuk isolir, biarkan loss saja untuk redirect web)
            if (rateLimitRows.length > 0) {
                logger.info('Profile isolir memiliki rate-limit, menghapus untuk biarkan loss (redirect web isolir)...');
                await conn.execute(
                    "DELETE FROM radgroupreply WHERE groupname = 'isolir' AND attribute = 'MikroTik-Rate-Limit'"
                );
                logger.info('✅ Rate-limit berhasil dihapus dari profile isolir');
            }
            
            // Cek apakah ada Framed-Pool atau Framed-IP-Address
            const [framedPoolRows] = await conn.execute(
                "SELECT value FROM radgroupreply WHERE groupname = 'isolir' AND attribute = 'Framed-Pool'"
            );
            const [framedIPRows] = await conn.execute(
                "SELECT value FROM radgroupreply WHERE groupname = 'isolir' AND attribute = 'Framed-IP-Address'"
            );
            
            // Jika tidak ada Framed-Pool atau Framed-IP-Address, tambahkan Framed-Pool default
            if (framedPoolRows.length === 0 && framedIPRows.length === 0) {
                logger.warn('Profile isolir tidak punya Framed-Pool atau Framed-IP-Address, menambahkan Framed-Pool default...');
                const isolirPool = getSetting('isolir_pool', 'isolir-pool');
                await conn.execute(
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ('isolir', 'Framed-Pool', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                    [isolirPool, isolirPool]
                );
                logger.info(`Profile isolir sekarang menggunakan Framed-Pool: ${isolirPool}`);
            }
            
            await conn.end();
            return { success: true, message: 'Profile isolir sudah ada dan konfigurasinya benar' };
        }
        
        // Profile isolir belum ada, buat dengan konfigurasi yang benar
        logger.info('Profile isolir belum ada di RADIUS, membuat profile isolir...');
        
        // 1. Insert Simultaneous-Use (required)
        await conn.execute(
            "INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ('isolir', 'Simultaneous-Use', ':=', '1')"
        );
        
        // 2. JANGAN set Rate-Limit untuk isolir (biarkan loss saja untuk redirect web isolir)
        // Rate-limit tidak diperlukan karena isolir hanya untuk redirect web, bukan untuk limit speed
        
        // 3. JANGAN set Session-Timeout atau Idle-Timeout (biarkan kosong)
        // Karena timeout yang terlalu kecil bisa menyebabkan disconnect
        
        // 4. Set Framed-Pool untuk isolir (default: isolir-pool)
        // Pool ini biasanya dibuat dari script generator isolir Mikrotik
        const isolirPool = getSetting('isolir_pool', 'isolir-pool');
        await conn.execute(
            "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ('isolir', 'Framed-Pool', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [isolirPool, isolirPool]
        );
        logger.info(`Profile isolir menggunakan Framed-Pool: ${isolirPool}`);
        
        // 5. Atau set Framed-IP-Address jika ada setting isolir IP range (alternatif)
        const isolirIpRange = getSetting('isolir_ip_range', null);
        if (isolirIpRange) {
            // Hapus Framed-Pool jika menggunakan IP range langsung
            await conn.execute(
                "DELETE FROM radgroupreply WHERE groupname = 'isolir' AND attribute = 'Framed-Pool'"
            );
            await conn.execute(
                "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ('isolir', 'Framed-IP-Address', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [isolirIpRange, isolirIpRange]
            );
            logger.info(`Profile isolir menggunakan Framed-IP-Address: ${isolirIpRange}`);
        }
        
        await conn.end();
        logger.info('✅ Profile isolir berhasil dibuat di RADIUS dengan konfigurasi yang benar');
        return { success: true, message: 'Profile isolir berhasil dibuat di RADIUS' };
    } catch (error) {
        await conn.end();
        logger.error(`Error ensuring isolir profile in RADIUS: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk suspend user (pindahkan ke group 'isolir')
async function suspendUserRadius(username) {
    const conn = await getRadiusConnection();
    try {
        // PENTING: Pastikan profile isolir ada di RADIUS sebelum suspend
        await ensureIsolirProfileRadius();
        
        // Simpan group sebelumnya (jika ada) untuk bisa restore nanti
        // Ambil group yang BUKAN 'isolir' (untuk restore nanti)
        const [currentGroup] = await conn.execute(
            "SELECT groupname FROM radusergroup WHERE username = ? AND groupname != 'isolir' LIMIT 1",
            [username]
        );
        
        let previousGroupToSave = null;
        
        // Jika ada group sebelumnya, simpan
        if (currentGroup && currentGroup.length > 0) {
            previousGroupToSave = currentGroup[0].groupname;
            logger.info(`[RADIUS] Saving previous group for ${username}: ${previousGroupToSave}`);
        } else {
            // Jika tidak ada group di radusergroup, coba ambil dari billing database
            // untuk mendapatkan package yang seharusnya digunakan
            try {
                const billingManager = require('./billing');
                let customer = null;
                try {
                    customer = await billingManager.getCustomerByUsername(username);
                } catch (e) {
                    // Jika tidak ditemukan, coba cari dengan query langsung
                    try {
                        const db = billingManager.db;
                        customer = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT c.*, p.name as package_name, p.pppoe_profile as package_pppoe_profile
                                FROM customers c
                                LEFT JOIN packages p ON c.package_id = p.id
                                WHERE c.pppoe_username = ? OR c.username = ?
                                LIMIT 1
                            `, [username, username], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                    } catch (dbError) {
                        logger.warn(`[RADIUS] Failed to query billing DB during suspend: ${dbError.message}`);
                    }
                }
                
                if (customer) {
                    // Prioritaskan pppoe_profile dari customer, lalu dari package, lalu package_name
                    previousGroupToSave = customer.pppoe_profile || 
                                         customer.package_pppoe_profile ||
                                         (customer.package_name ? customer.package_name.toLowerCase().replace(/\s+/g, '-') : null) ||
                                         customer.package_name ||
                                         'default';
                    logger.info(`[RADIUS] No group in radusergroup, using package from billing DB for ${username}: ${previousGroupToSave}`);
                } else {
                    previousGroupToSave = 'default';
                    logger.warn(`[RADIUS] No group found and customer not in billing DB, using 'default' for ${username}`);
                }
            } catch (billingError) {
                previousGroupToSave = 'default';
                logger.warn(`[RADIUS] Failed to get package from billing DB during suspend: ${billingError.message}, using 'default'`);
            }
        }
        
        // HAPUS SEMUA group assignment untuk username ini (termasuk yang duplikat)
        await conn.execute(
            "DELETE FROM radusergroup WHERE username = ?",
            [username]
        );
        
        // Tambahkan group isolir
        await conn.execute(
            "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, 'isolir', 1)",
            [username]
        );
        
        // Simpan group sebelumnya di radcheck dengan attribute khusus untuk restore nanti
        // Format: "PREVGROUP:groupname"
        if (previousGroupToSave) {
            // Hapus X-Previous-Group yang mungkin ada di radreply (jika ada)
            await conn.execute(
                "DELETE FROM radreply WHERE username = ? AND attribute = 'X-Previous-Group'",
                [username]
            );
            
            // Hapus PREVGROUP yang mungkin ada sebelumnya
            await conn.execute(
                "DELETE FROM radcheck WHERE username = ? AND attribute = 'NT-Password' AND value LIKE 'PREVGROUP:%'",
                [username]
            );
            
            // Simpan previous group di radcheck
            try {
                await conn.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'NT-Password', ':=', ?)",
                    [username, `PREVGROUP:${previousGroupToSave}`]
                );
                logger.info(`[RADIUS] Saved previous group for ${username}: ${previousGroupToSave}`);
            } catch (e) {
                logger.error(`[RADIUS] Failed to save previous group for ${username}: ${e.message}`);
                // Jangan throw, karena suspend tetap harus berhasil
            }
        } else {
            logger.warn(`[RADIUS] No previous group to save for ${username}`);
        }
        
        await conn.end();
        return { success: true, message: 'User berhasil di-suspend (isolir)' };
    } catch (error) {
        await conn.end();
        logger.error(`Error suspending user in RADIUS: ${error.message}`);
        throw error;
    }
}
// Fungsi untuk unsuspend user (kembalikan ke package sebelumnya)
async function unsuspendUserRadius(username) {
    const conn = await getRadiusConnection();
    try {
        // Ambil group sebelumnya dari radcheck dengan format PREVGROUP:groupname
        // (bukan dari radreply karena radreply tidak support custom attributes)
        const [prevGroup] = await conn.execute(
            "SELECT value FROM radcheck WHERE username = ? AND attribute = 'NT-Password' AND value LIKE 'PREVGROUP:%' LIMIT 1",
            [username]
        );
        
        // HAPUS SEMUA group assignment untuk username ini (termasuk 'isolir')
        await conn.execute(
            "DELETE FROM radusergroup WHERE username = ?",
            [username]
        );
        
        let previousGroup = null;
        
        if (prevGroup && prevGroup.length > 0) {
            // Extract group name dari format "PREVGROUP:groupname"
            const prevGroupValue = prevGroup[0].value;
            if (prevGroupValue && prevGroupValue.startsWith('PREVGROUP:')) {
                previousGroup = prevGroupValue.substring('PREVGROUP:'.length);
            }
        }
        
        if (!previousGroup) {
            // Jika tidak ada group sebelumnya, coba ambil dari billing database
            // untuk mendapatkan package yang seharusnya digunakan
            try {
                const billingManager = require('./billing');
                // Cari customer berdasarkan pppoe_username atau username
                let customer = null;
                try {
                    customer = await billingManager.getCustomerByUsername(username);
                } catch (e) {
                    // Jika tidak ditemukan, coba cari dengan query langsung
                    try {
                        const db = billingManager.db;
                        customer = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT c.*, p.name as package_name, p.pppoe_profile as package_pppoe_profile
                                FROM customers c
                                LEFT JOIN packages p ON c.package_id = p.id
                                WHERE c.pppoe_username = ? OR c.username = ?
                                LIMIT 1
                            `, [username, username], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                    } catch (dbError) {
                        logger.warn(`[RADIUS] Failed to query billing DB: ${dbError.message}`);
                    }
                }
                
                if (customer) {
                    // Prioritaskan pppoe_profile dari customer, lalu dari package, lalu package_name
                    // Tapi jangan gunakan 'default' jika ada package_name yang valid
                    previousGroup = customer.pppoe_profile || 
                                   customer.package_pppoe_profile;
                    
                    // Jika masih null, coba dari package_name
                    if (!previousGroup && customer.package_name) {
                        // Convert package_name ke format yang sesuai (lowercase, replace space dengan dash)
                        previousGroup = customer.package_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
                    }
                    
                    // Jika masih null atau empty, gunakan package_name langsung
                    if (!previousGroup && customer.package_name) {
                        previousGroup = customer.package_name;
                    }
                    
                    // Jika masih null, baru gunakan default
                    if (!previousGroup) {
                        previousGroup = 'default';
                        logger.warn(`[RADIUS] No package/profile found in billing DB for ${username}, using 'default'`);
                    } else {
                        logger.info(`[RADIUS] Using package/profile from billing DB for ${username}: ${previousGroup}`);
                    }
                } else {
                    // Fallback ke default jika tidak ada data di billing
                    previousGroup = 'default';
                    logger.warn(`[RADIUS] Customer not found in billing DB for ${username}, using 'default'`);
                }
            } catch (billingError) {
                logger.warn(`[RADIUS] Failed to get package from billing DB for ${username}: ${billingError.message}`);
                previousGroup = 'default';
            }
        }
        
        // Kembalikan ke group sebelumnya
        await conn.execute(
            "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
            [username, previousGroup]
        );
        
        // Hapus record previous group dari radcheck
        await conn.execute(
            "DELETE FROM radcheck WHERE username = ? AND attribute = 'NT-Password' AND value LIKE 'PREVGROUP:%'",
            [username]
        );
        
        await conn.end();
        return { success: true, message: `User di-un suspend ke package ${previousGroup}`, previousGroup: previousGroup };
    } catch (error) {
        await conn.end();
        logger.error(`Error unsuspending user in RADIUS: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk delete user PPPoE dari RADIUS
async function deletePPPoEUserRadius(username) {
    const conn = await getRadiusConnection();
    try {
        // Hapus dari radcheck
        await conn.execute("DELETE FROM radcheck WHERE username = ?", [username]);
        
        // Hapus dari radusergroup
        await conn.execute("DELETE FROM radusergroup WHERE username = ?", [username]);
        
        // Hapus dari radreply (jika ada)
        await conn.execute("DELETE FROM radreply WHERE username = ?", [username]);
        
        await conn.end();
        return { success: true, message: 'User berhasil dihapus dari RADIUS' };
    } catch (error) {
        await conn.end();
        logger.error(`Error deleting PPPoE user from RADIUS: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk edit user PPPoE di RADIUS (update password dan/atau package)
async function editPPPoEUserRadius({ oldUsername, username, password, profile = null }) {
    const conn = await getRadiusConnection();
    try {
        // Jika username berubah, perlu rename user (delete dan insert baru)
        if (oldUsername && username && oldUsername !== username) {
            logger.info(`Renaming user from ${oldUsername} to ${username}`);
            
            // 1. Copy data dari user lama ke user baru
            // Ambil password dari user lama jika password baru tidak diberikan
            let passwordToUse = password;
            if (!passwordToUse) {
                const [oldPasswordRows] = await conn.execute(
                    "SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password'",
                    [oldUsername]
                );
                if (oldPasswordRows.length > 0) {
                    passwordToUse = oldPasswordRows[0].value;
                }
            }
            
            // Ambil profile dari user lama jika profile baru tidak diberikan
            let profileToUse = profile;
            if (!profileToUse) {
                const [oldProfileRows] = await conn.execute(
                    "SELECT groupname FROM radusergroup WHERE username = ? LIMIT 1",
                    [oldUsername]
                );
                if (oldProfileRows.length > 0) {
                    profileToUse = oldProfileRows[0].groupname;
                }
            }
            
            // 2. Insert user baru dengan username baru
            if (passwordToUse) {
                await conn.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)",
                    [username, passwordToUse]
                );
            }
            
            if (profileToUse) {
                const groupname = profileToUse.toLowerCase().replace(/\s+/g, '_');
                await conn.execute(
                    "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
                    [username, groupname]
                );
            }
            
            // 3. Delete user lama
            await conn.execute("DELETE FROM radcheck WHERE username = ?", [oldUsername]);
            await conn.execute("DELETE FROM radusergroup WHERE username = ?", [oldUsername]);
            await conn.execute("DELETE FROM radreply WHERE username = ?", [oldUsername]);
            
            await conn.end();
            return { success: true, message: `User berhasil di-rename dari ${oldUsername} ke ${username}` };
        }
        
        // Jika username tidak berubah, hanya update password dan/atau profile
        const usernameToUpdate = username || oldUsername;
        if (!usernameToUpdate) {
            await conn.end();
            return { success: false, message: 'Username tidak ditemukan' };
        }
        
        // Update password jika diberikan
        if (password) {
            await conn.execute(
                "UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'",
                [password, usernameToUpdate]
            );
        }
        
        // Update package/group jika diberikan
        if (profile) {
            const groupname = profile.toLowerCase().replace(/\s+/g, '_');
            
            // HAPUS SEMUA groupname untuk username ini terlebih dahulu untuk menghindari duplikasi
            // Karena REPLACE INTO tidak bekerja jika tidak ada PRIMARY KEY/UNIQUE constraint
            await conn.execute(
                "DELETE FROM radusergroup WHERE username = ?",
                [usernameToUpdate]
            );
            
            // Insert groupname yang baru
            await conn.execute(
                "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
                [usernameToUpdate, groupname]
            );
        }
        
        await conn.end();
        return { success: true, message: 'User berhasil di-update di RADIUS' };
    } catch (error) {
        await conn.end();
        logger.error(`Error editing PPPoE user in RADIUS: ${error.message}`);
        throw error;
    }
}
function durationToSeconds(value, unit) {
    const numeric = parseInt(value, 10);
    if (isNaN(numeric) || numeric <= 0) {
        return null;
    }
    const normalizedUnit = typeof unit === 'string' ? unit.toLowerCase() : 's';
    switch (normalizedUnit) {
        case 'd':
            return numeric * 86400;
        case 'h':
            return numeric * 3600;
        case 'm':
            return numeric * 60;
        case 's':
        default:
            return numeric;
    }
}
function formatSecondsToDuration(secondsInput) {
    const seconds = parseInt(secondsInput, 10);
    if (isNaN(seconds) || seconds <= 0) {
        return null;
    }
    const units = [
        { unit: 'd', factor: 86400 },
        { unit: 'h', factor: 3600 },
        { unit: 'm', factor: 60 },
        { unit: 's', factor: 1 }
    ];
    for (const { unit, factor } of units) {
        if (seconds % factor === 0) {
            const value = seconds / factor;
            return {
                value,
                unit,
                string: `${value}${unit}`,
                seconds
            };
        }
    }
    return {
        value: seconds,
        unit: 's',
        string: `${seconds}s`,
        seconds
    };
}
// Fungsi untuk sync package limits ke Mikrotik PPPoE profile
async function syncPackageLimitsToMikrotik({ profile_name, upload_limit, download_limit, burst_limit_upload, burst_limit_download, burst_threshold, burst_time }, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        // Cari profile berdasarkan name
        const profiles = await conn.write('/ppp/profile/print', ['?name=' + profile_name]);
        if (!profiles || profiles.length === 0) {
            logger.warn(`Profile ${profile_name} tidak ditemukan di Mikrotik, skip sync limits`);
            if (routerObj && conn && typeof conn.close === 'function') {
                await conn.close();
            }
            return { success: false, message: `Profile ${profile_name} tidak ditemukan di Mikrotik` };
        }
        
        const profileId = profiles[0]['.id'];
        const rateLimit = buildMikrotikRateLimit({ upload_limit, download_limit, burst_limit_upload, burst_limit_download, burst_threshold, burst_time });
        
        const params = ['=.id=' + profileId];
        if (rateLimit) {
            params.push('=rate-limit=' + rateLimit);
        } else {
            // Hapus rate-limit jika tidak ada limit
            params.push('=rate-limit=');
        }
        
        await conn.write('/ppp/profile/set', params);
        
        if (routerObj && conn && typeof conn.close === 'function') {
            await conn.close();
        }
        
        return { success: true, message: `Package limits berhasil di-sync ke Mikrotik profile ${profile_name}` };
    } catch (error) {
        logger.error(`Error syncing package limits to Mikrotik: ${error.message}`);
        return { success: false, message: `Gagal sync limits ke Mikrotik: ${error.message}` };
    }
}

// Async helper untuk get user_auth_mode dari database (prioritaskan database, fallback ke settings.json)
async function getUserAuthModeAsync() {
    try {
        const { getRadiusConfigValue } = require('./radiusConfig');
        const mode = await getRadiusConfigValue('user_auth_mode', null);
        if (mode !== null && mode !== undefined) return mode;
    } catch (e) {
        // Fallback ke settings.json jika database tidak bisa diakses
        logger.debug('Failed to get user_auth_mode from database, using settings.json fallback');
    }
    return getSetting('user_auth_mode', 'mikrotik');
}

// Wrapper: Get active PPPoE connections (RADIUS atau Mikrotik API)
async function getActivePPPoEConnections() {
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        return await getActivePPPoEConnectionsRadius();
    } else {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return [];
        }
        try {
            const active = await conn.write('/ppp/active/print');
            const activeNames = Array.isArray(active) ? active.map(s => s.name) : [];
            
            const secrets = await conn.write('/ppp/secret/print');
            return (Array.isArray(secrets) ? secrets : []).map(secret => ({
                name: secret.name,
                ip: secret.address || 'N/A',
                uptime: secret.uptime || '00:00:00',
                'bytes-in': secret['bytes-in'] || 0,
                'bytes-out': secret['bytes-out'] || 0
            })).filter(secret => activeNames.includes(secret.name));
        } catch (error) {
            logger.error(`Error getting active PPPoE connections: ${error.message}`);
            return [];
        } finally {
            if (conn && typeof conn.close === 'function') {
                conn.close();
            }
        }
    }
}

// Wrapper: Pilih mode autentikasi dari settings
async function getPPPoEUsers() {
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        return await getPPPoEUsersRadius();
    } else {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return [];
        }
        // Ambil semua secret PPPoE
        const pppSecrets = await conn.write('/ppp/secret/print');
        // Ambil semua koneksi aktif
        const activeResult = await getActivePPPoEConnections();
        const activeNames = (activeResult && activeResult.success && Array.isArray(activeResult.data)) ? activeResult.data.map(c => c.name) : [];
        // Gabungkan data
        return pppSecrets.map(secret => ({
            id: secret['.id'],
            name: secret.name,
            password: secret.password,
            profile: secret.profile,
            active: activeNames.includes(secret.name)
        }));
    }
}

// Fungsi untuk edit user PPPoE (berdasarkan id untuk Mikrotik, atau username untuk RADIUS)
async function editPPPoEUser({ id, username, password, profile }) {
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        // Mode RADIUS: id adalah username lama, username adalah username baru (atau sama jika tidak diubah)
        return await editPPPoEUserRadius({ oldUsername: id, username, password, profile });
    } else {
        // Mode Mikrotik: menggunakan id
        try {
            const conn = await getMikrotikConnection();
            if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
            await conn.write('/ppp/secret/set', [
                '=.id=' + id,
                '=name=' + username,
                '=password=' + password,
                '=profile=' + profile
            ]);
            return { success: true };
        } catch (error) {
            logger.error(`Error editing PPPoE user: ${error.message}`);
            throw error;
        }
    }
}

// Fungsi untuk hapus user PPPoE (berdasarkan id untuk Mikrotik, atau username untuk RADIUS)
async function deletePPPoEUser(idOrUsername) {
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        // Mode RADIUS: parameter adalah username
        return await deletePPPoEUserRadius(idOrUsername);
    } else {
        // Mode Mikrotik: parameter adalah id
        try {
            const conn = await getMikrotikConnection();
            if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
            await conn.write('/ppp/secret/remove', [ '=.id=' + idOrUsername ]);
            return { success: true };
        } catch (error) {
            logger.error(`Error deleting PPPoE user: ${error.message}`);
            throw error;
        }
    }
}

// Fungsi untuk mendapatkan daftar koneksi PPPoE aktif
async function getActivePPPoEConnections() {
    try {
        // Check cache first
        const cacheKey = 'mikrotik:pppoe:active';
        const cachedData = cacheManager.get(cacheKey);
        
        if (cachedData) {
            logger.debug(`✅ Using cached active PPPoE connections (${cachedData.data.length} connections)`);
            return cachedData;
        }

        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }
        
        logger.debug('🔍 Fetching active PPPoE connections from Mikrotik API...');
        // Dapatkan daftar koneksi PPPoE aktif
        const pppConnections = await conn.write('/ppp/active/print');
        
        const result = {
            success: true,
            message: `Ditemukan ${pppConnections.length} koneksi PPPoE aktif`,
            data: pppConnections
        };
        
        // Cache the response for 1 minute (shorter TTL for real-time data)
        cacheManager.set(cacheKey, result, 1 * 60 * 1000);
        
        logger.debug(`✅ Found ${pppConnections.length} active PPPoE connections from API`);
        return result;
    } catch (error) {
        logger.error(`Error getting active PPPoE connections: ${error.message}`);
        return { success: false, message: `Gagal ambil data PPPoE: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar user PPPoE offline
async function getOfflinePPPoEUsers() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return [];
        }
        
        // Dapatkan semua secret PPPoE
        const pppSecrets = await conn.write('/ppp/secret/print');
        
        // Dapatkan koneksi aktif
        const activeConnections = await getActivePPPoEConnections();
        const activeUsers = activeConnections.map(conn => conn.name);
        
        // Filter user yang offline
        const offlineUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        
        return offlineUsers;
    } catch (error) {
        logger.error(`Error getting offline PPPoE users: ${error.message}`);
        return [];
    }
}

// Fungsi untuk mendapatkan informasi user PPPoE yang tidak aktif (untuk whatsapp.js)
async function getInactivePPPoEUsers() {
    try {
        // Check cache first
        const cacheKey = 'mikrotik:pppoe:inactive';
        const cachedData = cacheManager.get(cacheKey);
        
        if (cachedData) {
            logger.debug(`✅ Using cached inactive PPPoE users (${cachedData.totalInactive} users)`);
            return cachedData;
        }

        logger.debug('🔍 Fetching inactive PPPoE users from Mikrotik API...');
        
        // Dapatkan semua secret PPPoE
        const pppSecrets = await getMikrotikConnection().then(conn => {
            if (!conn) return [];
            return conn.write('/ppp/secret/print');
        });
        
        // Dapatkan koneksi aktif
        let activeUsers = [];
        const activeConnectionsResult = await getActivePPPoEConnections();
        if (activeConnectionsResult && activeConnectionsResult.success && Array.isArray(activeConnectionsResult.data)) {
            activeUsers = activeConnectionsResult.data.map(conn => conn.name);
        }
        
        // Filter user yang offline
        const inactiveUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        
        // Format hasil untuk whatsapp.js
        const result = {
            success: true,
            totalSecrets: pppSecrets.length,
            totalActive: activeUsers.length,
            totalInactive: inactiveUsers.length,
            data: inactiveUsers.map(user => ({
                name: user.name,
                comment: user.comment || '',
                profile: user.profile,
                lastLogout: user['last-logged-out'] || 'N/A'
            }))
        };
        
        // Cache the response for 1 minute (shorter TTL for real-time data)
        cacheManager.set(cacheKey, result, 1 * 60 * 1000);
        
        logger.debug(`✅ Found ${inactiveUsers.length} inactive PPPoE users from API`);
        return result;
    } catch (error) {
        logger.error(`Error getting inactive PPPoE users: ${error.message}`);
        return {
            success: false,
            message: error.message,
            totalSecrets: 0,
            totalActive: 0,
            totalInactive: 0,
            data: []
        };
    }
}

// Fungsi untuk mendapatkan resource router
async function getRouterResources(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return null;
        }

        // Dapatkan resource router
        const resources = await conn.write('/system/resource/print');

        if (!resources || !resources[0]) {
            logger.warn('No resource data returned from Mikrotik');
            return null;
        }

        const resourceData = resources[0];
        
        // Coba ambil temperature dari berbagai sumber
        let temperatureFound = null;
        let temperatureSource = null;
        
        // 1. Coba dari /system/health/print (prioritas tertinggi)
        try {
            const health = await conn.write('/system/health/print');
            if (health && health.length > 0) {
                const healthData = health[0];
                // Prioritaskan cpu-temperature jika ada (lebih akurat untuk monitoring)
                if (healthData['cpu-temperature'] !== undefined) {
                    const tempVal = safeNumber(healthData['cpu-temperature']);
                    if (tempVal > 0 && tempVal < 150) {
                        temperatureFound = tempVal;
                        temperatureSource = '/system/health (cpu-temperature)';
                    }
                } else if (healthData.temperature !== undefined) {
                    const tempVal = safeNumber(healthData.temperature);
                    if (tempVal > 0 && tempVal < 150) {
                        temperatureFound = tempVal;
                        temperatureSource = '/system/health (temperature)';
                    }
                }
            }
        } catch (e) {
            // /system/health/print tidak tersedia di semua router, ini normal
            logger.debug(`[TEMP] /system/health/print not available: ${e.message}`);
        }
        
        // 2. Coba dari /system/routerboard/print (beberapa router menyimpan temperature di sini)
        if (temperatureFound === null) {
            try {
                const rb = await conn.write('/system/routerboard/print');
                if (rb && rb.length > 0) {
                    const rbData = rb[0];
                    // Cek berbagai field temperature yang mungkin ada
                    const tempFields = ['temperature', 'cpu-temperature', 'board-temperature', 'thermal-temperature'];
                    for (const field of tempFields) {
                        if (rbData[field] !== undefined) {
                            const tempVal = safeNumber(rbData[field]);
                            if (tempVal > 0 && tempVal < 150) {
                                temperatureFound = tempVal;
                                temperatureSource = `/system/routerboard (${field})`;
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                logger.debug(`[TEMP] /system/routerboard/print error: ${e.message}`);
            }
        }
        
        // 3. Cek di resourceData untuk field temperature alternatif
        if (temperatureFound === null) {
            const tempFieldNames = [
                'temperature', 'cpu-temperature', 'board-temperature', 
                'thermal-temperature', 'sensor-temperature'
            ];
            for (const fieldName of tempFieldNames) {
                if (resourceData[fieldName] !== undefined && resourceData[fieldName] !== null) {
                    const tempVal = safeNumber(resourceData[fieldName]);
                    if (tempVal > 0 && tempVal < 150) {
                        temperatureFound = tempVal;
                        temperatureSource = `/system/resource (${fieldName})`;
                        break;
                    }
                }
            }
        }
        
        // Simpan temperature ke resourceData jika ditemukan
        if (temperatureFound !== null) {
            resourceData['temperature'] = temperatureFound;
            resourceData['cpu-temperature'] = temperatureFound;
            logger.info(`[TEMP] Temperature found: ${temperatureFound}°C (from ${temperatureSource})`);
        } else {
            // Tidak ada temperature sensor - ini normal untuk beberapa model router
            // Ubah dari warn ke debug untuk mengurangi log spam
            logger.debug('[TEMP] No temperature sensor available on this router (this is normal for some models)');
        }

        return resourceData;
    } catch (error) {
        logger.error(`Error getting router resources: ${error.message}`);
        return null;
    }
}

function safeNumber(val) {
    if (val === undefined || val === null) return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
}
// Format uptime dari Mikrotik (format: "1w2d3h4m5s" atau seconds)
function formatUptime(uptimeStr) {
    if (!uptimeStr || uptimeStr === 'N/A') return 'N/A';
    
    // Jika sudah berupa string formatted, return langsung
    if (typeof uptimeStr === 'string' && (uptimeStr.includes('w') || uptimeStr.includes('d') || uptimeStr.includes('h'))) {
        return uptimeStr;
    }
    
    // Jika berupa number (seconds), convert ke formatted string
    let seconds = 0;
    if (typeof uptimeStr === 'number') {
        seconds = uptimeStr;
    } else if (typeof uptimeStr === 'string') {
        // Parse format Mikrotik: "1w2d3h4m5s"
        const weeks = (uptimeStr.match(/(\d+)w/) || [0, 0])[1];
        const days = (uptimeStr.match(/(\d+)d/) || [0, 0])[1];
        const hours = (uptimeStr.match(/(\d+)h/) || [0, 0])[1];
        const minutes = (uptimeStr.match(/(\d+)m/) || [0, 0])[1];
        const secs = (uptimeStr.match(/(\d+)s/) || [0, 0])[1];
        seconds = parseInt(weeks || 0) * 604800 + 
                  parseInt(days || 0) * 86400 + 
                  parseInt(hours || 0) * 3600 + 
                  parseInt(minutes || 0) * 60 + 
                  parseInt(secs || 0);
        
        // Jika tidak ada format, coba parse sebagai angka
        if (seconds === 0) {
            seconds = parseInt(uptimeStr) || 0;
        }
    }
    
    if (seconds === 0) return 'N/A';
    
    const weeks = Math.floor(seconds / 604800);
    const days = Math.floor((seconds % 604800) / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let result = [];
    if (weeks > 0) result.push(`${weeks}w`);
    if (days > 0) result.push(`${days}d`);
    if (hours > 0) result.push(`${hours}h`);
    if (minutes > 0) result.push(`${minutes}m`);
    if (secs > 0 || result.length === 0) result.push(`${secs}s`);
    
    return result.join('');
}

// Helper function untuk parsing memory dengan berbagai format
function parseMemoryValue(value) {
    if (!value) return 0;

    // Jika sudah berupa number, return langsung
    if (typeof value === 'number') return value;

    // Jika berupa string yang berisi angka
    if (typeof value === 'string') {
        // Coba parse sebagai integer dulu (untuk format bytes dari MikroTik)
        const intValue = parseInt(value);
        if (!isNaN(intValue)) return intValue;

        // Jika gagal, coba parse dengan unit
        const str = value.toString().toLowerCase();
        const numericPart = parseFloat(str.replace(/[^0-9.]/g, ''));
        if (isNaN(numericPart)) return 0;

        // Check for units
        if (str.includes('kib') || str.includes('kb')) {
            return numericPart * 1024;
        } else if (str.includes('mib') || str.includes('mb')) {
            return numericPart * 1024 * 1024;
        } else if (str.includes('gib') || str.includes('gb')) {
            return numericPart * 1024 * 1024 * 1024;
        } else {
            // Assume bytes if no unit
            return numericPart;
        }
    }

    return 0;
}

// Fungsi untuk mendapatkan informasi resource yang diformat
        // Fungsi untuk mendapatkan resource info per router
async function getResourceInfoForRouter(routerObj = null) {
    let routerboard = null; // Deklarasi di awal fungsi untuk akses global
    try {
        const resources = await getRouterResources(routerObj);
        if (!resources) {
            return { success: false, message: 'Resource router tidak ditemukan', data: null };
        }
        
        // Debug: Log semua field yang tersedia dari Mikrotik (hanya sekali per router)
        if (routerObj && routerObj.id) {
            logger.info(`[TEMP DEBUG] Router ${routerObj.name} (${routerObj.nas_ip}) - All resource fields:`, Object.keys(resources).sort());
            // Log semua nilai yang mungkin terkait temperature
            Object.keys(resources).forEach(key => {
                const val = resources[key];
                if (typeof val !== 'undefined' && val !== null && String(val).toLowerCase().includes('temp')) {
                    logger.info(`[TEMP DEBUG] Potential temp field: ${key} = ${val}`);
                }
            });
        }

        // Get connection untuk mengambil data tambahan (identity, routerboard, interfaces)
        // Buat koneksi sekali dan gunakan untuk semua operasi
        let conn = null;
        try {
            if (routerObj) {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } else {
                conn = await getMikrotikConnection();
            }
        } catch (e) {
            logger.error(`Error getting connection for router ${routerObj ? routerObj.name : 'default'}: ${e.message}`);
        }
        
        // Jika tidak ada koneksi, return error
        if (!conn) {
            logger.error(`No connection available for router ${routerObj ? routerObj.name : 'default'}`);
            return { success: false, message: 'Tidak dapat membuat koneksi ke router', data: null };
        }
        
        // Get all interfaces traffic for total network in/out
        let totalRx = 0, totalTx = 0;
        let interfacesData = [];
        try {
            const interfaces = await conn.write('/interface/print');
            if (Array.isArray(interfaces)) {
                for (const iface of interfaces) {
                    if (iface.name && !iface.name.startsWith('<')) {
                        try {
                            // Get traffic rate (bits per second)
                            const monitor = await conn.write('/interface/monitor-traffic', [
                                `=interface=${iface.name}`,
                                '=once='
                            ]);
                            
                            if (monitor && monitor.length > 0) {
                                const m = monitor[0];
                                // rx-bits-per-second dan tx-bits-per-second sudah dalam bits per second
                                // Langsung convert ke Mbps (1 Mbps = 1,000,000 bits per second)
                                const rxBits = parseInt(m['rx-bits-per-second'] || 0);
                                const txBits = parseInt(m['tx-bits-per-second'] || 0);
                                // Konversi langsung dari bits/s ke Mbps
                                totalRx += rxBits; // Total dalam bits per second
                                totalTx += txBits; // Total dalam bits per second
                                
                                // Get cumulative bytes from interface
                                const rxByte = parseInt(iface['rx-byte'] || 0);
                                const txByte = parseInt(iface['tx-byte'] || 0);
                                
                                // Convert bits to bytes per second for interface data
                                const rxBytesPerSec = rxBits / 8;
                                const txBytesPerSec = txBits / 8;
                                
                                interfacesData.push({
                                    name: iface.name,
                                    rxBytesPerSec: rxBytesPerSec,
                                    txBytesPerSec: txBytesPerSec,
                                    rxBytesTotal: rxByte,
                                    txBytesTotal: txByte
                                });
                            }
                        } catch (e) {
                            // Skip interface yang error, tapi tetap ambil cumulative bytes jika ada
                            const rxByte = parseInt(iface['rx-byte'] || 0);
                            const txByte = parseInt(iface['tx-byte'] || 0);
                            if (rxByte > 0 || txByte > 0) {
                                interfacesData.push({
                                    name: iface.name,
                                    rxBytesPerSec: 0,
                                    txBytesPerSec: 0,
                                    rxBytesTotal: rxByte,
                                    txBytesTotal: txByte
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('Error getting interfaces traffic:', e.message);
        }

        // Parse memory berdasarkan field yang tersedia di debug
        const totalMem = parseMemoryValue(resources['total-memory']) || 0;
        const freeMem = parseMemoryValue(resources['free-memory']) || 0;
        const usedMem = totalMem > 0 && freeMem >= 0 ? totalMem - freeMem : 0;

        // Parse disk space berdasarkan field yang tersedia di debug
        const totalDisk = parseMemoryValue(resources['total-hdd-space']) || 0;
        const freeDisk = parseMemoryValue(resources['free-hdd-space']) || 0;
        const usedDisk = totalDisk > 0 && freeDisk >= 0 ? totalDisk - freeDisk : 0;

        // Parse CPU load (bisa dalam format percentage atau decimal)
        let cpuLoad = safeNumber(resources['cpu-load']);
        if (cpuLoad > 0 && cpuLoad <= 1) {
            cpuLoad = cpuLoad * 100; // Convert dari decimal ke percentage
        }

        // Parse temperature - ambil dari resourceData (sudah di-set dari health jika ada)
        let temperature = null;
        if (resources['temperature'] !== undefined && resources['temperature'] !== null) {
            const tempVal = safeNumber(resources['temperature']);
            if (tempVal > 0 && tempVal < 150) {
                temperature = tempVal;
            }
        } else if (resources['cpu-temperature'] !== undefined && resources['cpu-temperature'] !== null) {
            const tempVal = safeNumber(resources['cpu-temperature']);
            if (tempVal > 0 && tempVal < 150) {
                temperature = tempVal;
            }
        }
        
        // Ambil informasi tambahan: Identity, Routerboard, CPU, Version, Voltage
        let routerIdentity = null;
        let routerboardInfo = null;
        let voltage = null;
        
        if (conn) {
            try {
                // Ambil identity dari /system/identity/print
                const identityResult = await conn.write('/system/identity/print');
                if (identityResult && identityResult.length > 0 && identityResult[0].name) {
                    routerIdentity = identityResult[0].name;
                    logger.info(`[INFO] Router identity retrieved: ${routerIdentity} for router ${routerObj ? routerObj.name : 'default'}`);
                } else {
                    logger.warn(`[INFO] No identity found for router ${routerObj ? routerObj.name : 'default'}`);
                }
            } catch (e) {
                logger.error(`[INFO] /system/identity/print error for router ${routerObj ? routerObj.name : 'default'}: ${e.message}`);
            }
            
            // Ambil routerboard info
            try {
                const rb = await conn.write('/system/routerboard/print');
                if (rb && rb.length > 0) {
                    routerboardInfo = rb[0];
                    if (routerboardInfo['voltage'] !== undefined) {
                        voltage = safeNumber(routerboardInfo['voltage']);
                    }
                }
            } catch (e) {
                logger.debug(`[INFO] /system/routerboard/print error: ${e.message}`);
            }
        } else {
            logger.warn(`[INFO] No connection available for router ${routerObj ? routerObj.name : 'default'} to fetch identity and routerboard info`);
        }
        
        // Simpan informasi tambahan ke resources
        if (routerIdentity) {
            resources['identity'] = routerIdentity;
        }
        if (routerboardInfo) {
            if (routerboardInfo['board-name']) {
                resources['board-name'] = routerboardInfo['board-name'];
            }
            if (routerboardInfo['model']) {
                resources['model'] = routerboardInfo['model'];
            }
        }
        if (voltage !== null) {
            resources['voltage'] = voltage;
        }

        const data = {
            // System info
            routerId: routerObj ? routerObj.id : null,
            routerName: routerObj ? routerObj.name : 'Default Router',
            routerIp: routerObj ? routerObj.nas_ip : null,
            
            // CPU
            cpuLoad: Math.round(cpuLoad),
            cpuCount: safeNumber(resources['cpu-count']),
            cpuFrequency: safeNumber(resources['cpu-frequency']),
            
            // Memory
            memoryUsedMB: totalMem > 0 ? parseFloat((usedMem / 1024 / 1024).toFixed(2)) : 0,
            memoryFreeMB: totalMem > 0 ? parseFloat((freeMem / 1024 / 1024).toFixed(2)) : 0,
            totalMemoryMB: totalMem > 0 ? parseFloat((totalMem / 1024 / 1024).toFixed(2)) : 0,
            memoryUsedPercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
            
            // HDD
            diskUsedMB: totalDisk > 0 ? parseFloat((usedDisk / 1024 / 1024).toFixed(2)) : 0,
            diskFreeMB: totalDisk > 0 ? parseFloat((freeDisk / 1024 / 1024).toFixed(2)) : 0,
            totalDiskMB: totalDisk > 0 ? parseFloat((totalDisk / 1024 / 1024).toFixed(2)) : 0,
            diskUsedPercent: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : 0,
            
            // Temperature
            temperature: temperature, // Sudah di-set dari /system/health atau resource
            
            // Network (aggregated from all interfaces)
            // totalRx dan totalTx sudah dalam bits per second, convert ke Mbps (divide by 1,000,000)
            totalNetworkInMbps: parseFloat((totalRx / 1000000).toFixed(2)),
            totalNetworkOutMbps: parseFloat((totalTx / 1000000).toFixed(2)),
            
            // Interfaces with Rx Bytes Total
            interfaces: interfacesData.sort((a, b) => b.rxBytesTotal - a.rxBytesTotal).slice(0, 10), // Top 10
            
            // Other info
            uptime: resources.uptime || 'N/A',
            uptimeFormatted: formatUptime(resources.uptime),
            version: resources.version || 'N/A',
            model: resources['model'] || resources['board-name'] || 'N/A',
            boardName: resources['board-name'] || 'N/A',
            platform: resources['platform'] || 'N/A',
            // Additional system info
            identity: resources['identity'] || routerIdentity || 'N/A', // Fallback ke routerIdentity jika belum di-set ke resources
            cpu: resources['cpu'] || resources['architecture-name'] || 'N/A',
            voltage: resources['voltage'] !== undefined && resources['voltage'] !== null ? safeNumber(resources['voltage']) : null
        };

        return {
            success: true,
            message: 'Berhasil mengambil info resource router',
            data
        };
    } catch (error) {
        logger.error(`Error getting resource info for router: ${error.message}`);
        return { success: false, message: `Gagal ambil resource router: ${error.message}`, data: null };
    }
}
async function getResourceInfo() {
    // Ambil traffic interface utama (default ether1)
    const interfaceName = getSetting('main_interface', 'ether1');
    let traffic = { rx: 0, tx: 0 };
    try {
        traffic = await getInterfaceTraffic(interfaceName);
    } catch (e) { traffic = { rx: 0, tx: 0 }; }

    try {
        const resources = await getRouterResources();
        if (!resources) {
            return { success: false, message: 'Resource router tidak ditemukan', data: null };
        }

        // Debug: Log raw resource data (bisa dinonaktifkan nanti)
        // logger.info('Raw MikroTik resource data:', JSON.stringify(resources, null, 2));

        // Parse memory berdasarkan field yang tersedia di debug
        // Berdasarkan debug: free-memory: 944705536, total-memory: 1073741824 (dalam bytes)
        const totalMem = parseMemoryValue(resources['total-memory']) || 0;
        const freeMem = parseMemoryValue(resources['free-memory']) || 0;
        const usedMem = totalMem > 0 && freeMem >= 0 ? totalMem - freeMem : 0;

        // Parse disk space berdasarkan field yang tersedia di debug
        // Berdasarkan debug: free-hdd-space: 438689792, total-hdd-space: 537133056 (dalam bytes)
        const totalDisk = parseMemoryValue(resources['total-hdd-space']) || 0;
        const freeDisk = parseMemoryValue(resources['free-hdd-space']) || 0;
        const usedDisk = totalDisk > 0 && freeDisk >= 0 ? totalDisk - freeDisk : 0;

        // Parse CPU load (bisa dalam format percentage atau decimal)
        let cpuLoad = safeNumber(resources['cpu-load']);
        if (cpuLoad > 0 && cpuLoad <= 1) {
            cpuLoad = cpuLoad * 100; // Convert dari decimal ke percentage
        }

        const data = {
            trafficRX: traffic && traffic.rx ? (traffic.rx / 1000000).toFixed(2) : '0.00',
            trafficTX: traffic && traffic.tx ? (traffic.tx / 1000000).toFixed(2) : '0.00',
            cpuLoad: Math.round(cpuLoad),
            cpuCount: safeNumber(resources['cpu-count']),
            cpuFrequency: safeNumber(resources['cpu-frequency']),
            architecture: resources['architecture-name'] || resources['cpu'] || 'N/A',
            model: resources['model'] || resources['board-name'] || 'N/A',
            serialNumber: resources['serial-number'] || 'N/A',
            firmware: resources['firmware-type'] || resources['version'] || 'N/A',
            voltage: resources['voltage'] || resources['board-voltage'] || 'N/A',
            temperature: resources['temperature'] || resources['board-temperature'] || 'N/A',
            badBlocks: resources['bad-blocks'] || 'N/A',
            // Konversi dari bytes ke MB dengan 2 decimal places
            memoryUsed: totalMem > 0 ? parseFloat((usedMem / 1024 / 1024).toFixed(2)) : 0,
            memoryFree: totalMem > 0 ? parseFloat((freeMem / 1024 / 1024).toFixed(2)) : 0,
            totalMemory: totalMem > 0 ? parseFloat((totalMem / 1024 / 1024).toFixed(2)) : 0,
            diskUsed: totalDisk > 0 ? parseFloat((usedDisk / 1024 / 1024).toFixed(2)) : 0,
            diskFree: totalDisk > 0 ? parseFloat((freeDisk / 1024 / 1024).toFixed(2)) : 0,
            totalDisk: totalDisk > 0 ? parseFloat((totalDisk / 1024 / 1024).toFixed(2)) : 0,
            uptime: resources.uptime || 'N/A',
            version: resources.version || 'N/A',
            boardName: resources['board-name'] || 'N/A',
            platform: resources['platform'] || 'N/A',
            // Debug info (bisa dihapus nanti)
            rawTotalMem: resources['total-memory'],
            rawFreeMem: resources['free-memory'],
            rawTotalDisk: resources['total-hdd-space'],
            rawFreeDisk: resources['free-hdd-space'],
            parsedTotalMem: totalMem,
            parsedFreeMem: freeMem,
            parsedTotalDisk: totalDisk,
            parsedFreeDisk: freeDisk
        };

        // Log parsed data for debugging (bisa dinonaktifkan nanti)
        // logger.info('Parsed memory data:', {
        //     totalMem: totalMem,
        //     freeMem: freeMem,
        //     usedMem: usedMem,
        //     totalMemMB: data.totalMemory,
        //     freeMemMB: data.memoryFree,
        //     usedMemMB: data.memoryUsed
        // });

        return {
            success: true,
            message: 'Berhasil mengambil info resource router',
            data
        };
    } catch (error) {
        logger.error(`Error getting formatted resource info: ${error.message}`);
        return { success: false, message: `Gagal ambil resource router: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan daftar user hotspot aktif dari RADIUS (HANYA voucher hotspot, BUKAN PPPoE)
async function getActiveHotspotUsersRadius() {
    const conn = await getRadiusConnection();
    
    // Ambil daftar voucher usernames untuk filter
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = require('path').join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    const voucherUsernames = await new Promise((resolve, reject) => {
        db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
            if (err) {
                logger.warn(`Error getting voucher usernames for active hotspot: ${err.message}`);
                resolve([]);
            } else {
                resolve(rows.map(r => r.username));
            }
        });
    });
    db.close();
    
    // Jika tidak ada voucher, return empty
    if (voucherUsernames.length === 0) {
        await conn.end();
        return {
            success: true,
            message: 'Tidak ada voucher hotspot aktif',
            data: []
        };
    }
    
    // Ambil user yang sedang online dari radacct (acctstoptime IS NULL) HANYA untuk voucher
    const placeholders = voucherUsernames.map(() => '?').join(',');
    const [rows] = await conn.execute(`
        SELECT DISTINCT username 
        FROM radacct 
        WHERE acctstoptime IS NULL 
        AND username IN (${placeholders})
    `, voucherUsernames);
    
    await conn.end();
    return {
        success: true,
        message: `Ditemukan ${rows.length} user hotspot aktif (RADIUS)` ,
        data: rows.map(row => ({ name: row.username, user: row.username }))
    };
}
// Fungsi untuk mengambil semua hotspot users dari RADIUS (HANYA voucher hotspot, BUKAN PPPoE users)
async function getHotspotUsersRadius() {
    const conn = await getRadiusConnection();
    try {
        logger.info('Fetching hotspot voucher users from RADIUS database (excluding PPPoE users)...');
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        await ensureVoucherRevenueColumns();
        const voucherMetadataRows = await new Promise((resolve, reject) => {
            db.all(`
                SELECT username,
                       MAX(created_at) as created_at,
                       MAX(price) as price,
                       MAX(status) as status,
                       MAX(server_name) as server_name,
                       MAX(server_metadata) as server_metadata
                FROM voucher_revenue
                GROUP BY username
            `, [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher metadata for hotspot: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows || []);
                }
            });
        });

        let voucherUsernames = [];
        const voucherMetadata = {};

        if (voucherMetadataRows.length > 0) {
            voucherUsernames = voucherMetadataRows.map(row => row.username);
            voucherMetadataRows.forEach(row => {
                if (row.username) {
                    let parsedMetadata = null;
                    if (row.server_metadata) {
                        try {
                            parsedMetadata = JSON.parse(row.server_metadata);
                        } catch (parseErr) {
                            logger.warn(`Failed to parse server_metadata for ${row.username}: ${parseErr.message}`);
                        }
                    }
                    const serverName = row.server_name || (parsedMetadata && parsedMetadata.name) || null;
                    if (parsedMetadata && !parsedMetadata.name && serverName) {
                        parsedMetadata.name = serverName;
                    }
                    voucherMetadata[row.username] = {
                        created_at: row.created_at || null,
                        price: row.price,
                        status: row.status,
                        server_name: serverName,
                        server_metadata: parsedMetadata || (serverName ? { name: serverName } : null)
                    };
                }
            });
        } else {
            voucherUsernames = await new Promise((resolve, reject) => {
                db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                    if (err) {
                        logger.warn(`Error getting voucher usernames for hotspot: ${err.message}`);
                        resolve([]);
                    } else {
                        resolve(rows.map(r => r.username));
                    }
                });
            });
        }
        db.close();

        logger.info(`Found ${voucherUsernames.length} voucher usernames to include`);

        if (voucherUsernames.length === 0) {
            await conn.end();
            logger.info('No voucher users found in voucher_revenue table');
            return {
                success: true,
                data: []
            };
        }

        const placeholders = voucherUsernames.map(() => '?').join(',');
        const [userRows] = await conn.execute(`
            SELECT DISTINCT c.username,
                   c.value as password,
                   (SELECT groupname FROM radusergroup WHERE username = c.username LIMIT 1) as profile,
                   (SELECT value FROM radreply WHERE username = c.username AND attribute = 'Reply-Message' LIMIT 1) as comment
            FROM radcheck c
            WHERE c.attribute = 'Cleartext-Password'
              AND c.username IN (${placeholders})
            ORDER BY c.username
        `, voucherUsernames);

        logger.info(`Found ${userRows.length} hotspot voucher users in radcheck table`);

        const [limitRows] = await conn.execute(`
            SELECT username, attribute, value
            FROM radcheck
            WHERE username IN (${placeholders})
              AND attribute IN ('Max-All-Session', 'Expire-After')
        `, voucherUsernames);

        // Ambil Called-Station-Id untuk server hotspot binding
        const [serverRows] = await conn.execute(`
            SELECT username, value
            FROM radcheck
            WHERE username IN (${placeholders})
              AND attribute = 'Called-Station-Id'
        `, voucherUsernames);

        const [sessionRows] = await conn.execute(`
            SELECT username, value
            FROM radreply
            WHERE username IN (${placeholders})
              AND attribute = 'Session-Timeout'
        `, voucherUsernames);

        const [acctRows] = await conn.execute(`
            SELECT username,
                   SUM(IFNULL(acctsessiontime,0)) AS total_session,
                   MIN(acctstarttime) AS first_login,
                   MAX(acctstarttime) AS last_login,
                   MAX(acctstoptime) AS last_logout,
                   MIN(acctstarttime) AS start_time,
                   SUM(IFNULL(acctinputoctets,0)) AS total_input_octets,
                   SUM(IFNULL(acctoutputoctets,0)) AS total_output_octets,
                   MAX(CASE WHEN acctstoptime IS NULL OR acctstoptime = '' OR acctstoptime = '0000-00-00 00:00:00' THEN framedipaddress ELSE NULL END) AS active_ip,
                   MAX(framedipaddress) AS last_ip,
                   MAX(nasipaddress) AS router_ip,
                   MAX(calledstationid) AS server_identifier
            FROM radacct
            WHERE username IN (${placeholders})
            GROUP BY username
        `, voucherUsernames);

        await conn.end();

        const limitMap = {};
        limitRows.forEach(row => {
            if (!limitMap[row.username]) {
                limitMap[row.username] = {};
            }
            if (row.attribute === 'Max-All-Session') {
                const parsed = parseInt(row.value, 10);
                limitMap[row.username].maxAllSession = !isNaN(parsed) && parsed > 0 ? parsed : null;
            } else if (row.attribute === 'Expire-After') {
                const parsed = parseInt(row.value, 10);
                limitMap[row.username].expireAfter = !isNaN(parsed) && parsed > 0 ? parsed : null;
            }
        });

        // Map server hotspot dari Called-Station-Id
        const serverMap = {};
        serverRows.forEach(row => {
            serverMap[row.username] = row.value || null;
        });

        const sessionTimeoutMap = {};
        sessionRows.forEach(row => {
            const parsed = parseInt(row.value, 10);
            sessionTimeoutMap[row.username] = !isNaN(parsed) && parsed > 0 ? parsed : null;
        });

        const acctMap = {};
        acctRows.forEach(row => {
            const totalInputOctets = row.total_input_octets ? parseFloat(row.total_input_octets) : 0;
            const totalOutputOctets = row.total_output_octets ? parseFloat(row.total_output_octets) : 0;
            const octetToMb = (value) => value > 0 ? value / (1024 * 1024) : 0;
            acctMap[row.username] = {
                totalSession: row.total_session ? parseInt(row.total_session, 10) || 0 : 0,
                first_login: row.first_login || null,
                last_login: row.last_login || null,
                last_logout: row.last_logout || null,
                start_time: row.start_time || row.last_login || null,
                total_upload_mb: octetToMb(totalInputOctets),
                total_download_mb: octetToMb(totalOutputOctets),
                active_ip: row.active_ip || null,
                last_ip: row.last_ip || null,
                router_ip: row.router_ip || null,
                server_identifier: row.server_identifier || null
            };
        });

        return {
            success: true,
            data: userRows.map(row => {
                const meta = voucherMetadata[row.username] || {};
                const limits = limitMap[row.username] || {};
                const acct = acctMap[row.username] || {};
                const serverMetadata = meta.server_metadata || null;
                const serverNameFromMeta = meta.server_name || (serverMetadata && serverMetadata.name) || null;
                // Ambil server hotspot dari Called-Station-Id (prioritas) atau dari metadata
                const serverHotspotFromRadius = serverMap[row.username] || null;
                const serverHotspot = serverHotspotFromRadius || serverNameFromMeta || null;
                return {
                    name: row.username,
                    password: row.password || '',
                    profile: row.profile || 'default',
                    comment: row.comment || '',
                    created_at: meta.created_at || null,
                    price: meta.price || null,
                    status: meta.status || null,
                    nas_name: 'RADIUS',
                    nas_ip: 'RADIUS',
                    limit_seconds: limits.maxAllSession || null,
                    validity_seconds: limits.expireAfter || null,
                    session_timeout_seconds: sessionTimeoutMap[row.username] || null,
                    total_session_seconds: acct.totalSession || 0,
                    first_login: acct.first_login || null,
                    last_login: acct.last_login || null,
                    last_logout: acct.last_logout || null,
                    start_time: acct.start_time || null,
                    last_update: acct.last_update || null,
                    total_upload_mb: acct.total_upload_mb || 0,
                    total_download_mb: acct.total_download_mb || 0,
                    ip_address: acct.active_ip || acct.last_ip || null,
                    router_ip: acct.router_ip || null,
                    server_identifier: acct.server_identifier || serverHotspot || null,
                    server_metadata: serverMetadata,
                    server_name: serverNameFromMeta,
                    server_hotspot: serverHotspot  // Server hotspot dari Called-Station-Id
                };
            })
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting hotspot users from RADIUS: ${error.message}`);
        return { success: false, message: error.message, data: [] };
    }
}
// Fungsi untuk menambah user hotspot ke RADIUS
async function addHotspotUserRadius(username, password, profile, comment = null, server = null, serverMetadata = null, limits = null) {
    const conn = await getRadiusConnection();
    try {
        const limitOptions = limits && typeof limits === 'object' ? limits : {};
        const uptimeSeconds = limitOptions.uptimeSeconds && !isNaN(parseInt(limitOptions.uptimeSeconds, 10)) && parseInt(limitOptions.uptimeSeconds, 10) > 0
            ? parseInt(limitOptions.uptimeSeconds, 10)
            : null;
        const validitySeconds = limitOptions.validitySeconds && !isNaN(parseInt(limitOptions.validitySeconds, 10)) && parseInt(limitOptions.validitySeconds, 10) > 0
            ? parseInt(limitOptions.validitySeconds, 10)
            : null;

        // Insert password ke radcheck
        await conn.execute(
            "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
            [username, password, password]
        );
        
        // Cek apakah profile exist di radgroupreply dengan case-sensitive
        // Jika tidak ada, coba dengan normalized version
        let profileToUse = profile || 'default';
        const [profileCheck] = await conn.execute(
            "SELECT DISTINCT groupname FROM radgroupreply WHERE groupname = ? LIMIT 1",
            [profileToUse]
        );
        
        // Jika profile tidak ditemukan dengan case-sensitive, coba normalized
        if (profileCheck.length === 0 && profile) {
            const normalizedProfile = profile.toLowerCase().replace(/\s+/g, '_');
            const [normalizedCheck] = await conn.execute(
                "SELECT DISTINCT groupname FROM radgroupreply WHERE groupname = ? LIMIT 1",
                [normalizedProfile]
            );
            
            if (normalizedCheck.length > 0) {
                profileToUse = normalizedProfile;
            } else {
                // Jika masih tidak ada, gunakan profile asli (case-sensitive)
                profileToUse = profile;
            }
        }
        
        // Assign user ke group (profile) di radusergroup
        // HAPUS SEMUA groupname untuk username ini terlebih dahulu untuk menghindari duplikasi
        await conn.execute(
            "DELETE FROM radusergroup WHERE username = ?",
            [username]
        );
        
        // Insert groupname yang baru
        await conn.execute(
            "INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)",
            [username, profileToUse]
        );
        
        // Add comment to radreply table if provided
        if (comment) {
            await conn.execute(
                "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Reply-Message', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, comment, comment]
            );
        }
        
        // Binding ke server hotspot tertentu (jika dipilih)
        const serverMeta = serverMetadata && typeof serverMetadata === 'object' ? { ...serverMetadata } : {};
        let sanitizedServer = '';
        if (serverMeta.name) {
            sanitizedServer = String(serverMeta.name).trim();
        } else if (typeof server === 'string') {
            sanitizedServer = server.trim();
        }

        const nasIdentifier = serverMeta.nasIdentifier || serverMeta.nas_identifier || null;
        const nasIp = serverMeta.nasIp || serverMeta.nas_ip || null;
        const routerName = serverMeta.nasName || serverMeta.nas_name || null;
        const nasPortId = serverMeta.interface || serverMeta.nasPortId || serverMeta['nas-port-id'] || null;

        const isGlobalServer = !sanitizedServer || ['all', 'semua', ''].includes(sanitizedServer.toLowerCase());

        // Bersihkan binding lama di radcheck (kondisi) dan radreply (reply)
        await conn.execute(
            "DELETE FROM radcheck WHERE username = ? AND attribute IN ('NAS-Identifier', 'NAS-IP-Address', 'Mikrotik-Host', 'NAS-Port-Id', 'Called-Station-Id', 'Max-All-Session', 'Expire-After')",
            [username]
        );
        await conn.execute(
            "DELETE FROM radreply WHERE username = ? AND attribute IN ('Mikrotik-Server', 'Session-Timeout')",
            [username]
        );

        if (!isGlobalServer) {
            if (nasPortId) {
                await conn.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'NAS-Port-Id', '==', ?) ON DUPLICATE KEY UPDATE value = ?",
                    [username, nasPortId, nasPortId]
                );
            }

            await conn.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Called-Station-Id', '==', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, sanitizedServer, sanitizedServer]
            );

            await conn.execute(
                "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Server', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, sanitizedServer, sanitizedServer]
            );

            logger.info(`Voucher ${username} bound to server ${sanitizedServer} (NAS-Identifier=${nasIdentifier || 'n/a'}, NAS-IP=${nasIp || 'n/a'}, Router=${routerName || 'n/a'}, NAS-Port-Id=${nasPortId || 'n/a'})`);
        } else {
            logger.info(`Voucher ${username} created without specific Mikrotik server binding (server parameter: ${sanitizedServer || 'all'})`);
        }

        if (uptimeSeconds) {
            await conn.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Max-All-Session', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, uptimeSeconds.toString(), uptimeSeconds.toString()]
            );
            logger.info(`Voucher ${username} uptime limit set to ${uptimeSeconds} seconds`);

            await conn.execute(
                "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, uptimeSeconds.toString(), uptimeSeconds.toString()]
            );
            logger.info(`Voucher ${username} session timeout set to ${uptimeSeconds} seconds`);
        } else {
            await conn.execute(
                "DELETE FROM radreply WHERE username = ? AND attribute = 'Session-Timeout'",
                [username]
            );
        }

        if (validitySeconds) {
            await conn.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Expire-After', ':=', ?) ON DUPLICATE KEY UPDATE value = ?",
                [username, validitySeconds.toString(), validitySeconds.toString()]
            );
            logger.info(`Voucher ${username} validity set to ${validitySeconds} seconds`);
        }

        logger.info(`Voucher ${username} created in RADIUS mode ${!isGlobalServer ? `with Mikrotik-Server=${sanitizedServer}` : 'without specific Mikrotik-Server'} (original server parameter: ${server || 'all'})${uptimeSeconds ? `, uptime limit=${uptimeSeconds}s` : ''}${validitySeconds ? `, validity=${validitySeconds}s` : ''}`);
        
        await conn.end();
        return { success: true, message: 'User hotspot berhasil ditambahkan ke RADIUS' };
    } catch (error) {
        await conn.end();
        logger.error(`Error adding hotspot user to RADIUS: ${error.message}`);
        throw error;
    }
}

// Wrapper: Pilih mode autentikasi dari settings
async function getActiveHotspotUsers(routerObj = null) {
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        return await getActiveHotspotUsersRadius();
    } else {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }
        // Dapatkan daftar user hotspot aktif
        const hotspotUsers = await conn.write('/ip/hotspot/active/print');
        logger.info(`Found ${hotspotUsers.length} active hotspot users`);
        
        return {
            success: true,
            message: `Ditemukan ${hotspotUsers.length} user hotspot aktif`,
            data: hotspotUsers
        };
    }
}
// Fungsi untuk menambahkan user hotspot
async function addHotspotUser(username, password, profile, comment = null, customer = null, routerObj = null, price = null, server = null, serverMetadata = null, limits = null) {
    let conn = null;
    const mode = await getUserAuthModeAsync();
    const limitOptions = limits && typeof limits === 'object' ? limits : {};
    const uptimeSeconds = limitOptions.uptimeSeconds && !isNaN(parseInt(limitOptions.uptimeSeconds, 10)) && parseInt(limitOptions.uptimeSeconds, 10) > 0
        ? parseInt(limitOptions.uptimeSeconds, 10)
        : null;
    const validitySeconds = limitOptions.validitySeconds && !isNaN(parseInt(limitOptions.validitySeconds, 10)) && parseInt(limitOptions.validitySeconds, 10) > 0
        ? parseInt(limitOptions.validitySeconds, 10)
        : null;
    if (mode === 'radius') {
        let result = { success: false, message: 'Unknown error' };
        try {
            let serverInfo = serverMetadata;
            if (!serverInfo || typeof serverInfo !== 'object') {
                serverInfo = {};
            }
            if (server && typeof server === 'string') {
                server = server.trim();
                if (!serverInfo.name) serverInfo.name = server;
            }
            result = await addHotspotUserRadius(username, password, profile, comment, server, serverInfo, limits);
        } catch (radiusError) {
            logger.error(`Error in addHotspotUserRadius for ${username}: ${radiusError.message}`);
            // Tetap lanjutkan untuk membuat invoice, karena mungkin user sudah dibuat sebagian
            result = { success: false, message: radiusError.message };
        }
        
        // Simpan data voucher untuk laporan keuangan (TANPA membuat invoice)
        // Invoice hanya untuk pelanggan PPPoE, bukan untuk voucher
        let voucherRecordId = null;
        // Parse price dengan lebih robust: handle string, number, null, undefined
        let voucherPrice = 0;
        if (price !== null && price !== undefined && price !== '') {
            voucherPrice = parseFloat(price);
            if (isNaN(voucherPrice)) {
                voucherPrice = 0;
            }
        }
        const getServerNameForVoucher = () => {
            if (serverMetadata && typeof serverMetadata === 'object') {
                const raw = serverMetadata.name || serverMetadata.server || serverMetadata.nasName || serverMetadata.nas_name || serverMetadata.serverName;
                if (raw) return String(raw).trim();
            }
            if (typeof server === 'string') {
                return server.trim();
            }
            return null;
        };
        let serverNameForVoucher = getServerNameForVoucher();
        if (serverNameForVoucher && ['all', 'semua', ''].includes(serverNameForVoucher.toLowerCase())) {
            serverNameForVoucher = null;
        }
        let serverMetadataForStore = null;
        if (serverMetadata && typeof serverMetadata === 'object') {
            const metadataToStore = { ...serverMetadata };
            if (!metadataToStore.name && serverNameForVoucher) {
                metadataToStore.name = serverNameForVoucher;
            }
            try {
                serverMetadataForStore = JSON.stringify(metadataToStore);
            } catch (jsonErr) {
                logger.warn(`Failed to stringify server metadata for ${username}: ${jsonErr.message}`);
                serverMetadataForStore = null;
            }
        } else if (serverNameForVoucher) {
            serverMetadataForStore = JSON.stringify({ name: serverNameForVoucher });
        }
        await ensureVoucherRevenueColumns();
        logger.info(`Saving voucher revenue record for ${username} with price: ${voucherPrice} (original price param: ${price}, type: ${typeof price}) (RADIUS result: ${result.success ? 'success' : 'failed'})`);
        try {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = require('path').join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            
            logger.info(`[DEBUG] Opening database: ${dbPath}`);
            
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.get(`SELECT id, server_name, server_metadata FROM voucher_revenue WHERE username = ?`, [username], async (selectErr, existing) => {
                        if (selectErr) {
                            logger.error(`Failed to query existing voucher revenue for ${username}: ${selectErr.message}`);
                            reject(selectErr);
                            return;
                        }

                        const runAsync = (sql, params) => new Promise((res, rej) => {
                            db.run(sql, params, function(err) {
                                if (err) {
                                    rej(err);
                                } else {
                                    res(this);
                                }
                            });
                        });

                        try {
                            let runResult = null;
                            if (existing && existing.id) {
                                runResult = await runAsync(`
                                    UPDATE voucher_revenue
                                    SET price = ?,
                                        profile = ?,
                                        status = ?,
                                        notes = ?,
                                        server_name = COALESCE(?, server_name),
                                        server_metadata = COALESCE(?, server_metadata)
                                    WHERE username = ?
                                `, [
                                    voucherPrice,
                                    profile,
                                    'unpaid',
                                    `Voucher Hotspot ${username} - Profile: ${profile}`,
                                    serverNameForVoucher,
                                    serverMetadataForStore,
                                    username
                                ]);
                                voucherRecordId = existing.id;
                                logger.info(`🔁 Voucher revenue record updated for ${username}: ID=${voucherRecordId}`);
                            } else {
                                runResult = await runAsync(`
                                    INSERT INTO voucher_revenue (username, price, profile, created_at, status, notes, server_name, server_metadata)
                                    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)
                                `, [
                                    username,
                                    voucherPrice,
                                    profile,
                                    'unpaid',
                                    `Voucher Hotspot ${username} - Profile: ${profile}`,
                                    serverNameForVoucher,
                                    serverMetadataForStore
                                ]);
                                voucherRecordId = runResult ? runResult.lastID : null;
                                logger.info(`✅ Voucher revenue record saved for ${username}: ID=${voucherRecordId}, Price=Rp ${voucherPrice} - Status: unpaid (will be paid when voucher is used)`);
                            }

                            db.get(`SELECT username, price, status, server_name FROM voucher_revenue WHERE username = ?`, [username], (verifyErr, verifyRow) => {
                                if (verifyErr) {
                                    logger.error(`[DEBUG] Error verifying voucher revenue record: ${verifyErr.message}`);
                                } else if (verifyRow) {
                                    logger.info(`[DEBUG] Voucher revenue record verified: ${verifyRow.username}, price=${verifyRow.price}, status=${verifyRow.status}, server_name=${verifyRow.server_name}`);
                                } else {
                                    logger.error(`[DEBUG] Voucher revenue record not found after save! Username: ${username}`);
                                }
                            });

                            resolve();
                        } catch (runErr) {
                            reject(runErr);
                        }
                    });
                });
            });
            
            db.close();
            logger.info(`✅ Voucher revenue record creation completed for ${username}. Record ID: ${voucherRecordId || 'null'}`);
        } catch (voucherError) {
            // Log error dengan detail untuk debugging
            logger.error(`❌ CRITICAL: Error saving voucher revenue record for ${username}: ${voucherError.message}`);
            logger.error(`Voucher error stack: ${voucherError.stack}`);
            // Coba sekali lagi dengan retry logic
            try {
                logger.info(`Retrying voucher revenue record creation for ${username}...`);
                const sqlite3 = require('sqlite3').verbose();
                const dbPath = require('path').join(__dirname, '../data/billing.db');
                const db = new sqlite3.Database(dbPath);
                
                await new Promise((resolve, reject) => {
                    db.serialize(() => {
                        db.get(`SELECT id FROM voucher_revenue WHERE username = ?`, [username], async (selectErr, existing) => {
                            if (selectErr) {
                                reject(selectErr);
                                return;
                            }

                            const runAsync = (sql, params) => new Promise((res, rej) => {
                                db.run(sql, params, function(err) {
                                    if (err) {
                                        rej(err);
                                    } else {
                                        res(this);
                                    }
                                });
                            });

                            try {
                                if (existing && existing.id) {
                                    await runAsync(`
                                        UPDATE voucher_revenue
                                        SET price = ?, profile = ?, status = ?, notes = ?, server_name = COALESCE(?, server_name), server_metadata = COALESCE(?, server_metadata)
                                        WHERE username = ?
                                    `, [
                                        voucherPrice,
                                        profile,
                                        'unpaid',
                                        `Voucher Hotspot ${username} - Profile: ${profile}`,
                                        serverNameForVoucher,
                                        serverMetadataForStore,
                                        username
                                    ]);
                                    voucherRecordId = existing.id;
                                } else {
                                    const insertResult = await runAsync(`
                                        INSERT INTO voucher_revenue (username, price, profile, created_at, status, notes, server_name, server_metadata)
                                        VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)
                                    `, [
                                        username,
                                        voucherPrice,
                                        profile,
                                        'unpaid',
                                        `Voucher Hotspot ${username} - Profile: ${profile}`,
                                        serverNameForVoucher,
                                        serverMetadataForStore
                                    ]);
                                    voucherRecordId = insertResult ? insertResult.lastID : null;
                                }
                                resolve();
                            } catch (runErr) {
                                reject(runErr);
                            }
                        });
                    });
                });
                
                db.close();
            } catch (retryError) {
                logger.error(`❌ Retry also failed for ${username}: ${retryError.message}`);
            }
        }
        
        return { ...result, voucherRecordId };
    } else {
        if (customer) {
          conn = await getMikrotikConnectionForCustomer(customer);
        } else if (routerObj) {
          conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
          conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke router gagal: Data router/NAS tidak ditemukan');
            // Prepare parameters
            const params = [
                '=name=' + username,
                '=password=' + password,
                '=profile=' + profile
            ];
            if (comment) {
                params.push('=comment=' + comment);
            }
            // Add server parameter if provided (untuk menentukan server instance)
            if (server && server.trim() !== '' && server !== 'all') {
                params.push('=server=' + server);
            }
            await conn.write('/ip/hotspot/user/add', params);

            if (uptimeSeconds || validitySeconds) {
                try {
                    const users = await conn.write('/ip/hotspot/user/print', ['?name=' + username]);
                    if (users && users.length > 0) {
                        const userId = users[0]['.id'];
                        if (uptimeSeconds) {
                            await conn.write('/ip/hotspot/user/set', ['=.id=' + userId, '=limit-uptime=' + uptimeSeconds + 's']);
                        }
                        if (validitySeconds) {
                            const validityInfo = `[validity:${validitySeconds}s]`;
                            await conn.write('/ip/hotspot/user/set', ['=.id=' + userId, '=comment=' + validityInfo]);
                        }
                    }
                } catch (limitErr) {
                    logger.warn(`Failed to apply per-user limits in Mikrotik mode for ${username}: ${limitErr.message}`);
                }
            }
            return { success: true, message: 'User hotspot berhasil ditambahkan' };
    }
}
// Fungsi untuk menghapus user hotspot
async function deleteHotspotUser(username, routerObj = null) {
    try {
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius') {
            // Delete dari RADIUS database
            const conn = await getRadiusConnection();
            try {
                // Hapus dari radcheck
                await conn.execute(
                    "DELETE FROM radcheck WHERE username = ?",
                    [username]
                );
                // Hapus dari radusergroup
                await conn.execute(
                    "DELETE FROM radusergroup WHERE username = ?",
                    [username]
                );
                // Hapus dari radreply
                await conn.execute(
                    "DELETE FROM radreply WHERE username = ?",
                    [username]
                );
                await conn.end();
                
                // Hapus invoice terkait dari billing.db
                try {
                    const sqlite3 = require('sqlite3').verbose();
                    const dbPath = require('path').join(__dirname, '../data/billing.db');
                    const db = new sqlite3.Database(dbPath);
                    
                    await new Promise((resolve, reject) => {
                        // Cari invoice berdasarkan notes yang mengandung username
                        db.run(`
                            DELETE FROM invoices 
                            WHERE invoice_type = 'voucher' 
                            AND notes LIKE ?
                        `, [`Voucher Hotspot ${username}%`], function(err) {
                            if (err) {
                                logger.error(`Error deleting invoice for voucher ${username}: ${err.message}`);
                                reject(err);
                            } else {
                                if (this.changes > 0) {
                                    logger.info(`✅ Deleted ${this.changes} invoice(s) for voucher ${username}`);
                                }
                                resolve();
                            }
                        });
                    });
                    
                    db.close();
                } catch (invoiceError) {
                    logger.error(`Error deleting invoice for voucher ${username}: ${invoiceError.message}`);
                    // Jangan throw error, karena voucher sudah dihapus dari RADIUS
                }
                
                return { success: true, message: 'User hotspot berhasil dihapus dari RADIUS' };
            } catch (error) {
                await conn.end();
                logger.error(`Error deleting hotspot user from RADIUS: ${error.message}`);
                throw error;
            }
        } else {
            // Delete dari Mikrotik
            let conn = null;
            if (routerObj) {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } else {
                conn = await getMikrotikConnection();
            }
            if (!conn) {
                logger.error('No Mikrotik connection available');
                return { success: false, message: 'Koneksi ke Mikrotik gagal' };
            }
            // Cari user hotspot
            const users = await conn.write('/ip/hotspot/user/print', [
                '?name=' + username
            ]);
            if (users.length === 0) {
                return { success: false, message: 'User hotspot tidak ditemukan' };
            }
            // Hapus user hotspot
            await conn.write('/ip/hotspot/user/remove', [
                '=.id=' + users[0]['.id']
            ]);
            return { success: true, message: 'User hotspot berhasil dihapus' };
        }
    } catch (error) {
        logger.error(`Error deleting hotspot user: ${error.message}`);
        return { success: false, message: `Gagal menghapus user hotspot: ${error.message}` };
    }
}
// Fungsi untuk menambahkan secret PPPoE
async function addPPPoESecret(username, password, profile, localAddress = '', conn) {
    try {
        if (!conn) {
            // Backward compatibility: fallback to global connection if no explicit conn provided
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Parameter untuk menambahkan secret
        const params = [
            '=name=' + username,
            '=password=' + password,
            '=profile=' + profile,
            '=service=pppoe'
        ];
        if (localAddress) {
            params.push('=local-address=' + localAddress);
        }
        // Tambahkan secret PPPoE
        await conn.write('/ppp/secret/add', params);
        return { success: true, message: 'Secret PPPoE berhasil ditambahkan' };
    } catch (error) {
        logger.error(`Error adding PPPoE secret: ${error.message}`);
        return { success: false, message: `Gagal menambah secret PPPoE: ${error.message}` };
    }
}
// Fungsi untuk menghapus secret PPPoE
async function deletePPPoESecret(username) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Cari secret PPPoE
        const secrets = await conn.write('/ppp/secret/print', [
            '?name=' + username
        ]);
        if (secrets.length === 0) {
            return { success: false, message: 'Secret PPPoE tidak ditemukan' };
        }
        // Hapus secret PPPoE
        await conn.write('/ppp/secret/remove', [
            '=.id=' + secrets[0]['.id']
        ]);
        return { success: true, message: 'Secret PPPoE berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting PPPoE secret: ${error.message}`);
        return { success: false, message: `Gagal menghapus secret PPPoE: ${error.message}` };
    }
}

// Fungsi helper untuk disconnect PPPoE user (dapat digunakan untuk router spesifik)
async function disconnectPPPoEUser(username, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', disconnected: 0 };
        }
        
        // Cari sesi aktif user
        const activeSessions = await conn.write('/ppp/active/print', [
            `?name=${username}`
        ]);
        
        if (!activeSessions || activeSessions.length === 0) {
            return { success: true, message: `User ${username} tidak sedang online`, disconnected: 0 };
        }
        
        // Hapus semua sesi aktif user ini
        let disconnected = 0;
        for (const session of activeSessions) {
            try {
                await conn.write('/ppp/active/remove', [
                    `=.id=${session['.id']}`
                ]);
                disconnected++;
            } catch (removeError) {
                logger.warn(`Failed to remove session ${session['.id']} for ${username}: ${removeError.message}`);
            }
        }
        
        // Verifikasi bahwa semua session sudah terputus
        // Tunggu sebentar untuk memastikan disconnect selesai
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Cek lagi apakah masih ada session aktif
        const remainingSessions = await conn.write('/ppp/active/print', [
            `?name=${username}`
        ]);
        
        if (remainingSessions && remainingSessions.length > 0) {
            logger.warn(`Some sessions still active for ${username} after disconnect attempt, retrying...`);
            // Retry disconnect untuk session yang masih aktif
            for (const session of remainingSessions) {
                try {
                    await conn.write('/ppp/active/remove', [
                        `=.id=${session['.id']}`
                    ]);
                    disconnected++;
                } catch (retryError) {
                    logger.warn(`Failed to remove remaining session ${session['.id']} for ${username}: ${retryError.message}`);
                }
            }
        }
        
        logger.info(`Disconnected ${disconnected} active PPPoE session(s) for ${username}`);
        return { success: true, message: `User ${username} berhasil diputus dari ${disconnected} sesi aktif`, disconnected: disconnected };
    } catch (error) {
        logger.error(`Error disconnecting PPPoE user ${username}: ${error.message}`);
        return { success: false, message: `Gagal memutus koneksi PPPoE: ${error.message}`, disconnected: 0 };
    }
}

// Fungsi untuk mengubah profile PPPoE
async function setPPPoEProfile(username, profile) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Cari secret PPPoE
        const secrets = await conn.write('/ppp/secret/print', [
            '?name=' + username
        ]);
        if (secrets.length === 0) {
            return { success: false, message: 'Secret PPPoE tidak ditemukan' };
        }
        // Ubah profile PPPoE
        await conn.write('/ppp/secret/set', [
            '=.id=' + secrets[0]['.id'],
            '=profile=' + profile
        ]);

        // Tambahan: Kick user dari sesi aktif PPPoE
        // Cari sesi aktif
        const activeSessions = await conn.write('/ppp/active/print', [
            '?name=' + username
        ]);
        if (activeSessions.length > 0) {
            // Hapus semua sesi aktif user ini
            for (const session of activeSessions) {
                await conn.write('/ppp/active/remove', [
                    '=.id=' + session['.id']
                ]);
            }
            logger.info(`User ${username} di-kick dari sesi aktif PPPoE setelah ganti profile`);
        }

        return { success: true, message: 'Profile PPPoE berhasil diubah dan user di-kick dari sesi aktif' };
    } catch (error) {
        logger.error(`Error setting PPPoE profile: ${error.message}`);
        return { success: false, message: `Gagal mengubah profile PPPoE: ${error.message}` };
    }
}
// Fungsi untuk monitoring koneksi PPPoE
let lastActivePPPoE = [];
async function monitorPPPoEConnections() {
    try {
        // Cek ENV untuk enable/disable monitoring
        const monitorEnableRaw = getSetting('pppoe_monitor_enable', true);
        const monitorEnable = typeof monitorEnableRaw === 'string'
            ? monitorEnableRaw.toLowerCase() === 'true'
            : Boolean(monitorEnableRaw);
        if (!monitorEnable) {
            logger.info('PPPoE monitoring is DISABLED by ENV');
            return;
        }
        // Dapatkan interval monitoring dari konfigurasi dalam menit, konversi ke milidetik
        const intervalMinutes = parseFloat(getSetting('pppoe_monitor_interval_minutes', '1'));
        const interval = intervalMinutes * 60 * 1000; // Convert minutes to milliseconds
        
        console.log(`📋 Starting PPPoE monitoring (interval: ${intervalMinutes} menit / ${interval/1000}s)`);
        
        // Bersihkan interval sebelumnya jika ada
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
        
        // Set interval untuk monitoring
        monitorInterval = setInterval(async () => {
            try {
                // Dapatkan koneksi PPPoE aktif
                const connections = await getActivePPPoEConnections();
                if (!connections.success) {
                    logger.warn(`Monitoring PPPoE connections failed: ${connections.message}`);
                    return;
                }
                const activeNow = connections.data.map(u => u.name);
                // Deteksi login/logout
                const loginUsers = activeNow.filter(u => !lastActivePPPoE.includes(u));
                const logoutUsers = lastActivePPPoE.filter(u => !activeNow.includes(u));
                if (loginUsers.length > 0) {
                    // Ambil detail user login
                    const loginDetail = connections.data.filter(u => loginUsers.includes(u.name));
                    // Ambil daftar user offline
                    let offlineList = [];
                    try {
                        const conn = await getMikrotikConnection();
                        const pppSecrets = await conn.write('/ppp/secret/print');
                        offlineList = pppSecrets.filter(secret => !activeNow.includes(secret.name)).map(u => u.name);
                    } catch (e) {}
                    // Format pesan WhatsApp
                    let msg = `🔔 *PPPoE LOGIN*\n\n`;
                    loginDetail.forEach((u, i) => {
                        msg += `*${i+1}. ${u.name}*\n• Address: ${u.address || '-'}\n• Uptime: ${u.uptime || '-'}\n\n`;
                    });
                    msg += `🚫 *Pelanggan Offline* (${offlineList.length})\n`;
                    offlineList.forEach((u, i) => {
                        msg += `${i+1}. ${u}\n`;
                    });
                    // Kirim ke group WhatsApp
                    const technicianGroupId = getSetting('technician_group_id', '');
                    if (sock && technicianGroupId) {
                        try {
                            await sock.sendMessage(technicianGroupId, { text: msg });
                            logger.info(`PPPoE login notification sent to group: ${technicianGroupId}`);
                        } catch (e) {
                            logger.error('Gagal kirim notifikasi PPPoE ke WhatsApp group:', e);
                        }
                    } else {
                        logger.warn('No technician group configured for PPPoE notifications');
                    }
                    logger.info('PPPoE LOGIN:', loginUsers);
                }
                if (logoutUsers.length > 0) {
                    // Ambil detail user logout dari lastActivePPPoE (karena sudah tidak ada di connections.data)
                    let logoutDetail = logoutUsers.map(name => ({ name }));
                    // Ambil daftar user offline terbaru
                    let offlineList = [];
                    try {
                        const conn = await getMikrotikConnection();
                        const pppSecrets = await conn.write('/ppp/secret/print');
                        offlineList = pppSecrets.filter(secret => !activeNow.includes(secret.name)).map(u => u.name);
                    } catch (e) {}
                    // Format pesan WhatsApp
                    let msg = `🚪 *PPPoE LOGOUT*\n\n`;
                    logoutDetail.forEach((u, i) => {
                        msg += `*${i+1}. ${u.name}*\n\n`;
                    });
                    msg += `🚫 *Pelanggan Offline* (${offlineList.length})\n`;
                    offlineList.forEach((u, i) => {
                        msg += `${i+1}. ${u}\n`;
                    });
                    // Kirim ke group WhatsApp
                    const technicianGroupId = getSetting('technician_group_id', '');
                    if (sock && technicianGroupId) {
                        try {
                            await sock.sendMessage(technicianGroupId, { text: msg });
                            logger.info(`PPPoE logout notification sent to group: ${technicianGroupId}`);
                        } catch (e) {
                            logger.error('Gagal kirim notifikasi PPPoE LOGOUT ke WhatsApp group:', e);
                        }
                    } else {
                        logger.warn('No technician group configured for PPPoE notifications');
                    }
                    logger.info('PPPoE LOGOUT:', logoutUsers);
                }
                lastActivePPPoE = activeNow;
                logger.info(`Monitoring PPPoE connections: ${connections.data.length} active connections`);
            } catch (error) {
                logger.error(`Error in PPPoE monitoring: ${error.message}`);
            }
        }, interval);
        
        logger.info(`PPPoE monitoring started with interval ${interval}ms`);
    } catch (error) {
        logger.error(`Error starting PPPoE monitoring: ${error.message}`);
    }
}
// Fungsi untuk mendapatkan traffic interface
async function getInterfaceTraffic(interfaceName = 'ether1') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) return { rx: 0, tx: 0 };
        const res = await conn.write('/interface/monitor-traffic', [
            `=interface=${interfaceName}`,
            '=once='
        ]);
        if (!res || !res[0]) return { rx: 0, tx: 0 };
        // RX/TX dalam bps
        return {
            rx: res[0]['rx-bits-per-second'] || 0,
            tx: res[0]['tx-bits-per-second'] || 0
        };
    } catch (error) {
        logger.error('Error getting interface traffic:', error.message, error);
        return { rx: 0, tx: 0 };
    }
}
// Fungsi untuk mendapatkan daftar interface dari router tertentu
async function getInterfacesForRouter(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const interfaces = await conn.write('/interface/print');
        
        if (Array.isArray(interfaces)) {
            const interfaceList = interfaces
                .filter(iface => iface.name && !iface.name.startsWith('<'))
                .map(iface => ({
                    name: iface.name,
                    type: iface.type || '',
                    disabled: iface.disabled === 'true',
                    running: iface.running === 'true'
                }));
            
            return {
                success: true,
                message: `Ditemukan ${interfaceList.length} interface`,
                data: interfaceList
            };
        } else {
            return { success: false, message: 'Gagal mendapatkan interface', data: [] };
        }
    } catch (error) {
        logger.error(`Error getting interfaces: ${error.message}`);
        return { success: false, message: `Gagal ambil data interface: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar address pool dari router tertentu
async function getAddressPoolsForRouter(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const pools = await conn.write('/ip/pool/print');
        
        if (Array.isArray(pools)) {
            const poolList = pools.map(pool => ({
                name: pool.name,
                ranges: pool.ranges || '',
                comment: pool.comment || ''
            }));
            
            return {
                success: true,
                message: `Ditemukan ${poolList.length} address pool`,
                data: poolList
            };
        } else {
            return { success: false, message: 'Gagal mendapatkan address pool', data: [] };
        }
    } catch (error) {
        logger.error(`Error getting address pools: ${error.message}`);
        return { success: false, message: `Gagal ambil data address pool: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar interface (legacy, untuk backward compatibility)
async function getInterfaces() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const interfaces = await conn.write('/interface/print');
        return {
            success: true,
            message: `Ditemukan ${interfaces.length} interface`,
            data: interfaces
        };
    } catch (error) {
        logger.error(`Error getting interfaces: ${error.message}`);
        return { success: false, message: `Gagal ambil data interface: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan detail interface tertentu
async function getInterfaceDetail(interfaceName) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const interfaces = await conn.write('/interface/print', [
            `?name=${interfaceName}`
        ]);

        if (interfaces.length === 0) {
            return { success: false, message: 'Interface tidak ditemukan', data: null };
        }

        return {
            success: true,
            message: `Detail interface ${interfaceName}`,
            data: interfaces[0]
        };
    } catch (error) {
        logger.error(`Error getting interface detail: ${error.message}`);
        return { success: false, message: `Gagal ambil detail interface: ${error.message}`, data: null };
    }
}

// Fungsi untuk enable/disable interface
async function setInterfaceStatus(interfaceName, enabled) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari interface
        const interfaces = await conn.write('/interface/print', [
            `?name=${interfaceName}`
        ]);

        if (interfaces.length === 0) {
            return { success: false, message: 'Interface tidak ditemukan' };
        }

        // Set status interface
        const action = enabled ? 'enable' : 'disable';
        await conn.write(`/interface/${action}`, [
            `=.id=${interfaces[0]['.id']}`
        ]);

        return {
            success: true,
            message: `Interface ${interfaceName} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`
        };
    } catch (error) {
        logger.error(`Error setting interface status: ${error.message}`);
        return { success: false, message: `Gagal mengubah status interface: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan daftar IP address
async function getIPAddresses() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const addresses = await conn.write('/ip/address/print');
        return {
            success: true,
            message: `Ditemukan ${addresses.length} IP address`,
            data: addresses
        };
    } catch (error) {
        logger.error(`Error getting IP addresses: ${error.message}`);
        return { success: false, message: `Gagal ambil data IP address: ${error.message}`, data: [] };
    }
}

// Fungsi untuk menambah IP address
async function addIPAddress(interfaceName, address) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/ip/address/add', [
            `=interface=${interfaceName}`,
            `=address=${address}`
        ]);

        return { success: true, message: `IP address ${address} berhasil ditambahkan ke ${interfaceName}` };
    } catch (error) {
        logger.error(`Error adding IP address: ${error.message}`);
        return { success: false, message: `Gagal menambah IP address: ${error.message}` };
    }
}
// Fungsi untuk menghapus IP address
async function deleteIPAddress(interfaceName, address) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari IP address
        const addresses = await conn.write('/ip/address/print', [
            `?interface=${interfaceName}`,
            `?address=${address}`
        ]);

        if (addresses.length === 0) {
            return { success: false, message: 'IP address tidak ditemukan' };
        }

        // Hapus IP address
        await conn.write('/ip/address/remove', [
            `=.id=${addresses[0]['.id']}`
        ]);

        return { success: true, message: `IP address ${address} berhasil dihapus dari ${interfaceName}` };
    } catch (error) {
        logger.error(`Error deleting IP address: ${error.message}`);
        return { success: false, message: `Gagal menghapus IP address: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan routing table
async function getRoutes() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const routes = await conn.write('/ip/route/print');
        return {
            success: true,
            message: `Ditemukan ${routes.length} route`,
            data: routes
        };
    } catch (error) {
        logger.error(`Error getting routes: ${error.message}`);
        return { success: false, message: `Gagal ambil data route: ${error.message}`, data: [] };
    }
}

// Fungsi untuk menambah route
async function addRoute(destination, gateway, distance = '1') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/ip/route/add', [
            `=dst-address=${destination}`,
            `=gateway=${gateway}`,
            `=distance=${distance}`
        ]);

        return { success: true, message: `Route ${destination} via ${gateway} berhasil ditambahkan` };
    } catch (error) {
        logger.error(`Error adding route: ${error.message}`);
        return { success: false, message: `Gagal menambah route: ${error.message}` };
    }
}

// Fungsi untuk menghapus route
async function deleteRoute(destination) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari route
        const routes = await conn.write('/ip/route/print', [
            `?dst-address=${destination}`
        ]);

        if (routes.length === 0) {
            return { success: false, message: 'Route tidak ditemukan' };
        }

        // Hapus route
        await conn.write('/ip/route/remove', [
            `=.id=${routes[0]['.id']}`
        ]);

        return { success: true, message: `Route ${destination} berhasil dihapus` };
    } catch (error) {
        logger.error(`Error deleting route: ${error.message}`);
        return { success: false, message: `Gagal menghapus route: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan DHCP leases
async function getDHCPLeases() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const leases = await conn.write('/ip/dhcp-server/lease/print');
        return {
            success: true,
            message: `Ditemukan ${leases.length} DHCP lease`,
            data: leases
        };
    } catch (error) {
        logger.error(`Error getting DHCP leases: ${error.message}`);
        return { success: false, message: `Gagal ambil data DHCP lease: ${error.message}`, data: [] };
    }
}
// Fungsi untuk mendapatkan DHCP server
async function getDHCPServers() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const servers = await conn.write('/ip/dhcp-server/print');
        return {
            success: true,
            message: `Ditemukan ${servers.length} DHCP server`,
            data: servers
        };
    } catch (error) {
        logger.error(`Error getting DHCP servers: ${error.message}`);
        return { success: false, message: `Gagal ambil data DHCP server: ${error.message}`, data: [] };
    }
}

// Fungsi untuk ping
async function pingHost(host, count = '4') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const result = await conn.write('/ping', [
            `=address=${host}`,
            `=count=${count}`
        ]);

        return {
            success: true,
            message: `Ping ke ${host} selesai`,
            data: result
        };
    } catch (error) {
        logger.error(`Error pinging host: ${error.message}`);
        return { success: false, message: `Gagal ping ke ${host}: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan system logs
async function getSystemLogs(topics = '', count = '50') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const params = [];
        if (topics) {
            params.push(`?topics~${topics}`);
        }

        const logs = await conn.write('/log/print', params);

        // Batasi jumlah log yang dikembalikan
        const limitedLogs = logs.slice(0, parseInt(count));

        return {
            success: true,
            message: `Ditemukan ${limitedLogs.length} log entries`,
            data: limitedLogs
        };
    } catch (error) {
        logger.error(`Error getting system logs: ${error.message}`);
        return { success: false, message: `Gagal ambil system logs: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar profile PPPoE
async function getPPPoEProfiles(routerObj = null) {
    // Check auth mode
    const mode = await getUserAuthModeAsync();
    if (mode === 'radius') {
        return await getPPPoEProfilesRadius();
    }
    
    // Mikrotik API mode
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router for PPPoE profiles: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection for PPPoE profiles');
            conn = await getMikrotikConnection();
        }
        
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        logger.info('Fetching PPPoE profiles from Mikrotik...');
        const profiles = await conn.write('/ppp/profile/print');
        logger.info(`Successfully retrieved ${profiles ? profiles.length : 0} PPPoE profiles from ${routerObj ? routerObj.name : 'default'}`);
        
        // Attach router info to profiles if routerObj is provided
        if (Array.isArray(profiles) && routerObj) {
            profiles.forEach(prof => {
                if (prof) {
                    prof.nas_id = routerObj.id;
                    prof.nas_name = routerObj.name;
                    prof.nas_ip = routerObj.nas_ip;
                }
            });
        }
        
        return {
            success: true,
            message: `Ditemukan ${profiles ? profiles.length : 0} PPPoE profile`,
            data: profiles || []
        };
    } catch (error) {
        logger.error(`Error getting PPPoE profiles from ${routerObj ? routerObj.name : 'default'}: ${error.message}`);
        return { success: false, message: `Gagal ambil data PPPoE profile: ${error.message}`, data: [] };
    }
}
// Fungsi untuk mendapatkan detail profile PPPoE
async function getPPPoEProfileDetail(id) {
    try {
        // Check auth mode - if id is a groupname (string), it's RADIUS mode
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius' || (typeof id === 'string' && !id.match(/^\d+$/))) {
            return await getPPPoEProfileDetailRadius(id);
        }
        
        // Mikrotik API mode
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const profiles = await conn.write('/ppp/profile/print', [`?.id=${id}`]);
        if (profiles.length === 0) {
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }

        return {
            success: true,
            message: 'Detail profile berhasil diambil',
            data: profiles[0]
        };
    } catch (error) {
        logger.error(`Error getting PPPoE profile detail: ${error.message}`);
        return { success: false, message: `Gagal ambil detail profile: ${error.message}`, data: null };
    }
}
// Fungsi untuk mendapatkan daftar profile hotspot
async function getHotspotProfiles(routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection');
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal: Tidak dapat membuat koneksi', data: [] };
        }
        
        logger.info('Fetching hotspot profiles from Mikrotik...');
        const profiles = await conn.write('/ip/hotspot/user/profile/print');
        logger.info(`Successfully retrieved ${profiles ? profiles.length : 0} profiles from ${routerObj ? routerObj.name : 'default'}`);
        
        // Parse and validate profiles, attach router info if provided
        const validProfiles = [];
        if (Array.isArray(profiles)) {
            profiles.forEach((prof, idx) => {
                if (prof && (prof.name || prof['name'])) {
                    // Attach router info to profile for tracking
                    if (routerObj) {
                        prof.nas_id = routerObj.id;
                        prof.nas_name = routerObj.name;
                        prof.nas_ip = routerObj.nas_ip;
                    }
                    validProfiles.push(prof);
                    logger.debug(`  Profile ${idx + 1}: ${prof.name || prof['name']} (Rate: ${prof['rate-limit'] || 'none'}, Session: ${prof['session-timeout'] || 'none'}, Idle: ${prof['idle-timeout'] || 'none'})`);
                }
            });
        }
        logger.info(`Valid profiles after parsing: ${validProfiles.length}`);
        
        // Don't close connection here - let it be managed by connection pool or caller
        // Connection will be reused or closed automatically
        
        return {
            success: true,
            message: `Ditemukan ${validProfiles.length} profile hotspot`,
            data: validProfiles
        };
    } catch (error) {
        logger.error(`Error getting hotspot profiles from ${routerObj ? routerObj.name : 'default'}:`, error.message);
        logger.error('Error stack:', error.stack);
        
        // Don't close connection on error - might be reused
        // Connection will be managed by connection pool
        
        return { success: false, message: `Gagal ambil data profile hotspot: ${error.message}`, data: [] };
    }
}
// Fungsi untuk mendapatkan detail profile hotspot
async function getHotspotProfileDetail(id, routerObj = null) {
    try {
        // Determine auth mode terlebih dahulu
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius' || (typeof id === 'string' && id && !id.startsWith('*'))) {
            return await getHotspotProfileDetailRadius(id);
        }

        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }
        
        const result = await conn.write('/ip/hotspot/user/profile/print', [
            '?.id=' + id
        ]);
        
        if (result && result.length > 0) {
            return { success: true, data: result[0] };
        } else {
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }
    } catch (error) {
        logger.error(`Error getting hotspot profile detail: ${error.message}`);
        return { success: false, message: error.message, data: null };
    }
}
// Fungsi untuk mendapatkan daftar server hotspot
async function getHotspotServers(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }
        
        const result = await conn.write('/ip/hotspot/print');
        
        if (result && Array.isArray(result)) {
            const servers = result.map(server => ({
                id: server['.id'],
                name: server.name,
                interface: server.interface,
                profile: server.profile || '',
                addressPool: server['address-pool'] || '',
                address: server['address-pool'] || '', // Alias untuk kompatibilitas
                disabled: server.disabled === 'true',
                nas_id: routerObj ? routerObj.id : null,
                nas_name: routerObj ? routerObj.name : null,
                nas_ip: routerObj ? routerObj.nas_ip : null,
                nas_identifier: routerObj ? (routerObj.nas_identifier || routerObj.nasIdentifier || null) : null
            }));
            return { success: true, data: servers };
        } else {
            return { success: false, message: 'Gagal mendapatkan server hotspot', data: [] };
        }
    } catch (error) {
        logger.error(`Error getting hotspot servers: ${error.message}`);
        return { success: false, message: error.message, data: [] };
    }
}
// Fungsi untuk menambah Server Hotspot ke Mikrotik
async function addHotspotServer(serverData, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        const { name, interface: interfaceName, profile, addressPool, disabled } = serverData;

        if (!name || !name.trim()) {
            return { success: false, message: 'Nama server hotspot harus diisi' };
        }

        if (!interfaceName || !interfaceName.trim()) {
            return { success: false, message: 'Interface harus dipilih' };
        }

        const params = [
            '=name=' + String(name).trim(),
            '=interface=' + String(interfaceName).trim()
        ];

        if (profile && String(profile).trim() !== '') {
            params.push('=profile=' + String(profile).trim());
        }

        if (addressPool && String(addressPool).trim() !== '') {
            params.push('=address-pool=' + String(addressPool).trim());
        }

        if (disabled === 'true' || disabled === true) {
            params.push('=disabled=yes');
        }

        await conn.write('/ip/hotspot/add', params);

        logger.info(`Successfully added hotspot server: ${name} on interface ${interfaceName}`);
        return { success: true, message: `Server hotspot "${name}" berhasil ditambahkan` };
    } catch (error) {
        logger.error(`Error adding hotspot server: ${error.message}`);
        return { success: false, message: `Gagal menambah server hotspot: ${error.message}` };
    }
}

// Fungsi untuk mengedit Server Hotspot di Mikrotik
async function editHotspotServer(serverId, serverData, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        const { name, interface: interfaceName, profile, addressPool, disabled } = serverData;

        const params = ['=.id=' + serverId];

        if (name && String(name).trim() !== '') {
            params.push('=name=' + String(name).trim());
        }

        if (interfaceName && String(interfaceName).trim() !== '') {
            params.push('=interface=' + String(interfaceName).trim());
        }

        if (profile !== undefined) {
            if (profile && String(profile).trim() !== '') {
                params.push('=profile=' + String(profile).trim());
            } else {
                params.push('=profile=');
            }
        }

        if (addressPool !== undefined) {
            if (addressPool && String(addressPool).trim() !== '') {
                params.push('=address-pool=' + String(addressPool).trim());
            } else {
                params.push('=address-pool=');
            }
        }

        if (disabled !== undefined) {
            params.push(disabled === 'true' || disabled === true ? '=disabled=yes' : '=disabled=no');
        }

        await conn.write('/ip/hotspot/set', params);

        logger.info(`Successfully updated hotspot server: ID ${serverId}`);
        return { success: true, message: 'Server hotspot berhasil diupdate' };
    } catch (error) {
        logger.error(`Error editing hotspot server: ${error.message}`);
        return { success: false, message: `Gagal update server hotspot: ${error.message}` };
    }
}

// Fungsi untuk menghapus Server Hotspot dari Mikrotik
async function deleteHotspotServer(serverId, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/ip/hotspot/remove', ['=.id=' + serverId]);

        logger.info(`Successfully deleted hotspot server: ID ${serverId}`);
        return { success: true, message: 'Server hotspot berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting hotspot server: ${error.message}`);
        return { success: false, message: `Gagal menghapus server hotspot: ${error.message}` };
    }
}
// Fungsi untuk mendapatkan detail Server Hotspot dari Mikrotik
async function getHotspotServerDetail(serverId, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const result = await conn.write('/ip/hotspot/print', ['?.id=' + serverId]);

        if (result && Array.isArray(result) && result.length > 0) {
            const server = result[0];
            return {
                success: true,
                data: {
                    id: server['.id'],
                    name: server.name,
                    interface: server.interface,
                    profile: server.profile || '',
                    addressPool: server['address-pool'] || '',
                    disabled: server.disabled === 'true',
                    nas_id: routerObj ? routerObj.id : null,
                    nas_name: routerObj ? routerObj.name : null,
                    nas_ip: routerObj ? routerObj.nas_ip : null,
                    nas_identifier: routerObj ? (routerObj.nas_identifier || routerObj.nasIdentifier || null) : null
                }
            };
        } else {
            return { success: false, message: 'Server hotspot tidak ditemukan', data: null };
        }
    } catch (error) {
        logger.error(`Error getting hotspot server detail: ${error.message}`);
        return { success: false, message: error.message, data: null };
    }
}
// Fungsi untuk menambah Server Profile Hotspot ke Mikrotik
async function addHotspotServerProfileMikrotik(profileData, routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        const { name, 'hotspot-address': hotspotAddress, 'dns-name': dnsName,
                'html-directory': htmlDirectory, 'html-directory-override': htmlDirectoryOverride,
                'rate-limit': rateLimit, 'http-proxy': httpProxy, 'http-proxy-port': httpProxyPort,
                'smtp-server': smtpServer, 'login-by': loginBy, 'mac-auth-mode': macAuthMode,
                'mac-auth-password': macAuthPassword, 'http-cookie-lifetime': httpCookieLifetime,
                'ssl-certificate': sslCertificate, 'https-redirect': httpsRedirect,
                'split-user-domain': splitUserDomain, 'trial-uptime-limit': trialUptimeLimit,
                'trial-uptime-reset': trialUptimeReset, 'trial-user-profile': trialUserProfile,
                'use-radius': useRadius, 'default-domain': defaultDomain, 'location-id': locationId,
                'location-name': locationName, 'mac-format': macFormat, 'accounting': accounting,
                'interim-update': interimUpdate, 'nas-port-type': nasPortType,
                disabled, comment } = profileData;

        if (!name || !name.trim()) {
            return { success: false, message: 'Nama server profile harus diisi' };
        }

        const params = ['=name=' + String(name).trim()];

        // Parameter wajib untuk Server Profile di RouterOS v6.49
        if (hotspotAddress && String(hotspotAddress).trim() !== '') {
            params.push('=hotspot-address=' + String(hotspotAddress).trim());
        }

        if (dnsName && String(dnsName).trim() !== '') {
            params.push('=dns-name=' + String(dnsName).trim());
        }

        // General Tab Parameters
        if (htmlDirectory && String(htmlDirectory).trim() !== '') {
            params.push('=html-directory=' + String(htmlDirectory).trim());
        }

        if (htmlDirectoryOverride && String(htmlDirectoryOverride).trim() !== '') {
            params.push('=html-directory-override=' + String(htmlDirectoryOverride).trim());
        }

        if (rateLimit && String(rateLimit).trim() !== '') {
            params.push('=rate-limit=' + String(rateLimit).trim());
        }

        if (httpProxy && String(httpProxy).trim() !== '') {
            params.push('=http-proxy=' + String(httpProxy).trim());
        }

        if (httpProxyPort !== undefined && httpProxyPort !== null && String(httpProxyPort).trim() !== '') {
            params.push('=http-proxy-port=' + String(httpProxyPort).trim());
        }

        if (smtpServer && String(smtpServer).trim() !== '') {
            params.push('=smtp-server=' + String(smtpServer).trim());
        }

        // CATATAN: Parameter berikut ini TIDAK DIDUKUNG untuk Server Profile di RouterOS v6.49:
        // - login-by (hanya untuk User Profile)
        // - mac-auth-mode (hanya untuk User Profile)
        // - mac-auth-password (hanya untuk User Profile)
        // - http-cookie-lifetime (hanya untuk User Profile)
        // - ssl-certificate (hanya untuk User Profile atau Server Hotspot)
        // - https-redirect (hanya untuk User Profile)
        // - split-user-domain (hanya untuk User Profile)
        // - trial-uptime-limit (hanya untuk User Profile)
        // - trial-uptime-reset (hanya untuk User Profile)
        // - trial-user-profile (hanya untuk User Profile)
        // - use-radius (hanya untuk User Profile atau Server Hotspot, bukan Server Profile)
        // - default-domain (hanya untuk User Profile)
        // - location-id (hanya untuk User Profile)
        // - location-name (hanya untuk User Profile)
        // - mac-format (hanya untuk User Profile)
        // - accounting (hanya untuk User Profile atau Server Hotspot, bukan Server Profile)
        // - interim-update (hanya untuk User Profile)
        // - nas-port-type (hanya untuk User Profile)
        // 
        // CATATAN: Parameter Login Tab dan RADIUS Tab tidak didukung untuk Server Profile di RouterOS v6.49
        // Hanya parameter General Tab yang didukung

        // Common Parameters
        if (comment && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }

        // Untuk RouterOS v6.49, gunakan /ip/hotspot/profile/add (Server Profile)
        // JANGAN gunakan /ip/hotspot/user/profile/add karena itu untuk User Profile, bukan Server Profile!
        logger.info(`Attempting to add server profile "${name}" to router ${routerObj ? routerObj.name : 'default'}`);
        logger.info(`Parameters to send: ${JSON.stringify(params)}`);
        
        try {
            await conn.write('/ip/hotspot/profile/add', params);
            logger.info(`Successfully added hotspot server profile: ${name} (using /ip/hotspot/profile/add)`);
            
            // Delay sebentar untuk memastikan perubahan tersimpan
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Verify profile was created by querying it
            try {
                const verifyProfiles = await conn.write('/ip/hotspot/profile/print', ['?name=' + String(name).trim()]);
                if (verifyProfiles && verifyProfiles.length > 0) {
                    logger.info(`Profile "${name}" verified successfully in Mikrotik`);
                } else {
                    logger.warn(`Profile "${name}" created but not found during verification`);
                }
            } catch (verifyError) {
                logger.warn(`Could not verify profile after creation: ${verifyError.message}`);
            }
            
            // Close connection if created for this router
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return { success: true, message: `Server profile "${name}" berhasil ditambahkan` };
        } catch (cmdError) {
            logger.error(`Command /ip/hotspot/profile/add tidak tersedia atau gagal: ${cmdError.message}`);
            logger.error(`Parameters that failed: ${JSON.stringify(params)}`);
            
            // Close connection on error
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            // Berikan error message yang lebih informatif
            let errorMsg = `Gagal menambah server profile: ${cmdError.message}`;
            if (cmdError.message.includes('unknown parameter')) {
                errorMsg += `. Pastikan semua parameter yang digunakan didukung oleh RouterOS v6.49. Parameter yang dikirim: ${params.join(', ')}`;
            }
            
            return { 
                success: false, 
                message: errorMsg
            };
        }
    } catch (error) {
        logger.error(`Error adding hotspot server profile: ${error.message}`);
        
        // Close connection on error
        if (routerObj && conn && typeof conn.close === 'function') {
            try {
                await conn.close();
            } catch (closeError) {
                // Ignore
            }
        }
        
        return { success: false, message: `Gagal menambah server profile: ${error.message}` };
    }
}
// Fungsi untuk mengedit Server Profile Hotspot di Mikrotik
async function editHotspotServerProfileMikrotik(profileId, profileData, routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        const { name, 'hotspot-address': hotspotAddress, 'dns-name': dnsName,
                'html-directory': htmlDirectory, 'html-directory-override': htmlDirectoryOverride,
                'rate-limit': rateLimit, 'http-proxy': httpProxy, 'http-proxy-port': httpProxyPort,
                'smtp-server': smtpServer, 'login-by': loginBy, 'mac-auth-mode': macAuthMode,
                'mac-auth-password': macAuthPassword, 'http-cookie-lifetime': httpCookieLifetime,
                'ssl-certificate': sslCertificate, 'https-redirect': httpsRedirect,
                'split-user-domain': splitUserDomain, 'trial-uptime-limit': trialUptimeLimit,
                'trial-uptime-reset': trialUptimeReset, 'trial-user-profile': trialUserProfile,
                'use-radius': useRadius, 'default-domain': defaultDomain, 'location-id': locationId,
                'location-name': locationName, 'mac-format': macFormat, 'accounting': accounting,
                'interim-update': interimUpdate, 'nas-port-type': nasPortType,
                disabled, comment } = profileData;

        const params = ['=.id=' + profileId];

        if (name && String(name).trim() !== '') {
            params.push('=name=' + String(name).trim());
        }

        // Parameter yang didukung untuk Server Profile di RouterOS v6.49
        // Hanya kirim jika nilainya tidak kosong
        if (hotspotAddress !== undefined && hotspotAddress !== null && String(hotspotAddress).trim() !== '') {
            params.push('=hotspot-address=' + String(hotspotAddress).trim());
        }

        if (dnsName !== undefined && dnsName !== null && String(dnsName).trim() !== '') {
            params.push('=dns-name=' + String(dnsName).trim());
        }

        // General Tab Parameters - hanya kirim jika ada nilai
        if (htmlDirectory !== undefined && htmlDirectory !== null && String(htmlDirectory).trim() !== '') {
            params.push('=html-directory=' + String(htmlDirectory).trim());
        }

        if (htmlDirectoryOverride !== undefined && htmlDirectoryOverride !== null && String(htmlDirectoryOverride).trim() !== '') {
            params.push('=html-directory-override=' + String(htmlDirectoryOverride).trim());
        }

        if (rateLimit !== undefined && rateLimit !== null && String(rateLimit).trim() !== '') {
            params.push('=rate-limit=' + String(rateLimit).trim());
        }

        if (httpProxy !== undefined && httpProxy !== null && String(httpProxy).trim() !== '') {
            params.push('=http-proxy=' + String(httpProxy).trim());
        }

        if (httpProxyPort !== undefined && httpProxyPort !== null && String(httpProxyPort).trim() !== '' && httpProxyPort !== '0') {
            params.push('=http-proxy-port=' + String(httpProxyPort).trim());
        }

        if (smtpServer !== undefined && smtpServer !== null && String(smtpServer).trim() !== '') {
            params.push('=smtp-server=' + String(smtpServer).trim());
        }

        // CATATAN: Parameter berikut ini MUNGKIN TIDAK DIDUKUNG untuk Server Profile di RouterOS v6.49:
        // - login-by (hanya untuk User Profile)
        // - mac-auth-mode (hanya untuk User Profile)
        // - mac-auth-password (hanya untuk User Profile)
        // - http-cookie-lifetime (hanya untuk User Profile)
        // - ssl-certificate (hanya untuk User Profile atau Server Hotspot)
        // - https-redirect (hanya untuk User Profile)
        // - split-user-domain (hanya untuk User Profile)
        // - trial-uptime-limit (hanya untuk User Profile)
        // - trial-uptime-reset (hanya untuk User Profile)
        // - trial-user-profile (hanya untuk User Profile)
        // - use-radius (hanya untuk User Profile atau Server Hotspot, bukan Server Profile)
        // - default-domain (hanya untuk User Profile)
        // - location-id (hanya untuk User Profile)
        // - location-name (hanya untuk User Profile)
        // - mac-format (hanya untuk User Profile)
        // - accounting (hanya untuk User Profile atau Server Hotspot, bukan Server Profile)
        // - interim-update (hanya untuk User Profile)
        // - nas-port-type (hanya untuk User Profile)
        // 
        // CATATAN: Parameter Login Tab dan RADIUS Tab tidak didukung untuk Server Profile di RouterOS v6.49
        // Hanya parameter General Tab yang didukung

        // Common Parameters
        if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }

        // Untuk RouterOS v6.49, gunakan /ip/hotspot/profile/set (Server Profile)
        // JANGAN gunakan /ip/hotspot/user/profile/set karena itu untuk User Profile!
        logger.info(`Attempting to edit server profile ID ${profileId} for router ${routerObj ? routerObj.name : 'default'}`);
        logger.info(`Parameters to send: ${JSON.stringify(params)}`);
        
        try {
            await conn.write('/ip/hotspot/profile/set', params);
            logger.info(`Successfully updated hotspot server profile: ID ${profileId} (using /ip/hotspot/profile/set)`);
            
            // Close connection if created for this router
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return { success: true, message: 'Server profile berhasil diupdate' };
        } catch (cmdError) {
            logger.error(`Command /ip/hotspot/profile/set tidak tersedia atau gagal: ${cmdError.message}`);
            logger.error(`Parameters that failed: ${JSON.stringify(params)}`);
            
            // Close connection on error
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            // Berikan error message yang lebih informatif
            let errorMsg = `Gagal update server profile: ${cmdError.message}`;
            if (cmdError.message.includes('unknown parameter')) {
                errorMsg += `. Pastikan semua parameter yang digunakan didukung oleh RouterOS v6.49. Parameter yang dikirim: ${params.join(', ')}`;
            }
            
            return { 
                success: false, 
                message: errorMsg
            };
        }
    } catch (error) {
        logger.error(`Error editing hotspot server profile: ${error.message}`);
        
        // Close connection on error
        if (routerObj && conn && typeof conn.close === 'function') {
            try {
                await conn.close();
            } catch (closeError) {
                // Ignore
            }
        }
        
        return { success: false, message: `Gagal update server profile: ${error.message}` };
    }
}
// Fungsi untuk menghapus Server Profile Hotspot dari Mikrotik
async function deleteHotspotServerProfileMikrotik(profileId, routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Untuk RouterOS v6.49, gunakan /ip/hotspot/profile/remove (Server Profile)
        // JANGAN gunakan /ip/hotspot/user/profile/remove karena itu untuk User Profile!
        try {
            await conn.write('/ip/hotspot/profile/remove', ['=.id=' + profileId]);
            logger.info(`Successfully deleted hotspot server profile: ID ${profileId} (using /ip/hotspot/profile/remove)`);
            
            // Close connection if created for this router
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return { success: true, message: 'Server profile berhasil dihapus' };
        } catch (cmdError) {
            logger.error(`Command /ip/hotspot/profile/remove tidak tersedia atau gagal: ${cmdError.message}`);
            
            // Close connection on error
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            // JANGAN fallback ke /ip/hotspot/user/profile karena itu bukan Server Profile!
            return { 
                success: false, 
                message: `Gagal menghapus server profile: Command /ip/hotspot/profile/remove tidak tersedia. Pastikan RouterOS versi 6.49 atau lebih baru. Error: ${cmdError.message}` 
            };
        }
    } catch (error) {
        logger.error(`Error deleting hotspot server profile: ${error.message}`);
        
        // Close connection on error
        if (routerObj && conn && typeof conn.close === 'function') {
            try {
                await conn.close();
            } catch (closeError) {
                // Ignore
            }
        }
        
        return { success: false, message: `Gagal menghapus server profile: ${error.message}` };
    }
}

// Fungsi untuk memutus koneksi user hotspot aktif
async function disconnectHotspotUser(username, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        // Cari ID koneksi aktif berdasarkan username
        const activeUsers = await conn.write('/ip/hotspot/active/print', [
            '?user=' + username
        ]);
        
        if (!activeUsers || activeUsers.length === 0) {
            return { success: false, message: `User ${username} tidak ditemukan atau tidak aktif` };
        }
        
        // Putus koneksi user dengan ID yang ditemukan
        await conn.write('/ip/hotspot/active/remove', [
            '=.id=' + activeUsers[0]['.id']
        ]);
        
        logger.info(`Disconnected hotspot user: ${username}`);
        return { success: true, message: `User ${username} berhasil diputus` };
    } catch (error) {
        logger.error(`Error disconnecting hotspot user: ${error.message}`);
        return { success: false, message: error.message };
    }
}
// Fungsi untuk menambah profile hotspot
async function addHotspotProfile(profileData, routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router for add profile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke router ${routerObj.name}: ${connError.message}` };
            }
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        // Extract only valid fields, exclude router_id and id
        const {
            name,
            comment,
            rateLimit,
            rateLimitUnit,
            sessionTimeout,
            sessionTimeoutUnit,
            idleTimeout,
            idleTimeoutUnit,
            localAddress,
            remoteAddress,
            dnsServer,
            parentQueue,
            addressList,
            sharedUsers,
            limitUptimeValue,
            limitUptimeUnit,
            validityValue,
            validityUnit
        } = profileData;
        
        if (!name || !name.trim()) {
            return { success: false, message: 'Nama profile harus diisi' };
        }
        
        // Build parameters array - ONLY include core parameters that are definitely supported
        // Skip all optional parameters that might cause "unknown parameter" error
        const params = [];
        
        // Name is required
        if (!name || !String(name).trim()) {
            return { success: false, message: 'Nama profile harus diisi' };
        }
        params.push('=name=' + String(name).trim());
        
        // Comment - safe parameter
        if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }
        
        // Rate limit: only add if both value and unit are valid
        // Format Mikrotik: upload/download (e.g., "10M/10M") or just upload if same
        if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
            const rateLimitValue = String(rateLimit).trim();
            let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
            if (['k', 'm', 'g'].includes(rateLimitUnitValue)) {
                if (rateLimitUnitValue === 'm') rateLimitUnitValue = 'M';
                if (rateLimitUnitValue === 'g') rateLimitUnitValue = 'G';
                if (rateLimitUnitValue === 'k') rateLimitUnitValue = 'K';
                const numValue = parseInt(rateLimitValue);
                if (!isNaN(numValue) && numValue > 0) {
                    // Format: upload/download (same value for both)
                    const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                    params.push('=rate-limit=' + rateLimitFormatted);
                    logger.info(`Rate limit formatted: ${rateLimitFormatted}`);
                }
            }
        }
        
        // Session timeout: only add if both value and unit are valid
        if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
            const sessionTimeoutValue = String(sessionTimeout).trim();
            let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                const numValue = parseInt(sessionTimeoutValue);
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=session-timeout=' + numValue + sessionTimeoutUnitValue);
                }
            }
        }
        
        // Idle timeout: only add if both value and unit are valid
        if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
            const idleTimeoutValue = String(idleTimeout).trim();
            let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[idleTimeoutUnitValue]) {
                idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                const numValue = parseInt(idleTimeoutValue);
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=idle-timeout=' + numValue + idleTimeoutUnitValue);
                }
            }
        }
        
        // SKIP: local-address, remote-address, dns-server, parent-queue, address-list
        // These parameters may not be supported or cause "unknown parameter" error
        
        // Shared users: valid field - only if value is valid positive integer
        if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
            const sharedUsersValue = parseInt(String(sharedUsers).trim());
            if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                params.push('=shared-users=' + sharedUsersValue);
            }
        }
        
        // Limit uptime: valid field - only if value is valid positive integer
        if (limitUptimeValue !== undefined && limitUptimeValue !== null && String(limitUptimeValue).trim() !== '' && String(limitUptimeValue).trim() !== '0') {
            const limitUptimeValueValue = parseInt(String(limitUptimeValue).trim());
            if (!isNaN(limitUptimeValueValue) && limitUptimeValueValue > 0) {
                params.push('=limit-uptime=' + limitUptimeValueValue);
            }
        }
        
        // Validity: valid field - only if value is valid positive integer
        if (validityValue !== undefined && validityValue !== null && String(validityValue).trim() !== '' && String(validityValue).trim() !== '0') {
            const validityValueValue = parseInt(String(validityValue).trim());
            if (!isNaN(validityValueValue) && validityValueValue > 0) {
                params.push('=validity=' + validityValueValue);
            }
        }
        
        // Log parameters for debugging
        logger.info('=== Adding Hotspot Profile ===');
        logger.info('Name:', name);
        logger.info('Router:', routerObj ? `${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})` : 'default');
        logger.info('Total params:', params.length);
        logger.info('Raw params:', JSON.stringify(params));
        params.forEach((p, idx) => {
            logger.info(`  Param ${idx + 1}: ${p}`);
        });
        
        try {
            await conn.write('/ip/hotspot/user/profile/add', params);
            logger.info('✓ Successfully added hotspot profile:', name);
            return { success: true, message: 'Profile hotspot berhasil ditambahkan' };
        } catch (apiError) {
            // Try to identify which parameter is causing the issue
            logger.error('✗ Mikrotik API Error:', apiError.message);
            logger.error('Error stack:', apiError.stack);
            logger.error('Parameters that were sent:', JSON.stringify(params));
            
            // If error mentions "unknown parameter", try with minimal parameters (name only first)
            if (apiError.message && apiError.message.toLowerCase().includes('unknown parameter')) {
                logger.warn('=== Unknown parameter error, trying minimal approach ===');
                
                // Try with name only first
                try {
                    logger.info('Attempt 1: Name only');
                    const nameOnlyParams = ['=name=' + String(name).trim()];
                    await conn.write('/ip/hotspot/user/profile/add', nameOnlyParams);
                    logger.info('✓ Success with name only, now updating with other params');
                    
                    // Get the profile ID we just created
                    const profiles = await conn.write('/ip/hotspot/user/profile/print', ['?name=' + String(name).trim()]);
                    if (!profiles || profiles.length === 0) {
                        throw new Error('Profile created but not found');
                    }
                    const profileId = profiles[0]['.id'];
                    
                    // Now update with other parameters ONE BY ONE to avoid "unknown parameter" error
                    logger.info('Updating profile parameters one by one...');
                    
                    // Update comment
                    if (comment && comment.trim()) {
                        try {
                            await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=comment=' + String(comment).trim()]);
                            logger.info(`✓ Comment updated: ${comment}`);
                        } catch (e) {
                            logger.warn(`✗ Failed to update comment: ${e.message}`);
                        }
                    }
                    
                    // Update rate-limit
                    if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
                        const rateLimitValue = String(rateLimit).trim();
                        let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
                        if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                            if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                            else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                            else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                            const numValue = parseInt(rateLimitValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                // Format: upload/download (same value for both)
                                const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=rate-limit=' + rateLimitFormatted]);
                                    logger.info(`✓ Rate limit updated: ${rateLimitFormatted}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update rate limit: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update session-timeout
                    if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
                        const sessionTimeoutValue = String(sessionTimeout).trim();
                        let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
                        // Map ke format standar Mikrotik: S, m, h, d
                        const timeoutUnitMap = { 
                            's': 's', 'detik': 's',           // detik
                            'm': 'm', 'menit': 'm', 'men': 'm', // menit (lowercase)
                            'h': 'h', 'jam': 'h',              // jam
                            'd': 'd', 'hari': 'd'              // hari
                        };
                        if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                            sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                            const numValue = parseInt(sessionTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=session-timeout=' + numValue + sessionTimeoutUnitValue]);
                                    logger.info(`✓ Session timeout updated: ${numValue}${sessionTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update session timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update idle-timeout
                    if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
                        const idleTimeoutValue = String(idleTimeout).trim();
                        let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
                        // Map ke format standar Mikrotik: S, m, h, d
                        const timeoutUnitMap = { 
                            's': 's', 'detik': 's',           // detik
                            'm': 'm', 'menit': 'm', 'men': 'm', // menit (lowercase)
                            'h': 'h', 'jam': 'h',              // jam
                            'd': 'd', 'hari': 'd'              // hari
                        };
                        if (timeoutUnitMap[idleTimeoutUnitValue]) {
                            idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                            const numValue = parseInt(idleTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=idle-timeout=' + numValue + idleTimeoutUnitValue]);
                                    logger.info(`✓ Idle timeout updated: ${numValue}${idleTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update idle timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update shared-users
                    if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
                        const sharedUsersValue = parseInt(String(sharedUsers).trim());
                        if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=shared-users=' + sharedUsersValue]);
                                logger.info(`✓ Shared users updated: ${sharedUsersValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update shared users: ${e.message}`);
                            }
                        }
                    }
                    
                    // Update limit-uptime
                    if (limitUptimeValue !== undefined && limitUptimeValue !== null && String(limitUptimeValue).trim() !== '' && String(limitUptimeValue).trim() !== '0') {
                        const limitUptimeValueValue = parseInt(String(limitUptimeValue).trim());
                        if (!isNaN(limitUptimeValueValue) && limitUptimeValueValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=limit-uptime=' + limitUptimeValueValue]);
                                logger.info(`✓ Limit uptime updated: ${limitUptimeValueValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update limit uptime: ${e.message}`);
                            }
                        }
                    }
                    
                    // Update validity
                    if (validityValue !== undefined && validityValue !== null && String(validityValue).trim() !== '' && String(validityValue).trim() !== '0') {
                        const validityValueValue = parseInt(String(validityValue).trim());
                        if (!isNaN(validityValueValue) && validityValueValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=validity=' + validityValueValue]);
                                logger.info(`✓ Validity updated: ${validityValueValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update validity: ${e.message}`);
                            }
                        }
                    }
                    
                    logger.info('✓ Successfully added and updated profile');
                    
                    // Close connection if created for this request
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            logger.warn('Error closing connection:', closeError.message);
                        }
                    }
                    
                    return { success: true, message: 'Profile hotspot berhasil ditambahkan' };
                } catch (fallbackError) {
                    logger.error(`Fallback approach also failed: ${fallbackError.message}`);
                    
                    // Close connection on error
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            // Ignore
                        }
                    }
                    
                    return { success: false, message: `Gagal menambah profile: ${fallbackError.message}. Coba dengan nama profile yang berbeda atau pastikan koneksi ke router berhasil.` };
                }
            }
            
            // Close connection before throwing
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            throw apiError;
        } finally {
            // Ensure connection is closed if it was created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        }
    } catch (error) {
        logger.error(`Error adding hotspot profile: ${error.message}`);
        logger.error(`Error stack:`, error.stack);
        return { success: false, message: `Gagal menambah profile: ${error.message}` };
    }
}
// Fungsi untuk edit profile hotspot
async function editHotspotProfile(profileData, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        const {
            id,
            name,
            comment,
            rateLimit,
            rateLimitUnit,
            sessionTimeout,
            sessionTimeoutUnit,
            idleTimeout,
            idleTimeoutUnit,
            localAddress,
            remoteAddress,
            dnsServer,
            parentQueue,
            addressList,
            sharedUsers,
            limitUptimeValue,
            limitUptimeUnit,
            validityValue,
            validityUnit
        } = profileData;
        
        const params = [
            '=.id=' + id,
            '=name=' + name
        ];
        
        // Comment - safe parameter
        if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }
        
        // Rate limit: only add if both value and unit are valid, with proper unit mapping
        // Format Mikrotik: upload/download (e.g., "10M/10M") or just upload if same
        if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
            const rateLimitValue = String(rateLimit).trim();
            let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
            // Accept both lowercase and uppercase: k/K, m/M, g/G
            if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                // Normalize to uppercase for Mikrotik
                if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                const numValue = parseInt(rateLimitValue);
                if (!isNaN(numValue) && numValue > 0) {
                    // Format: upload/download (same value for both)
                    const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                    params.push('=rate-limit=' + rateLimitFormatted);
                    logger.info(`Rate limit formatted (edit): ${rateLimitFormatted} (from input: ${rateLimitValue}${rateLimitUnit})`);
                } else {
                    logger.warn(`Invalid rate limit value: ${rateLimitValue} (not a valid number)`);
                }
            } else {
                logger.warn(`Invalid rate limit unit: ${rateLimitUnitValue} (expected k/K, m/M, or g/G)`);
            }
        } else if (rateLimit === '' || rateLimit === null || rateLimit === undefined) {
            // Allow clearing rate limit
            params.push('=rate-limit=');
            logger.info('Rate limit cleared (empty value)');
        }
        
        // Session timeout: only add if both value and unit are valid, with proper unit mapping
        if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
            const sessionTimeoutValue = String(sessionTimeout).trim();
            let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                const numValue = parseInt(sessionTimeoutValue);
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=session-timeout=' + numValue + sessionTimeoutUnitValue);
                }
            }
        } else if (sessionTimeout === '' || sessionTimeout === null || sessionTimeout === undefined) {
            // Allow clearing session timeout
            params.push('=session-timeout=');
        }
        
        // Idle timeout: only add if both value and unit are valid, with proper unit mapping
        if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
            const idleTimeoutValue = String(idleTimeout).trim();
            let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[idleTimeoutUnitValue]) {
                idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                const numValue = parseInt(idleTimeoutValue);
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=idle-timeout=' + numValue + idleTimeoutUnitValue);
                }
            }
        } else if (idleTimeout === '' || idleTimeout === null || idleTimeout === undefined) {
            // Allow clearing idle timeout
            params.push('=idle-timeout=');
        }
        // SKIP: local-address, remote-address, dns-server, parent-queue, address-list
        // These parameters are NOT supported for hotspot user profile in Mikrotik
        // They may cause "unknown parameter" error
        
        // Shared users: valid field - only if value is valid positive integer
        if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
            const sharedUsersValue = parseInt(String(sharedUsers).trim());
            if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                params.push('=shared-users=' + sharedUsersValue);
            }
        }
        
        // Limit uptime: valid field - only if value is valid positive integer
        if (limitUptimeValue !== undefined && limitUptimeValue !== null && String(limitUptimeValue).trim() !== '' && String(limitUptimeValue).trim() !== '0') {
            const limitUptimeValueValue = parseInt(String(limitUptimeValue).trim());
            if (!isNaN(limitUptimeValueValue) && limitUptimeValueValue > 0) {
                params.push('=limit-uptime=' + limitUptimeValueValue);
            }
        }
        
        // Validity: valid field - only if value is valid positive integer
        if (validityValue !== undefined && validityValue !== null && String(validityValue).trim() !== '' && String(validityValue).trim() !== '0') {
            const validityValueValue = parseInt(String(validityValue).trim());
            if (!isNaN(validityValueValue) && validityValueValue > 0) {
                params.push('=validity=' + validityValueValue);
            }
        }
        
        // Log parameters for debugging
        logger.info('=== Editing Hotspot Profile ===');
        logger.info('Profile ID:', id);
        logger.info('Name:', name);
        logger.info('Router:', routerObj ? `${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})` : 'default');
        logger.info('Total params:', params.length);
        logger.info('Raw params:', JSON.stringify(params));
        params.forEach((p, idx) => {
            logger.info(`  Param ${idx + 1}: ${p}`);
        });
        
        try {
            await conn.write('/ip/hotspot/user/profile/set', params);
            logger.info('✓ Successfully updated hotspot profile:', name);
            
            // Close connection if created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return { success: true, message: 'Profile hotspot berhasil diupdate' };
        } catch (apiError) {
            logger.error('✗ Mikrotik API Error:', apiError.message);
            logger.error('Error stack:', apiError.stack);
            logger.error('Parameters that were sent:', JSON.stringify(params));
            
            // If error mentions "unknown parameter", try updating one by one
            if (apiError.message && apiError.message.toLowerCase().includes('unknown parameter')) {
                logger.warn('=== Unknown parameter error, trying step-by-step update ===');
                
                // Try updating with minimal parameters first (name, comment only)
                try {
                    logger.info('Attempt 1: Name and comment only');
                    const minimalParams = ['=.id=' + id, '=name=' + name];
                    if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
                        minimalParams.push('=comment=' + String(comment).trim());
                    }
                    await conn.write('/ip/hotspot/user/profile/set', minimalParams);
                    logger.info('✓ Success with minimal params, now updating with other params one by one');
                    
                    // Update rate-limit
                    if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
                        const rateLimitValue = String(rateLimit).trim();
                        let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
                        if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                            if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                            else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                            else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                            const numValue = parseInt(rateLimitValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=rate-limit=' + rateLimitFormatted]);
                                    logger.info(`✓ Rate limit updated: ${rateLimitFormatted}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update rate limit: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update session-timeout
                    if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
                        const sessionTimeoutValue = String(sessionTimeout).trim();
                        let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
                        // Map ke format standar Mikrotik: S, m, h, d
                        const timeoutUnitMap = { 
                            's': 's', 'detik': 's',           // detik
                            'm': 'm', 'menit': 'm', 'men': 'm', // menit (lowercase)
                            'h': 'h', 'jam': 'h',              // jam
                            'd': 'd', 'hari': 'd'              // hari
                        };
                        if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                            sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                            const numValue = parseInt(sessionTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=session-timeout=' + numValue + sessionTimeoutUnitValue]);
                                    logger.info(`✓ Session timeout updated: ${numValue}${sessionTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update session timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update idle-timeout
                    if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
                        const idleTimeoutValue = String(idleTimeout).trim();
                        let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
                        // Map ke format standar Mikrotik: S, m, h, d
                        const timeoutUnitMap = { 
                            's': 's', 'detik': 's',           // detik
                            'm': 'm', 'menit': 'm', 'men': 'm', // menit (lowercase)
                            'h': 'h', 'jam': 'h',              // jam
                            'd': 'd', 'hari': 'd'              // hari
                        };
                        if (timeoutUnitMap[idleTimeoutUnitValue]) {
                            idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                            const numValue = parseInt(idleTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=idle-timeout=' + numValue + idleTimeoutUnitValue]);
                                    logger.info(`✓ Idle timeout updated: ${numValue}${idleTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update idle timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update shared-users
                    if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
                        const sharedUsersValue = parseInt(String(sharedUsers).trim());
                        if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=shared-users=' + sharedUsersValue]);
                                logger.info(`✓ Shared users updated: ${sharedUsersValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update shared users: ${e.message}`);
                            }
                        }
                    }
                    
                    // Update limit-uptime
                    if (limitUptimeValue !== undefined && limitUptimeValue !== null && String(limitUptimeValue).trim() !== '' && String(limitUptimeValue).trim() !== '0') {
                        const limitUptimeValueValue = parseInt(String(limitUptimeValue).trim());
                        if (!isNaN(limitUptimeValueValue) && limitUptimeValueValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=limit-uptime=' + limitUptimeValueValue]);
                                logger.info(`✓ Limit uptime updated: ${limitUptimeValueValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update limit uptime: ${e.message}`);
                            }
                        }
                    }
                    
                    // Update validity
                    if (validityValue !== undefined && validityValue !== null && String(validityValue).trim() !== '' && String(validityValue).trim() !== '0') {
                        const validityValueValue = parseInt(String(validityValue).trim());
                        if (!isNaN(validityValueValue) && validityValueValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=validity=' + validityValueValue]);
                                logger.info(`✓ Validity updated: ${validityValueValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update validity: ${e.message}`);
                            }
                        }
                    }
                    
                    logger.info('✓ Successfully updated profile step by step');
                    
                    // Close connection if created for this request
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            logger.warn('Error closing connection:', closeError.message);
                        }
                    }
                    
                    return { success: true, message: 'Profile hotspot berhasil diupdate' };
                } catch (fallbackError) {
                    logger.error(`Fallback approach also failed: ${fallbackError.message}`);
                    
                    // Close connection on error
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            // Ignore
                        }
                    }
                    
                    return { success: false, message: `Gagal mengupdate profile: ${fallbackError.message}. Coba dengan parameter yang lebih sederhana atau pastikan koneksi ke router berhasil.` };
                }
            }
            
            // Close connection before throwing
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            throw apiError;
        } finally {
            // Ensure connection is closed if it was created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        }
    } catch (error) {
        logger.error(`Error editing hotspot profile: ${error.message}`);
        logger.error(`Error stack:`, error.stack);
        return { success: false, message: `Gagal mengupdate profile: ${error.message}` };
    }
}

// Fungsi untuk hapus profile hotspot
async function deleteHotspotProfile(id, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        await conn.write('/ip/hotspot/user/profile/remove', [
            '=.id=' + id
        ]);
        
        return { success: true, message: 'Profile hotspot berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting hotspot profile: ${error.message}`);
        return { success: false, message: `Gagal menghapus profile: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan firewall rules
async function getFirewallRules(chain = '') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const params = [];
        if (chain) {
            params.push(`?chain=${chain}`);
        }

        const rules = await conn.write('/ip/firewall/filter/print', params);
        return {
            success: true,
            message: `Ditemukan ${rules.length} firewall rule${chain ? ` untuk chain ${chain}` : ''}`,
            data: rules
        };
    } catch (error) {
        logger.error(`Error getting firewall rules: ${error.message}`);
        return { success: false, message: `Gagal ambil data firewall rule: ${error.message}`, data: [] };
    }
}

// Fungsi untuk restart router
async function restartRouter() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/system/reboot');
        return { success: true, message: 'Router akan restart dalam beberapa detik' };
    } catch (error) {
        logger.error(`Error restarting router: ${error.message}`);
        return { success: false, message: `Gagal restart router: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan identity router
async function getRouterIdentity() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const identity = await conn.write('/system/identity/print');
        return {
            success: true,
            message: 'Identity router berhasil diambil',
            data: identity[0]
        };
    } catch (error) {
        logger.error(`Error getting router identity: ${error.message}`);
        return { success: false, message: `Gagal ambil identity router: ${error.message}`, data: null };
    }
}
// Fungsi untuk set identity router
async function setRouterIdentity(name) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/system/identity/set', [
            `=name=${name}`
        ]);

        return { success: true, message: `Identity router berhasil diubah menjadi: ${name}` };
    } catch (error) {
        logger.error(`Error setting router identity: ${error.message}`);
        return { success: false, message: `Gagal mengubah identity router: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan clock router
async function getRouterClock() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const clock = await conn.write('/system/clock/print');
        return {
            success: true,
            message: 'Clock router berhasil diambil',
            data: clock[0]
        };
    } catch (error) {
        logger.error(`Error getting router clock: ${error.message}`);
        return { success: false, message: `Gagal ambil clock router: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan semua user (hotspot + PPPoE)
async function getAllUsers() {
    try {
        // Ambil user hotspot
        const hotspotResult = await getActiveHotspotUsers();
        const hotspotUsers = hotspotResult.success ? hotspotResult.data : [];

        // Ambil user PPPoE aktif
        const pppoeResult = await getActivePPPoEConnections();
        const pppoeUsers = pppoeResult.success ? pppoeResult.data : [];

        // Ambil user PPPoE offline
        const offlineResult = await getInactivePPPoEUsers();
        const offlineUsers = offlineResult.success ? offlineResult.data : [];

        return {
            success: true,
            message: `Total: ${hotspotUsers.length} hotspot aktif, ${pppoeUsers.length} PPPoE aktif, ${offlineUsers.length} PPPoE offline`,
            data: {
                hotspotActive: hotspotUsers,
                pppoeActive: pppoeUsers,
                pppoeOffline: offlineUsers,
                totalActive: hotspotUsers.length + pppoeUsers.length,
                totalOffline: offlineUsers.length
            }
        };
    } catch (error) {
        logger.error(`Error getting all users: ${error.message}`);
        return { success: false, message: `Gagal ambil data semua user: ${error.message}`, data: null };
    }
}

// ...
// Fungsi tambah user PPPoE (alias addPPPoESecret)
async function addPPPoEUser({ username, password, profile, customer = null, routerObj = null }) {
    try {
        const mode = await getUserAuthModeAsync();
        logger.info(`[addPPPoEUser] Mode: ${mode}, username: ${username}, profile: ${profile}`);
        
        if (mode === 'radius') {
            logger.info(`[addPPPoEUser] Using RADIUS mode for user ${username}`);
            return await addPPPoEUserRadius({ username, password, profile });
        } else {
            logger.info(`[addPPPoEUser] Using Mikrotik API mode for user ${username}`);
            let conn = null;
            if (customer) {
                logger.info(`[addPPPoEUser] Getting connection for customer ID: ${customer.id}`);
                conn = await getMikrotikConnectionForCustomer(customer);
            } else if (routerObj) {
                logger.info(`[addPPPoEUser] Getting connection for router: ${routerObj.name || routerObj.nas_ip}`);
                conn = await getMikrotikConnectionForRouter(routerObj);
            } else {
                logger.info(`[addPPPoEUser] Using fallback connection`);
                conn = await getMikrotikConnection(); // fallback lama ONLY for admin use
            }
            if (!conn) {
                const errorMsg = 'Koneksi ke router gagal: Data router/NAS tidak ditemukan';
                logger.error(`[addPPPoEUser] ${errorMsg}`);
                return { success: false, message: errorMsg, error: errorMsg };
            }
            logger.info(`[addPPPoEUser] Connection established, calling addPPPoESecret`);
            const result = await addPPPoESecret(username, password, profile, '', conn);
            logger.info(`[addPPPoEUser] Result:`, JSON.stringify(result));
            return result;
        }
    } catch (error) {
        logger.error(`[addPPPoEUser] Error:`, error);
        logger.error(`[addPPPoEUser] Error stack:`, error.stack);
        return { success: false, message: `Gagal menambahkan user PPPoE: ${error.message}`, error: error.message };
    }
}
// Update user hotspot (password dan profile)
async function updateHotspotUser(username, password, profile) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        // Cari .id user berdasarkan username
        const users = await conn.write('/ip/hotspot/user/print', [
            '?name=' + username
        ]);
        if (!users.length) throw new Error('User tidak ditemukan');
        const id = users[0]['.id'];
        // Update password dan profile
        await conn.write('/ip/hotspot/user/set', [
            '=numbers=' + id,
            '=password=' + password,
            '=profile=' + profile
        ]);
        return true;
    } catch (err) {
        throw err;
    }
}
// Fungsi untuk generate voucher hotspot secara massal (versi lama - dihapus)
// Fungsi ini diganti dengan fungsi generateHotspotVouchers yang lebih lengkap di bawah
// Fungsi untuk mendapatkan daftar profile Hotspot dari RADIUS (yang digunakan oleh voucher users)
async function getHotspotProfilesRadius() {
    const conn = await getRadiusConnection();
    try {
        // Ambil daftar groupname yang digunakan oleh hotspot voucher users (yang ada di voucher_revenue)
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames for hotspot profiles: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        logger.info(`Found ${voucherUsernames.length} voucher usernames for hotspot profile filtering`);
        
        let groupnames = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            const [groupRows] = await conn.execute(`
                SELECT DISTINCT groupname
                FROM radusergroup
                WHERE username IN (${placeholders})
                AND groupname IS NOT NULL AND groupname != ''
            `, voucherUsernames);
            groupnames = groupRows.map(row => row.groupname);
        }
        
        const [sessionTimeoutRows] = await conn.execute(`
            SELECT DISTINCT groupname
            FROM radgroupreply
            WHERE attribute = 'Session-Timeout'
            AND groupname IS NOT NULL AND groupname != ''
        `);
        
        let metadataGroupnames = [];
        try {
            if (await ensureHotspotProfilesMetadataTable(conn)) {
                const [metadataRows] = await conn.execute(`
                    SELECT groupname
                    FROM hotspot_profiles
                    WHERE groupname IS NOT NULL AND groupname != ''
                `);
                metadataGroupnames = metadataRows.map(row => row.groupname);
            }
        } catch (metaErr) {
            logger.warn(`Failed to load hotspot profile metadata groupnames: ${metaErr.message}`);
        }

        const allGroupnames = [...new Set([
            ...groupnames,
            ...sessionTimeoutRows.map(r => r.groupname),
            ...metadataGroupnames
        ])];

        logger.info(`Found ${allGroupnames.length} hotspot groupnames (${groupnames.length} from vouchers, ${sessionTimeoutRows.length} with Session-Timeout, ${metadataGroupnames.length} from metadata)`);

        const metadataMap = await getHotspotProfilesMetadata(conn, allGroupnames);

        const profiles = [];
        for (const rawGroupname of allGroupnames) {
            const groupname = rawGroupname;

            const [replyRows] = await conn.execute(`
                SELECT attribute, value
                FROM radgroupreply
                WHERE groupname = ?
                ORDER BY attribute
            `, [groupname]);

            const [checkRows] = await conn.execute(`
                SELECT attribute, value
                FROM radgroupcheck
                WHERE groupname = ?
                ORDER BY attribute
            `, [groupname]);

            const meta = metadataMap[groupname] || null;

            const profile = {
                name: meta?.display_name || groupname,
                '.id': groupname,
                groupname: groupname,
                'rate-limit': null,
                'session-timeout': null,
                'idle-timeout': null,
                'limit-uptime': null,
                'shared-users': meta?.shared_users || null,
                limitUptimeValue: meta?.limit_uptime_value || null,
                limitUptimeUnit: meta?.limit_uptime_unit || null,
                limitUptimeSeconds: null,
                validityValue: meta?.validity_value || null,
                validityUnit: meta?.validity_unit || null,
                validitySeconds: null,
                validityString: null,
                comment: meta?.comment || '',
                localAddress: meta?.local_address || '',
                remoteAddress: meta?.remote_address || '',
                dnsServer: meta?.dns_server || '',
                parentQueue: meta?.parent_queue || '',
                addressList: meta?.address_list || '',
                nas_name: 'RADIUS',
                nas_ip: 'RADIUS Server',
                is_radius: true
            };

            [...replyRows, ...checkRows].forEach(attr => {
                switch (attr.attribute) {
                    case 'MikroTik-Rate-Limit':
                    case 'Mikrotik-Rate-Limit':
                        profile['rate-limit'] = attr.value;
                        break;
                    case 'Session-Timeout': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.sessionTimeout = formatted.value;
                            profile.sessionTimeoutUnit = formatted.unit;
                            profile['session-timeout'] = formatted.string;
                        } else {
                            const parsed = parseTimeoutValue(attr.value);
                            profile.sessionTimeout = parsed.raw;
                            profile.sessionTimeoutUnit = parsed.unit;
                            profile['session-timeout'] = attr.value;
                        }
                        break;
                    }
                    case 'Max-All-Session': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.limitUptimeSeconds = formatted.seconds;
                            profile.limitUptimeValue = formatted.value;
                            profile.limitUptimeUnit = formatted.unit;
                            profile['limit-uptime'] = formatted.string;
                        }
                        break;
                    }
                    case 'Idle-Timeout': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.idleTimeout = formatted.value;
                            profile.idleTimeoutUnit = formatted.unit;
                            profile['idle-timeout'] = formatted.string;
                        } else {
                            const parsed = parseTimeoutValue(attr.value);
                            profile.idleTimeout = parsed.raw;
                            profile.idleTimeoutUnit = parsed.unit;
                            profile['idle-timeout'] = attr.value;
                        }
                        break;
                    }
                    case 'Expire-After': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.validitySeconds = formatted.seconds;
                            profile.validityValue = formatted.value;
                            profile.validityUnit = formatted.unit;
                            profile.validityString = formatted.string;
                        }
                        break;
                    }
                    case 'Mikrotik-Shared-Users':
                    case 'MikroTik-Shared-Users':
                    case 'Simultaneous-Use':
                        profile['shared-users'] = attr.value;
                        break;
                }
            });

            if (meta) {
                const rateUnit = meta.rate_limit_unit ? meta.rate_limit_unit.toUpperCase() : '';
                if (meta.rate_limit_value && rateUnit) {
                    const formatted = `${meta.rate_limit_value}${rateUnit}/${meta.rate_limit_value}${rateUnit}`;
                    if (!profile['rate-limit']) {
                        profile['rate-limit'] = formatted;
                    }
                    profile.rateLimit = meta.rate_limit_value;
                    profile.rateLimitUnit = rateUnit;
                }

                if (meta.shared_users) {
                    profile.sharedUsers = meta.shared_users;
                    profile['shared-users'] = meta.shared_users;
                }

                const limitUnit = meta.limit_uptime_unit ? meta.limit_uptime_unit.toLowerCase() : '';
                if (meta.limit_uptime_value && limitUnit) {
                    const formatted = `${meta.limit_uptime_value}${limitUnit}`;
                    profile.limitUptimeValue = meta.limit_uptime_value;
                    profile.limitUptimeUnit = limitUnit;
                    profile['limit-uptime'] = formatted;
                    const seconds = durationToSeconds(meta.limit_uptime_value, limitUnit);
                    if (seconds) {
                        profile.limitUptimeSeconds = seconds;
                    }
                }

                const validityUnit = meta.validity_unit ? meta.validity_unit.toLowerCase() : '';
                if (meta.validity_value && validityUnit) {
                    const formatted = `${meta.validity_value}${validityUnit}`;
                    profile.validityValue = meta.validity_value;
                    profile.validityUnit = validityUnit;
                    profile.validityString = formatted;
                    const seconds = durationToSeconds(meta.validity_value, validityUnit);
                    if (seconds) {
                        profile.validitySeconds = seconds;
                    }
                }
            }

            if (profile['limit-uptime']) {
                profile.limitUptimeString = profile['limit-uptime'];
            }
            if (profile.validityString) {
                profile['validity-period'] = profile.validityString;
            }

            profiles.push(profile);
        }

        // Deduplicate profiles by groupname (case-insensitive)
        const dedupedProfiles = [];
        const seenKeys = new Set();
        profiles.forEach(profile => {
            const key = String(profile.groupname || profile.name || '').trim().toLowerCase();
            if (!key) {
                dedupedProfiles.push(profile);
                return;
            }
            if (seenKeys.has(key)) {
                logger.debug(`Skipping duplicate hotspot profile detected for groupname: ${profile.groupname}`);
                return;
            }
            seenKeys.add(key);
            dedupedProfiles.push(profile);
        });

        await conn.end();
        return {
            success: true,
            message: `Ditemukan ${dedupedProfiles.length} profile hotspot dari RADIUS`,
            data: dedupedProfiles
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting hotspot profiles from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil data profile hotspot dari RADIUS: ${error.message}`, data: [] };
    }
}

// ============================================
// HOTSPOT SERVER PROFILE FUNCTIONS
// ============================================

async function getHotspotServerProfiles(routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router for server profiles: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection for server profiles');
            conn = await getMikrotikConnection();
        }
        
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal: Tidak dapat membuat koneksi', data: [] };
        }
        
        logger.info('Fetching hotspot server profiles from Mikrotik...');
        try {
            let profiles = null;
            try {
                profiles = await conn.write('/ip/hotspot/profile/print');
                logger.info(`Command /ip/hotspot/profile/print berhasil, mendapatkan ${profiles ? profiles.length : 0} profiles`);
            } catch (cmdError) {
                logger.error(`Command /ip/hotspot/profile/print tidak tersedia: ${cmdError.message}`);
                throw cmdError;
            }
            
            if (!profiles) {
                return { success: false, message: 'Tidak ada data profile yang ditemukan', data: [] };
            }
            
            logger.info(`Successfully retrieved ${profiles ? profiles.length : 0} server profiles from ${routerObj ? routerObj.name : 'default'}`);
            
            const validProfiles = [];
            if (Array.isArray(profiles)) {
                profiles.forEach((prof, idx) => {
                    if (prof && (prof.name || prof['name'])) {
                        const normalizedProfile = {
                            id: prof['.id'] || prof.id || '',
                            name: prof.name || prof['name'] || '',
                            'hotspot-address': prof['hotspot-address'] || prof['hotspot-address'] || '',
                            'dns-name': prof['dns-name'] || prof['dns-name'] || '',
                            'html-directory': prof['html-directory'] || prof['html-directory'] || '',
                            'html-directory-override': prof['html-directory-override'] || prof['html-directory-override'] || '',
                            'rate-limit': prof['rate-limit'] || prof['rate-limit'] || '',
                            'http-proxy': prof['http-proxy'] || prof['http-proxy'] || '',
                            'http-proxy-port': prof['http-proxy-port'] || prof['http-proxy-port'] || '',
                            'smtp-server': prof['smtp-server'] || prof['smtp-server'] || '',
                            'session-timeout': prof['session-timeout'] || '',
                            'idle-timeout': prof['idle-timeout'] || '',
                            'shared-users': prof['shared-users'] || '1',
                            'open-status-page': prof['open-status-page'] || '',
                            comment: prof.comment || '',
                            disabled: prof.disabled === 'true' || prof.disabled === true
                        };
                        
                        if (routerObj) {
                            normalizedProfile.nas_id = routerObj.id;
                            normalizedProfile.nas_name = routerObj.name;
                            normalizedProfile.nas_ip = routerObj.nas_ip;
                        }
                        
                        validProfiles.push(normalizedProfile);
                        logger.debug(`  Server Profile ${idx + 1}: ${normalizedProfile.name} (hotspot-address: ${normalizedProfile['hotspot-address']}, dns-name: ${normalizedProfile['dns-name']})`);
                    }
                });
            }
            logger.info(`Valid server profiles after parsing: ${validProfiles.length}`);
            
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return {
                success: true,
                message: `Ditemukan ${validProfiles.length} server profile hotspot`,
                data: validProfiles
            };
        } catch (cmdError) {
            logger.error(`Command tidak tersedia di router ${routerObj ? routerObj.name : 'default'}: ${cmdError.message}`);
            
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            return { 
                success: false, 
                message: `Router tidak mendukung fitur Server Profile Hotspot atau versi RouterOS tidak kompatibel: ${cmdError.message}`, 
                data: [] 
            };
        }
    } catch (error) {
        logger.error(`Error getting hotspot server profiles from ${routerObj ? routerObj.name : 'default'}: ${error.message}`);
        
        if (routerObj && conn && typeof conn.close === 'function') {
            try {
                await conn.close();
            } catch (closeError) {
                // Ignore
            }
        }
        
        return { success: false, message: `Gagal ambil server profile hotspot: ${error.message}`, data: [] };
    }
}

async function getHotspotServerProfilesRadius() {
    const conn = await getRadiusConnection();
    try {
        const [tableCheck] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = 'hotspot_server_profiles'
        `);
        
        if (tableCheck.length === 0 || tableCheck[0].count === 0) {
            await conn.end();
            logger.warn('Tabel hotspot_server_profiles belum dibuat. Silakan jalankan: mysql -u root -p < setup_hotspot_server_profiles_table.sql');
            return {
                success: false,
                message: 'Tabel hotspot_server_profiles belum dibuat. Silakan jalankan script setup: mysql -u root -p < setup_hotspot_server_profiles_table.sql',
                data: []
            };
        }
        
        const [rows] = await conn.execute(`
            SELECT id, name, rate_limit, session_timeout, idle_timeout, shared_users,
                   open_status_page, http_cookie_lifetime, split_user_domain,
                   status_autorefresh, copy_from, disabled, comment,
                   created_at, updated_at
            FROM hotspot_server_profiles
            WHERE disabled = 0
            ORDER BY name
        `);
        
        const profiles = rows.map(row => ({
            '.id': row.id.toString(),
            id: row.id,
            name: row.name,
            'rate-limit': row.rate_limit || '',
            'session-timeout': row.session_timeout || '',
            'idle-timeout': row.idle_timeout || '',
            'shared-users': row.shared_users || 1,
            'open-status-page': row.open_status_page || 'http-login',
            'http-cookie-lifetime': row.http_cookie_lifetime || 0,
            'split-user-domain': row.split_user_domain ? 'yes' : 'no',
            'status-autorefresh': row.status_autorefresh || 'none',
            'copy-from': row.copy_from || '',
            disabled: row.disabled ? 'true' : 'false',
            comment: row.comment || '',
            nas_name: 'RADIUS',
            nas_ip: 'RADIUS Server',
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
        
        await conn.end();
        return {
            success: true,
            message: `Ditemukan ${profiles.length} server profile hotspot dari RADIUS`,
            data: profiles
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting hotspot server profiles from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil server profile hotspot dari RADIUS: ${error.message}`, data: [] };
    }
}

async function addHotspotServerProfileRadius(profileData) {
    const conn = await getRadiusConnection();
    try {
        const [tableCheck] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = 'hotspot_server_profiles'
        `);
        
        if (tableCheck.length === 0 || tableCheck[0].count === 0) {
            await conn.end();
            return {
                success: false,
                message: 'Tabel hotspot_server_profiles belum dibuat. Silakan jalankan script setup terlebih dahulu: mysql -u root -p < setup_hotspot_server_profiles_table.sql'
            };
        }
        
        const name = (profileData.name || '').trim().toLowerCase().replace(/\s+/g, '-');
        
        if (!name || name === '') {
            await conn.end();
            return { success: false, message: 'Nama server profile tidak boleh kosong' };
        }
        
        const [existing] = await conn.execute(`
            SELECT COUNT(*) as count FROM hotspot_server_profiles WHERE name = ?
        `, [name]);
        
        if (existing && existing.length > 0 && existing[0].count > 0) {
            await conn.end();
            return { success: false, message: `Server profile dengan nama \"${name}\" sudah ada` };
        }
        
        await conn.execute(`
            INSERT INTO hotspot_server_profiles (
                name, rate_limit, session_timeout, idle_timeout, shared_users,
                open_status_page, http_cookie_lifetime, split_user_domain,
                status_autorefresh, copy_from, disabled, comment
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name,
            profileData['rate-limit'] || null,
            profileData['session-timeout'] || null,
            profileData['idle-timeout'] || null,
            parseInt(profileData['shared-users']) || 1,
            profileData['open-status-page'] || 'http-login',
            parseInt(profileData['http-cookie-lifetime']) || 0,
            profileData['split-user-domain'] === 'yes' ? 1 : 0,
            profileData['status-autorefresh'] || 'none',
            profileData['copy-from'] || null,
            profileData.disabled === 'true' ? 1 : 0,
            profileData.comment || null
        ]);
        
        await conn.end();
        logger.info(`Successfully added hotspot server profile to RADIUS: ${name}`);
        return { success: true, message: `Server profile \"${name}\" berhasil ditambahkan ke RADIUS` };
    } catch (error) {
        await conn.end();
        logger.error(`Error adding hotspot server profile to RADIUS: ${error.message}`);
        return { success: false, message: `Gagal menambah server profile: ${error.message}` };
    }
}

async function editHotspotServerProfileRadius(id, profileData) {
    const conn = await getRadiusConnection();
    try {
        const name = (profileData.name || '').trim().toLowerCase().replace(/\s+/g, '-');
        
        if (!name || name === '') {
            await conn.end();
            return { success: false, message: 'Nama server profile tidak boleh kosong' };
        }
        
        const [existing] = await conn.execute(`
            SELECT COUNT(*) as count FROM hotspot_server_profiles WHERE name = ? AND id != ?
        `, [name, id]);
        
        if (existing && existing.length > 0 && existing[0].count > 0) {
            await conn.end();
            return { success: false, message: `Server profile dengan nama \"${name}\" sudah ada` };
        }
        
        await conn.execute(`
            UPDATE hotspot_server_profiles SET
                name = ?, rate_limit = ?, session_timeout = ?, idle_timeout = ?,
                shared_users = ?, open_status_page = ?, http_cookie_lifetime = ?,
                split_user_domain = ?, status_autorefresh = ?, copy_from = ?,
                disabled = ?, comment = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            name,
            profileData['rate-limit'] || null,
            profileData['session-timeout'] || null,
            profileData['idle-timeout'] || null,
            parseInt(profileData['shared-users']) || 1,
            profileData['open-status-page'] || 'http-login',
            parseInt(profileData['http-cookie-lifetime']) || 0,
            profileData['split-user-domain'] === 'yes' ? 1 : 0,
            profileData['status-autorefresh'] || 'none',
            profileData['copy-from'] || null,
            profileData.disabled === 'true' ? 1 : 0,
            profileData.comment || null,
            id
        ]);
        
        await conn.end();
        logger.info(`Successfully updated hotspot server profile in RADIUS: ${name}`);
        return { success: true, message: `Server profile \"${name}\" berhasil diupdate` };
    } catch (error) {
        await conn.end();
        logger.error(`Error updating hotspot server profile in RADIUS: ${error.message}`);
        return { success: false, message: `Gagal update server profile: ${error.message}` };
    }
}

async function deleteHotspotServerProfileRadius(id) {
    const conn = await getRadiusConnection();
    try {
        await conn.execute(`
            UPDATE hotspot_server_profiles SET disabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `, [id]);
        
        await conn.end();
        logger.info(`Successfully disabled hotspot server profile in RADIUS: ID ${id}`);
        return { success: true, message: 'Server profile berhasil dihapus (disabled)' };
    } catch (error) {
        await conn.end();
        logger.error(`Error deleting hotspot server profile from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal menghapus server profile: ${error.message}` };
    }
}

async function getHotspotServerProfileDetailRadius(id) {
    const conn = await getRadiusConnection();
    try {
        const [rows] = await conn.execute(`
            SELECT id, name, rate_limit, session_timeout, idle_timeout, shared_users,
                   open_status_page, http_cookie_lifetime, split_user_domain,
                   status_autorefresh, copy_from, disabled, comment,
                   created_at, updated_at
            FROM hotspot_server_profiles
            WHERE id = ?
        `, [id]);
        
        if (rows.length === 0) {
            await conn.end();
            return { success: false, message: 'Server profile tidak ditemukan', data: null };
        }
        
        const row = rows[0];
        const profile = {
            '.id': row.id.toString(),
            id: row.id,
            name: row.name,
            'rate-limit': row.rate_limit || '',
            'session-timeout': row.session_timeout || '',
            'idle-timeout': row.idle_timeout || '',
            'shared-users': row.shared_users || 1,
            'open-status-page': row.open_status_page || 'http-login',
            'http-cookie-lifetime': row.http_cookie_lifetime || 0,
            'split-user-domain': row.split_user_domain ? 'yes' : 'no',
            'status-autorefresh': row.status_autorefresh || 'none',
            'copy-from': row.copy_from || '',
            disabled: row.disabled ? 'true' : 'false',
            comment: row.comment || '',
            nas_name: 'RADIUS',
            nas_ip: 'RADIUS Server',
            created_at: row.created_at,
            updated_at: row.updated_at
        };
        
        await conn.end();
        return { success: true, data: profile };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting hotspot server profile detail from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil detail server profile: ${error.message}`, data: null };
    }
}
let hotspotProfilesColumnsCache = null;
let hotspotProfilesPermissionWarningLogged = false;
let hotspotProfilesPermissionDenied = false; // Flag untuk menandai bahwa permission denied sudah terjadi

async function ensureHotspotProfilesMetadataTable(conn) {
    try {
        const [tableCheck] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = 'hotspot_profiles'
        `);

        if (!tableCheck || tableCheck.length === 0 || tableCheck[0].count === 0) {
            logger.info('Tabel hotspot_profiles belum ada, mencoba membuat...');
            try {
                // Buat tabel hotspot_profiles dengan struktur dasar
                await conn.execute(`
                    CREATE TABLE IF NOT EXISTS hotspot_profiles (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        groupname VARCHAR(128) NOT NULL UNIQUE,
                        display_name VARCHAR(128) NOT NULL,
                        comment TEXT NULL,
                        rate_limit_value VARCHAR(32) NULL,
                        rate_limit_unit VARCHAR(10) NULL,
                        burst_limit_value VARCHAR(32) NULL,
                        burst_limit_unit VARCHAR(10) NULL,
                        session_timeout_value INT DEFAULT NULL,
                        session_timeout_unit VARCHAR(10) NULL,
                        idle_timeout_value INT DEFAULT NULL,
                        idle_timeout_unit VARCHAR(10) NULL,
                        limit_uptime_value INT DEFAULT NULL,
                        limit_uptime_unit VARCHAR(10) NULL,
                        validity_value INT DEFAULT NULL,
                        validity_unit VARCHAR(10) NULL,
                        shared_users INT DEFAULT 1,
                        local_address VARCHAR(64) NULL,
                        remote_address VARCHAR(64) NULL,
                        dns_server VARCHAR(255) NULL,
                        parent_queue VARCHAR(64) NULL,
                        address_list VARCHAR(64) NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                logger.info('✅ Tabel hotspot_profiles berhasil dibuat');
                // Set cache untuk kolom yang baru dibuat
                const [newColumnRows] = await conn.execute(`
                    SELECT COLUMN_NAME
                    FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = 'hotspot_profiles'
                `);
                hotspotProfilesColumnsCache = new Set(
                    (newColumnRows || []).map(row => String(row.COLUMN_NAME).toLowerCase())
                );
                return true;
            } catch (createError) {
                logger.error(`❌ Gagal membuat tabel hotspot_profiles: ${createError.message}`);
                logger.warn('⚠️ Metadata profil hotspot tidak akan disimpan, tapi profil tetap berfungsi di radgroupreply');
                return false;
            }
        }

        // Pastikan kolom-kolom terbaru tersedia (untuk kompatibilitas versi lama)
        const requiredColumns = [
            { name: 'rate_limit_value', definition: 'VARCHAR(32)' },
            { name: 'rate_limit_unit', definition: 'VARCHAR(10)' },
            { name: 'burst_limit_value', definition: 'VARCHAR(32)' },
            { name: 'burst_limit_unit', definition: 'VARCHAR(10)' },
            { name: 'session_timeout_value', definition: 'INT DEFAULT NULL' },
            { name: 'session_timeout_unit', definition: 'VARCHAR(10)' },
            { name: 'idle_timeout_value', definition: 'INT DEFAULT NULL' },
            { name: 'idle_timeout_unit', definition: 'VARCHAR(10)' },
            { name: 'limit_uptime_value', definition: 'INT DEFAULT NULL' },
            { name: 'limit_uptime_unit', definition: 'VARCHAR(10)' },
            { name: 'validity_value', definition: 'INT DEFAULT NULL' },
            { name: 'validity_unit', definition: 'VARCHAR(10)' },
            { name: 'shared_users', definition: 'INT DEFAULT 1' },
            { name: 'local_address', definition: 'VARCHAR(64)' },
            { name: 'remote_address', definition: 'VARCHAR(64)' },
            { name: 'dns_server', definition: 'VARCHAR(255)' },
            { name: 'parent_queue', definition: 'VARCHAR(64)' },
            { name: 'address_list', definition: 'VARCHAR(64)' }
        ];

        const [columnRows] = await conn.execute(`
            SELECT COLUMN_NAME
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'hotspot_profiles'
        `);

        const existingColumns = new Set(
            (columnRows || []).map(row => String(row.COLUMN_NAME).toLowerCase())
        );
        hotspotProfilesColumnsCache = existingColumns;

        // Skip penambahan kolom jika permission sudah pernah denied
        if (hotspotProfilesPermissionDenied) {
            // Jika permission sudah pernah denied, langsung return tanpa mencoba lagi
            hotspotProfilesColumnsCache = existingColumns;
            return true;
        }

        for (const col of requiredColumns) {
            if (!existingColumns.has(col.name.toLowerCase())) {
                try {
                    await conn.execute(`ALTER TABLE hotspot_profiles ADD COLUMN ${col.name} ${col.definition}`);
                    logger.info(`Menambahkan kolom hotspot_profiles.${col.name} untuk kompatibilitas`);
                    existingColumns.add(col.name.toLowerCase());
                    hotspotProfilesColumnsCache = existingColumns;
                    // Reset flag jika berhasil menambahkan kolom (berarti permission sudah ada)
                    hotspotProfilesPermissionDenied = false;
                } catch (alterError) {
                    // Cek apakah error karena permission denied
                    const errorMsg = alterError.message || '';
                    if (errorMsg.includes('denied') || errorMsg.includes('permission') || errorMsg.includes('Access denied')) {
                        // Set flag bahwa permission denied
                        hotspotProfilesPermissionDenied = true;
                        // Hanya log sekali untuk menghindari spam log
                        if (!hotspotProfilesPermissionWarningLogged) {
                            logger.warn(`User database tidak memiliki permission ALTER TABLE untuk hotspot_profiles. Kolom tidak dapat ditambahkan otomatis.`);
                            logger.warn(`Untuk memperbaiki, jalankan: sudo bash scripts/grant_alter_permission.sh`);
                            logger.warn(`Atau sebagai root MySQL: GRANT ALTER ON radius.hotspot_profiles TO 'billing'@'localhost'; FLUSH PRIVILEGES;`);
                            hotspotProfilesPermissionWarningLogged = true;
                        }
                        // Break loop karena semua kolom akan gagal dengan alasan yang sama
                        break;
                    } else {
                        logger.warn(`Gagal menambahkan kolom hotspot_profiles.${col.name}: ${alterError.message}`);
                    }
                }
            }
        }

        hotspotProfilesColumnsCache = existingColumns;
        return true;
    } catch (error) {
        logger.error(`Error checking hotspot_profiles table: ${error.message}`);
        hotspotProfilesColumnsCache = null;
        return false;
    }
}

async function getHotspotProfilesMetadata(conn, groupnames = []) {
    if (!groupnames || groupnames.length === 0) return {};
    const exists = await ensureHotspotProfilesMetadataTable(conn);
    if (!exists) return {};

    const columnsSet = hotspotProfilesColumnsCache;
    let selectColumns = [];

    const addColumn = (columnName, required = false) => {
        if (
            required ||
            !columnsSet ||
            columnsSet.size === 0 ||
            columnsSet.has(columnName.toLowerCase())
        ) {
            selectColumns.push(columnName);
        }
    };

    addColumn('groupname', true);
    addColumn('display_name');
    addColumn('comment');
    addColumn('rate_limit_value');
    addColumn('rate_limit_unit');
    addColumn('burst_limit_value');
    addColumn('burst_limit_unit');
    addColumn('session_timeout_value');
    addColumn('session_timeout_unit');
    addColumn('idle_timeout_value');
    addColumn('idle_timeout_unit');
    addColumn('limit_uptime_value');
    addColumn('limit_uptime_unit');
    addColumn('validity_value');
    addColumn('validity_unit');
    addColumn('shared_users');
    addColumn('local_address');
    addColumn('remote_address');
    addColumn('dns_server');
    addColumn('parent_queue');
    addColumn('address_list');

    if (selectColumns.length === 0) {
        selectColumns = ['groupname'];
    }

    const placeholders = groupnames.map(() => '?').join(',');
    const sql = `
        SELECT ${selectColumns.join(', ')}
        FROM hotspot_profiles
        WHERE groupname IN (${placeholders})
    `;
    const [rows] = await conn.execute(sql, groupnames);

    const map = {};
    rows.forEach(row => {
        const key = row.groupname || row.GROUPNAME || null;
        if (key) {
            map[key] = row;
        }
    });
    return map;
}
async function getHotspotProfileMetadata(conn, groupname) {
    if (!groupname) return null;
    const exists = await ensureHotspotProfilesMetadataTable(conn);
    if (!exists) return null;

    const columnsSet = hotspotProfilesColumnsCache;
    let selectColumns = [];

    const addColumn = (columnName, required = false) => {
        if (
            required ||
            !columnsSet ||
            columnsSet.size === 0 ||
            columnsSet.has(columnName.toLowerCase())
        ) {
            selectColumns.push(columnName);
        }
    };

    addColumn('groupname', true);
    addColumn('display_name');
    addColumn('comment');
    addColumn('rate_limit_value');
    addColumn('rate_limit_unit');
    addColumn('burst_limit_value');
    addColumn('burst_limit_unit');
    addColumn('session_timeout_value');
    addColumn('session_timeout_unit');
    addColumn('idle_timeout_value');
    addColumn('idle_timeout_unit');
    addColumn('limit_uptime_value');
    addColumn('limit_uptime_unit');
    addColumn('validity_value');
    addColumn('validity_unit');
    addColumn('shared_users');
    addColumn('local_address');
    addColumn('remote_address');
    addColumn('dns_server');
    addColumn('parent_queue');
    addColumn('address_list');

    if (selectColumns.length === 0) {
        selectColumns = ['groupname'];
    }

    const sql = `
        SELECT ${selectColumns.join(', ')}
        FROM hotspot_profiles
        WHERE groupname = ?
        LIMIT 1
    `;
    const [rows] = await conn.execute(sql, [groupname]);

    return rows && rows.length > 0 ? rows[0] : null;
}

async function saveHotspotProfileMetadata(conn, metadata) {
    const exists = await ensureHotspotProfilesMetadataTable(conn);
    if (!exists) return false;

    const columnsSet = hotspotProfilesColumnsCache;
    const insertColumns = [];
    const placeholders = [];
    const values = [];
    const updateClauses = [];

    const addColumn = (columnName, value, options = {}) => {
        const { required = false, includeInUpdate = true } = options;
        if (
            required ||
            !columnsSet ||
            columnsSet.size === 0 ||
            columnsSet.has(columnName.toLowerCase())
        ) {
            insertColumns.push(columnName);
            placeholders.push('?');
            values.push(value !== undefined ? value : null);
            if (includeInUpdate) {
                updateClauses.push(`${columnName} = VALUES(${columnName})`);
            }
        }
    };

    addColumn('groupname', metadata.groupname, { required: true, includeInUpdate: false });
    addColumn('display_name', metadata.displayName || metadata.groupname);
    addColumn('comment', metadata.comment || null);
    addColumn('rate_limit_value', metadata.rateLimitValue);
    addColumn('rate_limit_unit', metadata.rateLimitUnit);
    addColumn('burst_limit_value', metadata.burstLimitValue);
    addColumn('burst_limit_unit', metadata.burstLimitUnit);
    addColumn('session_timeout_value', metadata.sessionTimeoutValue);
    addColumn('session_timeout_unit', metadata.sessionTimeoutUnit);
    addColumn('idle_timeout_value', metadata.idleTimeoutValue);
    addColumn('idle_timeout_unit', metadata.idleTimeoutUnit);
    addColumn('limit_uptime_value', metadata.limitUptimeValue);
    addColumn('limit_uptime_unit', metadata.limitUptimeUnit);
    addColumn('validity_value', metadata.validityValue);
    addColumn('validity_unit', metadata.validityUnit);
    addColumn('shared_users', metadata.sharedUsers);
    addColumn('local_address', metadata.localAddress);
    addColumn('remote_address', metadata.remoteAddress);
    addColumn('dns_server', metadata.dnsServer);
    addColumn('parent_queue', metadata.parentQueue);
    addColumn('address_list', metadata.addressList);

    if (insertColumns.length === 0) {
        return false;
    }

    if (updateClauses.length === 0) {
        updateClauses.push('groupname = VALUES(groupname)');
    }

    const sql = `
        INSERT INTO hotspot_profiles (${insertColumns.join(', ')})
        VALUES (${placeholders.join(', ')})
        ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}
    `;

    await conn.execute(sql, values);

    return true;
}

async function deleteHotspotProfileMetadata(conn, groupname) {
    const exists = await ensureHotspotProfilesMetadataTable(conn);
    if (!exists) return false;
    await conn.execute('DELETE FROM hotspot_profiles WHERE groupname = ?', [groupname]);
    return true;
}
async function ensurePPPoEProfilesMetadataTable(conn) {
    try {
        const [tableCheck] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = 'pppoe_profiles'
        `);

        if (!tableCheck || tableCheck.length === 0 || tableCheck[0].count === 0) {
            logger.info('Tabel pppoe_profiles belum ada, mencoba membuat...');
            try {
                await conn.execute(`
                    CREATE TABLE IF NOT EXISTS pppoe_profiles (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        groupname VARCHAR(128) NOT NULL UNIQUE,
                        display_name VARCHAR(128) NOT NULL,
                        comment TEXT NULL,
                        rate_limit VARCHAR(128) NULL,
                        local_address VARCHAR(64) NULL,
                        remote_address VARCHAR(64) NULL,
                        dns_server VARCHAR(128) NULL,
                        parent_queue VARCHAR(128) NULL,
                        address_list VARCHAR(128) NULL,
                        bridge_learning VARCHAR(16) NOT NULL DEFAULT 'default',
                        use_mpls VARCHAR(16) NOT NULL DEFAULT 'default',
                        use_compression VARCHAR(16) NOT NULL DEFAULT 'default',
                        use_encryption VARCHAR(16) NOT NULL DEFAULT 'default',
                        only_one VARCHAR(16) NOT NULL DEFAULT 'default',
                        change_tcp_mss VARCHAR(16) NOT NULL DEFAULT 'default',
                        use_upnp VARCHAR(16) NOT NULL DEFAULT 'default',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                logger.info('✅ Tabel pppoe_profiles berhasil dibuat');
                return true;
            } catch (createError) {
                logger.error(`❌ Gagal membuat tabel pppoe_profiles: ${createError.message}`);
                logger.warn('⚠️ Metadata profil tidak akan disimpan, tapi profil tetap berfungsi di radgroupreply');
                return false;
            }
        }

        return true;
    } catch (error) {
        logger.error(`Error checking pppoe_profiles table: ${error.message}`);
        return false;
    }
}

async function getPPPoEProfilesMetadata(conn, groupnames = []) {
    if (!groupnames || groupnames.length === 0) return {};
    const exists = await ensurePPPoEProfilesMetadataTable(conn);
    if (!exists) return {};

    const placeholders = groupnames.map(() => '?').join(',');
    const [rows] = await conn.execute(`
        SELECT groupname, display_name, comment, rate_limit,
               local_address, remote_address, dns_server,
               parent_queue, address_list,
               bridge_learning, use_mpls, use_compression,
               use_encryption, only_one, change_tcp_mss, use_upnp
        FROM pppoe_profiles
        WHERE groupname IN (${placeholders})
    `, groupnames);

    const map = {};
    rows.forEach(row => {
        map[row.groupname] = row;
    });
    return map;
}

async function getPPPoEProfileMetadata(conn, groupname) {
    if (!groupname) return null;
    const exists = await ensurePPPoEProfilesMetadataTable(conn);
    if (!exists) return null;

    const [rows] = await conn.execute(`
        SELECT groupname, display_name, comment, rate_limit,
               local_address, remote_address, dns_server,
               parent_queue, address_list,
               bridge_learning, use_mpls, use_compression,
               use_encryption, only_one, change_tcp_mss, use_upnp
        FROM pppoe_profiles
        WHERE groupname = ?
        LIMIT 1
    `, [groupname]);

    return rows && rows.length > 0 ? rows[0] : null;
}

async function savePPPoEProfileMetadata(conn, metadata) {
    const exists = await ensurePPPoEProfilesMetadataTable(conn);
    if (!exists) return false;

    await conn.execute(`
        INSERT INTO pppoe_profiles (
            groupname, display_name, comment, rate_limit,
            local_address, remote_address, dns_server,
            parent_queue, address_list,
            bridge_learning, use_mpls, use_compression,
            use_encryption, only_one, change_tcp_mss, use_upnp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            comment = VALUES(comment),
            rate_limit = VALUES(rate_limit),
            local_address = VALUES(local_address),
            remote_address = VALUES(remote_address),
            dns_server = VALUES(dns_server),
            parent_queue = VALUES(parent_queue),
            address_list = VALUES(address_list),
            bridge_learning = VALUES(bridge_learning),
            use_mpls = VALUES(use_mpls),
            use_compression = VALUES(use_compression),
            use_encryption = VALUES(use_encryption),
            only_one = VALUES(only_one),
            change_tcp_mss = VALUES(change_tcp_mss),
            use_upnp = VALUES(use_upnp)
    `, [
        metadata.groupname,
        metadata.displayName,
        metadata.comment,
        metadata.rateLimit,
        metadata.localAddress,
        metadata.remoteAddress,
        metadata.dnsServer,
        metadata.parentQueue,
        metadata.addressList,
        metadata.bridgeLearning,
        metadata.useMpls,
        metadata.useCompression,
        metadata.useEncryption,
        metadata.onlyOne,
        metadata.changeTcpMss,
        metadata.useUpnp
    ]);

    return true;
}

async function deletePPPoEProfileMetadata(conn, groupname) {
    const exists = await ensurePPPoEProfilesMetadataTable(conn);
    if (!exists) return false;
    await conn.execute('DELETE FROM pppoe_profiles WHERE groupname = ?', [groupname]);
    return true;
}
// Fungsi untuk mendapatkan detail profile hotspot (RADIUS)
async function getHotspotProfileDetailRadius(groupname) {
    const conn = await getRadiusConnection();
    try {
        if (!groupname) {
            await conn.end();
            return { success: false, message: 'Nama profile tidak boleh kosong', data: null };
        }

        const normalizedGroupname = String(groupname).trim();

        const [replyRows] = await conn.execute(`
            SELECT attribute, value
            FROM radgroupreply
            WHERE groupname = ?
            ORDER BY attribute
        `, [normalizedGroupname]);

        const [checkRows] = await conn.execute(`
            SELECT attribute, value
            FROM radgroupcheck
            WHERE groupname = ?
            ORDER BY attribute
        `, [normalizedGroupname]);

        const metadata = await getHotspotProfileMetadata(conn, normalizedGroupname);

        if ((!replyRows || replyRows.length === 0) && (!checkRows || checkRows.length === 0) && !metadata) {
            await conn.end();
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }

        const profile = {
            name: metadata?.display_name || normalizedGroupname,
            '.id': normalizedGroupname,
            groupname: normalizedGroupname,
            comment: metadata?.comment || '',
            disabled: false,
            rateLimit: null,
            sessionTimeout: null,
            idleTimeout: null,
            'limit-uptime': null,
            'shared-users': metadata?.shared_users || null,
            limitUptimeValue: metadata?.limit_uptime_value || null,
            limitUptimeUnit: metadata?.limit_uptime_unit || null,
            limitUptimeSeconds: null,
            validityValue: metadata?.validity_value || null,
            validityUnit: metadata?.validity_unit || null,
            validitySeconds: null,
            validityString: null,
            rateLimitUnit: null,
            sessionTimeoutUnit: null,
            idleTimeoutUnit: null,
            localAddress: metadata?.local_address || '',
            remoteAddress: metadata?.remote_address || '',
            dnsServer: metadata?.dns_server || '',
            parentQueue: metadata?.parent_queue || '',
            addressList: metadata?.address_list || '',
            nas_name: 'RADIUS',
            nas_ip: 'RADIUS Server',
            is_radius: true,
            'rate-limit': null,
            'session-timeout': null,
            'idle-timeout': null
        };

        const parseTimeoutValue = (value) => {
            if (!value) return { raw: null, unit: null };
            const match = String(value).match(/^(\d+)([a-zA-Z]*)$/);
            if (match) {
                return {
                    raw: match[1],
                    unit: match[2] || null
                };
            }
            return { raw: value, unit: null };
        };

        const parseRateLimit = (value) => {
            if (!value) return { raw: null, unit: null };
            const parts = String(value).split('/');
            if (parts.length >= 1) {
                const match = parts[0].match(/^(\d+)([kKmMgG]?)$/);
                if (match) {
                    return {
                        raw: match[1],
                        unit: match[2] ? match[2].toUpperCase() : null
                    };
                }
            }
            return { raw: value, unit: null };
        };

        [...replyRows, ...checkRows].forEach(attr => {
            switch (attr.attribute) {
                case 'MikroTik-Rate-Limit':
                case 'Mikrotik-Rate-Limit': {
                    profile['rate-limit'] = attr.value;
                    const parsed = parseRateLimit(attr.value);
                    profile.rateLimit = parsed.raw;
                    profile.rateLimitUnit = parsed.unit;
                    break;
                }
                case 'Session-Timeout': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.sessionTimeout = formatted.value;
                        profile.sessionTimeoutUnit = formatted.unit;
                        profile['session-timeout'] = formatted.string;
                    } else {
                        const parsed = parseTimeoutValue(attr.value);
                        profile.sessionTimeout = parsed.raw;
                        profile.sessionTimeoutUnit = parsed.unit;
                        profile['session-timeout'] = attr.value;
                    }
                    break;
                }
                case 'Max-All-Session': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.limitUptimeSeconds = formatted.seconds;
                        profile.limitUptimeValue = formatted.value;
                        profile.limitUptimeUnit = formatted.unit;
                        profile['limit-uptime'] = formatted.string;
                    }
                    break;
                }
                case 'Idle-Timeout': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.idleTimeout = formatted.value;
                        profile.idleTimeoutUnit = formatted.unit;
                        profile['idle-timeout'] = formatted.string;
                    } else {
                        const parsed = parseTimeoutValue(attr.value);
                        profile.idleTimeout = parsed.raw;
                        profile.idleTimeoutUnit = parsed.unit;
                        profile['idle-timeout'] = attr.value;
                    }
                    break;
                }
                case 'Expire-After': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.validitySeconds = formatted.seconds;
                        profile.validityValue = formatted.value;
                        profile.validityUnit = formatted.unit;
                        profile.validityString = formatted.string;
                    }
                    break;
                }
                case 'Mikrotik-Shared-Users':
                case 'MikroTik-Shared-Users':
                case 'Simultaneous-Use': {
                    profile['shared-users'] = attr.value;
                    break;
                }
                case 'Mikrotik-Address-List':
                case 'MikroTik-Address-List': {
                    profile.addressList = attr.value;
                    break;
                }
                case 'Mikrotik-Rate-Limit-Comment':
                case 'Comment': {
                    profile.comment = attr.value;
                    break;
                }
                default:
                    break;
            }
        });

        if (metadata) {
            const sessionUnit = metadata.session_timeout_unit ? metadata.session_timeout_unit.toLowerCase() : '';
            if (metadata.session_timeout_value && sessionUnit) {
                const formatted = `${metadata.session_timeout_value}${sessionUnit}`;
                profile.sessionTimeout = metadata.session_timeout_value;
                profile.sessionTimeoutUnit = sessionUnit;
                profile['session-timeout'] = formatted;
            }

            const idleUnit = metadata.idle_timeout_unit ? metadata.idle_timeout_unit.toLowerCase() : '';
            if (metadata.idle_timeout_value && idleUnit) {
                const formatted = `${metadata.idle_timeout_value}${idleUnit}`;
                profile.idleTimeout = metadata.idle_timeout_value;
                profile.idleTimeoutUnit = idleUnit;
                profile['idle-timeout'] = formatted;
            }

            const rateUnit = metadata.rate_limit_unit ? metadata.rate_limit_unit.toUpperCase() : '';
            if (metadata.rate_limit_value && rateUnit) {
                const formatted = `${metadata.rate_limit_value}${rateUnit}/${metadata.rate_limit_value}${rateUnit}`;
                if (!profile['rate-limit']) {
                    profile['rate-limit'] = formatted;
                }
                profile.rateLimit = metadata.rate_limit_value;
                profile.rateLimitUnit = rateUnit;
            }

            if (metadata.shared_users) {
                profile.sharedUsers = metadata.shared_users;
                profile['shared-users'] = metadata.shared_users;
            }

            const limitUnit = metadata.limit_uptime_unit ? metadata.limit_uptime_unit.toLowerCase() : '';
            if (metadata.limit_uptime_value && limitUnit) {
                const formatted = `${metadata.limit_uptime_value}${limitUnit}`;
                profile.limitUptimeValue = metadata.limit_uptime_value;
                profile.limitUptimeUnit = limitUnit;
                profile['limit-uptime'] = formatted;
                const seconds = durationToSeconds(metadata.limit_uptime_value, limitUnit);
                if (seconds) {
                    profile.limitUptimeSeconds = seconds;
                }
            }

            const validityUnit = metadata.validity_unit ? metadata.validity_unit.toLowerCase() : '';
            if (metadata.validity_value && validityUnit) {
                const formatted = `${metadata.validity_value}${validityUnit}`;
                profile.validityValue = metadata.validity_value;
                profile.validityUnit = validityUnit;
                profile.validityString = formatted;
                const seconds = durationToSeconds(metadata.validity_value, validityUnit);
                if (seconds) {
                    profile.validitySeconds = seconds;
                }
            }
        }

        if (profile['limit-uptime']) {
            profile.limitUptimeString = profile['limit-uptime'];
        }
        if (profile.validityString) {
            profile['validity-period'] = profile.validityString;
        }

        await conn.end();
        return {
            success: true,
            message: 'Detail profile berhasil diambil',
            data: profile
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting hotspot profile detail from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil detail profile: ${error.message}`, data: null };
    }
}
// Fungsi untuk mendapatkan daftar profile PPPoE dari RADIUS (yang digunakan oleh PPPoE users, BUKAN voucher)
async function getPPPoEProfilesRadius() {
    const conn = await getRadiusConnection();
    try {
        // Ambil daftar groupname yang digunakan oleh PPPoE users (yang TIDAK ada di voucher_revenue)
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames for PPPoE profiles: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        logger.info(`Found ${voucherUsernames.length} voucher usernames to exclude from PPPoE profiles`);
        
        // Ambil groupname yang digunakan oleh voucher users untuk di-exclude
        let voucherGroupnames = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            const [voucherGroups] = await conn.execute(`
                SELECT DISTINCT groupname
                FROM radusergroup
                WHERE username IN (${placeholders})
            `, voucherUsernames);
            voucherGroupnames = voucherGroups.map(r => r.groupname);
        }
        
        // Ambil semua groupname dari radgroupreply, exclude yang digunakan oleh voucher
        // INCLUDE 'isolir' agar profil isolir ditampilkan di UI (dengan badge khusus)
        let query = `
            SELECT DISTINCT groupname
            FROM radgroupreply
            WHERE groupname IS NOT NULL AND groupname != ''
            AND groupname NOT IN ('default')
        `;
        
        const params = [];
        if (voucherGroupnames.length > 0) {
            const excludePlaceholders = voucherGroupnames.map(() => '?').join(',');
            query += ` AND groupname NOT IN (${excludePlaceholders})`;
            params.push(...voucherGroupnames);
        }
        
        query += ` ORDER BY groupname ASC`;
        
        logger.info(`Query untuk mendapatkan profil: ${query}`);
        logger.info(`Params: ${JSON.stringify(params)}`);
        
        const [groupRows] = await conn.execute(query, params);
        
        logger.info(`Ditemukan ${groupRows.length} groupname dari radgroupreply`);

        const groupnames = groupRows.map(row => row.groupname);

        // Jangan tampilkan profile yang dibuat untuk hotspot. Profile hotspot disimpan
        // di tabel metadata `hotspot_profiles`, jadi gunakan itu sebagai penanda.
        // CRITICAL: Profil PPPoE harus dibedakan dengan profil Hotspot
        const hotspotMetadataMap = await getHotspotProfilesMetadata(conn, groupnames);
        
        logger.info(`🔍 Filtering: Ditemukan ${Object.keys(hotspotMetadataMap).length} profil hotspot dari ${groupnames.length} total profil`);

        const filteredGroupnames = groupnames.filter(name => {
            // Jangan filter profil isolir (profil sistem)
            if (name === 'isolir') {
                logger.debug(`✅ Profile "${name}" adalah profil isolir (sistem), akan ditampilkan`);
                return true;
            }
            if (hotspotMetadataMap[name]) {
                logger.info(`⏭️  SKIP: Profile "${name}" adalah profil HOTSPOT, tidak ditampilkan di daftar PPPoE`);
                return false;
            }
            logger.debug(`✅ Profile "${name}" adalah profil PPPoE, akan ditampilkan`);
            return true;
        });
        
        logger.info(`📋 Hasil filter: ${filteredGroupnames.length} profil PPPoE (dari ${groupnames.length} total, ${Object.keys(hotspotMetadataMap).length} adalah hotspot)`);

        const metadataMap = await getPPPoEProfilesMetadata(conn, filteredGroupnames);

        const profiles = [];
        // Gunakan filteredGroupnames untuk memastikan hanya profil yang valid yang ditampilkan
        logger.info(`Memproses ${filteredGroupnames.length} profil setelah filter hotspot`);
        
        for (const groupname of filteredGroupnames) {
            // Double check: skip jika ini adalah hotspot profile (kecuali isolir)
            if (groupname !== 'isolir' && hotspotMetadataMap[groupname]) {
                logger.debug(`Skipping hotspot profile "${groupname}" dari loop`);
                continue;
            }
            
            const meta = metadataMap[groupname] || null;
            
            // Get all attributes for this group
            const [attrRows] = await conn.execute(`
                SELECT attribute, value
                FROM radgroupreply
                WHERE groupname = ?
                ORDER BY attribute
            `, [groupname]);
            
            // Jika tidak ada attribute sama sekali, skip profil ini
            if (!attrRows || attrRows.length === 0) {
                logger.warn(`⚠️ Profile ${groupname} tidak memiliki attribute di radgroupreply, skip`);
                continue;
            }
            
            // Build profile object
            const isIsolirProfile = groupname === 'isolir';
            const profile = {
                name: meta?.display_name || groupname,
                '.id': groupname, // Use groupname as ID for RADIUS
                groupname: groupname,
                'rate-limit': null,
                'session-timeout': null,
                'idle-timeout': null,
                'limit-uptime': null,
                'shared-users': null,
                comment: meta?.comment || (isIsolirProfile ? 'Profile sistem untuk isolir/suspension' : ''),
                localAddress: meta?.local_address || '',
                remoteAddress: meta?.remote_address || '',
                dnsServer: meta?.dns_server || '',
                parentQueue: meta?.parent_queue || '',
                addressList: meta?.address_list || '',
                nas_name: 'RADIUS',
                nas_ip: 'RADIUS Server',
                is_radius: true,
                is_isolir: isIsolirProfile, // Flag khusus untuk profil isolir
                is_system_profile: isIsolirProfile, // Flag untuk profil sistem (tidak bisa diedit/dihapus)
                limitUptimeValue: meta?.limit_uptime_value || null,
                limitUptimeUnit: meta?.limit_uptime_unit || null,
                limitUptimeSeconds: null,
                validityValue: meta?.validity_value || null,
                validityUnit: meta?.validity_unit || null,
                validitySeconds: null,
                validityString: null
            };
            
            // Parse attributes
            attrRows.forEach(attr => {
                switch (attr.attribute) {
                    case 'MikroTik-Rate-Limit':
                    case 'Mikrotik-Rate-Limit':
                        profile['rate-limit'] = attr.value;
                        break;
                    case 'Session-Timeout': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.sessionTimeout = formatted.value;
                            profile.sessionTimeoutUnit = formatted.unit;
                            profile['session-timeout'] = formatted.string;
                        } else {
                            const parsed = parseTimeoutValue(attr.value);
                            profile.sessionTimeout = parsed.raw;
                            profile.sessionTimeoutUnit = parsed.unit;
                            profile['session-timeout'] = attr.value;
                        }
                        break;
                    }
                    case 'Max-All-Session': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.limitUptimeSeconds = formatted.seconds;
                            profile.limitUptimeValue = formatted.value;
                            profile.limitUptimeUnit = formatted.unit;
                            profile['limit-uptime'] = formatted.string;
                        }
                        break;
                    }
                    case 'Idle-Timeout': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.idleTimeout = formatted.value;
                            profile.idleTimeoutUnit = formatted.unit;
                            profile['idle-timeout'] = formatted.string;
                        } else {
                            const parsed = parseTimeoutValue(attr.value);
                            profile.idleTimeout = parsed.raw;
                            profile.idleTimeoutUnit = parsed.unit;
                            profile['idle-timeout'] = attr.value;
                        }
                        break;
                    }
                    case 'Expire-After': {
                        const formatted = formatSecondsToDuration(attr.value);
                        if (formatted) {
                            profile.validitySeconds = formatted.seconds;
                            profile.validityValue = formatted.value;
                            profile.validityUnit = formatted.unit;
                            profile.validityString = formatted.string;
                        }
                        break;
                    }
                    case 'Mikrotik-Shared-Users':
                    case 'MikroTik-Shared-Users':
                    case 'Simultaneous-Use':
                        profile['shared-users'] = attr.value;
                        break;
                    case 'Framed-IP-Address':
                        // Framed-IP-Address bisa untuk local address (single IP) atau remote address (IP range)
                        // Deteksi: jika mengandung "-" berarti IP range (remote address)
                        // Jika tidak mengandung "-" berarti single IP (local address)
                        const ipRangePattern = /^\d+\.\d+\.\d+\.\d+-\d+\.\d+\.\d+\.\d+$/;
                        const isIpRange = ipRangePattern.test(attr.value);
                        
                        if (isIpRange) {
                            // IP range = remote address
                            profile.remoteAddress = attr.value;
                            logger.debug(`📝 Framed-IP-Address "${attr.value}" terdeteksi sebagai IP range (remote address)`);
                        } else {
                            // Single IP = local address
                            if (!profile.localAddress || profile.localAddress === '') {
                                profile.localAddress = attr.value;
                                logger.debug(`📝 Framed-IP-Address "${attr.value}" terdeteksi sebagai single IP (local address)`);
                            }
                        }
                        break;
                    case 'Framed-Pool':
                        // Framed-Pool adalah untuk remote address (pool name)
                        // Selalu gunakan dari attribute karena ini sumber kebenaran untuk RADIUS
                        profile.remoteAddress = attr.value;
                        break;
                    case 'MS-Primary-DNS-Server':
                        // Combine dengan secondary DNS jika ada
                        if (!profile.dnsServer || profile.dnsServer === '') {
                            profile.dnsServer = attr.value;
                        } else {
                            profile.dnsServer = attr.value + ',' + (profile.dnsServer.split(',')[1] || '');
                        }
                        break;
                    case 'MS-Secondary-DNS-Server':
                        // Combine dengan primary DNS jika ada
                        if (!profile.dnsServer || profile.dnsServer === '') {
                            profile.dnsServer = attr.value;
                        } else {
                            const primary = profile.dnsServer.split(',')[0] || profile.dnsServer;
                            profile.dnsServer = primary + ',' + attr.value;
                        }
                        break;
                    case 'MikroTik-Address-List':
                        profile.addressList = attr.value;
                        break;
                    case 'MikroTik-Parent-Queue':
                        profile.parentQueue = attr.value;
                        break;
                }
            });
            
            // Override dengan metadata hanya jika attribute tidak ada (fallback)
            if (meta && !profile['rate-limit'] && meta.rate_limit) {
                profile['rate-limit'] = meta.rate_limit;
            }
            
            // Override dengan metadata hanya jika attribute tidak ada (fallback)
            if (meta) {
                if (!profile.localAddress && meta.local_address) {
                    profile.localAddress = meta.local_address;
                }
                if (!profile.remoteAddress && meta.remote_address) {
                    profile.remoteAddress = meta.remote_address;
                }
                if (!profile.dnsServer && meta.dns_server) {
                    profile.dnsServer = meta.dns_server;
                }
                if (!profile.parentQueue && meta.parent_queue) {
                    profile.parentQueue = meta.parent_queue;
                }
                if (!profile.addressList && meta.address_list) {
                    profile.addressList = meta.address_list;
                }
            }
            
            if (profile['limit-uptime']) {
                profile.limitUptimeString = profile['limit-uptime'];
            }
            if (profile.validityString) {
                profile['validity-period'] = profile.validityString;
            }
            
            // CRITICAL: Map camelCase fields to kebab-case for UI compatibility
            // UI menggunakan profile['remote-address'], tapi kita set remoteAddress
            if (profile.remoteAddress) {
                profile['remote-address'] = profile.remoteAddress;
            }
            if (profile.localAddress) {
                profile['local-address'] = profile.localAddress;
            }
            if (profile.dnsServer) {
                profile['dns-server'] = profile.dnsServer;
            }
            if (profile.parentQueue) {
                profile['parent-queue'] = profile.parentQueue;
            }
            if (profile.addressList) {
                profile['address-list'] = profile.addressList;
            }
            
            logger.debug(`📋 Profile ${groupname} - remoteAddress: "${profile.remoteAddress}", 'remote-address': "${profile['remote-address']}"`);

            profiles.push(profile);
        }
        
        logger.info(`✅ Total ${profiles.length} profil PPPoE yang akan ditampilkan (dari ${filteredGroupnames.length} setelah filter)`);
        
        await conn.end();
        return {
            success: true,
            message: `Ditemukan ${profiles.length} profile PPPoE dari RADIUS`,
            data: profiles
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting PPPoE profiles from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil data profile PPPoE dari RADIUS: ${error.message}`, data: [] };
    }
}
// Fungsi untuk menambah profile PPPoE ke RADIUS (radgroupreply)
async function addPPPoEProfileRadius(profileData) {
    const conn = await getRadiusConnection();
    try {
        // Normalize groupname: lowercase, underscore-separated
        const groupname = (profileData.name || '').toLowerCase().replace(/\s+/g, '_');
        
        if (!groupname || groupname === '') {
            await conn.end();
            return { success: false, message: 'Nama profile tidak boleh kosong' };
        }
        
        // Prevent creating reserved profiles
        const reservedNames = ['isolir', 'default'];
        if (reservedNames.includes(groupname)) {
            await conn.end();
            return { success: false, message: `Profile dengan nama "${groupname}" adalah profile sistem yang sudah ada dan tidak dapat dibuat ulang. Profile ini digunakan untuk isolir/suspension.` };
        }
        
        // Check if groupname already exists
        const [existing] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM radgroupreply
            WHERE groupname = ?
        `, [groupname]);
        
        if (existing && existing.length > 0 && existing[0].count > 0) {
            await conn.end();
            return { success: false, message: `Profile dengan nama "${groupname}" sudah ada di database RADIUS` };
        }
        
        const sanitize = (value) => {
            if (value === undefined || value === null) return null;
            const trimmed = String(value).trim();
            return trimmed === '' ? null : trimmed;
        };

        // Build rate-limit string
        let rateLimitStr = '';
        if (profileData['rate-limit']) {
            rateLimitStr = profileData['rate-limit'];
        } else if (profileData.rateLimit) {
            // Handle format from UI
            const upload = profileData.uploadLimit || '0';
            const download = profileData.downloadLimit || '0';
            rateLimitStr = `${download}/${upload}`;
            
            // Add burst if provided
            if (profileData.burstLimitDownload && profileData.burstLimitUpload && profileData.burstTime) {
                const burstTime = parseInt(profileData.burstTime.replace(/[smhd]/i, '')) || 10;
                rateLimitStr += ` ${profileData.burstLimitDownload}/${profileData.burstLimitUpload}`;
                if (profileData.burstThreshold) {
                    rateLimitStr += ` ${profileData.burstThreshold}/${profileData.burstThreshold}`;
                }
                rateLimitStr += ` ${burstTime}/${burstTime}`;
            }
        }
        
        // Convert timeout to seconds
        const convertToSeconds = (value, unit) => {
            if (!value) return null;
            const num = parseInt(value);
            if (isNaN(num)) return null;
            const unitLower = String(unit || 's').toLowerCase();
            const multipliers = { 's': 1, 'm': 60, 'h': 3600, 'd': 86400 };
            return num * (multipliers[unitLower] || 1);
        };
        
        const sessionTimeout = profileData['session-timeout'] || 
                             (profileData.sessionTimeout ? convertToSeconds(profileData.sessionTimeout, profileData.sessionTimeoutUnit) : null);
        const idleTimeout = profileData['idle-timeout'] || 
                          (profileData.idleTimeout ? convertToSeconds(profileData.idleTimeout, profileData.idleTimeoutUnit) : null);
        
        // Insert Simultaneous-Use (required)
        await conn.execute(`
            INSERT INTO radgroupcheck (groupname, attribute, op, value)
            VALUES (?, 'Simultaneous-Use', ':=', ?)
        `, [groupname, profileData['simultaneous-use'] || '1']);
        
        // Insert Rate-Limit if provided
        if (rateLimitStr) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Rate-Limit', ':=', ?)
            `, [groupname, rateLimitStr]);
        }
        
        // Insert Session-Timeout if provided
        if (sessionTimeout) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Session-Timeout', ':=', ?)
            `, [groupname, sessionTimeout.toString()]);
        }
        
        // Insert Idle-Timeout if provided
        if (idleTimeout) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Idle-Timeout', ':=', ?)
            `, [groupname, idleTimeout.toString()]);
        }
        
        // Insert Local-Address (Framed-IP-Address) if provided
        const localAddress = sanitize(profileData['local-address']);
        if (localAddress) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Framed-IP-Address', ':=', ?)
            `, [groupname, localAddress]);
        }
        
        // Insert Remote-Address (Framed-Pool) if provided
        const remoteAddress = sanitize(profileData['remote-address']);
        if (remoteAddress) {
            // Deteksi apakah ini IP range/address atau pool name
            // IP range format: 192.168.10.100-192.168.10.200 atau 192.168.10.50
            // Pool name format: pool_pppoe, hs-pool-5, dhcp_vlan-GenieAcs, dll
            const ipRangePattern = /^\d+\.\d+\.\d+\.\d+(-\d+\.\d+\.\d+\.\d+)?$/;
            const isIpRange = ipRangePattern.test(remoteAddress);
            
            if (isIpRange) {
                // IP range atau single IP - gunakan Framed-IP-Address
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'Framed-IP-Address', ':=', ?)
                `, [groupname, remoteAddress]);
            } else {
                // Pool name - gunakan Framed-Pool
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'Framed-Pool', ':=', ?)
                `, [groupname, remoteAddress]);
            }
        }
        
        // Insert DNS Server if provided
        const dnsServer = sanitize(profileData['dns-server']);
        if (dnsServer) {
            // Split multiple DNS servers (comma or space separated)
            const dnsServers = dnsServer.split(/[,\s]+/).filter(d => d.trim());
            if (dnsServers.length > 0) {
                // Primary DNS
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'MS-Primary-DNS-Server', ':=', ?)
                `, [groupname, dnsServers[0].trim()]);
                
                // Secondary DNS if provided
                if (dnsServers.length > 1) {
                    await conn.execute(`
                        INSERT INTO radgroupreply (groupname, attribute, op, value)
                        VALUES (?, 'MS-Secondary-DNS-Server', ':=', ?)
                    `, [groupname, dnsServers[1].trim()]);
                }
            }
        }
        
        // Insert Address-List (MikroTik-Address-List) if provided
        const addressList = sanitize(profileData['address-list']);
        if (addressList) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Address-List', ':=', ?)
            `, [groupname, addressList]);
        }
        
        // Insert Parent-Queue (MikroTik-Parent-Queue) if provided
        const parentQueue = sanitize(profileData['parent-queue']);
        if (parentQueue) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Parent-Queue', ':=', ?)
            `, [groupname, parentQueue]);
        }
        
        await savePPPoEProfileMetadata(conn, {
            groupname,
            displayName: sanitize(profileData.name) || groupname,
            comment: sanitize(profileData.comment),
            rateLimit: sanitize(profileData['rate-limit'] || profileData.rateLimit),
            localAddress: sanitize(profileData['local-address']),
            remoteAddress: sanitize(profileData['remote-address']),
            dnsServer: sanitize(profileData['dns-server']),
            parentQueue: sanitize(profileData['parent-queue']),
            addressList: sanitize(profileData['address-list']),
            bridgeLearning: sanitize(profileData['bridge-learning']) || 'default',
            useMpls: sanitize(profileData['use-mpls']) || 'default',
            useCompression: sanitize(profileData['use-compression']) || 'default',
            useEncryption: sanitize(profileData['use-encryption']) || 'default',
            onlyOne: sanitize(profileData['only-one']) || 'default',
            changeTcpMss: sanitize(profileData['change-tcp-mss']) || 'default',
            useUpnp: sanitize(profileData['use-upnp']) || 'default'
        });
        
        // Verifikasi bahwa profil benar-benar tersimpan
        const [verifyRows] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM radgroupreply
            WHERE groupname = ?
        `, [groupname]);
        const count = verifyRows && verifyRows.length > 0 ? verifyRows[0].count : 0;
        logger.info(`✅ Verifikasi: Profile ${groupname} memiliki ${count} attribute(s) di radgroupreply`);
        
        await conn.end();
        logger.info(`✅ Profile RADIUS berhasil ditambahkan: ${groupname}`);
        return { success: true, message: `Profile ${groupname} berhasil ditambahkan ke RADIUS` };
    } catch (error) {
        await conn.end();
        logger.error(`Error adding PPPoE profile to RADIUS: ${error.message}`);
        return { success: false, message: `Gagal menambahkan profile ke RADIUS: ${error.message}` };
    }
}
// Fungsi untuk edit profile PPPoE di RADIUS (radgroupreply)
async function editPPPoEProfileRadius(profileData) {
    const conn = await getRadiusConnection();
    try {
        const sanitize = (value) => {
            if (value === undefined || value === null) return null;
            const trimmed = String(value).trim();
            return trimmed === '' ? null : trimmed;
        };

        // Old groupname (dari id atau groupname)
        const oldGroupname = profileData.groupname || profileData.id || profileData.name;
        
        // New groupname (dari name yang diinput user, normalized)
        const newGroupname = profileData.name ? profileData.name.toLowerCase().replace(/\s+/g, '_') : oldGroupname;
        
        if (!oldGroupname) {
            await conn.end();
            return { success: false, message: 'Groupname tidak ditemukan' };
        }
        
        // Check if old groupname exists
        const [existing] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM radgroupreply
            WHERE groupname = ?
        `, [oldGroupname]);
        
        if (!existing || existing.length === 0 || existing[0].count === 0) {
            await conn.end();
            return { success: false, message: `Profile dengan nama ${oldGroupname} tidak ditemukan` };
        }
        
        // Jika nama berubah, perlu rename groupname di semua tabel terkait
        if (newGroupname && newGroupname !== oldGroupname && newGroupname !== '') {
            logger.info(`Renaming profile from ${oldGroupname} to ${newGroupname}`);
            
            // Check if new groupname already exists
            const [newExists] = await conn.execute(`
                SELECT COUNT(*) as count
                FROM radgroupreply
                WHERE groupname = ?
            `, [newGroupname]);
            
            if (newExists && newExists.length > 0 && newExists[0].count > 0) {
                await conn.end();
                return { success: false, message: `Profile dengan nama ${newGroupname} sudah ada` };
            }
            
            // 1. Copy semua data dari old groupname ke new groupname
            // Copy dari radgroupreply
            const [oldReplyRows] = await conn.execute(`
                SELECT attribute, op, value
                FROM radgroupreply
                WHERE groupname = ?
            `, [oldGroupname]);
            
            for (const row of oldReplyRows) {
                // Skip attributes yang akan diupdate
                if (['MikroTik-Rate-Limit', 'Mikrotik-Rate-Limit', 'Session-Timeout', 'Idle-Timeout',
                     'Framed-IP-Address', 'Framed-Pool',
                     'MS-Primary-DNS-Server', 'MS-Secondary-DNS-Server',
                     'MikroTik-Address-List', 'MikroTik-Parent-Queue'].includes(row.attribute)) {
                    continue; // Akan diinsert dengan nilai baru nanti
                }
                
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, ?, ?, ?)
                `, [newGroupname, row.attribute, row.op, row.value]);
            }
            
            // Copy dari radgroupcheck
            const [oldCheckRows] = await conn.execute(`
                SELECT attribute, op, value
                FROM radgroupcheck
                WHERE groupname = ?
            `, [oldGroupname]);
            
            for (const row of oldCheckRows) {
                await conn.execute(`
                    INSERT INTO radgroupcheck (groupname, attribute, op, value)
                    VALUES (?, ?, ?, ?)
                `, [newGroupname, row.attribute, row.op, row.value]);
            }
            
            // 2. Update radusergroup untuk semua user yang menggunakan groupname lama
            await conn.execute(`
                UPDATE radusergroup
                SET groupname = ?
                WHERE groupname = ?
            `, [newGroupname, oldGroupname]);
            
            // 3. Delete old groupname
            await conn.execute(`DELETE FROM radgroupreply WHERE groupname = ?`, [oldGroupname]);
            await conn.execute(`DELETE FROM radgroupcheck WHERE groupname = ?`, [oldGroupname]);

            await deletePPPoEProfileMetadata(conn, oldGroupname);
        }
        
        // Gunakan groupname yang baru untuk update attributes
        const groupnameToUpdate = (newGroupname && newGroupname !== oldGroupname && newGroupname !== '') ? newGroupname : oldGroupname;
        
        // Delete old attributes yang akan diupdate
        await conn.execute(`
            DELETE FROM radgroupreply
            WHERE groupname = ?
            AND attribute IN (
                'MikroTik-Rate-Limit', 'Mikrotik-Rate-Limit', 
                'Session-Timeout', 'Idle-Timeout',
                'Framed-IP-Address', 'Framed-Pool',
                'MS-Primary-DNS-Server', 'MS-Secondary-DNS-Server',
                'MikroTik-Address-List', 'MikroTik-Parent-Queue'
            )
        `, [groupnameToUpdate]);
        
        // Build rate-limit string
        let rateLimitStr = '';
        if (profileData['rate-limit']) {
            rateLimitStr = profileData['rate-limit'];
        } else if (profileData.rateLimit) {
            const upload = profileData.uploadLimit || '0';
            const download = profileData.downloadLimit || '0';
            rateLimitStr = `${download}/${upload}`;
            
            if (profileData.burstLimitDownload && profileData.burstLimitUpload && profileData.burstTime) {
                const burstTime = parseInt(profileData.burstTime.replace(/[smhd]/i, '')) || 10;
                rateLimitStr += ` ${profileData.burstLimitDownload}/${profileData.burstLimitUpload}`;
                if (profileData.burstThreshold) {
                    rateLimitStr += ` ${profileData.burstThreshold}/${profileData.burstThreshold}`;
                }
                rateLimitStr += ` ${burstTime}/${burstTime}`;
            }
        }
        
        // Convert timeout to seconds
        const convertToSeconds = (value, unit) => {
            if (!value) return null;
            const num = parseInt(value);
            if (isNaN(num)) return null;
            const unitLower = String(unit || 's').toLowerCase();
            const multipliers = { 's': 1, 'm': 60, 'h': 3600, 'd': 86400 };
            return num * (multipliers[unitLower] || 1);
        };
        
        const sessionTimeout = profileData['session-timeout'] || 
                             (profileData.sessionTimeout ? convertToSeconds(profileData.sessionTimeout, profileData.sessionTimeoutUnit) : null);
        const idleTimeout = profileData['idle-timeout'] || 
                          (profileData.idleTimeout ? convertToSeconds(profileData.idleTimeout, profileData.idleTimeoutUnit) : null);
        
        // Insert updated attributes
        if (rateLimitStr) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Rate-Limit', ':=', ?)
            `, [groupnameToUpdate, rateLimitStr]);
        }
        
        if (sessionTimeout) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Session-Timeout', ':=', ?)
            `, [groupnameToUpdate, sessionTimeout.toString()]);
        }
        
        if (idleTimeout) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Idle-Timeout', ':=', ?)
            `, [groupnameToUpdate, idleTimeout.toString()]);
        }
        
        // Update Simultaneous-Use if provided
        if (profileData['simultaneous-use'] !== undefined) {
            await conn.execute(`
                DELETE FROM radgroupcheck
                WHERE groupname = ? AND attribute = 'Simultaneous-Use'
            `, [groupnameToUpdate]);
            
            await conn.execute(`
                INSERT INTO radgroupcheck (groupname, attribute, op, value)
                VALUES (?, 'Simultaneous-Use', ':=', ?)
            `, [groupnameToUpdate, profileData['simultaneous-use']]);
        }
        
        // Insert/Update Local-Address (Framed-IP-Address) if provided
        // Hapus dulu Framed-IP-Address yang mungkin untuk local address
        // Tapi hati-hati: Framed-IP-Address juga bisa untuk remote address (IP range)
        // Solusi: Hapus semua Framed-IP-Address, lalu insert ulang sesuai kebutuhan
        const localAddress = sanitize(profileData['local-address']);
        const remoteAddress = sanitize(profileData['remote-address']);
        
        logger.info(`🔍 Edit Profile - Remote Address: "${remoteAddress}" (type: ${typeof remoteAddress})`);
        
        // Deteksi remote address type
        let remoteIsIpRange = false;
        if (remoteAddress) {
            const ipRangePattern = /^\d+\.\d+\.\d+\.\d+(-\d+\.\d+\.\d+\.\d+)?$/;
            remoteIsIpRange = ipRangePattern.test(remoteAddress);
            logger.info(`🔍 Remote Address Detection: "${remoteAddress}" -> isIpRange: ${remoteIsIpRange}`);
        } else {
            logger.warn(`⚠️  Remote Address kosong atau null!`);
        }
        
        // Hapus Framed-IP-Address yang lama (untuk local address atau remote address IP range)
        // Tapi hanya jika kita akan insert yang baru
        if (localAddress || (remoteAddress && remoteIsIpRange)) {
            // Hapus semua Framed-IP-Address yang ada
            // Catatan: Ini akan menghapus baik yang untuk local maupun remote
            // Tapi kita akan insert ulang sesuai kebutuhan
            await conn.execute(`
                DELETE FROM radgroupreply
                WHERE groupname = ? AND attribute = 'Framed-IP-Address'
            `, [groupnameToUpdate]);
        }
        
        // Insert Local-Address jika ada
        if (localAddress) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'Framed-IP-Address', ':=', ?)
            `, [groupnameToUpdate, localAddress]);
        }
        
        // Insert/Update Remote-Address
        if (remoteAddress) {
            if (remoteIsIpRange) {
                // IP range atau single IP - gunakan Framed-IP-Address
                // Catatan: Jika local address juga ada, ini akan menimpa
                // Tapi biasanya local address dan remote address IP range tidak digunakan bersamaan
                logger.info(`💾 Menyimpan remote address (IP range): ${remoteAddress} sebagai Framed-IP-Address`);
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'Framed-IP-Address', ':=', ?)
                `, [groupnameToUpdate, remoteAddress]);
            } else {
                // Pool name - gunakan Framed-Pool
                // Hapus dulu Framed-Pool yang lama
                logger.info(`💾 Menyimpan remote address (pool name): ${remoteAddress} sebagai Framed-Pool`);
                await conn.execute(`
                    DELETE FROM radgroupreply
                    WHERE groupname = ? AND attribute = 'Framed-Pool'
                `, [groupnameToUpdate]);
                
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'Framed-Pool', ':=', ?)
                `, [groupnameToUpdate, remoteAddress]);
                logger.info(`✅ Framed-Pool berhasil disimpan: ${groupnameToUpdate} = ${remoteAddress}`);
            }
        } else {
            // Jika remote address kosong, hapus Framed-Pool yang ada
            logger.info(`🗑️ Menghapus Framed-Pool karena remote address kosong`);
            await conn.execute(`
                DELETE FROM radgroupreply
                WHERE groupname = ? AND attribute = 'Framed-Pool'
            `, [groupnameToUpdate]);
        }
        
        // Insert/Update DNS Server if provided
        const dnsServer = sanitize(profileData['dns-server']);
        if (dnsServer) {
            // Split multiple DNS servers (comma or space separated)
            const dnsServers = dnsServer.split(/[,\s]+/).filter(d => d.trim());
            if (dnsServers.length > 0) {
                // Primary DNS
                await conn.execute(`
                    INSERT INTO radgroupreply (groupname, attribute, op, value)
                    VALUES (?, 'MS-Primary-DNS-Server', ':=', ?)
                `, [groupnameToUpdate, dnsServers[0].trim()]);
                
                // Secondary DNS if provided
                if (dnsServers.length > 1) {
                    await conn.execute(`
                        INSERT INTO radgroupreply (groupname, attribute, op, value)
                        VALUES (?, 'MS-Secondary-DNS-Server', ':=', ?)
                    `, [groupnameToUpdate, dnsServers[1].trim()]);
                }
            }
        }
        
        // Insert/Update Address-List (MikroTik-Address-List) if provided
        const addressList = sanitize(profileData['address-list']);
        if (addressList) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Address-List', ':=', ?)
            `, [groupnameToUpdate, addressList]);
        }
        
        // Insert/Update Parent-Queue (MikroTik-Parent-Queue) if provided
        const parentQueue = sanitize(profileData['parent-queue']);
        if (parentQueue) {
            await conn.execute(`
                INSERT INTO radgroupreply (groupname, attribute, op, value)
                VALUES (?, 'MikroTik-Parent-Queue', ':=', ?)
            `, [groupnameToUpdate, parentQueue]);
        }

        await savePPPoEProfileMetadata(conn, {
            groupname: groupnameToUpdate,
            displayName: sanitize(profileData.name) || groupnameToUpdate,
            comment: sanitize(profileData.comment),
            rateLimit: rateLimitStr ? rateLimitStr.trim() : sanitize(profileData['rate-limit'] || profileData.rateLimit),
            localAddress: sanitize(profileData['local-address']),
            remoteAddress: sanitize(profileData['remote-address']),
            dnsServer: sanitize(profileData['dns-server']),
            parentQueue: sanitize(profileData['parent-queue']),
            addressList: sanitize(profileData['address-list']),
            bridgeLearning: sanitize(profileData['bridge-learning']) || 'default',
            useMpls: sanitize(profileData['use-mpls']) || 'default',
            useCompression: sanitize(profileData['use-compression']) || 'default',
            useEncryption: sanitize(profileData['use-encryption']) || 'default',
            onlyOne: sanitize(profileData['only-one']) || 'default',
            changeTcpMss: sanitize(profileData['change-tcp-mss']) || 'default',
            useUpnp: sanitize(profileData['use-upnp']) || 'default'
        });
        
        await conn.end();
        const finalGroupname = (newGroupname && newGroupname !== oldGroupname && newGroupname !== '') ? newGroupname : oldGroupname;
        logger.info(`✅ Profile RADIUS berhasil diupdate: ${finalGroupname}`);
        return { success: true, message: `Profile ${finalGroupname} berhasil diupdate di RADIUS` };
    } catch (error) {
        await conn.end();
        logger.error(`Error editing PPPoE profile in RADIUS: ${error.message}`);
        return { success: false, message: `Gagal mengupdate profile di RADIUS: ${error.message}` };
    }
}
// Fungsi untuk hapus profile PPPoE dari RADIUS (radgroupreply)
async function deletePPPoEProfileRadius(groupname) {
    const conn = await getRadiusConnection();
    try {
        if (!groupname) {
            await conn.end();
            return { success: false, message: 'Groupname tidak boleh kosong' };
        }
        
        // Check if groupname is used by any user
        const [userCheck] = await conn.execute(`
            SELECT COUNT(*) as count
            FROM radusergroup
            WHERE groupname = ?
        `, [groupname]);
        
        if (userCheck && userCheck.length > 0 && userCheck[0].count > 0) {
            await conn.end();
            return { success: false, message: `Profile ${groupname} masih digunakan oleh ${userCheck[0].count} user. Pindahkan user ke profile lain terlebih dahulu.` };
        }
        
        // Delete from radgroupreply
        await conn.execute(`
            DELETE FROM radgroupreply
            WHERE groupname = ?
        `, [groupname]);
        
        // Delete from radgroupcheck
        await conn.execute(`
            DELETE FROM radgroupcheck
            WHERE groupname = ?
        `, [groupname]);
        
        await deletePPPoEProfileMetadata(conn, groupname);

        await conn.end();
        logger.info(`✅ Profile RADIUS berhasil dihapus: ${groupname}`);
        return { success: true, message: `Profile ${groupname} berhasil dihapus dari RADIUS` };
    } catch (error) {
        await conn.end();
        logger.error(`Error deleting PPPoE profile from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal menghapus profile dari RADIUS: ${error.message}` };
    }
}
// Fungsi untuk mendapatkan detail profile PPPoE dari RADIUS
async function getPPPoEProfileDetailRadius(groupname) {
    const conn = await getRadiusConnection();
    try {
        if (!groupname) {
            await conn.end();
            return { success: false, message: 'Groupname tidak boleh kosong', data: null };
        }
        
        // Get all attributes for this group
        const [attrRows] = await conn.execute(`
            SELECT attribute, value
            FROM radgroupreply
            WHERE groupname = ?
            ORDER BY attribute
        `, [groupname]);
        
        const [checkRows] = await conn.execute(`
            SELECT attribute, value
            FROM radgroupcheck
            WHERE groupname = ?
            ORDER BY attribute
        `, [groupname]);

        const metadata = await getPPPoEProfileMetadata(conn, groupname);
        
        if (attrRows.length === 0 && checkRows.length === 0 && !metadata) {
            await conn.end();
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }
        
        // Build profile object
        // Inisialisasi dengan metadata, tapi attribute dari radgroupreply akan override
        const profile = {
            name: metadata?.display_name || groupname,
            '.id': groupname,
            groupname: groupname,
            'rate-limit': null,
            'session-timeout': null,
            'idle-timeout': null,
            'limit-uptime': null,
            'shared-users': metadata?.shared_users || null,
            limitUptimeValue: metadata?.limit_uptime_value || null,
            limitUptimeUnit: metadata?.limit_uptime_unit || null,
            limitUptimeSeconds: null,
            validityValue: metadata?.validity_value || null,
            validityUnit: metadata?.validity_unit || null,
            validitySeconds: null,
            validityString: null,
            comment: metadata?.comment || '',
            // Inisialisasi kosong, akan diisi dari attribute (prioritas utama untuk RADIUS)
            localAddress: '',
            remoteAddress: '',
            dnsServer: '',
            parentQueue: '',
            addressList: '',
            nas_name: 'RADIUS',
            nas_ip: 'RADIUS Server',
            is_radius: true
        };
        
        // Parse attributes
        [...attrRows, ...checkRows].forEach(attr => {
            switch (attr.attribute) {
                case 'MikroTik-Rate-Limit':
                case 'Mikrotik-Rate-Limit':
                    profile['rate-limit'] = attr.value;
                    break;
                case 'Session-Timeout': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.sessionTimeout = formatted.value;
                        profile.sessionTimeoutUnit = formatted.unit;
                        profile['session-timeout'] = formatted.string;
                    } else {
                        const parsed = parseTimeoutValue(attr.value);
                        profile.sessionTimeout = parsed.raw;
                        profile.sessionTimeoutUnit = parsed.unit;
                        profile['session-timeout'] = attr.value;
                    }
                    break;
                }
                case 'Max-All-Session': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.limitUptimeSeconds = formatted.seconds;
                        profile.limitUptimeValue = formatted.value;
                        profile.limitUptimeUnit = formatted.unit;
                        profile['limit-uptime'] = formatted.string;
                    }
                    break;
                }
                case 'Idle-Timeout': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.idleTimeout = formatted.value;
                        profile.idleTimeoutUnit = formatted.unit;
                        profile['idle-timeout'] = formatted.string;
                    } else {
                        const parsed = parseTimeoutValue(attr.value);
                        profile.idleTimeout = parsed.raw;
                        profile.idleTimeoutUnit = parsed.unit;
                        profile['idle-timeout'] = attr.value;
                    }
                    break;
                }
                case 'Expire-After': {
                    const formatted = formatSecondsToDuration(attr.value);
                    if (formatted) {
                        profile.validitySeconds = formatted.seconds;
                        profile.validityValue = formatted.value;
                        profile.validityUnit = formatted.unit;
                        profile.validityString = formatted.string;
                    }
                    break;
                }
                case 'Mikrotik-Shared-Users':
                case 'MikroTik-Shared-Users':
                case 'Simultaneous-Use':
                    profile['shared-users'] = attr.value;
                    break;
                case 'Framed-IP-Address':
                    // Framed-IP-Address bisa untuk local address (single IP) atau remote address (IP range)
                    // Deteksi: jika mengandung "-" berarti IP range (remote address)
                    // Jika tidak mengandung "-" berarti single IP (local address)
                    const ipRangePatternDetail = /^\d+\.\d+\.\d+\.\d+-\d+\.\d+\.\d+\.\d+$/;
                    const isIpRangeDetail = ipRangePatternDetail.test(attr.value);
                    
                    if (isIpRangeDetail) {
                        // IP range = remote address
                        profile.remoteAddress = attr.value;
                        logger.debug(`📝 [Detail] Framed-IP-Address "${attr.value}" terdeteksi sebagai IP range (remote address)`);
                    } else {
                        // Single IP = local address
                        if (!profile.localAddress || profile.localAddress === '') {
                            profile.localAddress = attr.value;
                            logger.debug(`📝 [Detail] Framed-IP-Address "${attr.value}" terdeteksi sebagai single IP (local address)`);
                        } else {
                            // Jika localAddress sudah ada, update dengan yang baru
                            profile.localAddress = attr.value;
                        }
                    }
                    break;
                case 'Framed-Pool':
                    // Framed-Pool adalah untuk remote address (pool name)
                    // Selalu gunakan dari attribute karena ini sumber kebenaran untuk RADIUS
                    profile.remoteAddress = attr.value;
                    break;
                case 'MS-Primary-DNS-Server':
                    // Combine dengan secondary DNS jika ada
                    if (!profile.dnsServer || profile.dnsServer === '') {
                        profile.dnsServer = attr.value;
                    } else {
                        profile.dnsServer = attr.value + ',' + (profile.dnsServer.split(',')[1] || '');
                    }
                    break;
                case 'MS-Secondary-DNS-Server':
                    // Combine dengan primary DNS jika ada
                    if (!profile.dnsServer || profile.dnsServer === '') {
                        profile.dnsServer = attr.value;
                    } else {
                        const primary = profile.dnsServer.split(',')[0] || profile.dnsServer;
                        profile.dnsServer = primary + ',' + attr.value;
                    }
                    break;
                case 'MikroTik-Address-List':
                    profile.addressList = attr.value;
                    break;
                case 'MikroTik-Parent-Queue':
                    profile.parentQueue = attr.value;
                    break;
            }
        });

        // Override dengan metadata hanya jika attribute tidak ada
        if (!profile['rate-limit'] && metadata?.rate_limit) {
            profile['rate-limit'] = metadata.rate_limit;
        }
        
        // Override dengan metadata hanya jika attribute tidak ada (fallback)
        if (!profile.localAddress && metadata?.local_address) {
            profile.localAddress = metadata.local_address;
        }
        if (!profile.remoteAddress && metadata?.remote_address) {
            profile.remoteAddress = metadata.remote_address;
        }
        if (!profile.dnsServer && metadata?.dns_server) {
            profile.dnsServer = metadata.dns_server;
        }
        if (!profile.parentQueue && metadata?.parent_queue) {
            profile.parentQueue = metadata.parent_queue;
        }
        if (!profile.addressList && metadata?.address_list) {
            profile.addressList = metadata.address_list;
        }
        
        // CRITICAL: Map camelCase fields to kebab-case for UI compatibility
        // UI menggunakan profile['remote-address'], tapi kita set remoteAddress
        if (profile.remoteAddress) {
            profile['remote-address'] = profile.remoteAddress;
        }
        if (profile.localAddress) {
            profile['local-address'] = profile.localAddress;
        }
        if (profile.dnsServer) {
            profile['dns-server'] = profile.dnsServer;
        }
        if (profile.parentQueue) {
            profile['parent-queue'] = profile.parentQueue;
        }
        if (profile.addressList) {
            profile['address-list'] = profile.addressList;
        }
        
        logger.debug(`📋 [Detail] Profile ${groupname} - remoteAddress: "${profile.remoteAddress}", 'remote-address': "${profile['remote-address']}"`);
        
        const idleUnit = metadata.idle_timeout_unit ? metadata.idle_timeout_unit.toLowerCase() : '';
        if (metadata.idle_timeout_value && idleUnit) {
            const formatted = `${metadata.idle_timeout_value}${idleUnit}`;
            profile.idleTimeout = metadata.idle_timeout_value;
            profile.idleTimeoutUnit = idleUnit;
            profile['idle-timeout'] = formatted;
        }

        const limitUnit = metadata.limit_uptime_unit ? metadata.limit_uptime_unit.toLowerCase() : '';
        if (metadata.limit_uptime_value && limitUnit) {
            const formatted = `${metadata.limit_uptime_value}${limitUnit}`;
            profile.limitUptimeValue = metadata.limit_uptime_value;
            profile.limitUptimeUnit = limitUnit;
            profile['limit-uptime'] = formatted;
            const seconds = durationToSeconds(metadata.limit_uptime_value, limitUnit);
            if (seconds) {
                profile.limitUptimeSeconds = seconds;
            }
        }

        const validityUnit = metadata.validity_unit ? metadata.validity_unit.toLowerCase() : '';
        if (metadata.validity_value && validityUnit) {
            const formatted = `${metadata.validity_value}${validityUnit}`;
            profile.validityValue = metadata.validity_value;
            profile.validityUnit = validityUnit;
            profile.validityString = formatted;
            const seconds = durationToSeconds(metadata.validity_value, validityUnit);
            if (seconds) {
                profile.validitySeconds = seconds;
            }
        }
        
        if (profile['limit-uptime']) {
            profile.limitUptimeString = profile['limit-uptime'];
        }
        if (profile.validityString) {
            profile['validity-period'] = profile.validityString;
        }
        
        await conn.end();
        return {
            success: true,
            message: 'Detail profile berhasil diambil',
            data: profile
        };
    } catch (error) {
        await conn.end();
        logger.error(`Error getting PPPoE profile detail from RADIUS: ${error.message}`);
        return { success: false, message: `Gagal ambil detail profile: ${error.message}`, data: null };
    }
}
// Fungsi untuk menambah profile PPPoE
async function addPPPoEProfile(profileData, routerObj = null) {
    try {
        // Check auth mode
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius') {
            return await addPPPoEProfileRadius(profileData);
        }
        
        // Mikrotik API mode
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for addPPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        const params = [
            '=name=' + profileData.name
        ];
        
        // Tambahkan field opsional jika ada
        if (profileData['rate-limit']) params.push('=rate-limit=' + profileData['rate-limit']);
        if (profileData['local-address']) params.push('=local-address=' + profileData['local-address']);
        if (profileData['remote-address']) params.push('=remote-address=' + profileData['remote-address']);
        if (profileData['dns-server']) params.push('=dns-server=' + profileData['dns-server']);
        if (profileData['parent-queue']) params.push('=parent-queue=' + profileData['parent-queue']);
        if (profileData['address-list']) params.push('=address-list=' + profileData['address-list']);
        if (profileData.comment) params.push('=comment=' + profileData.comment);
        if (profileData['bridge-learning'] && profileData['bridge-learning'] !== 'default') params.push('=bridge-learning=' + profileData['bridge-learning']);
        if (profileData['use-mpls'] && profileData['use-mpls'] !== 'default') params.push('=use-mpls=' + profileData['use-mpls']);
        if (profileData['use-compression'] && profileData['use-compression'] !== 'default') params.push('=use-compression=' + profileData['use-compression']);
        if (profileData['use-encryption'] && profileData['use-encryption'] !== 'default') params.push('=use-encryption=' + profileData['use-encryption']);
        if (profileData['only-one'] && profileData['only-one'] !== 'default') params.push('=only-one=' + profileData['only-one']);
        if (profileData['change-tcp-mss'] && profileData['change-tcp-mss'] !== 'default') params.push('=change-tcp-mss=' + profileData['change-tcp-mss']);
        
        await conn.write('/ppp/profile/add', params);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error adding PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}
// Fungsi untuk edit profile PPPoE
async function editPPPoEProfile(profileData, routerObj = null) {
    try {
        // Check auth mode
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius') {
            return await editPPPoEProfileRadius(profileData);
        }
        
        // Mikrotik API mode
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for editPPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        const params = [
            '=.id=' + profileData.id
        ];
        
        // Tambahkan field yang akan diupdate
        if (profileData.name) params.push('=name=' + profileData.name);
        if (profileData['rate-limit'] !== undefined) params.push('=rate-limit=' + profileData['rate-limit']);
        if (profileData['local-address'] !== undefined) params.push('=local-address=' + profileData['local-address']);
        if (profileData['remote-address'] !== undefined) params.push('=remote-address=' + profileData['remote-address']);
        if (profileData['dns-server'] !== undefined) params.push('=dns-server=' + profileData['dns-server']);
        if (profileData['parent-queue'] !== undefined) params.push('=parent-queue=' + profileData['parent-queue']);
        if (profileData['address-list'] !== undefined) params.push('=address-list=' + profileData['address-list']);
        if (profileData.comment !== undefined) params.push('=comment=' + profileData.comment);
        if (profileData['bridge-learning'] !== undefined) params.push('=bridge-learning=' + profileData['bridge-learning']);
        if (profileData['use-mpls'] !== undefined) params.push('=use-mpls=' + profileData['use-mpls']);
        if (profileData['use-compression'] !== undefined) params.push('=use-compression=' + profileData['use-compression']);
        if (profileData['use-encryption'] !== undefined) params.push('=use-encryption=' + profileData['use-encryption']);
        if (profileData['only-one'] !== undefined) params.push('=only-one=' + profileData['only-one']);
        if (profileData['change-tcp-mss'] !== undefined) params.push('=change-tcp-mss=' + profileData['change-tcp-mss']);
        
        await conn.write('/ppp/profile/set', params);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error editing PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk hapus profile PPPoE
async function deletePPPoEProfile(id, routerObj = null) {
    try {
        // Check auth mode - if id is a groupname (string), it's RADIUS mode
        const mode = await getUserAuthModeAsync();
        if (mode === 'radius' || (typeof id === 'string' && !id.match(/^\d+$/))) {
            return await deletePPPoEProfileRadius(id);
        }
        
        // Mikrotik API mode
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for deletePPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        await conn.write('/ppp/profile/remove', [ '=.id=' + id ]);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error deleting PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}
// Fungsi untuk generate hotspot vouchers
async function generateHotspotVouchers(count, prefix, profile, server, limits = {}, price, charType = 'alphanumeric', routerObj = null) {
    try {
        // Check auth mode - RADIUS atau Mikrotik API
        const mode = await getUserAuthModeAsync();
        const isRadiusMode = mode === 'radius';
        
        // Harga voucher diambil dari input form "Harga" di /admin/hotspot/voucher
        // Invoice SELALU dibuat untuk voucher, bahkan jika harga 0 atau tidak diisi
        // Parse price dengan lebih robust: handle string, number, null, undefined, empty string
        let finalPrice = 0;
        if (price !== null && price !== undefined && price !== '') {
            const parsedPrice = parseFloat(price);
            if (!isNaN(parsedPrice)) {
                finalPrice = parsedPrice;
            }
        }
        logger.info(`generateHotspotVouchers: Parsed price from ${price} (type: ${typeof price}) to ${finalPrice} for ${count} vouchers`);
        
        // Normalisasi metadata server
        let serverMetadata = {};
        let serverName = 'all';
        if (server && typeof server === 'object' && !Array.isArray(server)) {
            serverMetadata = { ...server };
            serverName = (serverMetadata.name || serverMetadata.server || 'all').toString().trim() || 'all';
        } else if (typeof server === 'string') {
            serverName = server.trim() || 'all';
            serverMetadata = { name: serverName };
        } else {
            serverMetadata = { name: 'all' };
        }
        serverMetadata.name = serverName;
        
        // Untuk mode Mikrotik API, validasi koneksi terlebih dahulu
        if (!isRadiusMode) {
            let conn = null;
            if (routerObj) {
                conn = await getMikrotikConnectionForRouter(routerObj);
                logger.info(`Connecting to router: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728}) for voucher generation`);
            } else {
                conn = await getMikrotikConnection();
            }
            if (!conn) {
                logger.error('Tidak dapat terhubung ke Mikrotik');
                return { success: false, message: 'Tidak dapat terhubung ke Mikrotik', vouchers: [] };
            }
        }
        
        // Get voucher generation settings from database
        const voucherSettings = await getVoucherGenerationSettings();
        
        // Fungsi untuk generate random string berdasarkan jenis karakter
        function randomString(length, charType = 'alphanumeric') {
            let chars;
            switch (charType) {
                case 'numeric':
                    chars = '0123456789';
                    break;
                case 'alphabetic':
                    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
                    break;
                case 'alphanumeric':
                default:
                    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    break;
            }
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }
        
        const limitOptions = limits && typeof limits === 'object' ? limits : {};
        const validitySeconds = limitOptions.validitySeconds && !isNaN(parseInt(limitOptions.validitySeconds, 10)) && parseInt(limitOptions.validitySeconds, 10) > 0
            ? parseInt(limitOptions.validitySeconds, 10)
            : null;
        const uptimeSeconds = limitOptions.uptimeSeconds && !isNaN(parseInt(limitOptions.uptimeSeconds, 10)) && parseInt(limitOptions.uptimeSeconds, 10) > 0
            ? parseInt(limitOptions.uptimeSeconds, 10)
            : null;

        const vouchers = [];
        
        // Log untuk debugging
        logger.info(`Generating ${count} vouchers with prefix ${prefix} and profile ${profile} (Mode: ${isRadiusMode ? 'RADIUS' : 'Mikrotik API'}) - Server: ${serverName}`);
        
        for (let i = 0; i < count; i++) {
            // Generate username and password based on settings
            const usernameLength = parseInt(voucherSettings.username_length || 4);
            const charTypeSetting = voucherSettings.char_type || charType;
            const accountType = voucherSettings.account_type || 'voucher';
            
            const username = prefix + randomString(usernameLength, charTypeSetting);
            
            // Generate password berdasarkan tipe akun
            let password;
            if (accountType === 'voucher') {
                // Voucher: password sama dengan username
                password = username;
            } else {
                // Member: password berbeda dari username
                const passwordLength = parseInt(voucherSettings.password_length_separate || 6);
                password = randomString(passwordLength, 'alphanumeric');
            }
            
            try {
                // Tambahkan user hotspot menggunakan addHotspotUser (otomatis handle RADIUS/Mikrotik)
                // Di mode RADIUS, routerObj akan diabaikan oleh addHotspotUser
                // Pass finalPrice ke addHotspotUser untuk menyimpan ke voucher_revenue (TANPA membuat invoice)
                // Invoice hanya untuk pelanggan PPPoE, bukan untuk voucher
                // Pass server parameter untuk menentukan server instance (jika dipilih)
                const addResult = await addHotspotUser(
                    username,
                    password,
                    profile,
                    'voucher',
                    null,
                    routerObj,
                    finalPrice,
                    serverName,
                    serverMetadata,
                    { validitySeconds, uptimeSeconds }
                );
                
                // Voucher revenue record sudah dibuat di dalam addHotspotUser untuk mode RADIUS
                // Untuk mode Mikrotik API, simpan ke voucher_revenue di bawah ini jika belum dibuat
                let voucherRecordId = addResult.voucherRecordId || null;
                if (!voucherRecordId && !isRadiusMode && addResult.success) {
                    try {
                        await ensureVoucherRevenueColumns();
                        const sqlite3 = require('sqlite3').verbose();
                        const dbPath = require('path').join(__dirname, '../data/billing.db');
                        const db = new sqlite3.Database(dbPath);
                        let apiServerNameForVoucher = serverName && ['all', 'semua', ''].includes(serverName.toLowerCase()) ? null : serverName;
                        let apiServerMetadataForStore = null;
                        if (serverMetadata && typeof serverMetadata === 'object') {
                            const metadataToStore = { ...serverMetadata };
                            if (!metadataToStore.name && apiServerNameForVoucher) {
                                metadataToStore.name = apiServerNameForVoucher;
                            }
                            try {
                                apiServerMetadataForStore = JSON.stringify(metadataToStore);
                            } catch (jsonErr) {
                                logger.warn(`Failed to stringify server metadata for voucher ${username}: ${jsonErr.message}`);
                            }
                        } else if (apiServerNameForVoucher) {
                            apiServerMetadataForStore = JSON.stringify({ name: apiServerNameForVoucher });
                        }
                        await new Promise((resolve, reject) => {
                            db.serialize(() => {
                                db.get(`SELECT id FROM voucher_revenue WHERE username = ?`, [username], async (selectErr, existing) => {
                                    if (selectErr) {
                                        reject(selectErr);
                                        return;
                                    }

                                    const runAsync = (sql, params) => new Promise((res, rej) => {
                                        db.run(sql, params, function(err) {
                                            if (err) {
                                                rej(err);
                                            } else {
                                                res(this);
                                            }
                                        });
                                    });

                                    try {
                                        if (existing && existing.id) {
                                            await runAsync(`
                                                UPDATE voucher_revenue
                                                SET price = ?, profile = ?, status = ?, notes = ?, server_name = COALESCE(?, server_name), server_metadata = COALESCE(?, server_metadata)
                                                WHERE username = ?
                                            `, [
                                                finalPrice,
                                                profile,
                                                'unpaid',
                                                `Voucher Hotspot ${username} - Profile: ${profile}`,
                                                apiServerNameForVoucher,
                                                apiServerMetadataForStore,
                                                username
                                            ]);
                                            voucherRecordId = existing.id;
                                        } else {
                                            const insertResult = await runAsync(`
                                                INSERT INTO voucher_revenue (username, price, profile, created_at, status, notes, server_name, server_metadata)
                                                VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)
                                            `, [
                                                username,
                                                finalPrice,
                                                profile,
                                                'unpaid',
                                                `Voucher Hotspot ${username} - Profile: ${profile}`,
                                                apiServerNameForVoucher,
                                                apiServerMetadataForStore
                                            ]);
                                            voucherRecordId = insertResult ? insertResult.lastID : null;
                                        }
                                        resolve();
                                    } catch (runErr) {
                                        reject(runErr);
                                    }
                                });
                            });
                        });
                        
                        db.close();
                    } catch (voucherError) {
                        // Log error tapi jangan gagalkan pembuatan voucher
                        logger.error(`Error saving voucher revenue record for ${username}: ${voucherError.message}`);
                    }
                }
                
                // Tambahkan ke array vouchers
                vouchers.push({
                    username,
                    password,
                    profile,
                    server: serverName,
                    nas_name: isRadiusMode ? 'RADIUS' : (routerObj ? routerObj.name : 'default'),
                    nas_ip: isRadiusMode ? 'RADIUS' : (routerObj ? routerObj.nas_ip : ''),
                    createdAt: new Date(),
                    price: finalPrice, // Tambahkan harga ke data voucher
                    account_type: accountType, // Tambahkan tipe akun
                    voucher_record_id: voucherRecordId, // Tambahkan voucher revenue record ID jika ada
                    validitySeconds,
                    uptimeSeconds
                });
                
                logger.info(`${accountType === 'voucher' ? 'Voucher' : 'Member'} created: ${username} (password: ${password}) on ${isRadiusMode ? 'RADIUS' : (routerObj ? routerObj.name : 'default')}${voucherRecordId ? ` - Voucher Revenue Record: ${voucherRecordId} (Amount: Rp ${finalPrice})` : ' - NO VOUCHER RECORD CREATED!'}`);
            } catch (err) {
                logger.error(`Failed to create voucher ${username}: ${err.message}`);
                // Lanjutkan ke voucher berikutnya
            }
        }
        
        logger.info(`Successfully generated ${vouchers.length} vouchers`);
        
        return {
            success: true,
            message: `Berhasil membuat ${vouchers.length} voucher`,
            vouchers: vouchers
        };
    } catch (error) {
        logger.error(`Error generating vouchers: ${error.message}`);
        return {
            success: false,
            message: `Gagal generate voucher: ${error.message}`,
            vouchers: []
        };
    }
}

// Fungsi untuk mengambil pengaturan generate voucher dari database
async function getVoucherGenerationSettings() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        return new Promise((resolve, reject) => {
            db.all("SELECT setting_key, setting_value FROM voucher_generation_settings", (err, rows) => {
                if (err) {
                    console.log('⚠️ voucher_generation_settings table not found, using defaults');
                    resolve({});
                    return;
                }
                
                const settings = {};
                rows.forEach(row => {
                    settings[row.setting_key] = row.setting_value;
                });
                
                db.close();
                resolve(settings);
            });
        });
    } catch (error) {
        console.error('Error getting voucher generation settings:', error);
        return {};
    }
}
// Fungsi untuk test generate voucher (tanpa menyimpan ke Mikrotik)
async function generateTestVoucher(settings) {
    try {
        // Fungsi untuk generate random string berdasarkan jenis karakter
        function randomString(length, charType = 'alphanumeric') {
            let chars;
            switch (charType) {
                case 'numeric':
                    chars = '0123456789';
                    break;
                case 'alphabetic':
                    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
                    break;
                case 'alphanumeric':
                default:
                    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    break;
            }
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }

        // Generate username berdasarkan format
        let username;
        const usernameLength = parseInt(settings.username_length || 4);
        const charType = settings.char_type || 'alphanumeric';
        const usernameFormat = settings.username_format || 'V{timestamp}';

        switch (usernameFormat) {
            case 'V{timestamp}':
                const timestamp = Date.now().toString().slice(-6);
                username = 'V' + timestamp + randomString(usernameLength, charType);
                break;
            case 'V{random}':
                username = 'V' + randomString(usernameLength, charType);
                break;
            case '{random}':
                username = randomString(usernameLength, charType);
                break;
            default:
                username = 'V' + randomString(usernameLength, charType);
        }

        // Generate password berdasarkan tipe akun
        let password;
        const accountType = settings.account_type || 'voucher';
        
        if (accountType === 'voucher') {
            // Voucher: password sama dengan username
            password = username;
        } else {
            // Member: password berbeda dari username
            const passwordLength = parseInt(settings.password_length_separate || 6);
            password = randomString(passwordLength, 'alphanumeric');
        }

        return {
            success: true,
            username: username,
            password: password,
            account_type: accountType,
            message: `Test generate ${accountType} berhasil`
        };

    } catch (error) {
        return {
            success: false,
            message: 'Gagal test generate voucher: ' + error.message
        };
    }
}

// --- Watcher settings.json untuk reset koneksi Mikrotik jika setting berubah ---
const settingsPath = path.join(process.cwd(), 'settings.json');
let lastMikrotikConfig = {};

function getCurrentMikrotikConfig() {
    return {
        host: getSetting('mikrotik_host', '192.168.8.1'),
        port: getSetting('mikrotik_port', '8728'),
        user: getSetting('mikrotik_user', 'admin'),
        password: getSetting('mikrotik_password', 'admin')
    };
}

function mikrotikConfigChanged(newConfig, oldConfig) {
    return (
        newConfig.host !== oldConfig.host ||
        newConfig.port !== oldConfig.port ||
        newConfig.user !== oldConfig.user ||
        newConfig.password !== oldConfig.password
    );
}
// Inisialisasi config awal
lastMikrotikConfig = getCurrentMikrotikConfig();

fs.watchFile(settingsPath, { interval: 2000 }, (curr, prev) => {
    try {
        const newConfig = getCurrentMikrotikConfig();
        if (mikrotikConfigChanged(newConfig, lastMikrotikConfig)) {
            logger.info('Konfigurasi Mikrotik di settings.json berubah, reset koneksi Mikrotik...');
            mikrotikConnection = null;
            lastMikrotikConfig = newConfig;
        }
    } catch (e) {
        logger.error('Gagal cek perubahan konfigurasi Mikrotik:', e.message);
    }
});
let voucherRevenueColumnsChecked = false;
async function ensureVoucherRevenueColumns() {
    if (voucherRevenueColumnsChecked) return true;
    try {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        const columns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(voucher_revenue)", [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
        const columnNames = new Set(columns.map(col => (col.name || '').toLowerCase()));
        const runAlter = async (sql) => {
            await new Promise((resolve, reject) => {
                db.run(sql, err => {
                    if (err) {
                        logger.warn(`Failed to alter voucher_revenue table with SQL: ${sql} -> ${err.message}`);
                        resolve();
                    } else {
                        resolve();
                    }
                });
            });
        };
        if (!columnNames.has('server_name')) {
            await runAlter("ALTER TABLE voucher_revenue ADD COLUMN server_name TEXT");
        }
        if (!columnNames.has('server_metadata')) {
            await runAlter("ALTER TABLE voucher_revenue ADD COLUMN server_metadata TEXT");
        }
        db.close();
        voucherRevenueColumnsChecked = true;
        return true;
    } catch (error) {
        logger.warn(`ensureVoucherRevenueColumns failed: ${error.message}`);
        return false;
    }
}

// Fungsi untuk mendapatkan RouterOS version
async function getRouterOSVersion(routerObj) {
    try {
        const conn = await getMikrotikConnectionForRouter(routerObj);
        if (!conn) {
            throw new Error('Gagal koneksi ke router');
        }
        
        try {
            const resources = await conn.write('/system/resource/print');
            if (resources && resources[0] && resources[0].version) {
                const version = resources[0].version;
                // Parse version: "7.15" -> 7, "6.49.10" -> 6
                const majorVersion = parseInt(version.split('.')[0]);
                conn.close();
                return { success: true, version: version, major: majorVersion };
            }
        } catch (e) {
            logger.warn('Failed to get version from /system/resource:', e.message);
        }
        
        conn.close();
        return { success: false, version: null, major: null };
    } catch (error) {
        logger.error('Error getting RouterOS version:', error);
        return { success: false, version: null, major: null, error: error.message };
    }
}

// Fungsi untuk execute script Mikrotik (kompatibel ROS 6.x dan 7.x)
async function executeMikrotikScript(script, routerObj, rosVersion = null) {
    let conn = null;
    try {
        // Connect ke router
        conn = await getMikrotikConnectionForRouter(routerObj);
        if (!conn) {
            throw new Error('Gagal koneksi ke router');
        }
        
        // Detect ROS version jika tidak diberikan
        let detectedVersion = null;
        if (!rosVersion || rosVersion === 'auto') {
            const versionInfo = await getRouterOSVersion(routerObj);
            if (versionInfo.success && versionInfo.major) {
                detectedVersion = versionInfo.major;
                logger.info(`Detected RouterOS version: ${versionInfo.version} (major: ${detectedVersion})`);
            } else {
                // Default ke ROS 7 jika tidak bisa detect
                detectedVersion = 7;
                logger.warn('Could not detect ROS version, defaulting to ROS 7');
            }
        } else {
            detectedVersion = parseInt(rosVersion);
        }
        
        // Parse script menjadi commands
        const lines = script.split('\n');
        const commands = [];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            
            // Skip empty lines dan comments
            if (!line || line.startsWith('#') || line.startsWith('//')) {
                continue;
            }
            
            // Handle multi-line commands (ending with \)
            if (line.endsWith('\\')) {
                let fullCommand = line.slice(0, -1).trim();
                i++;
                while (i < lines.length) {
                    const nextLine = lines[i].trim();
                    if (!nextLine || nextLine.startsWith('#')) {
                        i--;
                        break;
                    }
                    if (nextLine.endsWith('\\')) {
                        fullCommand += ' ' + nextLine.slice(0, -1).trim();
                        i++;
                    } else {
                        fullCommand += ' ' + nextLine.trim();
                        break;
                    }
                }
                line = fullCommand.trim();
            }
            
            // Skip :put, :log, echo commands (tidak perlu execute)
            if (line.startsWith(':put') || line.startsWith(':log') || line.startsWith('echo')) {
                continue;
            }
            
            // Skip print commands (hanya untuk melihat data, tidak perlu execute)
            // Check berbagai format: /ip ... print, print where, etc.
            if (line.includes('/print') || line.match(/\s+print\s+/i) || line.trim().endsWith('print')) {
                logger.debug(`Skipping print/verification command: ${line}`);
                continue;
            }
            
            // Parse command: /ip firewall nat add chain=dstnat ...
            // Extract path dan params
            if (line.startsWith('/')) {
                // Check jika line mengandung "print" SEBELUM split (untuk catch semua format)
                // Command seperti "/ip firewall address-list print where" harus di-skip
                if (line.includes(' print ') || line.includes(' print where') || line.match(/\s+print\s+/i) || line.toLowerCase().includes(' print')) {
                    logger.debug(`Skipping print command (pre-check): ${line}`);
                    continue;
                }
                
                // Split line dengan regex yang lebih robust untuk handle multiple spaces
                // Gunakan split dengan regex untuk handle multiple spaces/tabs
                const parts = line.split(/\s+/).filter(p => p && p.trim() !== '');
                
                // Build full path: /ip firewall nat add -> /ip/firewall/nat/add
                // Tapi stop jika menemukan "print" atau action (add, set, remove, etc.)
                let pathParts = [];
                let paramsStartIndex = 0;
                let isPrintCommand = false;
                
                for (let j = 0; j < parts.length; j++) {
                    const part = parts[j].toLowerCase();
                    // Stop jika menemukan "print" atau action
                    if (part === 'print' || part === 'add' || part === 'set' || part === 'remove' || part === 'enable' || part === 'disable') {
                        if (part === 'print') {
                            // Ini adalah print command, skip
                            logger.debug(`Skipping print command (found 'print' in path): ${line}`);
                            isPrintCommand = true;
                            break; // Break dari loop j
                        }
                        // Ini adalah action, jadi path berakhir di sini
                        pathParts.push(parts[j]);
                        paramsStartIndex = j + 1;
                        break;
                    }
                    pathParts.push(parts[j]);
                }
                
                // Skip command ini jika adalah print command
                if (isPrintCommand) {
                    continue; // Continue ke line berikutnya (skip command ini)
                }
                
                // Jika tidak ada action ditemukan, semua adalah path
                if (paramsStartIndex === 0) {
                    paramsStartIndex = pathParts.length;
                }
                
                const path = pathParts.join('/');
                const params = parts.slice(paramsStartIndex);
                
                // Normalize params: remove empty strings dan trim
                const normalizedParams = params.filter(p => p && p.trim() !== '').map(p => p.trim());
                
                logger.info(`[PARSE] Parsed command - Path: ${path}, Params count: ${normalizedParams.length}, Params:`, normalizedParams);
                
                // Parse params menjadi object
                // Handle parameter dengan format: key=value atau key="value with spaces"
                // Value bisa mengandung = atau / (seperti IP dengan CIDR: 172.30.0.0/32)
                const paramObj = {};
                let currentKey = null;
                let currentValue = '';
                let inQuotes = false;
                
                // Iterate through normalized params
                for (let j = 0; j < normalizedParams.length; j++) {
                    const param = normalizedParams[j];
                    const equalsIndex = param.indexOf('=');
                    
                    if (equalsIndex > 0 && !inQuotes) {
                        // Save previous key-value
                        if (currentKey) {
                            paramObj[currentKey] = currentValue.trim() || true;
                        }
                        
                        // New key-value pair
                        currentKey = param.substring(0, equalsIndex);
                        currentValue = param.substring(equalsIndex + 1);
                        
                        // Check if value starts with quote
                        if (currentValue.startsWith('"')) {
                            inQuotes = true;
                            currentValue = currentValue.slice(1);
                            // Check if quote ends in same param (e.g., list="isolir-users")
                            // Perlu check length > 0 untuk handle kasus list="" (empty string dalam quotes)
                            if (currentValue.endsWith('"')) {
                                inQuotes = false;
                                // Strip closing quote
                                currentValue = currentValue.slice(0, -1);
                            }
                        }
                    } else if (inQuotes) {
                        // Continue building quoted value
                        currentValue += ' ' + param;
                        if (param.endsWith('"')) {
                            inQuotes = false;
                            currentValue = currentValue.slice(0, -1);
                            // Setelah quotes ditutup, save currentKey dan reset untuk parameter berikutnya
                            if (currentKey) {
                                paramObj[currentKey] = currentValue.trim();
                                currentKey = null;
                                currentValue = '';
                            }
                            // Setelah quotes ditutup, parameter berikutnya akan di-parse di iterasi berikutnya
                            // Tapi kita perlu handle kasus jika ada parameter lagi di iterasi yang sama
                            // (tidak mungkin karena kita sudah di akhir param yang mengandung closing quote)
                        }
                    } else if (currentKey) {
                        // Value continuation (untuk kasus seperti IP dengan CIDR: 172.30.0.0/32)
                        // Hanya tambahkan jika bukan key baru (tidak mengandung =)
                        if (equalsIndex < 0) {
                            // Ini adalah continuation dari value sebelumnya (bukan key baru)
                            currentValue += ' ' + param;
                        } else {
                            // Ini adalah key baru, save yang sebelumnya dulu
                            paramObj[currentKey] = currentValue.trim() || true;
                            currentKey = param.substring(0, equalsIndex);
                            currentValue = param.substring(equalsIndex + 1);
                            if (currentValue.startsWith('"')) {
                                inQuotes = true;
                                currentValue = currentValue.slice(1);
                                if (currentValue.endsWith('"')) {
                                    inQuotes = false;
                                    currentValue = currentValue.slice(0, -1);
                                }
                            }
                        }
                    } else {
                        // Tidak ada currentKey dan tidak dalam quotes, ini seharusnya key baru
                        // Tapi jika tidak ada =, ini mungkin parameter flag (tanpa value)
                        if (equalsIndex < 0) {
                            // Parameter flag (tanpa value)
                            paramObj[param] = true;
                        } else {
                            // Key-value pair baru
                            currentKey = param.substring(0, equalsIndex);
                            currentValue = param.substring(equalsIndex + 1);
                            if (currentValue.startsWith('"')) {
                                inQuotes = true;
                                currentValue = currentValue.slice(1);
                                if (currentValue.endsWith('"')) {
                                    inQuotes = false;
                                    currentValue = currentValue.slice(0, -1);
                                }
                            }
                        }
                    }
                }
                
                // Save last key-value
                if (currentKey) {
                    const finalValue = currentValue.trim();
                    // Jika value kosong atau hanya whitespace, set sebagai true (flag parameter)
                    // Tapi jika value adalah string kosong setelah trim quotes, tetap set sebagai empty string
                    paramObj[currentKey] = finalValue === '' ? true : finalValue;
                }
                
                // Convert paramObj ke array format untuk RouterOSAPI
                // Format node-routeros: =key=value atau =key (untuk flag)
                const paramArray = [];
                for (const [key, value] of Object.entries(paramObj)) {
                    if (value === true || value === '') {
                        // Flag parameter (tanpa value)
                        paramArray.push(`=${key}`);
                    } else {
                        // Key-value parameter dengan format =key=value
                        paramArray.push(`=${key}=${value}`);
                    }
                }
                
                // Debug: log parameter yang akan dikirim (gunakan info untuk visibility)
                logger.info(`[PARSE] Command: ${path}`);
                logger.info(`[PARSE] Normalized params (${normalizedParams.length}):`, normalizedParams);
                logger.info(`[PARSE] Parsed paramObj:`, JSON.stringify(paramObj, null, 2));
                logger.info(`[PARSE] Final paramArray (${paramArray.length}):`, paramArray);
                
                // Skip jika path mengandung /print (untuk verifikasi, tidak perlu execute)
                // Check berbagai format: /ip ... print, print where, etc.
                if (path.includes('/print') || path.endsWith('/print') || line.includes(' print ') || line.includes(' print where')) {
                    logger.debug(`Skipping print command: ${line}`);
                    continue;
                }
                
                commands.push({ path, params: paramArray, original: line });
            }
        }
        
        logger.info(`Executing ${commands.length} commands to router ${routerObj.name} (${routerObj.nas_ip})`);
        
        // Filter out any print commands that might have slipped through
        const executableCommands = commands.filter(cmd => {
            // Check berbagai format print command
            const isPrint = cmd.path.includes('/print') || 
                           cmd.path.endsWith('/print') || 
                           cmd.original.includes(' print ') || 
                           cmd.original.includes(' print where') ||
                           cmd.original.match(/\s+print\s+/i) ||
                           cmd.original.toLowerCase().includes('print');
            if (isPrint) {
                logger.debug(`Filtering out print command: ${cmd.original} (path: ${cmd.path})`);
                return false;
            }
            return true;
        });
        
        logger.info(`After filtering print commands: ${executableCommands.length} commands to execute (filtered ${commands.length - executableCommands.length} print commands)`);
        
        // Execute commands
        let executed = 0;
        let failed = 0;
        const errors = [];
        
        for (const cmd of executableCommands) {
            try {
                // Double check: skip print commands (seharusnya sudah di-skip di parsing, tapi untuk safety)
                // Check berbagai format print command
                if (cmd.path.includes('/print') || cmd.path.endsWith('/print') || 
                    cmd.original.includes(' print ') || cmd.original.includes(' print where') ||
                    cmd.original.match(/\s+print\s+/i)) {
                    logger.debug(`Skipping print command: ${cmd.path} (original: ${cmd.original})`);
                    continue;
                }
                
                logger.info(`[EXEC] Executing command: ${cmd.path}`);
                logger.info(`[EXEC] Command params (${cmd.params.length}):`, cmd.params);
                logger.info(`[EXEC] Original command: ${cmd.original}`);
                
                // Handle different command types
                if (cmd.path.includes('/remove')) {
                    // Remove command: /ip firewall nat remove [find ...]
                    // Extract find condition
                    const findMatch = cmd.original.match(/\[find\s+(.+?)\]/);
                    if (findMatch) {
                        const findCondition = findMatch[1];
                        // Parse find condition dan execute
                        const findParams = [];
                        if (findCondition.includes('where')) {
                            // ROS 7 format: [find where ...]
                            const whereMatch = findCondition.match(/where\s+(.+)/);
                            if (whereMatch) {
                                const whereClause = whereMatch[1];
                                // Parse where clause
                                if (whereClause.includes('comment~')) {
                                    const commentMatch = whereClause.match(/comment~"(.+?)"/);
                                    if (commentMatch) {
                                        findParams.push(`?comment~${commentMatch[1]}`);
                                    }
                                } else if (whereClause.includes('name=')) {
                                    const nameMatch = whereClause.match(/name="(.+?)"/);
                                    if (nameMatch) {
                                        findParams.push(`?name=${nameMatch[1]}`);
                                    }
                                }
                            }
                        } else {
                            // ROS 6 format: [find ...]
                            if (findCondition.includes('comment~')) {
                                const commentMatch = findCondition.match(/comment~"(.+?)"/);
                                if (commentMatch) {
                                    findParams.push(`?comment~${commentMatch[1]}`);
                                }
                            }
                        }
                        
                        const results = await conn.write(cmd.path.replace('/remove', '/print'), findParams);
                        if (results && results.length > 0) {
                            for (const item of results) {
                                await conn.write(cmd.path, [`=.id=${item['.id']}`]);
                            }
                        }
                    } else {
                        // Simple remove with ID
                        await conn.write(cmd.path, cmd.params);
                    }
                } else if (cmd.path.includes('/add')) {
                    // Add command
                    // Pastikan params adalah array dan tidak kosong
                    const addParams = Array.isArray(cmd.params) ? cmd.params : [];
                    if (addParams.length > 0) {
                        await conn.write(cmd.path, addParams);
                    } else {
                        logger.warn(`Add command with no params, skipping: ${cmd.path}`);
                        continue;
                    }
                } else if (cmd.path.includes('/set')) {
                    // Set command - need .id
                    const setParams = Array.isArray(cmd.params) ? cmd.params : [];
                    if (setParams.length > 0) {
                        await conn.write(cmd.path, setParams);
                    } else {
                        logger.warn(`Set command with no params, skipping: ${cmd.path}`);
                        continue;
                    }
                } else {
                    // Other commands - skip print commands (sudah di-skip di parsing)
                    if (cmd.path.includes('/print')) {
                        logger.debug(`Skipping print command: ${cmd.path}`);
                        continue;
                    }
                    // Pastikan params adalah array
                    const otherParams = Array.isArray(cmd.params) ? cmd.params : [];
                    await conn.write(cmd.path, otherParams);
                }
                
                executed++;
            } catch (cmdError) {
                // Check jika error adalah "already exists" atau "already have such entry"
                // Error ini tidak fatal karena berarti settingan sudah ada
                const errorMsg = cmdError.message || '';
                const isNonFatalError = 
                    errorMsg.includes('already have such entry') ||
                    errorMsg.includes('already exists') ||
                    errorMsg.includes('profile with the same name already exists') ||
                    errorMsg.includes('entry already exists');
                
                if (isNonFatalError) {
                    // Hanya log sebagai info, tidak dihitung sebagai failed
                    logger.info(`⚠️  Command skipped (already exists): ${cmd.original} - ${errorMsg}`);
                    executed++; // Tetap dihitung sebagai executed karena settingan sudah ada (tujuan tercapai)
                } else {
                    failed++;
                    errors.push(`Command failed: ${cmd.original} - ${errorMsg}`);
                    logger.warn(`Command failed: ${cmd.original}`, cmdError);
                }
                // Continue dengan command berikutnya
            }
        }
        
        conn.close();
        
        if (failed > 0) {
            logger.warn(`Script execution completed with ${failed} failed commands out of ${executableCommands.length}`);
            return {
                success: true,
                commands_executed: executed,
                commands_failed: failed,
                total_commands: executableCommands.length,
                ros_version: detectedVersion,
                warnings: errors
            };
        }
        
        return {
            success: true,
            commands_executed: executed,
            commands_failed: 0,
            total_commands: executableCommands.length,
            ros_version: detectedVersion,
            message: `Script berhasil dijalankan: ${executed} commands executed`
        };
    } catch (error) {
        if (conn) {
            try {
                conn.close();
            } catch (e) {
                // Ignore
            }
        }
        logger.error('Error executing Mikrotik script:', error);
        return {
            success: false,
            message: error.message || 'Gagal menjalankan script ke Mikrotik'
        };
    }
}

// Export all functions
module.exports = {
    setSock,
    connectToMikrotik,
    getMikrotikConnection,
    getMikrotikConnectionForRouter,
    getMikrotikConnectionForCustomer,
    getRouterForCustomer,
    getPPPoEUsers,
    addPPPoEUser,
    editPPPoEUser,
    deletePPPoEUser,
    getActivePPPoEConnections,
    formatUptime,
    getInactivePPPoEUsers,
    getRouterResources,
    getResourceInfo,
    getResourceInfoForRouter,
    getActiveHotspotUsers,
    addHotspotUser,
    deleteHotspotUser,
    addPPPoESecret,
    deletePPPoESecret,
    setPPPoEProfile,
    disconnectPPPoEUser,
    monitorPPPoEConnections,
    getInterfaces,
    getInterfacesForRouter,
    getAddressPoolsForRouter,
    getInterfaceDetail,
    setInterfaceStatus,
    getIPAddresses,
    addIPAddress,
    deleteIPAddress,
    // PPPoE/Hotspot profile helpers (needed by /admin/mikrotik)
    getPPPoEProfiles,
    getPPPoEProfileDetail,
    addPPPoEProfile,
    editPPPoEProfile,
    deletePPPoEProfile,
    // RADIUS profile functions
    getPPPoEProfilesRadius,
    addPPPoEProfileRadius,
    editPPPoEProfileRadius,
    deletePPPoEProfileRadius,
    getPPPoEProfileDetailRadius,
    getHotspotProfiles,
    getHotspotProfilesRadius,
    getHotspotProfileDetail,
    getHotspotProfileDetailRadius,
    saveHotspotProfileMetadata,
    deleteHotspotProfileMetadata,
    addHotspotProfile,
    editHotspotProfile,
    deleteHotspotProfile,
    getHotspotServerProfiles,
    getHotspotServerProfilesRadius,
    getHotspotServerProfileDetailRadius,
    addHotspotServerProfileRadius,
    editHotspotServerProfileRadius,
    deleteHotspotServerProfileRadius,
    addHotspotServerProfileMikrotik,
    editHotspotServerProfileMikrotik,
    deleteHotspotServerProfileMikrotik,
    getHotspotUsersRadius,
    getHotspotServers,
    addHotspotServer,
    editHotspotServer,
    deleteHotspotServer,
    getHotspotServerDetail,
    disconnectHotspotUser,
    generateHotspotVouchers,
    getInterfaceTraffic,
    // RADIUS functions
    getRadiusConnection,
    getUserAuthModeAsync,
    getRadiusStatistics,
    getPPPoEUsersRadius,
    getActivePPPoEConnectionsRadius,
    updatePPPoEUserRadiusPassword,
    assignPackageRadius,
    ensureIsolirProfileRadius,
    suspendUserRadius,
    unsuspendUserRadius,
    syncPackageLimitsToRadius,
    syncPackageLimitsToMikrotik,
    buildMikrotikRateLimit,
    formatSecondsToDuration,
    durationToSeconds,
    executeMikrotikScript,
    getRouterOSVersion
};