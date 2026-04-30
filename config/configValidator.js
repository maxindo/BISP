const axios = require('axios');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

/**
 * Validator untuk konfigurasi GenieACS dan Mikrotik
 * Mendeteksi settingan IP yang tidak sesuai atau dummy
 */
class ConfigValidator {
    constructor() {
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [], serverResults: [] },
            mikrotik: { isValid: false, errors: [], warnings: [], routerResults: [] },
            overall: { isValid: false, needsAttention: false }
        };
    }

    /**
     * Validasi format IP address
     */
    isValidIPAddress(ip) {
        // Regex untuk validasi IPv4
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        
        // Cek format IP
        if (!ipv4Regex.test(ip)) {
            return false;
        }

        // Cek IP yang tidak valid/dummy
        const dummyIPs = [
            '0.0.0.0',           // Invalid
            '127.0.0.1',         // Localhost (mungkin dummy)
            '192.168.1.1',       // Router default umum
            '192.168.0.1',       // Router default umum
            '10.0.0.1',          // Router default umum
            '172.16.0.1',        // Router default umum
            'localhost',         // Hostname localhost
            'example.com',       // Domain dummy
            'test.com',          // Domain dummy
            'dummy',             // Kata dummy
            'admin',             // Kata admin
            'test'               // Kata test
        ];

        return !dummyIPs.includes(ip.toLowerCase());
    }

    /**
     * Validasi port number
     */
    isValidPort(port) {
        const portNum = parseInt(port);
        return portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validasi URL format
     */
    isValidURL(url) {
        try {
            const urlObj = new URL(url);
            return this.isValidIPAddress(urlObj.hostname) || urlObj.hostname.includes('.');
        } catch (e) {
            return false;
        }
    }

    /**
     * Test koneksi ke GenieACS
     * Mengambil data dari database genieacs_servers, bukan settings.json
     */
    async testGenieACSConnection() {
        try {
            // Ambil semua GenieACS servers dari database
            const { getAllGenieacsServers } = require('./genieacs');
            const servers = await getAllGenieacsServers();

            if (!servers || servers.length === 0) {
                // Fallback ke settings.json jika tidak ada server di database
                const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
                const genieacsUsername = getSetting('genieacs_username', 'acs');
                const genieacsPassword = getSetting('genieacs_password', '');

                if (!genieacsUrl || genieacsUrl === 'http://localhost:7557') {
                    return {
                        success: false,
                        error: 'Tidak ada GenieACS server yang dikonfigurasi',
                        details: 'Silakan tambahkan GenieACS server di /admin/genieacs-setting',
                        servers: []
                    };
                }

                // Test dengan settings.json sebagai fallback
                const fallbackResult = await this.testGenieACSServer({
                    name: 'Default (settings.json)',
                    url: genieacsUrl,
                    username: genieacsUsername,
                    password: genieacsPassword
                });
                
                return {
                    success: fallbackResult.success,
                    error: fallbackResult.error || null,
                    message: fallbackResult.message || null,
                    details: fallbackResult.details || null,
                    servers: [{
                        server: 'Default (settings.json)',
                        serverId: null,
                        ...fallbackResult
                    }]
                };
            }

            // Test koneksi ke setiap server
            const serverResults = [];
            let allSuccess = true;
            let hasValidServer = false;

            for (const server of servers) {
                const result = await this.testGenieACSServer(server);
                serverResults.push({
                    server: server.name || server.url,
                    serverId: server.id,
                    ...result
                });

                if (result.success) {
                    hasValidServer = true;
                } else {
                    allSuccess = false;
                }
            }

            if (hasValidServer) {
                return {
                    success: true,
                    message: `${serverResults.filter(s => s.success).length} dari ${servers.length} server GenieACS terhubung`,
                    details: `Total ${servers.length} server dikonfigurasi`,
                    servers: serverResults
                };
            } else {
                return {
                    success: false,
                    error: 'Semua server GenieACS gagal koneksi',
                    details: `${serverResults.filter(s => !s.success).length} server bermasalah`,
                    servers: serverResults
                };
            }

        } catch (error) {
            logger.error(`Error testing GenieACS connections: ${error.message}`);
            return {
                success: false,
                error: 'Gagal memvalidasi koneksi GenieACS',
                details: error.message,
                servers: []
            };
        }
    }

    /**
     * Test koneksi ke satu GenieACS server
     */
    async testGenieACSServer(server) {
        try {
            const genieacsUrl = server.url;
            const genieacsUsername = server.username;
            const genieacsPassword = server.password;

            // Validasi URL format
            if (!this.isValidURL(genieacsUrl)) {
                return {
                    success: false,
                    error: 'Format URL GenieACS tidak valid',
                    details: `URL: ${genieacsUrl}`
                };
            }

            // Validasi credentials
            if (!genieacsUsername || !genieacsPassword) {
                return {
                    success: false,
                    error: 'Username atau password GenieACS tidak dikonfigurasi',
                    details: `Username: ${genieacsUsername ? 'Ada' : 'Kosong'}, Password: ${genieacsPassword ? 'Ada' : 'Kosong'}`
                };
            }

            // Test koneksi dengan timeout sangat pendek untuk login
            const response = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                timeout: 3000, // 3 detik timeout untuk login yang cepat
                headers: {
                    'Accept': 'application/json'
                }
            });

            return {
                success: true,
                message: 'Koneksi ke GenieACS berhasil',
                details: `Status: ${response.status}, Data devices: ${response.data ? response.data.length || 0 : 0}`
            };

        } catch (error) {
            let errorMessage = 'Gagal koneksi ke GenieACS';
            let errorDetails = error.message;

            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'GenieACS tidak dapat dijangkau';
                errorDetails = `Server tidak merespons pada ${server.url}. Pastikan GenieACS berjalan dan dapat diakses.`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Host GenieACS tidak ditemukan';
                errorDetails = `Alamat IP ${server.url} tidak dapat dijangkau. Periksa koneksi jaringan.`;
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'GenieACS timeout';
                errorDetails = `Koneksi ke ${server.url} timeout. Server mungkin lambat atau tidak aktif.`;
            } else if (error.response) {
                if (error.response.status === 401) {
                    errorMessage = 'Autentikasi GenieACS gagal';
                    errorDetails = 'Username atau password salah';
                } else if (error.response.status === 404) {
                    errorMessage = 'Endpoint GenieACS tidak ditemukan';
                    errorDetails = 'URL mungkin salah atau server tidak mendukung API';
                }
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails
            };
        }
    }

    /**
     * Test koneksi ke Mikrotik untuk router tertentu
     */
    async testMikrotikConnectionForRouter(router) {
        try {
            const mikrotikHost = router.nas_ip || router.ip;
            const mikrotikPort = router.port || '8728';
            const mikrotikUser = router.api_user || router.user || 'admin';
            const mikrotikPassword = router.api_password || router.password || '';

            // Validasi IP address
            if (!mikrotikHost || !this.isValidIPAddress(mikrotikHost)) {
                return {
                    success: false,
                    error: `IP address Mikrotik tidak valid`,
                    details: `IP: ${mikrotikHost || 'Kosong'}`,
                    routerName: router.name || 'Unknown'
                };
            }

            // Validasi port
            if (!this.isValidPort(mikrotikPort)) {
                return {
                    success: false,
                    error: `Port Mikrotik tidak valid`,
                    details: `Port: ${mikrotikPort}`,
                    routerName: router.name || 'Unknown'
                };
            }

            // Validasi credentials
            if (!mikrotikUser || !mikrotikPassword) {
                return {
                    success: false,
                    error: `Username atau password Mikrotik tidak dikonfigurasi`,
                    details: `Username: ${mikrotikUser ? 'Ada' : 'Kosong'}, Password: ${mikrotikPassword ? 'Ada' : 'Kosong'}`,
                    routerName: router.name || 'Unknown'
                };
            }

            // Test koneksi menggunakan API Mikrotik
            const { getMikrotikConnectionForRouter } = require('./mikrotik');
            
            // Coba koneksi dengan timeout
            const connection = await Promise.race([
                getMikrotikConnectionForRouter(router),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 5000)
                )
            ]);

            if (connection) {
                // Test dengan query sederhana
                try {
                    await connection.write('/system/resource/print');
                    return {
                        success: true,
                        message: `Koneksi ke ${router.name} berhasil`,
                        details: `Host: ${mikrotikHost}:${mikrotikPort}, User: ${mikrotikUser}`,
                        routerName: router.name || 'Unknown'
                    };
                } catch (queryError) {
                    return {
                        success: false,
                        error: `Koneksi berhasil tetapi query gagal`,
                        details: queryError.message,
                        routerName: router.name || 'Unknown'
                    };
                }
            } else {
                return {
                    success: false,
                    error: `Koneksi ke Mikrotik gagal`,
                    details: 'Tidak dapat membuat koneksi ke router Mikrotik',
                    routerName: router.name || 'Unknown'
                };
            }

        } catch (error) {
            const mikrotikHost = router.nas_ip || router.ip || 'Unknown';
            const mikrotikPort = router.port || '8728';
            let errorMessage = `Gagal koneksi ke Mikrotik`;
            let errorDetails = error.message;

            if (error.message.includes('timeout')) {
                errorMessage = `Mikrotik tidak merespons`;
                errorDetails = `Timeout - server mungkin tidak aktif atau tidak dapat dijangkau pada ${mikrotikHost}:${mikrotikPort}`;
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = `Koneksi ke Mikrotik ditolak`;
                errorDetails = `Port ${mikrotikPort} mungkin salah atau service tidak berjalan`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = `Host Mikrotik tidak ditemukan`;
                errorDetails = `Alamat IP ${mikrotikHost} tidak dapat dijangkau. Periksa koneksi jaringan.`;
            } else if (error.message.includes('invalid user name or password') || error.message.includes('username or password')) {
                errorMessage = `Autentikasi gagal`;
                errorDetails = `Username atau password salah untuk ${router.name || mikrotikHost}`;
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails,
                routerName: router.name || 'Unknown'
            };
        }
    }

    /**
     * Test koneksi ke semua Mikrotik router yang dikonfigurasi
     */
    async testMikrotikConnection() {
        try {
            // Ambil semua router dari database
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database('./data/billing.db');
            
            const routers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                });
            });

            if (!routers || routers.length === 0) {
                return {
                    success: false,
                    error: 'Tidak ada router Mikrotik yang dikonfigurasi',
                    details: 'Silakan tambahkan router di /admin/routers',
                    routers: []
                };
            }

            // Test koneksi ke setiap router
            const routerResults = [];
            let allSuccess = true;

            for (const router of routers) {
                const result = await this.testMikrotikConnectionForRouter(router);
                routerResults.push({
                    router: router.name || router.nas_ip || `Router ${router.id}`,
                    routerId: router.id,
                    ...result
                });
                
                if (!result.success) {
                    allSuccess = false;
                }
            }

            return {
                success: allSuccess,
                error: allSuccess ? null : 'Beberapa router gagal koneksi',
                details: allSuccess 
                    ? `Semua ${routers.length} router terhubung dengan baik` 
                    : `${routerResults.filter(r => !r.success).length} dari ${routers.length} router bermasalah`,
                routers: routerResults
            };

        } catch (error) {
            logger.error(`Error testing Mikrotik connections: ${error.message}`);
            return {
                success: false,
                error: 'Gagal memvalidasi koneksi Mikrotik',
                details: error.message,
                routers: []
            };
        }
    }

    /**
     * Validasi lengkap semua konfigurasi
     */
    async validateAllConfigurations() {
        console.log('🔍 [CONFIG_VALIDATOR] Memulai validasi konfigurasi...');
        
        // Reset hasil validasi
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [], serverResults: [] },
            mikrotik: { isValid: false, errors: [], warnings: [], routerResults: [] },
            overall: { isValid: false, needsAttention: false }
        };

        // Validasi GenieACS
        console.log('🔍 [CONFIG_VALIDATOR] Memvalidasi konfigurasi GenieACS...');
        const genieacsResult = await this.testGenieACSConnection();
        
        if (genieacsResult.success) {
            this.validationResults.genieacs.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] GenieACS: Konfigurasi valid');
            if (genieacsResult.servers && genieacsResult.servers.length > 0) {
                genieacsResult.servers.forEach(server => {
                    if (server.success) {
                        console.log(`   ✓ ${server.server}: ${server.message || 'Terhubung'}`);
                    } else {
                        console.log(`   ⚠️ ${server.server}: ${server.error || 'Gagal'}`);
                    }
                });
            }
        } else {
            if (genieacsResult.error) {
                this.validationResults.genieacs.errors.push(genieacsResult.error);
            }
            if (genieacsResult.servers && genieacsResult.servers.length > 0) {
                genieacsResult.servers.forEach(server => {
                    if (!server.success) {
                        const errorMsg = `${server.server}: ${server.error || 'Koneksi gagal'}`;
                        if (!this.validationResults.genieacs.errors.includes(errorMsg)) {
                            this.validationResults.genieacs.errors.push(errorMsg);
                        }
                        console.log(`   ❌ ${errorMsg}`);
                    } else {
                        console.log(`   ✓ ${server.server}: ${server.message || 'Terhubung'}`);
                    }
                });
            } else {
                console.log(`❌ [CONFIG_VALIDATOR] GenieACS: ${genieacsResult.error || 'Gagal validasi'}`);
            }
        }
        
        // Simpan detail server results untuk ditampilkan di UI
        this.validationResults.genieacs.serverResults = genieacsResult.servers || [];

        // Validasi Mikrotik
        console.log('🔍 [CONFIG_VALIDATOR] Memvalidasi konfigurasi Mikrotik...');
        const mikrotikResult = await this.testMikrotikConnection();
        
        if (mikrotikResult.success) {
            this.validationResults.mikrotik.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] Mikrotik: Konfigurasi valid');
            if (mikrotikResult.routers && mikrotikResult.routers.length > 0) {
                mikrotikResult.routers.forEach(router => {
                    console.log(`   ✓ ${router.router}: ${router.message || 'Terhubung'}`);
                });
            }
        } else {
            if (mikrotikResult.error) {
                this.validationResults.mikrotik.errors.push(mikrotikResult.error);
            }
            if (mikrotikResult.routers && mikrotikResult.routers.length > 0) {
                mikrotikResult.routers.forEach(router => {
                    if (!router.success) {
                        const errorMsg = `${router.router}: ${router.error || 'Koneksi gagal'}`;
                        if (!this.validationResults.mikrotik.errors.includes(errorMsg)) {
                            this.validationResults.mikrotik.errors.push(errorMsg);
                        }
                        console.log(`   ❌ ${errorMsg}`);
                    } else {
                        console.log(`   ✓ ${router.router}: ${router.message || 'Terhubung'}`);
                    }
                });
            } else {
                console.log(`❌ [CONFIG_VALIDATOR] Mikrotik: ${mikrotikResult.error || 'Gagal validasi'}`);
            }
        }
        
        // Simpan detail router results untuk ditampilkan di UI
        this.validationResults.mikrotik.routerResults = mikrotikResult.routers || [];

        // Evaluasi hasil keseluruhan
        this.validationResults.overall.isValid = 
            this.validationResults.genieacs.isValid && this.validationResults.mikrotik.isValid;
        
        this.validationResults.overall.needsAttention = 
            this.validationResults.genieacs.errors.length > 0 || this.validationResults.mikrotik.errors.length > 0;

        console.log(`🔍 [CONFIG_VALIDATOR] Validasi selesai. Status: ${this.validationResults.overall.isValid ? 'VALID' : 'PERLU PERHATIAN'}`);
        
        return this.validationResults;
    }

    /**
     * Dapatkan ringkasan validasi untuk ditampilkan ke admin
     */
    getValidationSummary() {
        const summary = {
            status: this.validationResults.overall.isValid ? 'valid' : 'warning',
            message: '',
            details: {
                genieacs: {
                    status: this.validationResults.genieacs.isValid ? 'valid' : 'error',
                    message: this.validationResults.genieacs.isValid ? 'Konfigurasi GenieACS valid' : 'Konfigurasi GenieACS bermasalah',
                    errors: this.validationResults.genieacs.errors
                },
                mikrotik: {
                    status: this.validationResults.mikrotik.isValid ? 'valid' : 'error', 
                    message: this.validationResults.mikrotik.isValid ? 'Konfigurasi Mikrotik valid' : 'Konfigurasi Mikrotik bermasalah',
                    errors: this.validationResults.mikrotik.errors
                }
            }
        };

        if (this.validationResults.overall.isValid) {
            summary.message = 'Semua konfigurasi sistem valid dan siap digunakan';
        } else {
            const errorCount = this.validationResults.genieacs.errors.length + this.validationResults.mikrotik.errors.length;
            summary.message = `Ditemukan ${errorCount} masalah konfigurasi yang perlu diperbaiki`;
        }

        return summary;
    }

    /**
     * Cek apakah konfigurasi saat ini menggunakan settingan default/dummy
     */
    checkForDefaultSettings() {
        const warnings = [];
        
        // Cek GenieACS
        const genieacsUrl = getSetting('genieacs_url', '');
        const genieacsUser = getSetting('genieacs_username', '');
        const genieacsPass = getSetting('genieacs_password', '');
        
        if (genieacsUrl.includes('localhost') || genieacsUrl.includes('127.0.0.1')) {
            warnings.push('GenieACS menggunakan alamat localhost - pastikan ini sesuai dengan setup Anda');
        }
        
        if (genieacsUser === 'admin' || genieacsUser === 'acs' || genieacsUser === '') {
            warnings.push('GenieACS menggunakan username default - pertimbangkan untuk mengubahnya');
        }
        
        if (genieacsPass === 'admin' || genieacsPass === 'password' || genieacsPass === '') {
            warnings.push('GenieACS menggunakan password default - segera ubah untuk keamanan');
        }

        // Cek Mikrotik
        const mikrotikHost = getSetting('mikrotik_host', '');
        const mikrotikUser = getSetting('mikrotik_user', '');
        const mikrotikPass = getSetting('mikrotik_password', '');
        
        if (mikrotikHost === '192.168.1.1' || mikrotikHost === '192.168.0.1' || mikrotikHost === '') {
            warnings.push('Mikrotik menggunakan IP default - pastikan sesuai dengan setup router Anda');
        }
        
        if (mikrotikUser === 'admin' || mikrotikUser === '') {
            warnings.push('Mikrotik menggunakan username default - pertimbangkan untuk mengubahnya');
        }
        
        if (mikrotikPass === 'admin' || mikrotikPass === 'password' || mikrotikPass === '') {
            warnings.push('Mikrotik menggunakan password default - segera ubah untuk keamanan');
        }

        return warnings;
    }
}

// Export instance singleton
const configValidator = new ConfigValidator();

module.exports = {
    ConfigValidator,
    configValidator,
    validateConfiguration: () => configValidator.validateAllConfigurations(),
    getValidationSummary: () => configValidator.getValidationSummary(),
    checkForDefaultSettings: () => configValidator.checkForDefaultSettings()
};
