const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// Get database config
const { getRadiusConfigValue } = require('../config/radiusConfig');

/**
 * GET /api/hotspot-error-message
 * API untuk mendapatkan error message berdasarkan username
 * Digunakan oleh template hotspot untuk menampilkan pesan error
 */
router.get('/api/hotspot-error-message', async (req, res) => {
    try {
        const username = req.query.username;
        
        if (!username) {
            return res.json({ 
                error: false, 
                message: null 
            });
        }
        
        // Get database config
        const dbHost = await getRadiusConfigValue('db_host', 'localhost');
        const dbUser = await getRadiusConfigValue('db_user', 'radius');
        const dbPassword = await getRadiusConfigValue('db_password', '');
        const dbName = await getRadiusConfigValue('db_name', 'radius');
        
        // Connect to database
        const connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPassword,
            database: dbName
        });
        
        let errorMessage = null;
        
        // Cek apakah user punya Max-All-Session (durasi habis)
        const [maxSessionRows] = await connection.execute(
            `SELECT value FROM radcheck 
             WHERE username = ? AND attribute = 'Max-All-Session'`,
            [username]
        );
        
        if (maxSessionRows.length > 0) {
            const maxSession = parseInt(maxSessionRows[0].value);
            
            // Cek total usage time
            const [timeRows] = await connection.execute(
                `SELECT SUM(acctsessiontime) as total_time 
                 FROM radacct 
                 WHERE username = ? AND acctstoptime IS NOT NULL`,
                [username]
            );
            
            if (timeRows.length > 0 && timeRows[0].total_time !== null) {
                const totalTime = parseInt(timeRows[0].total_time);
                
                if (totalTime >= maxSession) {
                    errorMessage = 'Durasi Voucher Sudah Habis';
                }
            }
        }
        
        // Jika belum ada error message, cek Expire-After
        if (!errorMessage) {
            const [expireRows] = await connection.execute(
                `SELECT value FROM radcheck 
                 WHERE username = ? AND attribute = 'Expire-After'`,
                [username]
            );
            
            if (expireRows.length > 0) {
                const expireAfter = parseInt(expireRows[0].value);
                
                // Cek kapan user pertama kali login
                const [firstLoginRows] = await connection.execute(
                    `SELECT MIN(acctstarttime) as first_login 
                     FROM radacct 
                     WHERE username = ?`,
                    [username]
                );
                
                if (firstLoginRows.length > 0 && firstLoginRows[0].first_login) {
                    const firstLogin = new Date(firstLoginRows[0].first_login);
                    const now = new Date();
                    const diffHours = (now - firstLogin) / (1000 * 60 * 60);
                    
                    if (diffHours >= expireAfter) {
                        errorMessage = 'Voucher expired: masa berlaku telah habis';
                    }
                }
            }
        }
        
        // Jika masih belum ada, cek dari radpostauth terakhir
        if (!errorMessage) {
            const [authRows] = await connection.execute(
                `SELECT * FROM radpostauth 
                 WHERE username = ? AND reply = 'Access-Reject' 
                 ORDER BY id DESC LIMIT 1`,
                [username]
            );
            
            if (authRows.length > 0) {
                // Default message untuk Access-Reject
                errorMessage = 'Akses ditolak';
            }
        }
        
        await connection.end();
        
        res.json({
            error: false,
            message: errorMessage,
            username: username
        });
        
    } catch (err) {
        console.error('Error fetching hotspot error message:', err);
        res.json({
            error: true,
            message: null
        });
    }
});

/**
 * GET /hotspot-error
 * Halaman error untuk ditampilkan saat login gagal
 * Bisa digunakan dengan Mikrotik-Advertise-URL
 */
router.get('/hotspot-error', async (req, res) => {
    try {
        const username = req.query.username || req.query.user || 'Unknown';
        let errorMessage = 'Akses ditolak';
        
        // Get database config
        const dbHost = await getRadiusConfigValue('db_host', 'localhost');
        const dbUser = await getRadiusConfigValue('db_user', 'radius');
        const dbPassword = await getRadiusConfigValue('db_password', '');
        const dbName = await getRadiusConfigValue('db_name', 'radius');
        
        // Connect to database
        const connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPassword,
            database: dbName
        });
        
        // Cek apakah user punya Max-All-Session (durasi habis)
        const [maxSessionRows] = await connection.execute(
            `SELECT value FROM radcheck 
             WHERE username = ? AND attribute = 'Max-All-Session'`,
            [username]
        );
        
        if (maxSessionRows.length > 0) {
            const maxSession = parseInt(maxSessionRows[0].value);
            
            // Cek total usage time
            const [timeRows] = await connection.execute(
                `SELECT SUM(acctsessiontime) as total_time 
                 FROM radacct 
                 WHERE username = ? AND acctstoptime IS NOT NULL`,
                [username]
            );
            
            if (timeRows.length > 0 && timeRows[0].total_time !== null) {
                const totalTime = parseInt(timeRows[0].total_time);
                
                if (totalTime >= maxSession) {
                    errorMessage = 'Durasi Voucher Sudah Habis';
                }
            }
        }
        
        // Jika belum ada error message, cek Expire-After
        if (!errorMessage || errorMessage === 'Akses ditolak') {
            const [expireRows] = await connection.execute(
                `SELECT value FROM radcheck 
                 WHERE username = ? AND attribute = 'Expire-After'`,
                [username]
            );
            
            if (expireRows.length > 0) {
                const expireAfter = parseInt(expireRows[0].value);
                
                // Cek kapan user pertama kali login
                const [firstLoginRows] = await connection.execute(
                    `SELECT MIN(acctstarttime) as first_login 
                     FROM radacct 
                     WHERE username = ?`,
                    [username]
                );
                
                if (firstLoginRows.length > 0 && firstLoginRows[0].first_login) {
                    const firstLogin = new Date(firstLoginRows[0].first_login);
                    const now = new Date();
                    const diffHours = (now - firstLogin) / (1000 * 60 * 60);
                    
                    if (diffHours >= expireAfter) {
                        errorMessage = 'Voucher expired: masa berlaku telah habis';
                    }
                }
            }
        }
        
        await connection.end();
        
        res.render('hotspot-error', {
            errorMessage: errorMessage,
            username: username
        });
        
    } catch (err) {
        console.error('Error rendering hotspot error page:', err);
        res.render('hotspot-error', {
            errorMessage: 'Terjadi kesalahan. Silakan coba lagi.',
            username: req.query.username || 'Unknown'
        });
    }
});

module.exports = router;

