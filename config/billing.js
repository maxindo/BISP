const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const PaymentGatewayManager = require('./paymentGateway');
const logger = require('./logger'); // Added logger import
const { getCompanyHeader } = require('./message-templates');
const { getSetting } = require('./settingsManager');

class BillingManager {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/billing.db');
        this.paymentGateway = new PaymentGatewayManager();
        this.initDatabase();
    }

    // Hot-reload payment gateway configuration
    async reloadPaymentGateway() {
        try {
            const result = await this.paymentGateway.reload();
            return result;
        } catch (e) {
            try { logger.error('[BILLING] Failed to reload payment gateways:', e.message); } catch (_) {}
            return { error: true, message: e.message };
        }
    }

    /**
     * Helper function untuk auto-sync status ke RADIUS
     * Dipanggil saat status customer berubah menjadi 'suspended' atau 'active'
     */
    async _autoSyncStatusToRadius(customer, oldStatus, newStatus) {
        try {
            // Hanya sync jika status benar-benar berubah
            if (newStatus === 'suspended' && oldStatus !== 'suspended') {
                // Status berubah menjadi suspended - langsung sync ke RADIUS
                const { getUserAuthModeAsync } = require('./mikrotik');
                const authMode = await getUserAuthModeAsync();
                
                if (authMode === 'radius') {
                    const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || 
                                   (customer.username && String(customer.username).trim());
                    
                    if (pppUser) {
                        logger.info(`[BILLING] Auto-syncing ${pppUser} to isolir group in RADIUS...`);
                        const { suspendUserRadius, getRouterForCustomer, getMikrotikConnectionForRouter, disconnectPPPoEUser } = require('./mikrotik');
                        
                        // Disconnect active session TERLEBIH DAHULU
                        try {
                            let routerObj = null;
                            try {
                                routerObj = await getRouterForCustomer(customer);
                            } catch (routerError) {
                                // Jika customer tidak punya router mapping, cari di semua router
                                logger.warn(`[BILLING] Customer tidak punya router mapping, mencari di semua router untuk ${pppUser}`);
                                const sqlite3 = require('sqlite3').verbose();
                                const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
                                const routers = await new Promise((resolve) => 
                                    db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || []))
                                );
                                db.close();
                                
                                // Cari router yang memiliki user aktif
                                for (const router of routers) {
                                    try {
                                        const conn = await getMikrotikConnectionForRouter(router);
                                        const activeSessions = await conn.write('/ppp/active/print', [`?name=${pppUser}`]);
                                        if (activeSessions && activeSessions.length > 0) {
                                            routerObj = router;
                                            logger.info(`[BILLING] Found active session for ${pppUser} on router ${router.name}`);
                                            break;
                                        }
                                    } catch (e) {
                                        // Continue to next router
                                    }
                                }
                                
                                // Jika tidak ditemukan, gunakan router pertama sebagai fallback
                                if (!routerObj && routers.length > 0) {
                                    routerObj = routers[0];
                                    logger.warn(`[BILLING] No active session found, using first router as fallback: ${routerObj.name}`);
                                }
                            }
                            
                            if (routerObj) {
                                const disconnectResult = await disconnectPPPoEUser(pppUser, routerObj);
                                
                                if (disconnectResult.success && disconnectResult.disconnected > 0) {
                                    logger.info(`[BILLING] Disconnected ${disconnectResult.disconnected} active session(s) for ${pppUser} before isolir`);
                                    
                                    // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                } else if (disconnectResult.disconnected === 0) {
                                    logger.info(`[BILLING] User ${pppUser} tidak sedang online, langsung isolir`);
                                } else {
                                    logger.warn(`[BILLING] Disconnect result: ${disconnectResult.message}`);
                                }
                            } else {
                                logger.warn(`[BILLING] Tidak ada router yang tersedia untuk disconnect ${pppUser}`);
                            }
                        } catch (disconnectError) {
                            logger.warn(`[BILLING] Failed to disconnect active session for ${pppUser}: ${disconnectError.message}`);
                        }
                        
                        // Pindahkan ke group isolir
                        const suspendResult = await suspendUserRadius(pppUser);
                        if (suspendResult && suspendResult.success) {
                            logger.info(`[BILLING] ✅ ${pppUser} successfully moved to isolir group`);
                        } else {
                            logger.error(`[BILLING] ❌ Failed to move ${pppUser} to isolir: ${suspendResult?.message || 'Unknown error'}`);
                        }
                    }
                }
            } else if (newStatus === 'active' && oldStatus === 'suspended') {
                // Status berubah dari suspended ke active - restore dari isolir
                const { getUserAuthModeAsync } = require('./mikrotik');
                const authMode = await getUserAuthModeAsync();
                
                if (authMode === 'radius') {
                    const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || 
                                   (customer.username && String(customer.username).trim());
                    
                    if (pppUser) {
                        logger.info(`[BILLING] Auto-restoring ${pppUser} from isolir group in RADIUS...`);
                        const { unsuspendUserRadius, getRouterForCustomer, getMikrotikConnectionForRouter, disconnectPPPoEUser } = require('./mikrotik');
                        
                        // Disconnect active session TERLEBIH DAHULU
                        try {
                            let routerObj = null;
                            try {
                                routerObj = await getRouterForCustomer(customer);
                            } catch (routerError) {
                                // Jika customer tidak punya router mapping, cari di semua router
                                logger.warn(`[BILLING] Customer tidak punya router mapping, mencari di semua router untuk ${pppUser}`);
                                const sqlite3 = require('sqlite3').verbose();
                                const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
                                const routers = await new Promise((resolve) => 
                                    db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || []))
                                );
                                db.close();
                                
                                // Cari router yang memiliki user aktif
                                for (const router of routers) {
                                    try {
                                        const conn = await getMikrotikConnectionForRouter(router);
                                        const activeSessions = await conn.write('/ppp/active/print', [`?name=${pppUser}`]);
                                        if (activeSessions && activeSessions.length > 0) {
                                            routerObj = router;
                                            logger.info(`[BILLING] Found active session for ${pppUser} on router ${router.name}`);
                                            break;
                                        }
                                    } catch (e) {
                                        // Continue to next router
                                    }
                                }
                                
                                // Jika tidak ditemukan, gunakan router pertama sebagai fallback
                                if (!routerObj && routers.length > 0) {
                                    routerObj = routers[0];
                                    logger.warn(`[BILLING] No active session found, using first router as fallback: ${routerObj.name}`);
                                }
                            }
                            
                            if (routerObj) {
                                const disconnectResult = await disconnectPPPoEUser(pppUser, routerObj);
                                
                                if (disconnectResult.success && disconnectResult.disconnected > 0) {
                                    logger.info(`[BILLING] Disconnected ${disconnectResult.disconnected} active session(s) for ${pppUser} before restore`);
                                    
                                    // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                } else if (disconnectResult.disconnected === 0) {
                                    logger.info(`[BILLING] User ${pppUser} tidak sedang online, langsung restore`);
                                } else {
                                    logger.warn(`[BILLING] Disconnect result: ${disconnectResult.message}`);
                                }
                            } else {
                                logger.warn(`[BILLING] Tidak ada router yang tersedia untuk disconnect ${pppUser}`);
                            }
                        } catch (disconnectError) {
                            logger.warn(`[BILLING] Failed to disconnect active session for ${pppUser}: ${disconnectError.message}`);
                        }
                        
                        // Restore ke package sebelumnya
                        const restoreResult = await unsuspendUserRadius(pppUser);
                        if (restoreResult && restoreResult.success) {
                            logger.info(`[BILLING] ✅ ${pppUser} successfully restored from isolir group`);
                        } else {
                            logger.error(`[BILLING] ❌ Failed to restore ${pppUser} from isolir: ${restoreResult?.message || 'Unknown error'}`);
                        }
                    }
                }
            }
        } catch (syncError) {
            logger.error(`[BILLING] Error auto-syncing status to RADIUS: ${syncError.message}`);
            // Jangan throw error, karena update status sudah berhasil
        }
    }

    async setCustomerStatusById(id, status) {
        return new Promise(async (resolve, reject) => {
            try {
                const existing = await this.getCustomerById(id);
                if (!existing) return reject(new Error('Customer not found'));
                const oldStatus = existing.status;
                const sql = `UPDATE customers SET status = ? WHERE id = ?`;
                this.db.run(sql, [status, id], async (err) => {
                    if (err) return reject(err);
                    try {
                        logger.info(`[BILLING] setCustomerStatusById: id=${id}, username=${existing.username}, from=${oldStatus} -> to=${status}`);
                        
                        // PENTING: Auto-sync ke RADIUS jika status berubah menjadi 'suspended' atau 'active'
                        await this._autoSyncStatusToRadius(existing, oldStatus, status);
                    } catch (_) {}
                    resolve({ id, status });
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    initDatabase() {
        // Pastikan direktori data ada
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Inisialisasi database secara synchronous
        try {
            this.db = new sqlite3.Database(this.dbPath);
            console.log('Billing database connected');
            
            // Enable foreign key constraints for cascade delete
            this.db.run("PRAGMA foreign_keys = ON", (err) => {
                if (err) {
                    console.error('Error enabling foreign keys:', err);
                } else {
                    console.log('✅ Foreign keys enabled for cascade delete');
                }
            });
            
            this.createTables();
        } catch (err) {
            console.error('Error opening billing database:', err);
            throw err;
        }
    }

    async updateCustomerById(id, customerData) {
        return new Promise(async (resolve, reject) => {
            const { name, username, pppoe_username, email, address, latitude, longitude, package_id, odp_id, pppoe_profile, status, auto_suspension, billing_day, renewal_type, fix_date, cable_type, cable_length, port_number, cable_status, cable_notes } = customerData;
            try {
                const oldCustomer = await this.getCustomerById(id);
                if (!oldCustomer) return reject(new Error('Customer not found'));

                const normBillingDay = Math.min(Math.max(parseInt(billing_day !== undefined ? billing_day : (oldCustomer?.billing_day ?? 15), 10) || 15, 1), 28);
                
                // Normalisasi renewal_type dan fix_date
                const normRenewalType = renewal_type || oldCustomer.renewal_type || 'renewal';
                const normFixDate = renewal_type === 'fix_date' ? 
                    (fix_date !== undefined ? Math.min(Math.max(parseInt(fix_date, 10) || 15, 1), 28) : (oldCustomer.fix_date || 15)) : 
                    null;

                const sql = `UPDATE customers SET name = ?, username = ?, pppoe_username = ?, email = ?, address = ?, latitude = ?, longitude = ?, package_id = ?, odp_id = ?, pppoe_profile = ?, status = ?, auto_suspension = ?, billing_day = ?, renewal_type = ?, fix_date = ?, cable_type = ?, cable_length = ?, port_number = ?, cable_status = ?, cable_notes = ? WHERE id = ?`;
                this.db.run(sql, [
                    name ?? oldCustomer.name,
                    username ?? oldCustomer.username,
                    pppoe_username ?? oldCustomer.pppoe_username,
                    email ?? oldCustomer.email,
                    address ?? oldCustomer.address,
                    latitude !== undefined ? parseFloat(latitude) : oldCustomer.latitude,
                    longitude !== undefined ? parseFloat(longitude) : oldCustomer.longitude,
                    package_id ?? oldCustomer.package_id,
                    odp_id !== undefined ? odp_id : oldCustomer.odp_id,
                    pppoe_profile ?? oldCustomer.pppoe_profile,
                    status ?? oldCustomer.status,
                    auto_suspension !== undefined ? auto_suspension : oldCustomer.auto_suspension,
                    normBillingDay,
                    normRenewalType,
                    normFixDate,
                    cable_type !== undefined ? cable_type : oldCustomer.cable_type,
                    cable_length !== undefined ? cable_length : oldCustomer.cable_length,
                    port_number !== undefined ? port_number : oldCustomer.port_number,
                    cable_status !== undefined ? cable_status : oldCustomer.cable_status,
                    cable_notes !== undefined ? cable_notes : oldCustomer.cable_notes,
                    id
                ], async (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // PENTING: Auto-sync ke RADIUS jika status berubah menjadi 'suspended' atau 'active'
                        const newStatus = status !== undefined ? status : oldCustomer.status;
                        const oldStatus = oldCustomer.status;
                        if (newStatus !== oldStatus) {
                            // Buat customer object dengan data terbaru untuk sync
                            const updatedCustomer = {
                                ...oldCustomer,
                                ...customerData,
                                id,
                                status: newStatus
                            };
                            await this._autoSyncStatusToRadius(updatedCustomer, oldStatus, newStatus);
                        }
                        
                        // Sinkronisasi cable routes jika ada data ODP atau cable
                        if (odp_id !== undefined || cable_type !== undefined) {
                            console.log(`🔧 Updating cable route for customer ${oldCustomer.username}, odp_id: ${odp_id}, cable_type: ${cable_type}`);
                            try {
                                const db = this.db;
                                const customerId = id;
                                
                                // Cek apakah sudah ada cable route untuk customer ini
                                const existingRoute = await new Promise((resolve, reject) => {
                                    db.get('SELECT * FROM cable_routes WHERE customer_id = ?', [customerId], (err, row) => {
                                        if (err) reject(err);
                                        else resolve(row);
                                    });
                                });
                                
                                if (existingRoute) {
                                    // Update cable route yang ada
                                    console.log(`📝 Found existing cable route for customer ${oldCustomer.username}, updating...`);
                                    console.log(`🔧 ODP: ${odp_id !== undefined ? odp_id : existingRoute.odp_id}, Port: ${port_number !== undefined ? port_number : existingRoute.port_number}`);
                                    const updateSql = `
                                        UPDATE cable_routes 
                                        SET odp_id = ?, cable_type = ?, cable_length = ?, port_number = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                                        WHERE customer_id = ?
                                    `;
                                    
                                    db.run(updateSql, [
                                        odp_id !== undefined ? odp_id : existingRoute.odp_id,
                                        cable_type !== undefined ? cable_type : existingRoute.cable_type,
                                        cable_length !== undefined ? cable_length : existingRoute.cable_length,
                                        port_number !== undefined ? port_number : existingRoute.port_number,
                                        cable_status !== undefined ? cable_status : existingRoute.status,
                                        cable_notes !== undefined ? cable_notes : existingRoute.notes,
                                        customerId
                                    ], function(err) {
                                        if (err) {
                                            console.error(`❌ Error updating cable route for customer ${oldCustomer.username}:`, err.message);
                                        } else {
                                            console.log(`✅ Successfully updated cable route for customer ${oldCustomer.username}`);
                                        }
                                    });
                                } else if (odp_id) {
                                    // Buat cable route baru jika belum ada
                                    console.log(`📝 Creating new cable route for customer ${oldCustomer.username}...`);
                                    const cableRouteSql = `
                                        INSERT INTO cable_routes (customer_id, odp_id, cable_type, cable_length, port_number, status, notes)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    `;
                                    
                                    db.run(cableRouteSql, [
                                        customerId,
                                        odp_id,
                                        cable_type || 'Fiber Optic',
                                        cable_length || 0,
                                        port_number || 1,
                                        cable_status || 'connected',
                                        cable_notes || `Auto-created for customer ${oldCustomer.name}`
                                    ], function(err) {
                                        if (err) {
                                            console.error(`❌ Error creating cable route for customer ${oldCustomer.username}:`, err.message);
                                        } else {
                                            console.log(`✅ Successfully created cable route for customer ${oldCustomer.username}`);
                                        }
                                    });
                                }
                            } catch (cableError) {
                                console.error(`❌ Error handling cable route for customer ${oldCustomer.username}:`, cableError.message);
                                // Jangan reject, karena customer sudah berhasil diupdate di billing
                            }
                        }
                        
                        resolve({ username: oldCustomer.username, id, ...customerData });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Update customer coordinates untuk mapping
    async updateCustomerCoordinates(id, coordinates) {
        return new Promise((resolve, reject) => {
            const { latitude, longitude } = coordinates;
            
            if (latitude === undefined || longitude === undefined) {
                return reject(new Error('Latitude dan longitude wajib diisi'));
            }

            const sql = `UPDATE customers SET latitude = ?, longitude = ? WHERE id = ?`;
            this.db.run(sql, [latitude, longitude, id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, latitude, longitude, changes: this.changes });
                }
            });
        });
    }

    // Get customer by serial number (untuk mapping device)
    async getCustomerBySerialNumber(serialNumber) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM customers WHERE serial_number = ?`;
            this.db.get(sql, [serialNumber], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    // Get customer by PPPoE username (untuk mapping device)
    async getCustomerByPPPoE(pppoeUsername) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM customers WHERE pppoe_username = ?`;
            this.db.get(sql, [pppoeUsername], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    createTables() {
        const tables = [
            // Tabel paket internet
            `CREATE TABLE IF NOT EXISTS packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                speed TEXT NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                tax_rate DECIMAL(5,2) DEFAULT 11.00,
                description TEXT,
                pppoe_profile TEXT DEFAULT 'default',
                router_id INTEGER,
                upload_limit TEXT,
                download_limit TEXT,
                burst_limit_upload TEXT,
                burst_limit_download TEXT,
                burst_threshold TEXT,
                burst_time TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (router_id) REFERENCES routers(id)
            )`,

            // Tabel pelanggan
            `CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                pppoe_username TEXT,
                email TEXT,
                address TEXT,
                latitude DECIMAL(10,8),
                longitude DECIMAL(11,8),
                package_id INTEGER,
                pppoe_profile TEXT,
                status TEXT DEFAULT 'active',
                join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                -- Cable connection fields
                cable_type TEXT,
                cable_length INTEGER,
                port_number INTEGER,
                cable_status TEXT DEFAULT 'connected',
                cable_notes TEXT,
                FOREIGN KEY (package_id) REFERENCES packages (id)
            )`,

            // Tabel routers (NAS) untuk RADIUS mapping
            `CREATE TABLE IF NOT EXISTS routers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                nas_ip TEXT NOT NULL,
                nas_identifier TEXT,
                secret TEXT,
                UNIQUE(nas_ip)
            )`,

            // Mapping customer ke router (tanpa ubah skema customers)
            `CREATE TABLE IF NOT EXISTS customer_router_map (
                customer_id INTEGER NOT NULL,
                router_id INTEGER NOT NULL,
                PRIMARY KEY (customer_id),
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
            )`,

            // Tabel tagihan
            `CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                package_id INTEGER NOT NULL,
                invoice_number TEXT UNIQUE NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                due_date DATE NOT NULL,
                status TEXT DEFAULT 'unpaid',
                payment_date DATETIME,
                payment_method TEXT,
                payment_gateway TEXT,
                payment_token TEXT,
                payment_url TEXT,
                payment_status TEXT DEFAULT 'pending',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers (id),
                FOREIGN KEY (package_id) REFERENCES packages (id)
            )`,

            // Tabel pembayaran
            `CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                payment_method TEXT NOT NULL,
                reference_number TEXT,
                notes TEXT,
                FOREIGN KEY (invoice_id) REFERENCES invoices (id)
            )`,

            // Tabel transaksi payment gateway
            `CREATE TABLE IF NOT EXISTS payment_gateway_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL,
                gateway TEXT NOT NULL,
                order_id TEXT NOT NULL,
                payment_url TEXT,
                token TEXT,
                amount DECIMAL(10,2) NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_type TEXT,
                fraud_status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invoice_id) REFERENCES invoices (id)
            )`,

            // Tabel expenses untuk pengeluaran
            `CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                account_expenses TEXT,
                expense_date DATE NOT NULL,
                payment_method TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabel income (pemasukan)
            `CREATE TABLE IF NOT EXISTS income (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                income_date DATE NOT NULL,
                payment_method TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabel ODP (Optical Distribution Point)
            `CREATE TABLE IF NOT EXISTS odps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                code VARCHAR(50) NOT NULL UNIQUE,
                latitude DECIMAL(10,8) NOT NULL,
                longitude DECIMAL(11,8) NOT NULL,
                address TEXT,
                capacity INTEGER DEFAULT 64,
                used_ports INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
                installation_date DATE,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabel Cable Routes (Jalur Kabel dari ODP ke Pelanggan)
            `CREATE TABLE IF NOT EXISTS cable_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                odp_id INTEGER NOT NULL,
                cable_length DECIMAL(8,2),
                cable_type VARCHAR(50) DEFAULT 'Fiber Optic',
                installation_date DATE,
                status VARCHAR(20) DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'maintenance', 'damaged')),
                port_number INTEGER,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (odp_id) REFERENCES odps(id) ON DELETE CASCADE
            )`,

            // Tabel Network Segments (Segmen Jaringan)
            `CREATE TABLE IF NOT EXISTS network_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL,
                start_odp_id INTEGER NOT NULL,
                end_odp_id INTEGER,
                segment_type VARCHAR(50) DEFAULT 'Backbone' CHECK (segment_type IN ('Backbone', 'Distribution', 'Access')),
                cable_length DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'damaged', 'inactive')),
                installation_date DATE,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (start_odp_id) REFERENCES odps(id) ON DELETE CASCADE,
                FOREIGN KEY (end_odp_id) REFERENCES odps(id) ON DELETE CASCADE
            )`,
            
            // Tabel ODP Connections (Backbone Network)
            `CREATE TABLE IF NOT EXISTS odp_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_odp_id INTEGER NOT NULL,
                to_odp_id INTEGER NOT NULL,
                connection_type VARCHAR(50) DEFAULT 'fiber' CHECK (connection_type IN ('fiber', 'copper', 'wireless', 'microwave')),
                cable_length DECIMAL(8,2),
                cable_capacity VARCHAR(20) DEFAULT '1G' CHECK (cable_capacity IN ('100M', '1G', '10G', '100G')),
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive', 'damaged')),
                installation_date DATE,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_odp_id) REFERENCES odps(id) ON DELETE CASCADE,
                FOREIGN KEY (to_odp_id) REFERENCES odps(id) ON DELETE CASCADE,
                UNIQUE(from_odp_id, to_odp_id)
            )`,

            // Tabel Cable Maintenance Log
            `CREATE TABLE IF NOT EXISTS cable_maintenance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cable_route_id INTEGER,
                network_segment_id INTEGER,
                maintenance_type VARCHAR(50) NOT NULL CHECK (maintenance_type IN ('repair', 'replacement', 'inspection', 'upgrade')),
                description TEXT NOT NULL,
                performed_by INTEGER,
                maintenance_date DATE NOT NULL,
                duration_hours DECIMAL(4,2),
                cost DECIMAL(12,2),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cable_route_id) REFERENCES cable_routes(id) ON DELETE CASCADE,
                FOREIGN KEY (network_segment_id) REFERENCES network_segments(id) ON DELETE CASCADE
            )`
        ];

        // Create tables sequentially to ensure proper order
        this.createTablesSequentially(tables);

        // Tambahkan kolom payment_status jika belum ada
        this.db.run("ALTER TABLE invoices ADD COLUMN payment_status TEXT DEFAULT 'pending'", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding payment_status column:', err);
            }
        });

        // Tambahkan kolom pppoe_profile ke packages jika belum ada
        this.db.run("ALTER TABLE packages ADD COLUMN pppoe_profile TEXT DEFAULT 'default'", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding pppoe_profile column to packages:', err);
            } else if (!err) {
                console.log('Added pppoe_profile column to packages table');
            }
        });

        // Tambahkan kolom pppoe_profile ke customers jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN pppoe_profile TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding pppoe_profile column to customers:', err);
            } else if (!err) {
                console.log('Added pppoe_profile column to customers table');
            }
        });

        // Tambahkan kolom cable connection ke customers jika belum ada
        this.addCableFieldsToCustomers();

        // Tambahkan kolom auto_suspension ke customers jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN auto_suspension BOOLEAN DEFAULT 1", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding auto_suspension column:', err);
            } else if (!err) {
                console.log('Added auto_suspension column to customers table');
            }
        });

        // Tambahkan kolom billing_day ke customers jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN billing_day INTEGER DEFAULT 15", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding billing_day column:', err);
            } else if (!err) {
                console.log('Added billing_day column to customers table');
            }
        });

        // Tambahkan kolom tax_rate ke packages jika belum ada
        this.db.run("ALTER TABLE packages ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 11.00", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding tax_rate column to packages:', err);
            } else if (!err) {
                console.log('Added tax_rate column to packages table');
            }
        });

        // Tambahkan kolom latitude dan longitude ke customers jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN latitude DECIMAL(10,8)", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding latitude column to customers:', err);
            } else if (!err) {
                console.log('Added latitude column to customers table');
            }
        });
        this.db.run("ALTER TABLE customers ADD COLUMN longitude DECIMAL(11,8)", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding longitude column to customers:', err);
            } else if (!err) {
                console.log('Added longitude column to customers table');
            }
        });

        // Tambahkan kolom odp_id ke customers jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN odp_id INTEGER", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding odp_id column to customers:', err);
            } else if (!err) {
                console.log('Added odp_id column to customers table');
            }
        });

        // Tambahkan kolom parent_odp_id ke odps jika belum ada
        this.db.run("ALTER TABLE odps ADD COLUMN parent_odp_id INTEGER", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding parent_odp_id column to odps:', err);
            } else if (!err) {
                console.log('Added parent_odp_id column to odps table');
            }
        });

        // Update existing customers to have username if null (for backward compatibility)
        this.db.run("UPDATE customers SET username = 'cust_' || substr(phone, -4, 4) || '_' || strftime('%s','now') WHERE username IS NULL OR username = ''", (err) => {
            if (err) {
                console.error('Error updating null usernames:', err);
            } else {
                console.log('Updated null usernames for existing customers');
            }
        });
    }

    addCableFieldsToCustomers() {
        // Add cable connection fields to customers table
        const cableFields = [
            { name: 'cable_type', type: 'TEXT' },
            { name: 'cable_length', type: 'INTEGER' },
            { name: 'port_number', type: 'INTEGER' },
            { name: 'cable_status', type: 'TEXT DEFAULT "connected"' },
            { name: 'cable_notes', type: 'TEXT' }
        ];

        cableFields.forEach(field => {
            this.db.run(`ALTER TABLE customers ADD COLUMN ${field.name} ${field.type}`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error(`Error adding ${field.name} column:`, err);
                } else if (!err) {
                    console.log(`Added ${field.name} column to customers table`);
                }
            });
        });
    }

    createTablesSequentially(tables) {
        let currentIndex = 0;
        
        const createNextTable = () => {
            if (currentIndex >= tables.length) {
                // All tables created, now add columns and create indexes/triggers
                this.addColumnsAndCreateIndexes();
                return;
            }
            
            const tableSQL = tables[currentIndex];
            this.db.run(tableSQL, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                }
                currentIndex++;
                createNextTable();
            });
        };
        
        createNextTable();
    }

    addColumnsAndCreateIndexes() {
        // Tambahkan kolom customer_id jika belum ada (ID Pelanggan 6 digit)
        this.db.run("ALTER TABLE customers ADD COLUMN customer_id TEXT UNIQUE", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding customer_id column:', err);
            } else if (!err) {
                console.log('Added customer_id column to customers table');
                // Generate customer_id untuk customer yang sudah ada
                this.generateCustomerIdsForExistingCustomers();
            }
        });
        
        // Buat index untuk customer_id
        this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id)", (err) => {
            if (err) {
                console.error('Error creating index for customer_id:', err);
            }
        });
        
        // Tambahkan kolom pppoe_username jika belum ada
        this.db.run("ALTER TABLE customers ADD COLUMN pppoe_username TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding pppoe_username column:', err);
            }
        });

        // Tambahkan kolom payment_gateway jika belum ada
        this.db.run("ALTER TABLE invoices ADD COLUMN payment_gateway TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding payment_gateway column:', err);
            }
        });

        // Tambahkan kolom payment_token jika belum ada
        this.db.run("ALTER TABLE invoices ADD COLUMN payment_token TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding payment_token column:', err);
            }
        });

        // Tambahkan kolom payment_url jika belum ada
        this.db.run("ALTER TABLE invoices ADD COLUMN payment_url TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding payment_url column:', err);
            }
        });

        // Tambahkan kolom image ke packages jika belum ada
        this.db.run("ALTER TABLE packages ADD COLUMN image TEXT", (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding image column to packages:', err);
            } else if (!err) {
                console.log('Added image column to packages table');
            }
        });

        // Buat index untuk tabel ODP dan Cable Network
        this.createODPIndexes();
        
        // Buat trigger untuk tabel ODP dan Cable Network
        this.createODPTriggers();
    }

    createODPIndexes() {
        const indexes = [
            // Indexes untuk performa ODP dan Cable Network
            'CREATE INDEX IF NOT EXISTS idx_odps_location ON odps(latitude, longitude)',
            'CREATE INDEX IF NOT EXISTS idx_odps_status ON odps(status)',
            'CREATE INDEX IF NOT EXISTS idx_cable_routes_customer ON cable_routes(customer_id)',
            'CREATE INDEX IF NOT EXISTS idx_cable_routes_odp ON cable_routes(odp_id)',
            'CREATE INDEX IF NOT EXISTS idx_cable_routes_status ON cable_routes(status)',
            'CREATE INDEX IF NOT EXISTS idx_network_segments_start ON network_segments(start_odp_id)',
            'CREATE INDEX IF NOT EXISTS idx_network_segments_end ON network_segments(end_odp_id)',
            'CREATE INDEX IF NOT EXISTS idx_network_segments_status ON network_segments(status)',
            'CREATE INDEX IF NOT EXISTS idx_maintenance_logs_route ON cable_maintenance_logs(cable_route_id)',
            'CREATE INDEX IF NOT EXISTS idx_maintenance_logs_segment ON cable_maintenance_logs(network_segment_id)',
            'CREATE INDEX IF NOT EXISTS idx_maintenance_logs_date ON cable_maintenance_logs(maintenance_date)'
        ];

        indexes.forEach(indexSQL => {
            this.db.run(indexSQL, (err) => {
                if (err) {
                    console.error('Error creating ODP index:', err);
                }
            });
        });
    }

    createODPTriggers() {
        const triggers = [
            // Triggers untuk update timestamp
            `CREATE TRIGGER IF NOT EXISTS update_odps_updated_at 
                AFTER UPDATE ON odps
                FOR EACH ROW
            BEGIN
                UPDATE odps SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END`,
            
            `CREATE TRIGGER IF NOT EXISTS update_cable_routes_updated_at 
                AFTER UPDATE ON cable_routes
                FOR EACH ROW
            BEGIN
                UPDATE cable_routes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END`,
            
            `CREATE TRIGGER IF NOT EXISTS update_network_segments_updated_at 
                AFTER UPDATE ON network_segments
                FOR EACH ROW
            BEGIN
                UPDATE network_segments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END`,
            
            `CREATE TRIGGER IF NOT EXISTS update_odp_connections_updated_at 
                AFTER UPDATE ON odp_connections
                FOR EACH ROW
            BEGIN
                UPDATE odp_connections SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END`,
            
            // Triggers untuk update used_ports di ODP
            `CREATE TRIGGER IF NOT EXISTS update_odp_used_ports_insert
                AFTER INSERT ON cable_routes
                FOR EACH ROW
            BEGIN
                UPDATE odps SET used_ports = used_ports + 1 WHERE id = NEW.odp_id;
            END`,
            
            `CREATE TRIGGER IF NOT EXISTS update_odp_used_ports_delete
                AFTER DELETE ON cable_routes
                FOR EACH ROW
            BEGIN
                UPDATE odps SET used_ports = used_ports - 1 WHERE id = OLD.odp_id;
            END`,

            // Trigger untuk memutakhirkan used_ports saat cable_routes berpindah ODP
            `CREATE TRIGGER IF NOT EXISTS update_odp_used_ports_change
                AFTER UPDATE OF odp_id ON cable_routes
                FOR EACH ROW
                WHEN NEW.odp_id IS NOT OLD.odp_id
            BEGIN
                UPDATE odps SET used_ports = used_ports - 1 WHERE id = OLD.odp_id;
                UPDATE odps SET used_ports = used_ports + 1 WHERE id = NEW.odp_id;
            END`
        ];

        triggers.forEach(triggerSQL => {
            this.db.run(triggerSQL, (err) => {
                if (err) {
                    console.error('Error creating ODP trigger:', err);
                }
            });
        });
    }

    // Paket Management
    async createPackage(packageData) {
        return new Promise((resolve, reject) => {
            // Add columns if they don't exist (migration)
            const migrations = [
                'router_id INTEGER',
                'nas_ip TEXT',
                'upload_limit TEXT',
                'download_limit TEXT',
                'burst_limit_upload TEXT',
                'burst_limit_download TEXT',
                'burst_threshold TEXT',
                'burst_time TEXT'
            ];
            
            migrations.forEach(col => {
                this.db.run(`ALTER TABLE packages ADD COLUMN ${col}`, (err) => {
                    // Ignore error if column already exists
                });
            });
            
            const { 
                name, speed, price, tax_rate, description, pppoe_profile, image, router_id, nas_ip,
                upload_limit, download_limit, burst_limit_upload, burst_limit_download, 
                burst_threshold, burst_time 
            } = packageData;
            
            const sql = `INSERT INTO packages (
                name, speed, price, tax_rate, description, pppoe_profile, image, router_id, nas_ip,
                upload_limit, download_limit, burst_limit_upload, burst_limit_download, 
                burst_threshold, burst_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            this.db.run(sql, [
                name, 
                speed, 
                price, 
                tax_rate !== undefined ? tax_rate : 11.00, 
                description, 
                pppoe_profile || 'default', 
                image || null, 
                router_id || null,
                nas_ip || null,
                upload_limit || null,
                download_limit || null,
                burst_limit_upload || null,
                burst_limit_download || null,
                burst_threshold || null,
                burst_time || null
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...packageData });
                }
            });
        });
    }

    async getPackages() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM packages WHERE is_active = 1 ORDER BY price ASC`;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getPackageById(id) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM packages WHERE id = ?`;
            
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async updatePackage(id, packageData) {
        return new Promise((resolve, reject) => {
            // Add columns if they don't exist (migration)
            const migrations = [
                'router_id INTEGER',
                'nas_ip TEXT',
                'upload_limit TEXT',
                'download_limit TEXT',
                'burst_limit_upload TEXT',
                'burst_limit_download TEXT',
                'burst_threshold TEXT',
                'burst_time TEXT'
            ];
            
            migrations.forEach(col => {
                this.db.run(`ALTER TABLE packages ADD COLUMN ${col}`, (err) => {
                    // Ignore error if column already exists
                });
            });
            
            const { 
                name, speed, price, tax_rate, description, pppoe_profile, image, router_id, nas_ip,
                upload_limit, download_limit, burst_limit_upload, burst_limit_download, 
                burst_threshold, burst_time 
            } = packageData;
            
            const sql = `UPDATE packages SET 
                name = ?, speed = ?, price = ?, tax_rate = ?, description = ?, pppoe_profile = ?, 
                image = ?, router_id = ?, nas_ip = ?,
                upload_limit = ?, download_limit = ?, burst_limit_upload = ?, burst_limit_download = ?,
                burst_threshold = ?, burst_time = ?
                WHERE id = ?`;
            
            this.db.run(sql, [
                name, 
                speed, 
                price, 
                tax_rate || 0, 
                description, 
                pppoe_profile || 'default', 
                image || null, 
                router_id || null,
                nas_ip || null,
                upload_limit || null,
                download_limit || null,
                burst_limit_upload || null,
                burst_limit_download || null,
                burst_threshold || null,
                burst_time || null,
                id
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, ...packageData });
                }
            });
        });
    }

    async deletePackage(id) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE packages SET is_active = 0 WHERE id = ?`;
            
            this.db.run(sql, [id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, deleted: true });
                }
            });
        });
    }

    // Customer Management
    async createCustomer(customerData) {
        return new Promise(async (resolve, reject) => {
            // Pastikan database sudah siap
            if (!this.db) {
                console.error('❌ Database not initialized');
                return reject(new Error('Database not initialized'));
            }
            
            // Simpan reference database untuk digunakan di callback
            const db = this.db;
            
            const { name, username, phone, pppoe_username, email, address, package_id, odp_id, pppoe_profile, status, auto_suspension, billing_day, static_ip, assigned_ip, mac_address, latitude, longitude, cable_type, cable_length, port_number, cable_status, cable_notes, ktp_photo_path, house_photo_path } = customerData;
            
            // Use provided username, fallback to auto-generate if not provided
            const finalUsername = username || this.generateUsername(phone);
            const autoPPPoEUsername = pppoe_username || this.generatePPPoEUsername(phone);
            
            // Generate customer_id (6 digit numerik)
            let generatedCustomerId;
            try {
                generatedCustomerId = await this.generateCustomerId();
            } catch (genErr) {
                console.error('Error generating customer_id:', genErr);
                return reject(new Error('Failed to generate customer ID'));
            }
            
            // Normalisasi billing_day (1-28)
            const normBillingDay = Math.min(Math.max(parseInt(billing_day ?? 15, 10) || 15, 1), 28);
            
            // Pastikan status 'register' tidak di-override
            // Jika status sudah diset (termasuk 'register'), gunakan itu
            // Jika tidak, default ke 'active'
            const finalStatus = (status !== undefined && status !== null && status !== '') ? status : 'active';
            
            const sql = `INSERT INTO customers (customer_id, username, name, phone, pppoe_username, email, address, package_id, odp_id, pppoe_profile, status, auto_suspension, billing_day, static_ip, assigned_ip, mac_address, latitude, longitude, cable_type, cable_length, port_number, cable_status, cable_notes, ktp_photo_path, house_photo_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            // Default coordinates untuk Jakarta jika tidak ada koordinat
            const finalLatitude = latitude !== undefined ? parseFloat(latitude) : -6.2088;
            const finalLongitude = longitude !== undefined ? parseFloat(longitude) : 106.8456;
            
            db.run(sql, [generatedCustomerId, finalUsername, name, phone, autoPPPoEUsername, email, address, package_id, customerData.odp_id || null, pppoe_profile, finalStatus, auto_suspension !== undefined ? auto_suspension : 1, normBillingDay, static_ip || null, assigned_ip || null, mac_address || null, finalLatitude, finalLongitude, cable_type || null, cable_length || null, port_number || null, cable_status || 'connected', cable_notes || null, ktp_photo_path || null, house_photo_path || null], async function(err) {
                if (err) {
                    reject(err);
                } else {
                    const customer = { id: this.lastID, ...customerData };
                    
                    // Jika ada data ODP, buat cable route otomatis
                    if (odp_id) {
                        console.log(`🔧 Creating cable route for new customer ${finalUsername}, odp_id: ${odp_id}, cable_type: ${cable_type}`);
                        try {
                            // Insert cable route langsung ke database
                            const cableRouteSql = `
                                INSERT INTO cable_routes (customer_id, odp_id, cable_type, cable_length, port_number, status, notes)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `;
                            
                            db.run(cableRouteSql, [
                                this.lastID,
                                odp_id,
                                cable_type || 'Fiber Optic',
                                cable_length || 0,
                                port_number || 1,
                                cable_status || 'connected',
                                cable_notes || `Auto-created for customer ${name}`
                            ], function(err) {
                                if (err) {
                                    console.error(`❌ Error creating cable route for customer ${finalUsername}:`, err.message);
                                } else {
                                    console.log(`✅ Successfully created cable route for customer ${finalUsername}`);
                                }
                            });
                        } catch (cableError) {
                            console.error(`❌ Error creating cable route for customer ${finalUsername}:`, cableError.message);
                            // Jangan reject, karena customer sudah berhasil dibuat di billing
                        }
                    }
                    
                    // Jika ada nomor telepon dan PPPoE username, coba tambahkan tag ke GenieACS
                    // Tambahkan timeout dan error handling untuk mencegah delay
                    if (phone && autoPPPoEUsername) {
                        try {
                            // Timeout untuk operasi GenieACS
                            const genieacsPromise = new Promise(async (resolve, reject) => {
                                const timeout = setTimeout(() => reject(new Error('GenieACS operation timeout')), 3000); // 3 second timeout
                                
                                try {
                                    const genieacs = require('./genieacs');
                                    // Cari device berdasarkan PPPoE Username
                                    const device = await genieacs.findDeviceByPPPoE(autoPPPoEUsername);
                                    
                                    if (device) {
                                        // Tambahkan tag nomor telepon ke device
                                        await genieacs.addTagToDevice(device._id, phone);
                                        console.log(`✅ Successfully added phone tag ${phone} to device ${device._id} for customer ${finalUsername} (PPPoE: ${autoPPPoEUsername})`);
                                    } else {
                                        console.log(`ℹ️ No device found with PPPoE Username ${autoPPPoEUsername} for customer ${finalUsername} - this is normal for new customers`);
                                    }
                                    clearTimeout(timeout);
                                    resolve();
                                } catch (genieacsError) {
                                    clearTimeout(timeout);
                                    reject(genieacsError);
                                }
                            });
                            
                            await genieacsPromise;
                        } catch (genieacsError) {
                            console.log(`⚠️ GenieACS integration skipped for customer ${finalUsername} (timeout or error): ${genieacsError.message}`);
                            // Jangan reject, karena customer sudah berhasil dibuat di billing
                        }
                    } else if (phone && finalUsername) {
                        // Fallback: coba dengan username jika pppoe_username tidak ada
                        try {
                            // Timeout untuk operasi GenieACS
                            const genieacsPromise = new Promise(async (resolve, reject) => {
                                const timeout = setTimeout(() => reject(new Error('GenieACS operation timeout')), 3000); // 3 second timeout
                                
                                try {
                                    const genieacs = require('./genieacs');
                                    const device = await genieacs.findDeviceByPPPoE(finalUsername);
                                    
                                    if (device) {
                                        await genieacs.addTagToDevice(device._id, phone);
                                        console.log(`✅ Successfully added phone tag ${phone} to device ${device._id} for customer ${finalUsername} (using username as PPPoE)`);
                                    } else {
                                        console.log(`ℹ️ No device found with PPPoE Username ${finalUsername} for customer ${finalUsername} - this is normal for new customers`);
                                    }
                                    clearTimeout(timeout);
                                    resolve();
                                } catch (genieacsError) {
                                    clearTimeout(timeout);
                                    reject(genieacsError);
                                }
                            });
                            
                            await genieacsPromise;
                        } catch (genieacsError) {
                            console.log(`⚠️ GenieACS integration skipped for customer ${finalUsername} (timeout or error): ${genieacsError.message}`);
                        }
                    }
                    
                    resolve(customer);
                }
            });
        });
    }

    async getCustomers() {
        return new Promise(async (resolve, reject) => {
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.image as package_image, p.tax_rate,
                       c.latitude, c.longitude,
                       r.name as router_name,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id
                LEFT JOIN customer_router_map m ON m.customer_id = c.id
                LEFT JOIN routers r ON r.id = m.router_id
                ORDER BY c.name ASC
            `;
            
            this.db.all(sql, [], async (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Calculate price with tax for each customer
                    let processedRows = rows.map(row => {
                        if (row.package_price && row.tax_rate !== null) {
                            row.package_price = this.calculatePriceWithTax(row.package_price, row.tax_rate);
                        }
                        return row;
                    });
                    
                    // Jika menggunakan RADIUS mode, ambil profil dari RADIUS untuk customer yang punya pppoe_username
                    try {
                        const { getUserAuthModeAsync, getRadiusConnection } = require('./mikrotik');
                        const authMode = await getUserAuthModeAsync();
                        
                        if (authMode === 'radius') {
                            const radiusConn = await getRadiusConnection();
                            
                            // Kumpulkan semua pppoe_username yang valid
                            const pppUsers = processedRows
                                .map(c => (c.pppoe_username && String(c.pppoe_username).trim()) || (c.username && String(c.username).trim()))
                                .filter(u => u && u.length > 0);
                            
                            if (pppUsers.length > 0) {
                                // Batch query: ambil semua group sekaligus
                                const placeholders = pppUsers.map(() => '?').join(',');
                                const [allGroups] = await radiusConn.execute(
                                    `SELECT username, groupname FROM radusergroup WHERE username IN (${placeholders})`,
                                    pppUsers
                                );
                                
                                // Buat map untuk lookup cepat
                                // Jika user punya multiple groups, ambil yang pertama (biasanya hanya satu group per user)
                                const profileMap = new Map();
                                allGroups.forEach(g => {
                                    // Set group pertama yang ditemukan untuk setiap username
                                    // Jika ada multiple, yang terakhir akan menang (tapi seharusnya hanya satu)
                                    profileMap.set(g.username, g.groupname);
                                });
                                
                                // Update profil untuk setiap customer
                                processedRows.forEach(customer => {
                                    const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || 
                                                   (customer.username && String(customer.username).trim());
                                    
                                    if (pppUser && profileMap.has(pppUser)) {
                                        // Gunakan profil dari RADIUS (ini adalah profil yang sebenarnya digunakan)
                                        customer.pppoe_profile = profileMap.get(pppUser);
                                        customer.pppoe_profile_source = 'radius'; // Flag untuk tracking
                                    }
                                });
                            }
                            
                            await radiusConn.end();
                        }
                    } catch (authError) {
                        // Jika error saat cek auth mode, tetap gunakan dari billing database
                        // logger.warn(`Failed to check auth mode or get RADIUS profiles: ${authError.message}`);
                    }
                    
                    resolve(processedRows);
                }
            });
        });
    }

    // OPTIMASI: Get customers dengan pagination untuk menghindari load semua data sekaligus
    async getCustomersPaginated(limit = 50, offset = 0, filters = {}) {
        return new Promise(async (resolve, reject) => {
            // Build WHERE clause dari filters
            let whereClause = '';
            const params = [];
            
            if (filters.status) {
                whereClause += ' AND c.status = ?';
                params.push(filters.status);
            }
            
            if (filters.search) {
                whereClause += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.pppoe_username LIKE ?)';
                const searchTerm = `%${filters.search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }
            
            if (filters.router_id) {
                whereClause += ' AND m.router_id = ?';
                params.push(filters.router_id);
            }

            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.image as package_image, p.tax_rate,
                       c.latitude, c.longitude,
                       r.name as router_name,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id
                LEFT JOIN customer_router_map m ON m.customer_id = c.id
                LEFT JOIN routers r ON r.id = m.router_id
                WHERE 1=1 ${whereClause}
                ORDER BY c.id DESC
                LIMIT ? OFFSET ?
            `;
            
            const queryParams = [...params, limit, offset];
            
            // Get total count untuk pagination
            const countSql = `
                SELECT COUNT(*) as total
                FROM customers c
                LEFT JOIN customer_router_map m ON m.customer_id = c.id
                WHERE 1=1 ${whereClause}
            `;
            
            this.db.get(countSql, params, async (err, countRow) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const totalCount = countRow ? countRow.total : 0;
                
                this.db.all(sql, queryParams, async (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Calculate price with tax for each customer
                        let processedRows = rows.map(row => {
                            if (row.package_price && row.tax_rate !== null) {
                                row.package_price = this.calculatePriceWithTax(row.package_price, row.tax_rate);
                            }
                            return row;
                        });
                        
                        // Jika menggunakan RADIUS mode, ambil profil dari RADIUS untuk customer yang punya pppoe_username
                        try {
                            const { getUserAuthModeAsync, getRadiusConnection } = require('./mikrotik');
                            const authMode = await getUserAuthModeAsync();
                            
                            if (authMode === 'radius' && processedRows.length > 0) {
                                const radiusConn = await getRadiusConnection();
                                
                                // Kumpulkan semua pppoe_username yang valid
                                const pppUsers = processedRows
                                    .map(c => (c.pppoe_username && String(c.pppoe_username).trim()) || (c.username && String(c.username).trim()))
                                    .filter(u => u && u.length > 0);
                                
                                if (pppUsers.length > 0) {
                                    // Batch query: ambil semua group sekaligus
                                    const placeholders = pppUsers.map(() => '?').join(',');
                                    const [allGroups] = await radiusConn.execute(
                                        `SELECT username, groupname FROM radusergroup WHERE username IN (${placeholders})`,
                                        pppUsers
                                    );
                                    
                                    // Buat map untuk lookup cepat
                                    const profileMap = new Map();
                                    allGroups.forEach(g => {
                                        profileMap.set(g.username, g.groupname);
                                    });
                                    
                                    // Update profil untuk setiap customer
                                    processedRows.forEach(customer => {
                                        const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || 
                                                       (customer.username && String(customer.username).trim());
                                        
                                        if (pppUser && profileMap.has(pppUser)) {
                                            customer.pppoe_profile = profileMap.get(pppUser);
                                            customer.pppoe_profile_source = 'radius';
                                        }
                                    });
                                }
                                
                                await radiusConn.end();
                            }
                        } catch (authError) {
                            // Jika error saat cek auth mode, tetap gunakan dari billing database
                        }
                        
                        resolve({
                            customers: processedRows,
                            totalCount: totalCount,
                            page: Math.floor(offset / limit) + 1,
                            totalPages: Math.ceil(totalCount / limit),
                            limit: limit,
                            offset: offset
                        });
                    }
                });
            });
        });
    }

    async getCustomerByUsername(username) {
        return new Promise((resolve, reject) => {
            // Cari di kedua kolom: username dan pppoe_username
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed, p.image as package_image, p.tax_rate, p.pppoe_profile as package_pppoe_profile
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.username = ? OR c.pppoe_username = ?
            `;
            
            this.db.get(sql, [username, username], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row && row.package_price && row.tax_rate !== null) {
                        // Calculate price with tax for customer display
                        row.package_price = this.calculatePriceWithTax(row.package_price, row.tax_rate);
                    }
                    resolve(row);
                }
            });
        });
    }

    // Search customers by name, phone, or username
    async searchCustomers(searchTerm) {
        return new Promise((resolve, reject) => {
            const searchPattern = `%${searchTerm}%`;
            
            const sql = `
                SELECT id, username, name, phone, email, address, pppoe_username, 
                       package_id, status, created_at, updated_at
                FROM customers 
                WHERE name LIKE ? OR phone LIKE ? OR username LIKE ? OR pppoe_username LIKE ?
                ORDER BY name ASC
                LIMIT 20
            `;
            
            this.db.all(sql, [searchPattern, searchPattern, searchPattern, searchPattern], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    // Get customer by ID
    async getCustomerById(id) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT c.*, p.name as package_name, p.speed, p.price, p.image as package_image
                FROM customers c
                LEFT JOIN packages p ON c.package_id = p.id
                WHERE c.id = ?
            `;
            
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    // Get customer by customer_id (6 digit ID)
    async getCustomerByCustomerId(customerId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed, p.image as package_image, p.tax_rate
                FROM customers c
                LEFT JOIN packages p ON c.package_id = p.id
                WHERE c.customer_id = ?
            `;
            
            this.db.get(sql, [customerId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    async getCustomerByPhone(phone) {
        return new Promise((resolve, reject) => {
            try {
                // Normalisasi nomor telepon ke beberapa varian agar lookup fleksibel
                const digitsOnly = (phone || '').toString().replace(/\D/g, '');
                const intl = digitsOnly.startsWith('62')
                    ? digitsOnly
                    : (digitsOnly.startsWith('0') ? ('62' + digitsOnly.slice(1)) : digitsOnly);
                const local08 = digitsOnly.startsWith('62')
                    ? ('0' + digitsOnly.slice(2))
                    : (digitsOnly.startsWith('0') ? digitsOnly : ('0' + digitsOnly));

                const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed, p.image as package_image, p.tax_rate,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.phone = ? OR c.phone = ? OR c.phone = ?
            `;

                // Prioritaskan pencarian berdasarkan varian yang umum: intl, local, original digits
                this.db.get(sql, [intl, local08, digitsOnly], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (row && row.package_price && row.tax_rate !== null) {
                            // Calculate price with tax for customer display
                            row.package_price = this.calculatePriceWithTax(row.package_price, row.tax_rate);
                        }
                        resolve(row || null);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async getCustomerByNameOrPhone(searchTerm) {
        return new Promise((resolve, reject) => {
            // Bersihkan nomor telefon (hapus karakter non-digit)
            const cleanPhone = searchTerm.replace(/\D/g, '');
            
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed, p.tax_rate,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.phone = ? 
                   OR c.name LIKE ? 
                   OR c.username LIKE ?
                ORDER BY 
                    CASE 
                        WHEN c.phone = ? THEN 1
                        WHEN c.name = ? THEN 2
                        WHEN c.name LIKE ? THEN 3
                        WHEN c.username LIKE ? THEN 4
                        ELSE 5
                    END
                LIMIT 1
            `;
            
            const likeTerm = `%${searchTerm}%`;
            const params = [
                cleanPhone,           // Exact phone match
                likeTerm,            // Name LIKE
                likeTerm,            // Username LIKE
                cleanPhone,          // ORDER BY phone exact
                searchTerm,          // ORDER BY name exact
                `${searchTerm}%`,    // ORDER BY name starts with
                likeTerm             // ORDER BY username LIKE
            ];
            
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row && row.package_price && row.tax_rate !== null) {
                        // Calculate price with tax for customer display
                        row.package_price = this.calculatePriceWithTax(row.package_price, row.tax_rate);
                    }
                    resolve(row);
                }
            });
        });
    }

    async findCustomersByNameOrPhone(searchTerm) {
        return new Promise((resolve, reject) => {
            // Bersihkan nomor telefon (hapus karakter non-digit) 
            const cleanPhone = searchTerm.replace(/\D/g, '');
            
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.phone = ? 
                   OR c.name LIKE ? 
                   OR c.username LIKE ?
                ORDER BY 
                    CASE 
                        WHEN c.phone = ? THEN 1
                        WHEN c.name = ? THEN 2
                        WHEN c.name LIKE ? THEN 3
                        WHEN c.username LIKE ? THEN 4
                        ELSE 5
                    END
                LIMIT 5
            `;
            
            const likeTerm = `%${searchTerm}%`;
            const params = [
                cleanPhone,           // Exact phone match
                likeTerm,            // Name LIKE
                likeTerm,            // Username LIKE
                cleanPhone,          // ORDER BY phone exact
                searchTerm,          // ORDER BY name exact
                `${searchTerm}%`,    // ORDER BY name starts with
                likeTerm             // ORDER BY username LIKE
            ];
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async updateCustomer(phone, customerData) {
        return this.updateCustomerByPhone(phone, customerData);
    }

    async updateCustomerByPhone(oldPhone, customerData) {
        return new Promise(async (resolve, reject) => {
            // Pastikan database sudah siap
            if (!this.db) {
                console.error('Database not initialized');
                return reject(new Error('Database not initialized'));
            }
            
            // Simpan reference database untuk digunakan di callback
            const db = this.db;
            
            const { name, username, phone, pppoe_username, email, address, package_id, odp_id, pppoe_profile, status, auto_suspension, billing_day, renewal_type, fix_date, latitude, longitude, cable_type, cable_length, port_number, cable_status, cable_notes, ktp_photo_path, house_photo_path } = customerData;
            
            // Dapatkan data customer lama untuk membandingkan nomor telepon
            try {
                const oldCustomer = await this.getCustomerByPhone(oldPhone);
                if (!oldCustomer) {
                    return reject(new Error('Pelanggan tidak ditemukan'));
                }
                
                const oldPPPoE = oldCustomer ? oldCustomer.pppoe_username : null;
                
                // Normalisasi billing_day (1-28) dengan fallback ke nilai lama atau 15
                const normBillingDay = Math.min(Math.max(parseInt(billing_day !== undefined ? billing_day : (oldCustomer?.billing_day ?? 15), 10) || 15, 1), 28);
                
                // Normalisasi renewal_type dan fix_date
                const normRenewalType = renewal_type || oldCustomer.renewal_type || 'renewal';
                const normFixDate = renewal_type === 'fix_date' ? 
                    (fix_date !== undefined ? Math.min(Math.max(parseInt(fix_date, 10) || 15, 1), 28) : (oldCustomer.fix_date || 15)) : 
                    null;
                
                const sql = `UPDATE customers SET name = ?, username = ?, phone = ?, pppoe_username = ?, email = ?, address = ?, package_id = ?, odp_id = ?, pppoe_profile = ?, status = ?, auto_suspension = ?, billing_day = ?, renewal_type = ?, fix_date = ?, latitude = ?, longitude = ?, cable_type = ?, cable_length = ?, port_number = ?, cable_status = ?, cable_notes = ?, ktp_photo_path = ?, house_photo_path = ? WHERE id = ?`;
                
                db.run(sql, [
                    name !== undefined ? name : oldCustomer.name, 
                    username || oldCustomer.username, 
                    phone || oldPhone, 
                    pppoe_username !== undefined ? pppoe_username : oldCustomer.pppoe_username, 
                    email !== undefined ? email : oldCustomer.email, 
                    address !== undefined ? address : oldCustomer.address, 
                    package_id !== undefined ? package_id : oldCustomer.package_id, 
                    odp_id !== undefined ? odp_id : oldCustomer.odp_id,
                    pppoe_profile !== undefined ? pppoe_profile : oldCustomer.pppoe_profile, 
                    status !== undefined ? status : oldCustomer.status, 
                    auto_suspension !== undefined ? auto_suspension : oldCustomer.auto_suspension, 
                    normBillingDay,
                    normRenewalType,
                    normFixDate,
                    latitude !== undefined ? parseFloat(latitude) : oldCustomer.latitude,
                    longitude !== undefined ? parseFloat(longitude) : oldCustomer.longitude,
                    cable_type !== undefined ? cable_type : oldCustomer.cable_type,
                    cable_length !== undefined ? cable_length : oldCustomer.cable_length,
                    port_number !== undefined ? port_number : oldCustomer.port_number,
                    cable_status !== undefined ? cable_status : oldCustomer.cable_status,
                    cable_notes !== undefined ? cable_notes : oldCustomer.cable_notes,
                    ktp_photo_path !== undefined ? ktp_photo_path : oldCustomer.ktp_photo_path,
                    house_photo_path !== undefined ? house_photo_path : oldCustomer.house_photo_path,
                    oldCustomer.id
                ], async function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        // Jika nomor telepon atau PPPoE username berubah, update tag di GenieACS
                        const newPhone = phone || oldPhone;
                        if (newPhone && (newPhone !== oldPhone || pppoe_username !== oldPPPoE)) {
                            try {
                                // Timeout untuk operasi GenieACS
                                const genieacsPromise = new Promise(async (resolve, reject) => {
                                    const timeout = setTimeout(() => reject(new Error('GenieACS operation timeout')), 3000); // 3 second timeout
                                    
                                    try {
                                        const genieacs = require('./genieacs');
                                        
                                        // Hapus tag lama jika ada
                                        if (oldPhone && oldPPPoE) {
                                            try {
                                                const oldDevice = await genieacs.findDeviceByPPPoE(oldPPPoE);
                                                if (oldDevice) {
                                                    await genieacs.removeTagFromDevice(oldDevice._id, oldPhone);
                                                    console.log(`Removed old phone tag ${oldPhone} from device ${oldDevice._id} for customer ${oldCustomer.username}`);
                                                }
                                            } catch (error) {
                                                console.warn(`Error removing old phone tag for customer ${oldCustomer.username}:`, error.message);
                                            }
                                        }
                                        
                                        // Tambahkan tag baru
                                        const pppoeToUse = pppoe_username || oldCustomer.username; // Fallback ke username jika pppoe_username kosong
                                        const device = await genieacs.findDeviceByPPPoE(pppoeToUse);
                                        
                                        if (device) {
                                            await genieacs.addTagToDevice(device._id, newPhone);
                                            console.log(`Successfully updated phone tag to ${newPhone} for device ${device._id} and customer ${oldCustomer.username} (PPPoE: ${pppoeToUse})`);
                                        } else {
                                            console.warn(`No device found with PPPoE Username ${pppoeToUse} for customer ${oldCustomer.username}`);
                                        }
                                        clearTimeout(timeout);
                                        resolve();
                                    } catch (genieacsError) {
                                        clearTimeout(timeout);
                                        reject(genieacsError);
                                    }
                                });
                                
                                await genieacsPromise;
                            } catch (genieacsError) {
                                console.error(`Error updating phone tag in GenieACS for customer ${oldCustomer.username} (timeout or error):`, genieacsError.message);
                                // Jangan reject, karena customer sudah berhasil diupdate di billing
                            }
                        }
                        
                        // Jika ada data ODP atau field kabel yang berubah, update cable route
                        if (
                            odp_id !== undefined ||
                            cable_type !== undefined ||
                            cable_length !== undefined ||
                            port_number !== undefined ||
                            cable_status !== undefined ||
                            cable_notes !== undefined
                        ) {
                            console.log(`🔧 Updating cable route for customer ${oldCustomer.username}, odp_id: ${odp_id}, cable_type: ${cable_type}`);
                            try {
                                const customerId = oldCustomer.id;
                                
                                // Cari cable route yang ada
                                const existingRoute = await new Promise((resolve, reject) => {
                                    db.get('SELECT * FROM cable_routes WHERE customer_id = ?', [customerId], (err, row) => {
                                        if (err) reject(err);
                                        else resolve(row);
                                    });
                                });
                                
                                if (existingRoute) {
                                    // Update cable route yang ada
                                    console.log(`📝 Found existing cable route for customer ${oldCustomer.username}, updating...`);
                                    console.log(`🔧 ODP: ${odp_id !== undefined ? odp_id : existingRoute.odp_id}, Port: ${port_number !== undefined ? port_number : existingRoute.port_number}`);
                                    const updateSql = `
                                        UPDATE cable_routes 
                                        SET odp_id = ?, cable_type = ?, cable_length = ?, port_number = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                                        WHERE customer_id = ?
                                    `;
                                    
                                    db.run(updateSql, [
                                        odp_id !== undefined ? odp_id : existingRoute.odp_id,
                                        cable_type !== undefined ? cable_type : existingRoute.cable_type,
                                        cable_length !== undefined ? cable_length : existingRoute.cable_length,
                                        port_number !== undefined ? port_number : existingRoute.port_number,
                                        cable_status !== undefined ? cable_status : existingRoute.status,
                                        cable_notes !== undefined ? cable_notes : existingRoute.notes,
                                        customerId
                                    ], function(err) {
                                        if (err) {
                                            console.error(`❌ Error updating cable route for customer ${oldCustomer.username}:`, err.message);
                                        } else {
                                            console.log(`✅ Successfully updated cable route for customer ${oldCustomer.username}`);
                                        }
                                    });
                                } else if (odp_id) {
                                    // Buat cable route baru jika belum ada
                                    console.log(`📝 Creating new cable route for customer ${oldCustomer.username}...`);
                                    const cableRouteSql = `
                                        INSERT INTO cable_routes (customer_id, odp_id, cable_type, cable_length, port_number, status, notes)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    `;
                                    
                                    db.run(cableRouteSql, [
                                        customerId,
                                        odp_id,
                                        cable_type || 'Fiber Optic',
                                        cable_length || 0,
                                        port_number || 1,
                                        cable_status || 'connected',
                                        cable_notes || `Auto-created for customer ${name}`
                                    ], function(err) {
                                        if (err) {
                                            console.error(`❌ Error creating cable route for customer ${oldCustomer.username}:`, err.message);
                                        } else {
                                            console.log(`✅ Successfully created cable route for customer ${oldCustomer.username}`);
                                        }
                                    });
                                }
                            } catch (cableError) {
                                console.error(`❌ Error handling cable route for customer ${oldCustomer.username}:`, cableError.message);
                                // Jangan reject, karena customer sudah berhasil diupdate di billing
                            }
                        }
                        
                        resolve({ username: oldCustomer.username, ...customerData });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async deleteCustomer(phone) {
        return new Promise(async (resolve, reject) => {
            try {
                // Dapatkan data customer sebelum dihapus
                const customer = await this.getCustomerByPhone(phone);
                if (!customer) {
                    reject(new Error('Pelanggan tidak ditemukan'));
                    return;
                }

                // Cek apakah ada invoice yang terkait dengan customer ini
                const invoices = await this.getInvoicesByCustomer(customer.id);
                if (invoices && invoices.length > 0) {
                    reject(new Error(`Tidak dapat menghapus pelanggan: ${invoices.length} tagihan masih ada untuk pelanggan ini. Silakan hapus semua tagihan terlebih dahulu.`));
                    return;
                }

                // Hapus cable routes terlebih dahulu (akan dihapus otomatis karena CASCADE)
                // Tapi kita hapus manual untuk memastikan trigger ODP used_ports berjalan
                const deleteCableRoutesSql = `DELETE FROM cable_routes WHERE customer_id = ?`;
                this.db.run(deleteCableRoutesSql, [customer.id], function(err) {
                    if (err) {
                        console.error(`❌ Error deleting cable routes for customer ${customer.username}:`, err.message);
                    } else {
                        console.log(`✅ Successfully deleted cable routes for customer ${customer.username}`);
                    }
                });

                const sql = `DELETE FROM customers WHERE phone = ?`;
                
                this.db.run(sql, [phone], async function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        // Hapus tag dari GenieACS jika ada nomor telepon
                        if (customer.phone) {
                            try {
                                const genieacs = require('./genieacs');
                                const pppoeToUse = customer.pppoe_username || customer.username; // Fallback ke username jika pppoe_username kosong
                                const device = await genieacs.findDeviceByPPPoE(pppoeToUse);
                                
                                if (device) {
                                    await genieacs.removeTagFromDevice(device._id, customer.phone);
                                    console.log(`Removed phone tag ${customer.phone} from device ${device._id} for deleted customer ${customer.username} (PPPoE: ${pppoeToUse})`);
                                } else {
                                    console.warn(`No device found with PPPoE Username ${pppoeToUse} for deleted customer ${customer.username}`);
                                }
                            } catch (genieacsError) {
                                console.error(`Error removing phone tag from GenieACS for deleted customer ${customer.username}:`, genieacsError.message);
                                // Jangan reject, karena customer sudah berhasil dihapus di billing
                                // Log error tapi lanjutkan proses
                            }
                        }
                        
                        resolve({ username: customer.username, deleted: true });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async deleteCustomerById(id) {
        return new Promise(async (resolve, reject) => {
            try {
                // Dapatkan data customer sebelum dihapus
                const customer = await this.getCustomerById(id);
                if (!customer) {
                    reject(new Error('Pelanggan tidak ditemukan'));
                    return;
                }

                // Cek apakah ada invoice yang terkait dengan customer ini
                const invoices = await this.getInvoicesByCustomer(customer.id);
                if (invoices && invoices.length > 0) {
                    reject(new Error(`Tidak dapat menghapus pelanggan: ${invoices.length} tagihan masih ada untuk pelanggan ini. Silakan hapus semua tagihan terlebih dahulu.`));
                    return;
                }

                // Hapus cable routes terlebih dahulu (akan dihapus otomatis karena CASCADE)
                // Tapi kita hapus manual untuk memastikan trigger ODP used_ports berjalan
                const deleteCableRoutesSql = `DELETE FROM cable_routes WHERE customer_id = ?`;
                this.db.run(deleteCableRoutesSql, [customer.id], function(err) {
                    if (err) {
                        console.error(`❌ Error deleting cable routes for customer ${customer.username}:`, err.message);
                    } else {
                        console.log(`✅ Successfully deleted cable routes for customer ${customer.username}`);
                    }
                });

                const sql = `DELETE FROM customers WHERE id = ?`;
                
                this.db.run(sql, [id], async function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        // Hapus tag dari GenieACS jika ada nomor telepon
                        if (customer.phone) {
                            try {
                                const genieacs = require('./genieacs');
                                const pppoeToUse = customer.pppoe_username || customer.username; // Fallback ke username jika pppoe_username kosong
                                const device = await genieacs.findDeviceByPPPoE(pppoeToUse);
                                
                                if (device) {
                                    await genieacs.removeTagFromDevice(device._id, customer.phone);
                                    console.log(`Removed phone tag ${customer.phone} from device ${device._id} for deleted customer ${customer.username} (PPPoE: ${pppoeToUse})`);
                                } else {
                                    console.warn(`No device found with PPPoE Username ${pppoeToUse} for deleted customer ${customer.username}`);
                                }
                            } catch (genieacsError) {
                                console.error(`Error removing phone tag from GenieACS for deleted customer ${customer.username}:`, genieacsError.message);
                                // Jangan reject, karena customer sudah berhasil dihapus di billing
                                // Log error tapi lanjutkan proses
                            }
                        }
                        
                        resolve({ username: customer.username, deleted: true });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Helper function to calculate price with tax
    calculatePriceWithTax(price, taxRate) {
        if (!taxRate || taxRate === 0) {
            return Math.round(price);
        }
        const amount = price * (1 + taxRate / 100);
        return Math.round(amount); // Konsisten rounding untuk menghilangkan desimal
    }

    // Invoice Management
    async createInvoice(invoiceData) {
        return new Promise((resolve, reject) => {
            const { customer_id, package_id, amount, due_date, notes, base_amount, tax_rate, invoice_type = 'monthly' } = invoiceData;
            const invoice_number = this.generateInvoiceNumber();
            
            // Check if base_amount and tax_rate columns exist
            let sql, params;
            if (base_amount !== undefined && tax_rate !== undefined) {
                sql = `INSERT INTO invoices (customer_id, package_id, invoice_number, amount, base_amount, tax_rate, due_date, notes, invoice_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                params = [customer_id, package_id, invoice_number, amount, base_amount, tax_rate, due_date, notes, invoice_type];
            } else {
                sql = `INSERT INTO invoices (customer_id, package_id, invoice_number, amount, due_date, notes, invoice_type) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                params = [customer_id, package_id, invoice_number, amount, due_date, notes, invoice_type];
            }
            
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, invoice_number, ...invoiceData });
                }
            });
        });
    }

    async getInvoicesWithFilters(filters = {}, limit = null, offset = null) {
        return new Promise((resolve, reject) => {
            // Check if renewal_type and invoice_type columns exist
            this.db.all("PRAGMA table_info(customers)", (pragmaErr, customerColumns) => {
                if (pragmaErr) {
                    reject(pragmaErr);
                    return;
                }
                
                this.db.all("PRAGMA table_info(invoices)", (invoicePragmaErr, invoiceColumns) => {
                    if (invoicePragmaErr) {
                        reject(invoicePragmaErr);
                        return;
                    }
                    
                    const hasRenewalType = customerColumns.some(col => col.name === 'renewal_type');
                    const hasFixDate = customerColumns.some(col => col.name === 'fix_date');
                    const hasCustomerId = customerColumns.some(col => col.name === 'customer_id');
                    const hasInvoiceType = invoiceColumns.some(col => col.name === 'invoice_type');
                    
                    // Build SELECT clause based on column existence
                    let selectClause = `SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone`;
                    if (hasCustomerId) selectClause += `, c.customer_id`;
                    if (hasRenewalType) selectClause += `, c.renewal_type`;
                    if (hasFixDate) selectClause += `, c.fix_date`;
                    selectClause += `, p.name as package_name, p.speed as package_speed`;
                    
                    let sql = `
                        ${selectClause}
                        FROM invoices i
                        LEFT JOIN customers c ON i.customer_id = c.id
                        LEFT JOIN packages p ON i.package_id = p.id
                        WHERE 1=1
                    `;
                    
                    const params = [];
                    
                    // Filter by month if provided (format: YYYY-MM)
                    if (filters.month) {
                        sql += ` AND strftime('%Y-%m', i.created_at) = ?`;
                        params.push(filters.month);
                    }
                    
                    // Filter by customer username
                    if (filters.customer_username) {
                        sql += ` AND c.username LIKE ?`;
                        params.push(`%${filters.customer_username}%`);
                    }
                    
                    // Filter by status
                    if (filters.status) {
                        if (filters.status === 'overdue') {
                            sql += ` AND i.status = 'unpaid' AND DATE(i.due_date) < DATE('now')`;
                        } else if (filters.status === 'unpaid') {
                            sql += ` AND i.status = 'unpaid' AND DATE(i.due_date) >= DATE('now')`;
                        } else {
                            sql += ` AND i.status = ?`;
                            params.push(filters.status);
                        }
                    }
                    
                    // Filter by invoice type (only if columns exist)
                    if (filters.type) {
                        if (filters.type === 'monthly' && hasRenewalType) {
                            sql += ` AND c.renewal_type = 'renewal'`;
                        } else if (filters.type === 'fix_date' && hasRenewalType) {
                            sql += ` AND c.renewal_type = 'fix_date'`;
                        } else if (filters.type === 'manual' && hasInvoiceType) {
                            sql += ` AND i.invoice_type = 'manual'`;
                        }
                    }
            
                    sql += ` ORDER BY i.created_at DESC`;
                    
                    if (limit) {
                        sql += ` LIMIT ?`;
                        params.push(limit);
                        
                        if (offset) {
                            sql += ` OFFSET ?`;
                            params.push(offset);
                        }
                    }
                    
                    this.db.all(sql, params, (err, rows) => {
                        if (err) {
                            reject(err);
                        } else {
                            // Tambahkan informasi tipe tagihan dan next due date berdasarkan renewal_type dan status
                            const currentDate = new Date();
                            const currentMonth = currentDate.getMonth();
                            const currentYear = currentDate.getFullYear();
                            
                            const processedRows = rows.map(row => {
                                let invoiceType = 'Renewal';
                                let nextDueDate = null;
                                
                                // Handle missing renewal_type column
                                const renewalType = hasRenewalType ? (row.renewal_type || 'renewal') : 'renewal';
                                const fixDate = hasFixDate ? row.fix_date : null;
                                
                                if (renewalType === 'fix_date') {
                                    invoiceType = `Fix Date (${fixDate || 'N/A'})`;
                                } else {
                                    invoiceType = 'Renewal';
                                }
                                
                                // Hitung next due date untuk invoice yang sudah lunas
                                if (row.status === 'paid' && row.payment_date) {
                                    try {
                                        const customer = {
                                            renewal_type: renewalType,
                                            fix_date: fixDate
                                        };
                                        nextDueDate = this.calculateNextDueDate(customer, row.due_date, row.payment_date);
                                    } catch (error) {
                                        console.error('Error calculating next due date:', error);
                                    }
                                }
                                
                                return {
                                    ...row,
                                    renewal_type: renewalType,
                                    fix_date: fixDate,
                                    invoice_type: invoiceType,
                                    next_due_date: nextDueDate
                                };
                            });
                            
                            resolve(processedRows);
                        }
                    });
                });
            });
        });
    }

    async getInvoicesCountWithFilters(filters = {}) {
        return new Promise((resolve, reject) => {
            // Check if renewal_type and invoice_type columns exist
            this.db.all("PRAGMA table_info(customers)", (pragmaErr, customerColumns) => {
                if (pragmaErr) {
                    reject(pragmaErr);
                    return;
                }
                
                this.db.all("PRAGMA table_info(invoices)", (invoicePragmaErr, invoiceColumns) => {
                    if (invoicePragmaErr) {
                        reject(invoicePragmaErr);
                        return;
                    }
                    
                    const hasRenewalType = customerColumns.some(col => col.name === 'renewal_type');
                    const hasInvoiceType = invoiceColumns.some(col => col.name === 'invoice_type');
                    
                    const currentDate = new Date();
                    const currentMonth = currentDate.getMonth();
                    const currentYear = currentDate.getFullYear();
                    
                    // Hitung tanggal awal bulan berjalan saja (tidak termasuk bulan sebelumnya)
                    const currentMonthStart = new Date(currentYear, currentMonth, 1);
                    const currentMonthStartStr = currentMonthStart.toISOString().split('T')[0]; // Format: YYYY-MM-DD
                    
                    let sql = `
                        SELECT COUNT(*) as count
                        FROM invoices i
                        LEFT JOIN customers c ON i.customer_id = c.id
                        WHERE DATE(i.created_at) >= ?
                    `;
                    
                    const params = [currentMonthStartStr];
                    
                    // Filter by customer username
                    if (filters.customer_username) {
                        sql += ` AND c.username LIKE ?`;
                        params.push(`%${filters.customer_username}%`);
                    }
                    
                    // Filter by status
                    if (filters.status) {
                        if (filters.status === 'overdue') {
                            sql += ` AND i.status = 'unpaid' AND DATE(i.due_date) < DATE('now')`;
                        } else if (filters.status === 'unpaid') {
                            sql += ` AND i.status = 'unpaid' AND DATE(i.due_date) >= DATE('now')`;
                        } else {
                            sql += ` AND i.status = ?`;
                            params.push(filters.status);
                        }
                    }
                    
                    // Filter by invoice type (only if columns exist)
                    if (filters.type) {
                        if (filters.type === 'monthly' && hasRenewalType) {
                            sql += ` AND c.renewal_type = 'renewal'`;
                        } else if (filters.type === 'fix_date' && hasRenewalType) {
                            sql += ` AND c.renewal_type = 'fix_date'`;
                        } else if (filters.type === 'manual' && hasInvoiceType) {
                            sql += ` AND i.invoice_type = 'manual'`;
                        }
                    }
                    
                    this.db.get(sql, params, (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(row.count);
                        }
                    });
                });
            });
        });
    }

    async getInvoices(customerUsername = null, limit = null, offset = null) {
        return new Promise((resolve, reject) => {
            // Check if renewal_type and fix_date columns exist
            this.db.all("PRAGMA table_info(customers)", (pragmaErr, customerColumns) => {
                if (pragmaErr) {
                    reject(pragmaErr);
                    return;
                }
                
                const hasRenewalType = customerColumns.some(col => col.name === 'renewal_type');
                const hasFixDate = customerColumns.some(col => col.name === 'fix_date');
                const hasCustomerId = customerColumns.some(col => col.name === 'customer_id');
                
                // Build SELECT clause based on column existence
                let selectClause = `SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone`;
                if (hasCustomerId) selectClause += `, c.customer_id`;
                if (hasRenewalType) selectClause += `, c.renewal_type`;
                if (hasFixDate) selectClause += `, c.fix_date`;
                selectClause += `, p.name as package_name, p.speed as package_speed`;
                
                let sql = `
                    ${selectClause}
                    FROM invoices i
                    LEFT JOIN customers c ON i.customer_id = c.id
                    LEFT JOIN packages p ON i.package_id = p.id
                    WHERE 1=1
                `;
                
                const params = [];
                
                if (customerUsername) {
                    sql += ` AND c.username = ?`;
                    params.push(customerUsername);
                }
                
                sql += ` ORDER BY i.created_at DESC`;
                
                if (limit) {
                    sql += ` LIMIT ?`;
                    params.push(limit);
                    
                    if (offset) {
                        sql += ` OFFSET ?`;
                        params.push(offset);
                    }
                }
                
                this.db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Tambahkan informasi tipe tagihan dan next due date berdasarkan renewal_type dan status
                        const currentDate = new Date();
                        const currentMonth = currentDate.getMonth();
                        const currentYear = currentDate.getFullYear();
                        
                        const processedRows = rows.map(row => {
                            let invoiceType = 'Renewal';
                            let nextDueDate = null;
                            
                            // Handle missing renewal_type column
                            const renewalType = hasRenewalType ? (row.renewal_type || 'renewal') : 'renewal';
                            const fixDate = hasFixDate ? row.fix_date : null;
                            
                            // Cek apakah invoice ini dari bulan berjalan saja
                            const invoiceDate = new Date(row.created_at);
                            const invoiceMonth = invoiceDate.getMonth();
                            const invoiceYear = invoiceDate.getFullYear();
                            
                            // Hanya hitung next due date untuk invoice bulan berjalan
                            const isCurrentMonthInvoice = (invoiceYear === currentYear && invoiceMonth === currentMonth);
                            
                            if (row.status === 'paid') {
                                // Untuk invoice yang sudah lunas, next due date berdasarkan fix date atau renewal
                                if (renewalType === 'fix_date') {
                                    // Fix date: next due date adalah tanggal fix_date di bulan berikutnya
                                    const nextMonth = new Date(currentYear, currentMonth + 1, fixDate || 15);
                                    nextDueDate = nextMonth;
                                } else {
                                    // Renewal: next due date berdasarkan tanggal pembayaran
                                    if (row.payment_date) {
                                        // Jika ada tanggal pembayaran, gunakan tanggal pembayaran + 1 bulan
                                        const paymentDate = new Date(row.payment_date);
                                        const currentDueDate = new Date(row.due_date);
                                        
                                        if (paymentDate <= currentDueDate) {
                                            // Bayar sebelum atau tepat jatuh tempo: tanggal tetap
                                            const nextDue = new Date(currentDueDate);
                                            nextDue.setMonth(nextDue.getMonth() + 1);
                                            nextDueDate = nextDue;
                                        } else {
                                        // Bayar setelah jatuh tempo: tanggal berubah sesuai tanggal bayar
                                        const nextDue = new Date(paymentDate);
                                        nextDue.setMonth(nextDue.getMonth() + 1);
                                        nextDueDate = nextDue;
                                    }
                                } else {
                                    // Fallback: 30 hari dari due_date jika tidak ada payment_date
                                    const currentDueDate = new Date(row.due_date);
                                    nextDueDate = new Date(currentDueDate.getTime() + (30 * 24 * 60 * 60 * 1000));
                                }
                            }
                            } else {
                                // Untuk invoice yang belum lunas atau terlambat, next due date mengikuti tanggal jatuh tempo
                                nextDueDate = new Date(row.due_date);
                            }
                            
                            return {
                                ...row,
                                renewal_type: renewalType,
                                fix_date: fixDate,
                                invoice_type_display: invoiceType,
                                next_due_date: nextDueDate
                            };
                        });
                        resolve(processedRows);
                    }
                });
            });
        });
    }

    async getUnpaidInvoices() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.status = 'unpaid'
                ORDER BY i.due_date ASC, i.created_at DESC
            `;

            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getPaidInvoices() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed,
                       pay.payment_date, pay.payment_method
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                LEFT JOIN payments pay ON i.id = pay.invoice_id
                WHERE i.status = 'paid'
                ORDER BY i.payment_date DESC, i.created_at DESC
            `;

            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getInvoicesCount(customerUsername = null) {
        return new Promise((resolve, reject) => {
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();
            
            // Hitung tanggal awal bulan berjalan saja
            const currentMonthStart = new Date(currentYear, currentMonth, 1);
            const currentMonthStartStr = currentMonthStart.toISOString().split('T')[0]; // Format: YYYY-MM-DD
            
            let sql = 'SELECT COUNT(*) as count FROM invoices i WHERE DATE(i.created_at) >= ?';
            const params = [currentMonthStartStr];
            
            if (customerUsername) {
                sql += ' AND EXISTS (SELECT 1 FROM customers c WHERE c.id = i.customer_id AND c.username = ?)';
                params.push(customerUsername);
            }
            
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.count : 0);
                }
            });
        });
    }

    async getInvoicesByCustomer(customerId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.customer_id = ?
                ORDER BY i.created_at DESC
            `;
            
            this.db.all(sql, [customerId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getCustomersByPackage(packageId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.speed as package_speed
                FROM customers c
                LEFT JOIN packages p ON c.package_id = p.id
                WHERE c.package_id = ?
                ORDER BY c.name ASC
            `;
            
            this.db.all(sql, [packageId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getInvoicesByCustomerAndDateRange(customerUsername, startDate, endDate) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE c.username = ? 
                AND i.created_at BETWEEN ? AND ?
                ORDER BY i.created_at DESC
            `;
            
            const params = [
                customerUsername,
                startDate.toISOString(),
                endDate.toISOString()
            ];
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getInvoiceById(id) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username as customer_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.id = ?
            `;
            
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    // Check if this is a voucher invoice by looking at invoice_number pattern
                    if (row && row.invoice_number && row.invoice_number.includes('INV-VCR-')) {
                        // Extract voucher package name from notes field
                        // Format: "Voucher Hotspot 10rb - 5 Hari x1"
                        const notes = row.notes || '';
                        const voucherMatch = notes.match(/Voucher Hotspot (.+?) x\d+/);
                        if (voucherMatch) {
                            row.package_name = voucherMatch[1]; // e.g., "10rb - 5 Hari"
                        }
                    }
                    resolve(row);
                }
            });
        });
    }

    async updateInvoiceStatus(id, status, paymentMethod = null) {
        return new Promise(async (resolve, reject) => {
            try {
                const paymentDate = status === 'paid' ? new Date().toISOString() : null;
                const sql = `UPDATE invoices SET status = ?, payment_date = ?, payment_method = ? WHERE id = ?`;
                
                this.db.run(sql, [status, paymentDate, paymentMethod, id], async (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // If invoice is marked as paid, sync billing date for renewal customers and restore service if needed
                    if (status === 'paid' && paymentDate) {
                        try {
                            // Get invoice and customer data
                            const invoiceData = await this.getInvoiceById(id);
                            if (invoiceData) {
                                const customer = await this.getCustomerById(invoiceData.customer_id);
                                if (customer) {
                                    // Sync billing date for renewal customers
                                    if (customer.renewal_type === 'renewal') {
                                        // Calculate next due date
                                        const nextDueDate = this.calculateNextDueDate(
                                            customer, 
                                            invoiceData.due_date, 
                                            paymentDate
                                        );
                                        
                                        // Sync billing date
                                        const syncResult = await this.syncBillingDateForRenewal(
                                            customer.id, 
                                            nextDueDate
                                        );
                                        
                                        console.log(`[BILLING] Billing date synced for ${customer.name}:`, syncResult);
                                    }
                                    
                                    // Check if customer is suspended and restore service if no unpaid invoices
                                    if (customer.status === 'suspended') {
                                        try {
                                            const customerInvoices = await this.getInvoicesByCustomer(customer.id);
                                            const unpaidInvoices = customerInvoices.filter(i => i.status === 'unpaid');
                                            
                                            if (unpaidInvoices.length === 0) {
                                                console.log(`[BILLING] Auto-restoring service for customer ${customer.name} - no unpaid invoices`);
                                                const serviceSuspension = require('./serviceSuspension');
                                                const restoreResult = await serviceSuspension.restoreCustomerService(
                                                    customer, 
                                                    `Payment via ${paymentMethod || 'online'} - Invoice ${invoiceData.invoice_number}`
                                                );
                                                
                                                if (restoreResult.success) {
                                                    console.log(`[BILLING] Customer ${customer.name} service successfully restored`);
                                                } else {
                                                    console.error(`[BILLING] Failed to restore customer ${customer.name}:`, restoreResult);
                                                }
                                            } else {
                                                console.log(`[BILLING] Customer ${customer.name} still has ${unpaidInvoices.length} unpaid invoices - keeping suspended`);
                                            }
                                        } catch (restoreError) {
                                            console.error(`[BILLING] Error restoring customer service:`, restoreError);
                                        }
                                    }
                                }
                            }
                        } catch (syncError) {
                            console.error('[BILLING] Error syncing billing date:', syncError);
                            // Don't reject the main operation if sync fails
                        }
                    }
                    
                    resolve({ id, status, payment_date: paymentDate, payment_method: paymentMethod });
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async updateInvoice(id, invoiceData) {
        return new Promise((resolve, reject) => {
            const { customer_id, package_id, amount, due_date, notes } = invoiceData;
            const sql = `UPDATE invoices SET customer_id = ?, package_id = ?, amount = ?, due_date = ?, notes = ? WHERE id = ?`;
            
            // Use arrow function to preserve class context (this)
            this.db.run(sql, [customer_id, package_id, amount, due_date, notes, id], (err) => {
                if (err) {
                    reject(err);
                } else {
                    // Get the updated invoice
                    this.getInvoiceById(id).then(resolve).catch(reject);
                }
            });
        });
    }

    async deleteInvoice(id) {
        return new Promise((resolve, reject) => {
            // First get the invoice details before deleting
            this.getInvoiceById(id).then(invoice => {
                if (!invoice) {
                    reject(new Error('Invoice not found'));
                    return;
                }

                // Start a transaction to ensure all deletions succeed or fail together
                this.db.serialize(() => {
                    this.db.run('BEGIN TRANSACTION');
                    
                    // Delete related records first to avoid foreign key constraint violations
                    // Use a more robust approach with Promise-based deletion
                    // Note: activity_logs doesn't have invoice_id column, so we skip it
                    const deleteQueries = [
                        { query: 'DELETE FROM payments WHERE invoice_id = ?', name: 'payments' },
                        { query: 'DELETE FROM payment_gateway_transactions WHERE invoice_id = ?', name: 'payment_gateway_transactions' },
                        { query: 'DELETE FROM technician_activities WHERE invoice_id = ?', name: 'technician_activities' },
                        { query: 'DELETE FROM agent_monthly_payments WHERE invoice_id = ?', name: 'agent_monthly_payments' },
                        { query: 'DELETE FROM agent_payments WHERE invoice_id = ?', name: 'agent_payments' },
                        { query: 'DELETE FROM collector_payments WHERE invoice_id = ?', name: 'collector_payments' }
                        // activity_logs doesn't have invoice_id column, so we don't delete from it
                    ];
                    
                    let completedQueries = 0;
                    let hasError = false;
                    const errors = [];
                    
                    deleteQueries.forEach((queryObj, index) => {
                        // Check if table exists before trying to delete
                        this.db.run(queryObj.query, [id], function(err) {
                            if (err) {
                                // Ignore "no such table" and "no such column" errors, but log others
                                const ignorableErrors = ['no such table', 'no such column'];
                                const isIgnorable = ignorableErrors.some(errorType => 
                                    err.message.toLowerCase().includes(errorType)
                                );
                                
                                if (!isIgnorable) {
                                    console.error(`Error deleting from ${queryObj.name}:`, err.message);
                                    errors.push(`${queryObj.name}: ${err.message}`);
                                    hasError = true;
                                } else {
                                    // Log but don't fail for ignorable errors
                                    logger.debug(`Skipping deletion from ${queryObj.name}: ${err.message}`);
                                }
                            }
                            
                            completedQueries++;
                            if (completedQueries === deleteQueries.length) {
                                if (hasError) {
                                    this.db.run('ROLLBACK', (rollbackErr) => {
                                        if (rollbackErr) {
                                            console.error('Error rolling back transaction:', rollbackErr.message);
                                        }
                                        reject(new Error(`Failed to delete related records: ${errors.join('; ')}`));
                                    });
                                } else {
                                    // Now delete the invoice itself
                                    this.db.run('DELETE FROM invoices WHERE id = ?', [id], function(err) {
                                        if (err) {
                                            this.db.run('ROLLBACK', (rollbackErr) => {
                                                if (rollbackErr) {
                                                    console.error('Error rolling back transaction:', rollbackErr.message);
                                                }
                                            });
                                            reject(err);
                                        } else {
                                            this.db.run('COMMIT', (commitErr) => {
                                                if (commitErr) {
                                                    console.error('Error committing transaction:', commitErr.message);
                                                    reject(commitErr);
                                                } else {
                                                    console.log(`✅ Successfully deleted invoice ${invoice.invoice_number} (ID: ${id})`);
                                                    resolve(invoice);
                                                }
                                            });
                                        }
                                    }.bind(this));
                                }
                            }
                        }.bind(this));
                    });
                });
            }).catch(reject);
        });
    }

    // Payment Management
    async recordPayment(paymentData) {
        return new Promise(async (resolve, reject) => {
            try {
                const { invoice_id, amount, payment_method, reference_number, notes } = paymentData;
                const sql = `INSERT INTO payments (invoice_id, amount, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?)`;
                
                this.db.run(sql, [invoice_id, amount, payment_method, reference_number, notes], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ 
                            success: true, 
                            id: this.lastID, 
                            ...paymentData 
                        });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async recordCollectorPayment(paymentData) {
        return new Promise((resolve, reject) => {
            const { invoice_id, amount, payment_method, reference_number, notes, collector_id, commission_amount } = paymentData;
            const self = this; // Store reference to this
            
            // Set database timeout and WAL mode for better concurrency
            this.db.run('PRAGMA busy_timeout=30000', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                self.db.run('PRAGMA journal_mode=WAL', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Mulai transaction untuk operasi kompleks
                    self.db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        // Insert payment
                        const sql = `INSERT INTO payments (
                            invoice_id, amount, payment_method, reference_number, notes, 
                            collector_id, commission_amount, payment_type
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'collector')`;
                        
                        self.db.run(sql, [
                            invoice_id, amount, payment_method, reference_number, notes,
                            collector_id, commission_amount || 0
                        ], function(err) {
                            if (err) {
                                self.db.run('ROLLBACK', (rollbackErr) => {
                                    if (rollbackErr) console.error('Rollback error:', rollbackErr.message);
                                    reject(err);
                                });
                                return;
                            }
                            
                            const paymentId = this.lastID;
                            
                            // Jika ada komisi, catat sebagai expense
                            if (commission_amount && commission_amount > 0) {
                                // Get collector name untuk deskripsi
                                self.db.get('SELECT name FROM collectors WHERE id = ?', [collector_id], (err, collector) => {
                                    if (err) {
                                        self.db.run('ROLLBACK', (rollbackErr) => {
                                            if (rollbackErr) console.error('Rollback error:', rollbackErr.message);
                                            reject(err);
                                        });
                                        return;
                                    }
                                    
                                    const collectorName = collector ? collector.name : 'Unknown Collector';
                                    
                                    // Insert commission as expense
                                    const expenseSql = `INSERT INTO expenses (
                                        description, amount, category, expense_date, 
                                        payment_method, notes
                                    ) VALUES (?, ?, ?, DATE('now'), ?, ?)`;
                                    
                                    self.db.run(expenseSql, [
                                        `Komisi Kolektor - ${collectorName}`,
                                        commission_amount,
                                        'Operasional',
                                        'Transfer Bank', // Default payment method for commission
                                        `Komisi ${commission_amount}% dari pembayaran invoice ${invoice_id} via kolektor ${collectorName}`
                                    ], function(err) {
                                        if (err) {
                                            self.db.run('ROLLBACK', (rollbackErr) => {
                                                if (rollbackErr) console.error('Rollback error:', rollbackErr.message);
                                                reject(err);
                                            });
                                            return;
                                        }
                                        
                                        // Commit transaction
                                        self.db.run('COMMIT', (err) => {
                                            if (err) {
                                                reject(err);
                                            } else {
                                                resolve({ 
                                                    success: true, 
                                                    id: paymentId, 
                                                    expenseId: this.lastID,
                                                    commissionRecorded: true,
                                                    ...paymentData 
                                                });
                                            }
                                        });
                                    });
                                });
                            } else {
                                // Commit transaction tanpa expense
                                self.db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve({ 
                                            success: true, 
                                            id: paymentId, 
                                            commissionRecorded: false,
                                            ...paymentData 
                                        });
                                    }
                                });
                            }
                        });
                    });
                });
            });
        });
    }

    async getCollectorById(collectorId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM collectors WHERE id = ?', [collectorId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async recordCollectorPaymentRecord(paymentData) {
        return new Promise((resolve, reject) => {
            const { collector_id, customer_id, amount, payment_amount, commission_amount, payment_method, notes, status } = paymentData;
            
            const sql = `INSERT INTO collector_payments (
                collector_id, customer_id, amount, payment_amount, commission_amount,
                payment_method, notes, status, collected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
            
            this.db.run(sql, [
                collector_id, customer_id, amount, payment_amount, commission_amount,
                payment_method, notes, status
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        success: true, 
                        id: this.lastID,
                        ...paymentData 
                    });
                }
            });
        });
    }

    async getCollectorTodayPayments(collectorId, startOfDay, endOfDay) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT COALESCE(SUM(payment_amount), 0) as total
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at < ? AND status = 'completed'
            `, [collectorId, startOfDay.toISOString(), endOfDay.toISOString()], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0)));
            });
        });
    }

    // Get current month's total commission (reset every month)
    async getCollectorTotalCommission(collectorId) {
        return new Promise((resolve, reject) => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            
            this.db.get(`
                SELECT COALESCE(SUM(commission_amount), 0) as total
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at <= ? AND status = 'completed'
            `, [collectorId, startDate, endDate], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0)));
            });
        });
    }

    // Get current month's total payments count (reset every month)
    async getCollectorTotalPayments(collectorId) {
        return new Promise((resolve, reject) => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            
            this.db.get(`
                SELECT COUNT(*) as count
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at <= ? AND status = 'completed'
            `, [collectorId, startDate, endDate], (err, row) => {
                if (err) reject(err);
                else resolve(parseInt(row ? row.count : 0));
            });
        });
    }

    async getCollectorRecentPayments(collectorId, limit = 5) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT cp.*, c.name as customer_name, c.phone as customer_phone
                FROM collector_payments cp
                LEFT JOIN customers c ON cp.customer_id = c.id
                WHERE cp.collector_id = ? AND cp.status = 'completed'
                ORDER BY cp.collected_at DESC
                LIMIT ?
            `, [collectorId, limit], (err, rows) => {
                if (err) reject(err);
                else {
                    const validRows = (rows || []).map(row => ({
                        ...row,
                        payment_amount: Math.round(parseFloat(row.payment_amount || 0)),
                        commission_amount: Math.round(parseFloat(row.commission_amount || 0)),
                        customer_name: row.customer_name || 'Unknown Customer'
                    }));
                    resolve(validRows);
                }
            });
        });
    }

    async getCollectorAllPayments(collectorId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT cp.*, c.name as customer_name, c.phone as customer_phone
                FROM collector_payments cp
                LEFT JOIN customers c ON cp.customer_id = c.id
                WHERE cp.collector_id = ?
                ORDER BY cp.collected_at DESC
            `, [collectorId], (err, rows) => {
                if (err) reject(err);
                else {
                    const validRows = (rows || []).map(row => ({
                        ...row,
                        payment_amount: Math.round(parseFloat(row.payment_amount || 0)),
                        commission_amount: Math.round(parseFloat(row.commission_amount || 0)),
                        customer_name: row.customer_name || 'Unknown Customer',
                        collected_at: row.collected_at || new Date().toISOString()
                    }));
                    resolve(validRows);
                }
            });
        });
    }

    // Monthly reset methods for collector summary
    async getCollectorMonthlyPayments(collectorId, year, month) {
        return new Promise((resolve, reject) => {
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            
            this.db.get(`
                SELECT COALESCE(SUM(payment_amount), 0) as total
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at <= ? AND status = 'completed'
            `, [collectorId, startDate, endDate], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0)));
            });
        });
    }

    async getCollectorMonthlyCommission(collectorId, year, month) {
        return new Promise((resolve, reject) => {
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            
            this.db.get(`
                SELECT COALESCE(SUM(commission_amount), 0) as total
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at <= ? AND status = 'completed'
            `, [collectorId, startDate, endDate], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0)));
            });
        });
    }

    async getCollectorMonthlyCount(collectorId, year, month) {
        return new Promise((resolve, reject) => {
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            
            this.db.get(`
                SELECT COUNT(*) as count
                FROM collector_payments 
                WHERE collector_id = ? AND collected_at >= ? AND collected_at <= ? AND status = 'completed'
            `, [collectorId, startDate, endDate], (err, row) => {
                if (err) reject(err);
                else resolve(parseInt(row ? row.count : 0));
            });
        });
    }

    // Save collector monthly summary
    async saveCollectorMonthlySummary(collectorId, year, month, stats) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT OR REPLACE INTO collector_monthly_summary (
                    collector_id, year, month, total_payments, total_commission, 
                    payment_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `;
            
            this.db.run(sql, [
                collectorId, year, month, 
                stats.total_payments || 0,
                stats.total_commission || 0,
                stats.payment_count || 0
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, collectorId, year, month });
            });
        });
    }

    // Get collector monthly summary
    async getCollectorMonthlySummary(collectorId, year, month) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM collector_monthly_summary 
                WHERE collector_id = ? AND year = ? AND month = ?
            `, [collectorId, year, month], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Get all collector monthly summaries
    async getAllCollectorMonthlySummaries(collectorId, limit = 12) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM collector_monthly_summary 
                WHERE collector_id = ?
                ORDER BY year DESC, month DESC
                LIMIT ?
            `, [collectorId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async getPayments(invoiceId = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    c.phone as customer_phone,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
            `;
            
            const params = [];
            if (invoiceId) {
                sql += ` WHERE p.invoice_id = ?`;
                params.push(invoiceId);
            }
            
            sql += ` ORDER BY p.payment_date DESC`;
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getCollectorPayments(invoiceId = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    c.phone as customer_phone,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                WHERE p.collector_id IS NOT NULL AND col.id IS NOT NULL
            `;
            
            const params = [];
            if (invoiceId) {
                sql += ` AND p.invoice_id = ?`;
                params.push(invoiceId);
            }
            
            sql += ` ORDER BY p.payment_date DESC`;
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getCollectorPaymentsWithFilters(filters) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    c.phone as customer_phone,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                WHERE 1=1
            `;
            
            const params = [];
            
            // Date range filter
            if (filters.from) {
                sql += ` AND DATE(p.payment_date) >= ?`;
                params.push(filters.from);
            }
            if (filters.to) {
                sql += ` AND DATE(p.payment_date) <= ?`;
                params.push(filters.to);
            }
            
            // Collector filter
            if (filters.collector_id) {
                sql += ` AND p.collector_id = ?`;
                params.push(filters.collector_id);
            }
            
            // Status filter
            if (filters.status) {
                if (filters.status === 'completed') {
                    sql += ` AND p.payment_date IS NOT NULL`;
                } else if (filters.status === 'received') {
                    sql += ` AND p.remittance_status = 'received'`;
                }
            }
            
            // Search filter
            if (filters.q) {
                sql += ` AND (
                    c.name LIKE ? OR 
                    c.phone LIKE ? OR 
                    i.invoice_number LIKE ? OR 
                    p.notes LIKE ?
                )`;
                const searchTerm = `%${filters.q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
            
            sql += ` ORDER BY p.payment_date DESC`;
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getAllCollectors() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT id, name, phone, status
                FROM collectors
                WHERE status = 'active'
                ORDER BY name ASC
            `;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getPaymentById(id) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    p.*, 
                    i.invoice_number, 
                    c.username, 
                    c.name as customer_name,
                    col.name as collector_name,
                    col.phone as collector_phone
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
                LEFT JOIN collectors col ON p.collector_id = col.id
                WHERE p.id = ?
            `;
            
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async updatePayment(id, paymentData) {
        return new Promise((resolve, reject) => {
            const { amount, payment_method, reference_number, notes } = paymentData;
            const sql = `UPDATE payments SET amount = ?, payment_method = ?, reference_number = ?, notes = ? WHERE id = ?`;
            this.db.run(sql, [amount, payment_method, reference_number, notes, id], (err) => {
                if (err) {
                    reject(err);
                } else {
                    this.getPaymentById(id).then(resolve).catch(reject);
                }
            });
        });
    }

    async deletePayment(id) {
        return new Promise((resolve, reject) => {
            // Ambil payment terlebih dahulu untuk reference
            this.getPaymentById(id).then(payment => {
                if (!payment) return reject(new Error('Payment not found'));
                const sql = `DELETE FROM payments WHERE id = ?`;
                this.db.run(sql, [id], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(payment);
                    }
                });
            }).catch(reject);
        });
    }

    // Utility functions
    generateInvoiceNumber() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `INV-${year}${month}-${random}`;
    }

    // Calculate next due date based on renewal type
    calculateNextDueDate(customer, currentDueDate, paymentDate) {
        const renewalType = customer.renewal_type || 'renewal';
        const fixDate = customer.fix_date || customer.billing_day || 15;
        const payment = new Date(paymentDate);
        const currentDue = new Date(currentDueDate);
        
        if (renewalType === 'fix_date') {
            // Fix Date: Tanggal jatuh tempo tetap sesuai fix_date
            const nextDue = new Date(currentDue);
            nextDue.setMonth(nextDue.getMonth() + 1);
            nextDue.setDate(Math.min(fixDate, new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()));
            return nextDue.toISOString().split('T')[0];
        } else {
            // Renewal: Tanggal jatuh tempo mengikuti tanggal pembayaran
            // Jika bayar sebelum jatuh tempo, tanggal tetap
            // Jika bayar setelah jatuh tempo, tanggal berubah sesuai tanggal bayar
            
            if (payment <= currentDue) {
                // Bayar sebelum atau tepat jatuh tempo: tanggal tetap
                const nextDue = new Date(currentDue);
                nextDue.setMonth(nextDue.getMonth() + 1);
                return nextDue.toISOString().split('T')[0];
            } else {
                // Bayar setelah jatuh tempo: tanggal berubah sesuai tanggal bayar
                const nextDue = new Date(payment);
                nextDue.setMonth(nextDue.getMonth() + 1);
                return nextDue.toISOString().split('T')[0];
            }
        }
    }

    // Sync billing date for renewal customers after payment
    async syncBillingDateForRenewal(customerId, nextDueDate) {
        return new Promise((resolve, reject) => {
            // Get customer data
            this.db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (!customer) {
                    reject(new Error('Customer not found'));
                    return;
                }
                
                // Only sync for renewal customers
                if (customer.renewal_type !== 'renewal') {
                    resolve({ success: true, message: 'Not a renewal customer, no sync needed' });
                    return;
                }
                
                // Extract day from next due date
                const nextDue = new Date(nextDueDate);
                const newBillingDay = nextDue.getDate();
                
                // Update billing_day in customers table
                this.db.run(
                    'UPDATE customers SET billing_day = ? WHERE id = ?',
                    [newBillingDay, customerId],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({
                                success: true,
                                message: `Billing day updated to ${newBillingDay} for customer ${customer.name}`,
                                oldBillingDay: customer.billing_day,
                                newBillingDay: newBillingDay
                            });
                        }
                    }
                );
            });
        });
    }

    // Process direct payment with idempotency check
    async processDirectPaymentWithIdempotency(invoice, result, gateway) {
        try {
            logger.info(`[WEBHOOK] Processing direct payment for invoice: ${invoice.id}`);

            // Check if payment already exists to prevent duplicates
            const existingPaymentSql = `
                SELECT id FROM payments 
                WHERE invoice_id = ? AND reference_number = ? AND payment_method = 'online'
            `;
            
            const existingPayment = await new Promise((resolve, reject) => {
                this.db.get(existingPaymentSql, [invoice.id, result.order_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (existingPayment) {
                logger.warn(`[WEBHOOK] Payment already exists for invoice ${invoice.id}, order ${result.order_id}. Skipping duplicate.`);
                return { success: true, message: 'Payment already processed', duplicate: true };
            }

            // Mark invoice paid and record payment
            await this.updateInvoiceStatus(invoice.id, 'paid', 'online');
            const paymentData = {
                invoice_id: invoice.id,
                amount: result.amount || invoice.amount,
                payment_method: 'online',
                reference_number: result.order_id,
                notes: `Payment via ${gateway} - ${result.payment_type || 'online'}`
            };
            await this.recordPayment(paymentData);

            logger.info(`[WEBHOOK] Direct payment processed successfully for invoice: ${invoice.id}`);
            return { success: true, message: 'Payment processed successfully' };
        } catch (error) {
            logger.error(`[WEBHOOK] Error processing direct payment:`, error);
            throw error;
        }
    }

    // Generate username otomatis berdasarkan nomor telepon
    generateUsername(phone) {
        // Ambil 4 digit terakhir dari nomor telepon
        const last4Digits = phone.slice(-4);
        const timestamp = Date.now().toString().slice(-6);
        // Tambah random string untuk menghindari collision
        const randomStr = Math.random().toString(36).substring(2, 6);
        return `cust_${last4Digits}_${timestamp}_${randomStr}`;
    }

    // Generate PPPoE username otomatis
    generatePPPoEUsername(phone) {
        // Ambil 4 digit terakhir dari nomor telepon
        const last4Digits = phone.slice(-4);
        // Tambah random string untuk menghindari collision
        const randomStr = Math.random().toString(36).substring(2, 4);
        return `pppoe_${last4Digits}_${randomStr}`;
    }

    // Generate Customer ID 6 digit numerik yang unik
    async generateCustomerId() {
        return new Promise((resolve, reject) => {
            const maxAttempts = 100;
            let attempts = 0;
            
            // First, ensure customer_id column exists
            this.db.run("ALTER TABLE customers ADD COLUMN customer_id TEXT", (alterErr) => {
                // Ignore error if column already exists
                if (alterErr && !alterErr.message.includes('duplicate column name')) {
                    console.warn('Warning: Could not add customer_id column:', alterErr.message);
                }
                
                // Create index if not exists
                this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id)", (indexErr) => {
                    if (indexErr) {
                        console.warn('Warning: Could not create index for customer_id:', indexErr.message);
                    }
                    
                    const tryGenerate = () => {
                        attempts++;
                        if (attempts > maxAttempts) {
                            return reject(new Error('Failed to generate unique customer ID after maximum attempts'));
                        }
                        
                        // Generate 6 digit number (100000 - 999999)
                        const customerId = Math.floor(100000 + Math.random() * 900000).toString();
                        
                        // Check if ID already exists
                        this.db.get('SELECT id FROM customers WHERE customer_id = ?', [customerId], (err, row) => {
                            if (err) {
                                // If column doesn't exist, try to add it and retry
                                if (err.message.includes('no such column: customer_id')) {
                                    // Column doesn't exist, add it and retry
                                    this.db.run("ALTER TABLE customers ADD COLUMN customer_id TEXT", (addErr) => {
                                        if (addErr && !addErr.message.includes('duplicate column name')) {
                                            return reject(new Error('Customer ID column does not exist and could not be created: ' + addErr.message));
                                        }
                                        // Retry after adding column
                                        setTimeout(() => tryGenerate(), 100);
                                    });
                                } else {
                                    return reject(err);
                                }
                            } else {
                                if (row) {
                                    // ID already exists, try again
                                    return tryGenerate();
                                } else {
                                    // ID is unique, return it
                                    resolve(customerId);
                                }
                            }
                        });
                    };
                    
                    tryGenerate();
                });
            });
        });
    }

    // Generate customer_id untuk customer yang sudah ada (tanpa customer_id)
    async generateCustomerIdsForExistingCustomers() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id FROM customers WHERE customer_id IS NULL OR customer_id = ""', [], async (err, rows) => {
                if (err) {
                    console.error('Error getting customers without customer_id:', err);
                    return reject(err);
                }
                
                if (!rows || rows.length === 0) {
                    return resolve();
                }
                
                console.log(`Generating customer_id for ${rows.length} existing customers...`);
                
                for (const row of rows) {
                    try {
                        const customerId = await this.generateCustomerId();
                        this.db.run('UPDATE customers SET customer_id = ? WHERE id = ?', [customerId, row.id], (updateErr) => {
                            if (updateErr) {
                                console.error(`Error updating customer_id for customer ${row.id}:`, updateErr);
                            } else {
                                console.log(`Generated customer_id ${customerId} for customer ${row.id}`);
                            }
                        });
                    } catch (genErr) {
                        console.error(`Error generating customer_id for customer ${row.id}:`, genErr);
                    }
                }
                
                resolve();
            });
        });
    }

    async getBillingStats() {
        return new Promise((resolve, reject) => {
            // Get current month date range
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();
            const currentMonthStart = new Date(currentYear, currentMonth, 1);
            const currentMonthEnd = new Date(currentYear, currentMonth + 1, 0);
            const currentMonthStartStr = currentMonthStart.toISOString().split('T')[0];
            const currentMonthEndStr = currentMonthEnd.toISOString().split('T')[0];
            
            // Check if invoice_type column exists first
            this.db.get("PRAGMA table_info(invoices)", (err, pragmaResult) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Check all columns
                this.db.all("PRAGMA table_info(invoices)", (pragmaErr, columns) => {
                    if (pragmaErr) {
                        reject(pragmaErr);
                        return;
                    }
                    
                    const hasInvoiceType = columns.some(col => col.name === 'invoice_type');
                    
                    // Query yang lebih aman dan terpisah untuk menghindari duplikasi data
                    // Hanya menghitung data bulan berjalan untuk pendapatan
                    // Use conditional logic based on column existence
                    let sql;
                    let params;
                    
                    if (hasInvoiceType) {
                        // Query dengan invoice_type column
                        sql = `
                            SELECT 
                                (SELECT COUNT(*) FROM customers) as total_customers,
                                (SELECT COUNT(*) FROM customers WHERE status = 'active') as active_customers,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ?) as monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE invoice_type = 'voucher') as voucher_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ? AND status = 'paid') as paid_monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ? AND status = 'unpaid' AND (invoice_type != 'voucher' OR invoice_type IS NULL)) as unpaid_monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE invoice_type = 'voucher' AND status = 'paid') as paid_voucher_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE invoice_type = 'voucher' AND status = 'unpaid') as unpaid_voucher_invoices,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE DATE(created_at) >= ? AND status = 'paid' AND (invoice_type != 'voucher' OR invoice_type IS NULL)) as monthly_revenue,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE invoice_type = 'voucher' AND status = 'paid') as voucher_revenue,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE DATE(created_at) >= ? AND status = 'unpaid') as monthly_unpaid,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE invoice_type = 'voucher' AND status = 'unpaid') as voucher_unpaid
                        `;
                        params = [currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, currentMonthStartStr];
                    } else {
                        // Fallback query tanpa invoice_type (identify voucher by invoice_number pattern)
                        sql = `
                            SELECT 
                                (SELECT COUNT(*) FROM customers) as total_customers,
                                (SELECT COUNT(*) FROM customers WHERE status = 'active') as active_customers,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ?) as monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE invoice_number LIKE 'INV-VCR-%' OR notes LIKE 'Voucher Hotspot%') as voucher_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ? AND status = 'paid') as paid_monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE DATE(created_at) >= ? AND status = 'unpaid' AND invoice_number NOT LIKE 'INV-VCR-%' AND notes NOT LIKE 'Voucher Hotspot%') as unpaid_monthly_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE (invoice_number LIKE 'INV-VCR-%' OR notes LIKE 'Voucher Hotspot%') AND status = 'paid') as paid_voucher_invoices,
                                (SELECT COUNT(*) FROM invoices WHERE (invoice_number LIKE 'INV-VCR-%' OR notes LIKE 'Voucher Hotspot%') AND status = 'unpaid') as unpaid_voucher_invoices,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE DATE(created_at) >= ? AND status = 'paid' AND invoice_number NOT LIKE 'INV-VCR-%' AND notes NOT LIKE 'Voucher Hotspot%') as monthly_revenue,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE (invoice_number LIKE 'INV-VCR-%' OR notes LIKE 'Voucher Hotspot%') AND status = 'paid') as voucher_revenue,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE DATE(created_at) >= ? AND status = 'unpaid') as monthly_unpaid,
                                (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE (invoice_number LIKE 'INV-VCR-%' OR notes LIKE 'Voucher Hotspot%') AND status = 'unpaid') as voucher_unpaid
                        `;
                        params = [currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, currentMonthStartStr];
                    }
                    
                    this.db.get(sql, params, (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            // Pastikan semua nilai adalah angka dan tidak null
                            const stats = {
                                // Customer stats
                                total_customers: parseInt(row.total_customers) || 0,
                                active_customers: parseInt(row.active_customers) || 0,
                                
                                // Invoice counts by type
                                monthly_invoices: parseInt(row.monthly_invoices) || 0,
                                voucher_invoices: parseInt(row.voucher_invoices) || 0,
                                
                                // Paid invoices by type
                                paid_monthly_invoices: parseInt(row.paid_monthly_invoices) || 0,
                                paid_voucher_invoices: parseInt(row.paid_voucher_invoices) || 0,
                                
                                // Unpaid invoices by type
                                unpaid_monthly_invoices: parseInt(row.unpaid_monthly_invoices) || 0,
                                unpaid_voucher_invoices: parseInt(row.unpaid_voucher_invoices) || 0,
                                
                                // Revenue by type
                                monthly_revenue: parseFloat(row.monthly_revenue) || 0,
                                voucher_revenue: parseFloat(row.voucher_revenue) || 0,
                                
                                // Unpaid amounts by type
                                monthly_unpaid: parseFloat(row.monthly_unpaid) || 0,
                                voucher_unpaid: parseFloat(row.voucher_unpaid) || 0,
                                
                                // Legacy fields for backward compatibility
                                total_invoices: (parseInt(row.monthly_invoices) || 0) + (parseInt(row.voucher_invoices) || 0),
                                paid_invoices: (parseInt(row.paid_monthly_invoices) || 0) + (parseInt(row.paid_voucher_invoices) || 0),
                                unpaid_invoices: (parseInt(row.unpaid_monthly_invoices) || 0) + (parseInt(row.unpaid_voucher_invoices) || 0),
                                total_revenue: (parseFloat(row.monthly_revenue) || 0) + (parseFloat(row.voucher_revenue) || 0),
                                total_unpaid: (parseFloat(row.monthly_unpaid) || 0) + (parseFloat(row.voucher_unpaid) || 0)
                            };
                            
                            // Validasi logika: active_customers tidak boleh lebih dari total_customers
                            if (stats.active_customers > stats.total_customers) {
                                console.warn('Warning: Active customers count is higher than total customers. This indicates data inconsistency.');
                                // Set active_customers to total_customers as fallback
                                stats.active_customers = stats.total_customers;
                            }
                            
                            const finalizeStats = async () => {
                                try {
                                    const voucherInvoices = await this.getVoucherInvoices(currentMonthStartStr, currentMonthEndStr);
                                    const voucherStats = this.calculateVoucherStats(voucherInvoices);
                                    
                                    stats.voucher_summary = {
                                        total_vouchers: voucherStats.total_vouchers,
                                        recognized_vouchers: voucherStats.paid_vouchers,
                                        pending_vouchers: voucherStats.unpaid_vouchers,
                                        recognized_revenue: voucherStats.total_revenue,
                                        pending_revenue: voucherStats.unpaid_amount
                                    };
                                    
                                    stats.voucher_invoices = voucherStats.total_vouchers;
                                    stats.paid_voucher_invoices = voucherStats.paid_vouchers;
                                    stats.unpaid_voucher_invoices = voucherStats.unpaid_vouchers;
                                    stats.voucher_revenue = voucherStats.total_revenue;
                                    stats.voucher_unpaid = voucherStats.unpaid_amount;
                                    
                                    stats.total_invoices = (parseInt(row.monthly_invoices) || 0) + voucherStats.total_vouchers;
                                    stats.paid_invoices = (parseInt(row.paid_monthly_invoices) || 0) + voucherStats.paid_vouchers;
                                    stats.unpaid_invoices = (parseInt(row.unpaid_monthly_invoices) || 0) + voucherStats.unpaid_vouchers;
                                    stats.total_revenue = (parseFloat(row.monthly_revenue) || 0) + voucherStats.total_revenue;
                                    stats.total_unpaid = (parseFloat(row.monthly_unpaid) || 0) + voucherStats.unpaid_amount;
                                } catch (voucherErr) {
                                    logger.error(`Failed to compute voucher stats for dashboard: ${voucherErr.message}`);
                                    stats.voucher_summary = {
                                        total_vouchers: stats.voucher_invoices,
                                        recognized_vouchers: stats.paid_voucher_invoices,
                                        pending_vouchers: stats.unpaid_voucher_invoices,
                                        recognized_revenue: stats.voucher_revenue,
                                        pending_revenue: stats.voucher_unpaid
                                    };
                                } finally {
                                    resolve(stats);
                                }
                            };
                            
                            finalizeStats();
                        }
                    });
                });
            });
        });
    }

    // Fungsi untuk membersihkan data duplikat dan memperbaiki konsistensi
    async cleanupDataConsistency() {
        return new Promise((resolve, reject) => {
            const cleanupQueries = [
                // 1. Hapus duplikat customers berdasarkan phone (keep yang terbaru)
                `DELETE FROM customers 
                 WHERE id NOT IN (
                     SELECT MAX(id) 
                     FROM customers 
                     GROUP BY phone
                 )`,
                
                // 2. Update status customers yang tidak valid (tapi jangan ubah 'register')
                `UPDATE customers 
                 SET status = 'inactive' 
                 WHERE status NOT IN ('active', 'inactive', 'suspended', 'register')`,
                
                // 3. Update status invoices yang tidak valid
                `UPDATE invoices 
                 SET status = 'unpaid' 
                 WHERE status NOT IN ('paid', 'unpaid', 'cancelled')`,
                
                // 4. Pastikan amount invoice tidak null atau negatif
                `UPDATE invoices 
                 SET amount = 0 
                 WHERE amount IS NULL OR amount < 0`,
                
                // 5. Hapus invoices yang tidak memiliki customer
                `DELETE FROM invoices 
                 WHERE customer_id NOT IN (SELECT id FROM customers)`
            ];
            
            let completed = 0;
            const total = cleanupQueries.length;
            
            cleanupQueries.forEach((query, index) => {
                this.db.run(query, [], (err) => {
                    if (err) {
                        console.warn(`Cleanup query ${index + 1} failed:`, err.message);
                    }
                    
                    completed++;
                    if (completed === total) {
                        console.log('Data consistency cleanup completed');
                        resolve(true);
                    }
                });
            });
        });
    }

    // Fungsi untuk mendapatkan invoice berdasarkan type
    async getInvoicesByType(invoiceType = 'monthly') {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username as customer_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                LEFT JOIN customers c ON i.customer_id = c.id
                LEFT JOIN packages p ON i.package_id = p.id
                WHERE i.invoice_type = ?
                ORDER BY i.created_at DESC
            `;
            
            this.db.all(sql, [invoiceType], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Fungsi untuk mendapatkan statistik berdasarkan invoice type
    async getInvoiceStatsByType(invoiceType = 'monthly') {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_invoices,
                    COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
                    COUNT(CASE WHEN status = 'unpaid' THEN 1 END) as unpaid_invoices,
                    COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as total_revenue,
                    COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount ELSE 0 END), 0) as total_unpaid
                FROM invoices 
                WHERE invoice_type = ?
            `;
            
            this.db.get(sql, [invoiceType], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        total_invoices: parseInt(row.total_invoices) || 0,
                        paid_invoices: parseInt(row.paid_invoices) || 0,
                        unpaid_invoices: parseInt(row.unpaid_invoices) || 0,
                        total_revenue: parseFloat(row.total_revenue) || 0,
                        total_unpaid: parseFloat(row.total_unpaid) || 0
                    });
                }
            });
        });
    }

    // Voucher cleanup methods
    async cleanupExpiredVoucherInvoices() {
        return new Promise((resolve, reject) => {
            const cleanupEnabled = getSetting('voucher_cleanup.enabled', true);
            const expiryHours = parseInt(getSetting('voucher_cleanup.expiry_hours', '24'));
            const deleteInvoices = getSetting('voucher_cleanup.delete_expired_invoices', true);
            const logActions = getSetting('voucher_cleanup.log_cleanup_actions', true);
            
            if (!cleanupEnabled) {
                resolve({ success: true, message: 'Voucher cleanup disabled', cleaned: 0 });
                return;
            }
            
            // Calculate expiry time
            const expiryTime = new Date();
            expiryTime.setHours(expiryTime.getHours() - expiryHours);
            const expiryTimeStr = expiryTime.toISOString();
            
            if (logActions) {
                console.log(`🧹 Starting voucher cleanup for invoices older than ${expiryHours} hours (before ${expiryTimeStr})`);
            }
            
            // First, get expired invoices for logging
            const selectSql = `
                SELECT i.id, i.invoice_number, i.amount, i.created_at, i.status, c.name as customer_name
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.invoice_type = 'voucher' 
                AND i.status = 'unpaid' 
                AND i.created_at < ?
                ORDER BY i.created_at ASC
            `;
            
            this.db.all(selectSql, [expiryTimeStr], (err, expiredInvoices) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (expiredInvoices.length === 0) {
                    if (logActions) {
                        console.log('✅ No expired voucher invoices found');
                    }
                    resolve({ success: true, message: 'No expired invoices found', cleaned: 0 });
                    return;
                }
                
                if (logActions) {
                    console.log(`📋 Found ${expiredInvoices.length} expired voucher invoices:`);
                    expiredInvoices.forEach(invoice => {
                        console.log(`   - ${invoice.invoice_number} (${invoice.customer_name}) - ${invoice.amount} - ${invoice.created_at}`);
                    });
                }
                
                if (deleteInvoices) {
                    // Delete expired invoices
                    const deleteSql = `
                        DELETE FROM invoices 
                        WHERE invoice_type = 'voucher' 
                        AND status = 'unpaid' 
                        AND created_at < ?
                    `;
                    
                    this.db.run(deleteSql, [expiryTimeStr], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            const deletedCount = this.changes;
                            if (logActions) {
                                console.log(`🗑️  Deleted ${deletedCount} expired voucher invoices`);
                            }
                            resolve({ 
                                success: true, 
                                message: `Cleaned up ${deletedCount} expired voucher invoices`,
                                cleaned: deletedCount,
                                expiredInvoices: expiredInvoices
                            });
                        }
                    });
                } else {
                    // Just mark as expired without deleting
                    const updateSql = `
                        UPDATE invoices 
                        SET notes = COALESCE(notes, '') || ' [EXPIRED - NOT DELETED]'
                        WHERE invoice_type = 'voucher' 
                        AND status = 'unpaid' 
                        AND created_at < ?
                    `;
                    
                    this.db.run(updateSql, [expiryTimeStr], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            const updatedCount = this.changes;
                            if (logActions) {
                                console.log(`🏷️  Marked ${updatedCount} expired voucher invoices as expired`);
                            }
                            resolve({ 
                                success: true, 
                                message: `Marked ${updatedCount} expired voucher invoices as expired`,
                                cleaned: updatedCount,
                                expiredInvoices: expiredInvoices
                            });
                        }
                    });
                }
            });
        });
    }
    
    async getExpiredVoucherInvoices() {
        return new Promise((resolve, reject) => {
            const expiryHours = parseInt(getSetting('voucher_cleanup.expiry_hours', '24'));
            
            const expiryTime = new Date();
            expiryTime.setHours(expiryTime.getHours() - expiryHours);
            const expiryTimeStr = expiryTime.toISOString();
            
            const sql = `
                SELECT i.id, i.invoice_number, i.amount, i.created_at, i.status, i.notes,
                       c.name as customer_name, c.phone as customer_phone
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.invoice_type = 'voucher' 
                AND i.status = 'unpaid' 
                AND i.created_at < ?
                ORDER BY i.created_at ASC
            `;
            
            this.db.all(sql, [expiryTimeStr], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Monthly summary methods
    async saveMonthlySummary(year, month, stats, notes = null) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT OR REPLACE INTO monthly_summary (
                    year, month, total_customers, active_customers,
                    monthly_invoices, voucher_invoices,
                    paid_monthly_invoices, paid_voucher_invoices,
                    unpaid_monthly_invoices, unpaid_voucher_invoices,
                    monthly_revenue, voucher_revenue,
                    monthly_unpaid, voucher_unpaid,
                    total_revenue, total_unpaid, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const params = [
                year, month,
                stats.total_customers || 0,
                stats.active_customers || 0,
                stats.monthly_invoices || 0,
                stats.voucher_invoices || 0,
                stats.paid_monthly_invoices || 0,
                stats.paid_voucher_invoices || 0,
                stats.unpaid_monthly_invoices || 0,
                stats.unpaid_voucher_invoices || 0,
                stats.monthly_revenue || 0,
                stats.voucher_revenue || 0,
                stats.monthly_unpaid || 0,
                stats.voucher_unpaid || 0,
                stats.total_revenue || 0,
                stats.total_unpaid || 0,
                notes
            ];
            
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, year, month });
                }
            });
        });
    }

    async getMonthlySummary(year, month) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM monthly_summary 
                WHERE year = ? AND month = ?
            `;
            
            this.db.get(sql, [year, month], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getAllMonthlySummaries(limit = 12) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM monthly_summary 
                ORDER BY year DESC, month DESC 
                LIMIT ?
            `;
            
            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async generateMonthlySummary() {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1; // JavaScript months are 0-based
            
            // Get current stats
            const stats = await this.getBillingStats();
            
            // Save to monthly summary
            const notes = `Summary generated on ${now.toISOString().split('T')[0]}`;
            const result = await this.saveMonthlySummary(year, month, stats, notes);
            
            logger.info(`Monthly summary saved for ${year}-${month}: ${JSON.stringify(stats)}`);
            
            return {
                success: true,
                message: `Monthly summary saved for ${year}-${month}`,
                year,
                month,
                stats,
                id: result.id
            };
        } catch (error) {
            logger.error('Error generating monthly summary:', error);
            throw error;
        }
    }

    // Auto reset monthly summary for all collectors and admin
    async performMonthlyReset() {
        try {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            
            // Get previous month for saving summary
            const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
            const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
            
            logger.info(`🔄 Starting monthly reset for ${currentYear}-${currentMonth}`);
            
            // 1. Save admin monthly summary for previous month
            const adminStats = await this.getBillingStats();
            await this.saveMonthlySummary(prevYear, prevMonth, adminStats, `Auto-generated on ${now.toISOString().split('T')[0]}`);
            logger.info(`✅ Admin monthly summary saved for ${prevYear}-${prevMonth}`);
            
            // 2. Save collector monthly summaries for previous month
            const collectors = await this.getAllCollectors();
            for (const collector of collectors) {
                const collectorStats = {
                    total_payments: await this.getCollectorMonthlyPayments(collector.id, prevYear, prevMonth),
                    total_commission: await this.getCollectorMonthlyCommission(collector.id, prevYear, prevMonth),
                    payment_count: await this.getCollectorMonthlyCount(collector.id, prevYear, prevMonth)
                };
                
                await this.saveCollectorMonthlySummary(collector.id, prevYear, prevMonth, collectorStats);
                logger.info(`✅ Collector ${collector.name} monthly summary saved for ${prevYear}-${prevMonth}`);
            }
            
            // 3. Create collector_monthly_summary table if not exists
            await this.ensureCollectorMonthlySummaryTable();
            
            logger.info(`🎉 Monthly reset completed successfully for ${currentYear}-${currentMonth}`);
            
            return {
                success: true,
                message: `Monthly reset completed for ${currentYear}-${currentMonth}`,
                year: currentYear,
                month: currentMonth,
                previousYear: prevYear,
                previousMonth: prevMonth,
                collectorsProcessed: collectors.length
            };
            
        } catch (error) {
            logger.error('Error performing monthly reset:', error);
            throw error;
        }
    }

    // Ensure collector_monthly_summary table exists
    async ensureCollectorMonthlySummaryTable() {
        return new Promise((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS collector_monthly_summary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collector_id INTEGER NOT NULL,
                    year INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    total_payments REAL NOT NULL DEFAULT 0,
                    total_commission REAL NOT NULL DEFAULT 0,
                    payment_count INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(collector_id, year, month)
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Get all collectors
    async getAllCollectors() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM collectors WHERE status = "active"', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Mobile dashboard specific methods
    async getTotalCustomers() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) as count FROM customers`;
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count || 0);
                }
            });
        });
    }

    async getTotalInvoices() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) as count FROM invoices`;
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count || 0);
                }
            });
        });
    }

    async getTotalRevenue() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT SUM(amount) as total FROM invoices WHERE status = 'paid'`;
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.total || 0);
                }
            });
        });
    }

    async getPendingPayments() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) as count FROM invoices WHERE status = 'unpaid'`;
            this.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count || 0);
                }
            });
        });
    }

    async getReportsStats() {
        return new Promise((resolve, reject) => {
            try {
                // Get all stats in parallel with error handling for each query
                Promise.all([
                    // Active customers
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM customers WHERE status = 'active'`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting active customers:', err);
                                res(0); // Return 0 on error instead of rejecting
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Inactive customers
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM customers WHERE status IN ('inactive', 'suspended')`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting inactive customers:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // New customers this month
                    new Promise((res, rej) => {
                        this.db.get(`
                            SELECT COUNT(*) as count 
                            FROM customers 
                            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
                        `, [], (err, row) => {
                            if (err) {
                                console.error('Error getting new customers this month:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Invoices this month
                    new Promise((res, rej) => {
                        this.db.get(`
                            SELECT COUNT(*) as count 
                            FROM invoices 
                            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
                        `, [], (err, row) => {
                            if (err) {
                                console.error('Error getting invoices this month:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Paid invoices
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM invoices WHERE status = 'paid'`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting paid invoices:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Unpaid invoices
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM invoices WHERE status = 'unpaid'`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting unpaid invoices:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Successful payments
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM payments WHERE status = 'completed'`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting successful payments:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    }),
                    // Failed payments
                    new Promise((res, rej) => {
                        this.db.get(`SELECT COUNT(*) as count FROM payments WHERE status = 'failed'`, [], (err, row) => {
                            if (err) {
                                console.error('Error getting failed payments:', err);
                                res(0);
                            } else {
                                res(row?.count || 0);
                            }
                        });
                    })
                ]).then(([
                    activeCustomers,
                    inactiveCustomers,
                    newCustomersThisMonth,
                    invoicesThisMonth,
                    paidInvoices,
                    unpaidInvoices,
                    successfulPayments,
                    failedPayments
                ]) => {
                    // Calculate retention rate
                    const totalCustomers = activeCustomers + inactiveCustomers;
                    const retentionRate = totalCustomers > 0 
                        ? Math.round((activeCustomers / totalCustomers) * 100) 
                        : 0;
                    
                    // Calculate payment rate
                    const totalInvoices = paidInvoices + unpaidInvoices;
                    const paymentRate = totalInvoices > 0 
                        ? Math.round((paidInvoices / totalInvoices) * 100) 
                        : 0;
                    
                    resolve({
                        activeCustomers: activeCustomers || 0,
                        inactiveCustomers: inactiveCustomers || 0,
                        newCustomersThisMonth: newCustomersThisMonth || 0,
                        invoicesThisMonth: invoicesThisMonth || 0,
                        paidInvoices: paidInvoices || 0,
                        unpaidInvoices: unpaidInvoices || 0,
                        successfulPayments: successfulPayments || 0,
                        failedPayments: failedPayments || 0,
                        retentionRate: retentionRate || 0,
                        paymentRate: paymentRate || 0
                    });
                }).catch((err) => {
                    console.error('Error in getReportsStats Promise.all:', err);
                    // Return default values instead of rejecting
                    resolve({
                        activeCustomers: 0,
                        inactiveCustomers: 0,
                        newCustomersThisMonth: 0,
                        invoicesThisMonth: 0,
                        paidInvoices: 0,
                        unpaidInvoices: 0,
                        successfulPayments: 0,
                        failedPayments: 0,
                        retentionRate: 0,
                        paymentRate: 0
                    });
                });
            } catch (error) {
                console.error('Error in getReportsStats:', error);
                // Return default values instead of rejecting
                resolve({
                    activeCustomers: 0,
                    inactiveCustomers: 0,
                    newCustomersThisMonth: 0,
                    invoicesThisMonth: 0,
                    paidInvoices: 0,
                    unpaidInvoices: 0,
                    successfulPayments: 0,
                    failedPayments: 0,
                    retentionRate: 0,
                    paymentRate: 0
                });
            }
        });
    }

    async getOverdueInvoices() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.status = 'unpaid' AND date(i.due_date) < date('now', 'localtime')
                ORDER BY i.due_date ASC
            `;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing billing database:', err);
                } else {
                    console.log('Billing database connection closed');
                }
            });
        }
    }

    // Payment Gateway Methods
    async createOnlinePayment(invoiceId, gateway = null) {
        return new Promise(async (resolve, reject) => {
            try {
                // Get invoice details
                const invoice = await this.getInvoiceById(invoiceId);
                if (!invoice) {
                    throw new Error('Invoice not found');
                }

                // Get customer details
                const customer = await this.getCustomerById(invoice.customer_id);
                if (!customer) {
                    throw new Error('Customer not found');
                }

                // Prepare invoice data for payment gateway
                const paymentData = {
                    id: invoice.id,
                    invoice_number: invoice.invoice_number,
                    amount: invoice.amount,
                    customer_name: customer.name,
                    customer_phone: customer.phone,
                    customer_email: customer.email,
                    package_name: invoice.package_name,
                    package_id: invoice.package_id
                };

                // Create payment with selected gateway
                const paymentResult = await this.paymentGateway.createPayment(paymentData, gateway);

                // Save payment transaction to database
                const sql = `
                    INSERT INTO payment_gateway_transactions 
                    (invoice_id, gateway, order_id, payment_url, token, amount, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `;

                const db = this.db;
                db.run(sql, [
                    invoiceId,
                    paymentResult.gateway,
                    paymentResult.order_id,
                    paymentResult.payment_url,
                    paymentResult.token,
                    invoice.amount,
                    'pending'
                ], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Update invoice with payment gateway info
                        const updateSql = `
                            UPDATE invoices 
                            SET payment_gateway = ?, payment_token = ?, payment_url = ?, payment_status = 'pending'
                            WHERE id = ?
                        `;

                        db.run(updateSql, [
                            paymentResult.gateway,
                            paymentResult.token,
                            paymentResult.payment_url,
                            invoiceId
                        ], (updateErr) => {
                            if (updateErr) {
                                reject(updateErr);
                            } else {
                                resolve(paymentResult);
                            }
                        });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Create online payment with specific method (for customer choice)
    async createOnlinePaymentWithMethod(invoiceId, gateway = null, method = null, paymentType = 'invoice', customerPhoneOverride = null) {
        return new Promise(async (resolve, reject) => {
            try {
                // Get invoice details
                const invoice = await this.getInvoiceById(invoiceId);
                if (!invoice) {
                    throw new Error('Invoice not found');
                }

                // Get customer details
                const customer = await this.getCustomerById(invoice.customer_id);
                if (!customer) {
                    throw new Error('Customer not found');
                }

                // Prepare invoice data for payment gateway
                const paymentData = {
                    id: invoice.id,
                    invoice_number: invoice.invoice_number,
                    amount: invoice.amount,
                    customer_name: customer.name,
                    customer_phone: customerPhoneOverride || customer.phone,
                    customer_email: customer.email,
                    package_name: invoice.package_name,
                    package_id: invoice.package_id,
                    payment_method: method // Add specific method for Tripay
                };

                // Create payment with selected gateway and method
                const paymentResult = await this.paymentGateway.createPaymentWithMethod(paymentData, gateway, method, paymentType);

                // Save payment transaction to database
                const sql = `
                    INSERT INTO payment_gateway_transactions 
                    (invoice_id, gateway, order_id, payment_url, token, amount, status, payment_type) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const db = this.db;
                db.run(sql, [
                    invoiceId,
                    paymentResult.gateway,
                    paymentResult.order_id,
                    paymentResult.payment_url,
                    paymentResult.token,
                    invoice.amount,
                    'pending',
                    method || 'all'
                ], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Update invoice with payment gateway info
                        const updateSql = `
                            UPDATE invoices 
                            SET payment_gateway = ?, payment_token = ?, payment_url = ?, payment_status = 'pending'
                            WHERE id = ?
                        `;

                        db.run(updateSql, [
                            paymentResult.gateway,
                            paymentResult.token,
                            paymentResult.payment_url,
                            invoiceId
                        ], (updateErr) => {
                            if (updateErr) {
                                reject(updateErr);
                            } else {
                                resolve(paymentResult);
                            }
                        });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

async handlePaymentWebhook(payload, gateway) {
    return new Promise(async (resolve, reject) => {
        try {
            logger.info(`[WEBHOOK] Processing ${gateway} webhook:`, payload);

            // Normalize/parse from gateway
            const result = await this.paymentGateway.handleWebhook(payload, gateway);
            logger.info(`[WEBHOOK] Gateway result:`, result);

            // Find transaction by order_id
            const txSql = `
                SELECT * FROM payment_gateway_transactions
                WHERE order_id = ? AND gateway = ?
            `;

            this.db.get(txSql, [result.order_id, gateway], async (err, transaction) => {
                if (err) {
                    logger.error(`[WEBHOOK] Database error:`, err);
                    return reject(err);
                }

                // Fallback by invoice number
                if (!transaction) {
                    logger.warn(`[WEBHOOK] Transaction not found for order_id: ${result.order_id}`);
                    const invoiceNumber = (result.order_id || '').replace('INV-', '');
                    const fallbackSql = `
                        SELECT i.*
                        FROM invoices i
                        WHERE i.invoice_number = ?
                    `;
                    this.db.get(fallbackSql, [invoiceNumber], async (fbErr, invoice) => {
                        if (fbErr || !invoice) {
                            logger.error(`[WEBHOOK] Fallback search failed:`, fbErr);
                            return reject(new Error('Transaction and invoice not found'));
                        }
                        // Process direct payment with idempotency check
                        await this.processDirectPaymentWithIdempotency(invoice, result, gateway);
                        // Immediate restore for fallback path
                        try {
                            const customer = await this.getCustomerById(invoice.customer_id);
                            if (customer && customer.status === 'suspended') {
                                const invoices = await this.getInvoicesByCustomer(customer.id);
                                const unpaid = invoices.filter(i => i.status === 'unpaid');
                                if (unpaid.length === 0) {
                                    const serviceSuspension = require('./serviceSuspension');
                                    await serviceSuspension.restoreCustomerService(customer);
                                }
                            }
                        } catch (restoreErr) {
                            logger.error('[WEBHOOK] Immediate restore (fallback) failed:', restoreErr);
                        }
                        return resolve({ success: true, message: 'Payment processed via fallback method', invoice_id: invoice.id });
                    });
                    return; // stop here, fallback async handled
                }

                // Update transaction status
                const updateSql = `
                    UPDATE payment_gateway_transactions
                    SET status = ?, payment_type = ?, fraud_status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `;
                this.db.run(updateSql, [
                    result.status,
                    result.payment_type || null,
                    result.fraud_status || null,
                    transaction.id
                ], async (updateErr) => {
                    if (updateErr) {
                        logger.error(`[WEBHOOK] Update transaction error:`, updateErr);
                        return reject(updateErr);
                    }

                    if (result.status !== 'success') {
                        logger.info(`[WEBHOOK] Payment status updated: ${result.status}`);
                        return resolve({ success: true, message: 'Payment status updated', status: result.status });
                    }

                    try {
                        logger.info(`[WEBHOOK] Processing successful payment for invoice: ${transaction.invoice_id}`);

                        // Check if payment already exists to prevent duplicates
                        const existingPaymentSql = `
                            SELECT id FROM payments 
                            WHERE invoice_id = ? AND reference_number = ? AND payment_method = 'online'
                        `;
                        
                        const existingPayment = await new Promise((resolve, reject) => {
                            this.db.get(existingPaymentSql, [transaction.invoice_id, result.order_id], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });

                        if (existingPayment) {
                            logger.warn(`[WEBHOOK] Payment already exists for invoice ${transaction.invoice_id}, order ${result.order_id}. Skipping duplicate.`);
                            return resolve({ success: true, message: 'Payment already processed', duplicate: true });
                        }

                        // Mark invoice paid and record payment
                        await this.updateInvoiceStatus(transaction.invoice_id, 'paid', 'online');
                        const paymentData = {
                            invoice_id: transaction.invoice_id,
                            amount: result.amount || transaction.amount,
                            payment_method: 'online',
                            reference_number: result.order_id,
                            notes: `Payment via ${gateway} - ${result.payment_type || 'online'}`
                        };
                        await this.recordPayment(paymentData);

                        // Notify and restore
                        const invoice = await this.getInvoiceById(transaction.invoice_id);
                        const customer = await this.getCustomerById(invoice.customer_id);
                        if (customer) {
                            try {
                                await this.sendPaymentSuccessNotification(customer, invoice);
                            } catch (notificationError) {
                                logger.error(`[WEBHOOK] Failed send notification:`, notificationError);
                            }
                            try {
                                const refreshed = await this.getCustomerById(invoice.customer_id);
                                if (refreshed && refreshed.status === 'suspended') {
                                    const invoices = await this.getInvoicesByCustomer(refreshed.id);
                                    const unpaid = invoices.filter(i => i.status === 'unpaid');
                                    if (unpaid.length === 0) {
                                        const serviceSuspension = require('./serviceSuspension');
                                        await serviceSuspension.restoreCustomerService(refreshed);
                                    }
                                }
                            } catch (restoreErr) {
                                logger.error('[WEBHOOK] Immediate restore failed:', restoreErr);
                            }
                        } else {
                            logger.error(`[WEBHOOK] Customer not found for invoice: ${transaction.invoice_id}`);
                        }

                        return resolve({ success: true, message: 'Payment processed successfully', invoice_id: transaction.invoice_id });
                    } catch (processingError) {
                        logger.error(`[WEBHOOK] Error in payment processing:`, processingError);
                        return resolve({ success: true, message: 'Payment processed successfully', invoice_id: transaction.invoice_id });
                    }
                });
            });
        } catch (error) {
            logger.error(`[WEBHOOK] Webhook processing error:`, error);
            reject(error);
        }
    });
    }

    async getFinancialReport(startDate, endDate, type = 'all') {
        return new Promise((resolve, reject) => {
            try {
                let sql = '';
                const params = [];
                
                if (type === 'income') {
                    // Laporan pemasukan dari pembayaran online, manual, dan kolektor
                    // Hanya menggunakan data dari payments untuk menghindari duplikasi dengan payment_gateway_transactions
                    sql = `
                        SELECT 
                            'income' as type,
                            p.payment_date as date,
                            p.amount as amount,
                            p.payment_method,
                            CASE 
                                WHEN p.payment_type = 'collector' THEN CONCAT('Kolektor - ', COALESCE(col.name, 'Unknown'))
                                WHEN p.payment_method = 'online' AND p.notes LIKE '%tripay%' THEN 'tripay'
                                WHEN p.payment_type = 'manual' THEN 'Manual Payment'
                                ELSE 'Direct Payment'
                            END as gateway_name,
                            i.invoice_number as invoice_number,
                            c.name as customer_name,
                            c.phone as customer_phone,
                            CASE 
                                WHEN p.payment_type = 'collector' THEN CONCAT('Pembayaran via kolektor ', COALESCE(col.name, 'Unknown'))
                                WHEN p.payment_method = 'online' AND p.notes LIKE '%tripay%' THEN p.notes
                                ELSE ''
                            END as description,
                            p.notes,
                            COALESCE(col.name, '') as collector_name,
                            COALESCE(p.commission_amount, 0) as commission_amount
                        FROM payments p
                        JOIN invoices i ON p.invoice_id = i.id
                        JOIN customers c ON i.customer_id = c.id
                        LEFT JOIN collectors col ON p.collector_id = col.id
                        WHERE DATE(p.payment_date) BETWEEN ? AND ?
                        AND p.payment_type IN ('direct', 'collector', 'online', 'manual')
                        
                        UNION ALL
                        
                        SELECT 
                            'income' as type,
                            inc.created_at as date,
                            inc.amount as amount,
                            inc.payment_method,
                            CONCAT('Pendapatan - ', inc.category) as gateway_name,
                            '' as invoice_number,
                            '' as customer_name,
                            '' as customer_phone,
                            inc.description as description,
                            inc.notes,
                            '' as collector_name,
                            0 as commission_amount
                        FROM income inc
                        WHERE DATE(inc.income_date) BETWEEN ? AND ?
                        
                        ORDER BY date DESC
                    `;
                    params.push(startDate, endDate, startDate, endDate);
                } else if (type === 'expense') {
                    // Laporan pengeluaran dari tabel expenses
                    sql = `
                        SELECT 
                            'expense' as type,
                            e.expense_date as date,
                            e.amount as amount,
                            e.payment_method,
                            e.category as gateway_name,
                            e.description as description,
                            e.notes as notes,
                            '' as invoice_number,
                            '' as customer_name,
                            '' as customer_phone,
                            '' as collector_name,
                            0 as commission_amount
                        FROM expenses e
                        WHERE DATE(e.expense_date) BETWEEN ? AND ?
                        ORDER BY e.expense_date DESC
                    `;
                    params.push(startDate, endDate);
                } else {
                    // Laporan gabungan pemasukan dan pengeluaran
                    // Hanya menggunakan data dari payments untuk menghindari duplikasi dengan payment_gateway_transactions
                    sql = `
                        SELECT 
                            'income' as type,
                            p.payment_date as date,
                            p.amount as amount,
                            p.payment_method,
                            CASE 
                                WHEN p.payment_type = 'collector' THEN CONCAT('Kolektor - ', COALESCE(col.name, 'Unknown'))
                                WHEN p.payment_method = 'online' AND p.notes LIKE '%tripay%' THEN 'tripay'
                                WHEN p.payment_type = 'manual' THEN 'Manual Payment'
                                ELSE 'Direct Payment'
                            END as gateway_name,
                            i.invoice_number as invoice_number,
                            c.name as customer_name,
                            c.phone as customer_phone,
                            CASE 
                                WHEN p.payment_type = 'collector' THEN CONCAT('Pembayaran via kolektor ', COALESCE(col.name, 'Unknown'))
                                WHEN p.payment_method = 'online' AND p.notes LIKE '%tripay%' THEN p.notes
                                ELSE ''
                            END as description,
                            p.notes,
                            COALESCE(col.name, '') as collector_name,
                            COALESCE(p.commission_amount, 0) as commission_amount
                        FROM payments p
                        JOIN invoices i ON p.invoice_id = i.id
                        JOIN customers c ON i.customer_id = c.id
                        LEFT JOIN collectors col ON p.collector_id = col.id
                        WHERE DATE(p.payment_date) BETWEEN ? AND ?
                        AND p.payment_type IN ('direct', 'collector', 'online', 'manual')
                        
                        UNION ALL
                        
                        SELECT 
                            'income' as type,
                            inc.created_at as date,
                            inc.amount as amount,
                            inc.payment_method,
                            CONCAT('Pendapatan - ', inc.category) as gateway_name,
                            '' as invoice_number,
                            '' as customer_name,
                            '' as customer_phone,
                            inc.description as description,
                            inc.notes,
                            '' as collector_name,
                            0 as commission_amount
                        FROM income inc
                        WHERE DATE(inc.income_date) BETWEEN ? AND ?
                        
                        UNION ALL
                        
                        SELECT 
                            'expense' as type,
                            e.expense_date as date,
                            e.amount as amount,
                            e.payment_method,
                            e.category as gateway_name,
                            e.description as description,
                            e.notes as notes,
                            '' as invoice_number,
                            '' as customer_name,
                            '' as customer_phone,
                            '' as collector_name,
                            0 as commission_amount
                        FROM expenses e
                        WHERE DATE(e.expense_date) BETWEEN ? AND ?
                        
                        ORDER BY date DESC
                    `;
                    params.push(startDate, endDate, startDate, endDate, startDate, endDate);
                }

                this.db.all(sql, params, async (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        try {
                            let transactions = Array.isArray(rows) ? [...rows] : [];
                            let voucherSummary = {
                                total_vouchers: 0,
                                recognized_vouchers: 0,
                                recognized_revenue: 0,
                                pending_vouchers: 0,
                                pending_revenue: 0
                            };
                            
                            if (type !== 'expense') {
                                const voucherInvoices = await this.getVoucherInvoices(startDate, endDate);
                                const voucherStats = this.calculateVoucherStats(voucherInvoices);
                                
                                voucherSummary = {
                                    total_vouchers: voucherStats.total_vouchers,
                                    recognized_vouchers: voucherStats.paid_vouchers,
                                    recognized_revenue: voucherStats.total_revenue,
                                    pending_vouchers: voucherStats.unpaid_vouchers,
                                    pending_revenue: voucherStats.unpaid_amount
                                };
                                
                                const voucherTransactions = this.buildVoucherTransactions(voucherInvoices);
                                if (voucherTransactions.length > 0) {
                                    transactions = transactions.concat(voucherTransactions);
                                }
                            }
                            
                            // Urutkan transaksi dari terbaru
                            transactions.sort((a, b) => {
                                const dateA = new Date(a.date || a.payment_date || 0).getTime();
                                const dateB = new Date(b.date || b.payment_date || 0).getTime();
                                return dateB - dateA;
                            });
                            
                            // Hitung total dan statistik
                            const totalIncome = transactions.filter(r => r.type === 'income')
                                .reduce((sum, r) => sum + (r.amount || 0), 0);
                            const totalExpense = transactions.filter(r => r.type === 'expense')
                                .reduce((sum, r) => sum + (r.amount || 0), 0);
                            const totalCommission = transactions.filter(r => r.type === 'income')
                                .reduce((sum, r) => sum + (r.commission_amount || 0), 0);
                            const netProfit = totalIncome - totalExpense;
                            
                            // Statistik per tipe pembayaran
                            const incomeByType = transactions.filter(r => r.type === 'income')
                                .reduce((acc, r) => {
                                    const gateway = r.gateway_name || 'Unknown';
                                    if (!acc[gateway]) {
                                        acc[gateway] = { count: 0, amount: 0, commission: 0 };
                                    }
                                    acc[gateway].count++;
                                    acc[gateway].amount += (r.amount || 0);
                                    acc[gateway].commission += (r.commission_amount || 0);
                                    return acc;
                                }, {});
                            
                            // Calculate profit and loss details
                            const profitLossData = await this.calculateProfitLoss(startDate, endDate);
                            
                            const result = {
                                transactions,
                                summary: {
                                    totalIncome,
                                    totalExpense,
                                    totalCommission,
                                    netProfit,
                                    transactionCount: transactions.length,
                                    incomeCount: transactions.filter(r => r.type === 'income').length,
                                    expenseCount: transactions.filter(r => r.type === 'expense').length,
                                    incomeByType
                                },
                                voucherSummary,
                                profitLossData,
                                dateRange: { startDate, endDate }
                            };
                            
                            resolve(result);
                        } catch (processError) {
                            reject(processError);
                        }
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Method untuk mengelola expenses
    async addExpense(expenseData) {
        return new Promise((resolve, reject) => {
            const { amount, category, account_expenses, expense_date, payment_method, notes } = expenseData;
            
            const sql = `INSERT INTO expenses (description, amount, category, account_expenses, expense_date, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            
            // Description dibuat dari account_expenses jika ada, atau dari category
            const description = account_expenses || category || '';
            
            this.db.run(sql, [description, amount, category, account_expenses || null, expense_date, payment_method || null, notes || null], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...expenseData });
                }
            });
        });
    }

    async getExpenses(startDate = null, endDate = null) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM expenses';
            const params = [];
            
            if (startDate && endDate) {
                sql += ' WHERE expense_date BETWEEN ? AND ?';
                params.push(startDate, endDate);
            }
            
            sql += ' ORDER BY expense_date DESC';
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async updateExpense(id, expenseData) {
        return new Promise((resolve, reject) => {
            const { amount, category, account_expenses, expense_date, payment_method, notes } = expenseData;
            
            const sql = `UPDATE expenses SET description = ?, amount = ?, category = ?, account_expenses = ?, expense_date = ?, payment_method = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
            
            // Description dibuat dari account_expenses jika ada, atau dari category
            const description = account_expenses || category || '';
            
            this.db.run(sql, [description, amount, category, account_expenses || null, expense_date, payment_method || null, notes || null, id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, ...expenseData });
                }
            });
        });
    }

    async deleteExpense(id) {
        return new Promise((resolve, reject) => {
            const sql = 'DELETE FROM expenses WHERE id = ?';
            
            this.db.run(sql, [id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, deleted: true });
                }
            });
        });
    }

    // Method untuk menghitung data laba rugi dengan rincian
    async calculateProfitLoss(startDate, endDate) {
        return new Promise(async (resolve, reject) => {
            try {
                // 2. Pendapatan Voucher (tidak bergantung pada invoice_type)
                const voucherInvoices = await this.getVoucherInvoices(startDate, endDate);
                const voucherStats = this.calculateVoucherStats(voucherInvoices);
                
                // 3. Pendapatan lain-lain dari Manajemen Pendapatan
                const incomes = await this.getIncomes(startDate, endDate);
                const otherIncomeTotal = incomes.reduce((sum, inc) => sum + (inc.amount || 0), 0);
                
                // 4. Pengeluaran dengan rincian
                const expenses = await this.getExpenses(startDate, endDate);
                
                // Group expenses by category and account_expenses
                const expensesByCategory = expenses.reduce((acc, exp) => {
                    const category = exp.category || 'Lainnya';
                    const account = exp.account_expenses || 'Tidak Diketahui';
                    
                    if (!acc[category]) {
                        acc[category] = {};
                    }
                    if (!acc[category][account]) {
                        acc[category][account] = 0;
                    }
                    acc[category][account] += (exp.amount || 0);
                    return acc;
                }, {});
                
                // Calculate total expenses by category
                const expensesTotalByCategory = {};
                Object.keys(expensesByCategory).forEach(category => {
                    expensesTotalByCategory[category] = Object.values(expensesByCategory[category])
                        .reduce((sum, amount) => sum + amount, 0);
                });
                
                // 1. Pendapatan Bulanan Pembayaran Pelanggan (bukan voucher)
                // Check if invoice_type column exists
                this.db.all("PRAGMA table_info(invoices)", (pragmaErr, columns) => {
                    if (pragmaErr) {
                        reject(pragmaErr);
                        return;
                    }
                    
                    const hasInvoiceType = columns.some(col => col.name === 'invoice_type');
                    
                    let monthlyPaymentSql;
                    if (hasInvoiceType) {
                        monthlyPaymentSql = `
                            SELECT SUM(p.amount) as total
                            FROM payments p
                            JOIN invoices i ON p.invoice_id = i.id
                            WHERE DATE(p.payment_date) BETWEEN ? AND ?
                            AND p.payment_type IN ('direct', 'collector', 'online', 'manual')
                            AND (i.invoice_type != 'voucher' OR i.invoice_type IS NULL)
                            AND i.invoice_number NOT LIKE 'VCHR-%'
                        `;
                    } else {
                        // If invoice_type column doesn't exist, filter by invoice_number pattern
                        monthlyPaymentSql = `
                            SELECT SUM(p.amount) as total
                            FROM payments p
                            JOIN invoices i ON p.invoice_id = i.id
                            WHERE DATE(p.payment_date) BETWEEN ? AND ?
                            AND p.payment_type IN ('direct', 'collector', 'online', 'manual')
                            AND i.invoice_number NOT LIKE 'VCHR-%'
                        `;
                    }
                    
                    // Get monthly payment total
                    this.db.get(monthlyPaymentSql, [startDate, endDate], (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        const monthlyPaymentTotal = row?.total || 0;
                        const voucherRevenue = voucherStats.total_revenue || 0;
                        const totalRevenue = monthlyPaymentTotal + voucherRevenue + otherIncomeTotal;
                        const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
                        const netProfit = totalRevenue - totalExpenses;
                        
                        resolve({
                            revenue: {
                                monthlyPayment: monthlyPaymentTotal,
                                voucher: voucherRevenue,
                                otherIncome: otherIncomeTotal,
                                total: totalRevenue
                            },
                            expenses: {
                                byCategory: expensesByCategory,
                                totalByCategory: expensesTotalByCategory,
                                total: totalExpenses
                            },
                            netProfit: netProfit
                        });
                    });
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Method untuk mengelola income (pemasukan)
    async addIncome(incomeData) {
        return new Promise((resolve, reject) => {
            const { description, amount, category, income_date, payment_method, notes } = incomeData;
            
            const sql = `INSERT INTO income (description, amount, category, income_date, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?)`;
            
            this.db.run(sql, [description, amount, category, income_date, payment_method, notes], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...incomeData });
                }
            });
        });
    }

    async getIncomes(startDate = null, endDate = null) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM income';
            const params = [];
            
            if (startDate && endDate) {
                sql += ' WHERE income_date BETWEEN ? AND ?';
                params.push(startDate, endDate);
            }
            
            sql += ' ORDER BY income_date DESC';
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async updateIncome(id, incomeData) {
        return new Promise((resolve, reject) => {
            const { description, amount, category, income_date, payment_method, notes } = incomeData;
            
            const sql = `UPDATE income SET description = ?, amount = ?, category = ?, income_date = ?, payment_method = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
            
            this.db.run(sql, [description, amount, category, income_date, payment_method, notes, id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, ...incomeData });
                }
            });
        });
    }

    async deleteIncome(id) {
        return new Promise((resolve, reject) => {
            const sql = 'DELETE FROM income WHERE id = ?';
            
            this.db.run(sql, [id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id, deleted: true });
                }
            });
        });
    }

    // Method untuk mendapatkan statistik komisi kolektor
    async getCommissionStats(startDate = null, endDate = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    c.id as collector_id,
                    c.name as collector_name,
                    COUNT(p.id) as payment_count,
                    SUM(p.amount) as total_collected,
                    SUM(p.commission_amount) as total_commission,
                    AVG(p.commission_amount) as avg_commission,
                    MAX(p.payment_date) as last_payment_date
                FROM collectors c
                LEFT JOIN payments p ON c.id = p.collector_id AND p.payment_type = 'collector'
            `;
            
            const params = [];
            if (startDate && endDate) {
                sql += ' WHERE DATE(p.payment_date) BETWEEN ? AND ?';
                params.push(startDate, endDate);
            }
            
            sql += ' GROUP BY c.id, c.name ORDER BY total_commission DESC';
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Hitung total komisi dari expenses
                    const expenseSql = `
                        SELECT SUM(amount) as total_commission_expenses
                        FROM expenses 
                        WHERE category = 'Operasional' AND description LIKE 'Komisi Kolektor%'
                    `;
                    
                    if (startDate && endDate) {
                        expenseSql += ' AND DATE(expense_date) BETWEEN ? AND ?';
                        params.push(startDate, endDate);
                    }
                    
                    this.db.get(expenseSql, params.slice(params.length - 2), (err, expenseRow) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({
                                collectors: rows,
                                totalCommissionExpenses: expenseRow ? expenseRow.total_commission_expenses || 0 : 0,
                                totalCommissionFromPayments: rows.reduce((sum, row) => sum + (row.total_commission || 0), 0)
                            });
                        }
                    });
                }
            });
        });
    }

    // Method untuk mendapatkan kolektor dengan pending amounts (untuk remittance)
    async getCollectorsWithPendingAmounts() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    c.id,
                    c.name,
                    c.phone,
                    c.commission_rate,
                    COALESCE(SUM(p.amount - p.commission_amount), 0) as pending_amount,
                    COUNT(p.id) as pending_payments_count
                FROM collectors c
                LEFT JOIN payments p ON c.id = p.collector_id 
                    AND p.payment_type = 'collector'
                    AND p.remittance_status IS NULL
                WHERE c.status = 'active'
                GROUP BY c.id, c.name, c.phone, c.commission_rate
                ORDER BY c.name
            `;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    // Method untuk mendapatkan riwayat komisi (expenses) sebagai remittances
    async getCommissionExpenses() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    e.id,
                    e.description,
                    e.amount,
                    e.expense_date as received_at,
                    e.payment_method,
                    e.notes,
                    SUBSTR(e.description, 18) as collector_name
                FROM expenses e
                WHERE e.category = 'Operasional' 
                AND e.description LIKE 'Komisi Kolektor%'
                ORDER BY e.expense_date DESC
                LIMIT 20
            `;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    // Method untuk mencatat remittance (update status di payments)
    async recordCollectorRemittance(remittanceData) {
        return new Promise((resolve, reject) => {
            const { collector_id, amount, payment_method, notes, remittance_date } = remittanceData;
            const self = this; // Store reference to this
            
            // Mulai transaction
            this.db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Update payments dengan remittance_status = 'remitted'
                const updateSql = `
                    UPDATE payments 
                    SET remittance_status = 'remitted', 
                        remittance_date = ?,
                        remittance_notes = ?
                    WHERE collector_id = ? 
                    AND payment_type = 'collector'
                    AND remittance_status IS NULL
                `;
                
                // Update semua payment yang belum di-remit
                self.db.run(updateSql, [remittance_date, notes, collector_id], function(err) {
                    if (err) {
                        self.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    
                    // Commit transaction
                    self.db.run('COMMIT', (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ 
                                success: true, 
                                updatedPayments: this.changes,
                                ...remittanceData 
                            });
                        }
                    });
                });
            });
        });
    }

    async getPaymentTransactions(invoiceId = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT pgt.*, i.invoice_number, c.name as customer_name
                FROM payment_gateway_transactions pgt
                JOIN invoices i ON pgt.invoice_id = i.id
                JOIN customers c ON i.customer_id = c.id
            `;

            const params = [];
            if (invoiceId) {
                sql += ' WHERE pgt.invoice_id = ?';
                params.push(invoiceId);
            }

            sql += ' ORDER BY pgt.created_at DESC';

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getGatewayStatus() {
        return this.paymentGateway.getGatewayStatus();
    }

    // Send payment success notification
    async sendPaymentSuccessNotification(customer, invoice) {
        try {
            logger.info(`[NOTIFICATION] Sending payment success notification to ${customer.phone} for invoice ${invoice.invoice_number}`);
            
            const whatsapp = require('./whatsapp');
            
            // Cek apakah WhatsApp sudah terhubung
            const whatsappStatus = whatsapp.getWhatsAppStatus();
            if (!whatsappStatus || !whatsappStatus.connected) {
                logger.warn(`[NOTIFICATION] WhatsApp not connected, status: ${JSON.stringify(whatsappStatus)}`);
                return false;
            }
            
            const message = `🎉 *Pembayaran Berhasil!*

Halo ${customer.name},

Pembayaran tagihan Anda telah berhasil diproses:

📋 *Detail Pembayaran:*
• No. Tagihan: ${invoice.invoice_number}
• Jumlah: Rp ${parseFloat(invoice.amount).toLocaleString('id-ID')}
• Status: LUNAS ✅

Terima kasih telah mempercayai layanan kami.

*${getCompanyHeader()}*
Info: ${getSetting('contact_whatsapp', '0813-6888-8498')}`;

            const result = await whatsapp.sendMessage(customer.phone, message);
            logger.info(`[NOTIFICATION] WhatsApp message sent successfully to ${customer.phone}`);
            return result;
        } catch (error) {
            logger.error(`[NOTIFICATION] Error sending payment success notification to ${customer.phone}:`, error);
            return false;
        }
    }

    // Fungsi untuk mendapatkan statistik laporan keuangan voucher
    // Menggunakan tabel voucher_revenue (bukan invoices), karena invoice hanya untuk pelanggan PPPoE
    async getVoucherReportStats(startDate, endDate) {
        // Keperluan backward compat: gunakan getVoucherInvoices untuk statistik
        const invoices = await this.getVoucherInvoices(startDate, endDate);
        return this.calculateVoucherStats(invoices);
    }

    // Fungsi untuk mendapatkan statistik laporan keuangan PPPoE
    async getPPPoEReportStats(startDate, endDate) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_invoices,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_invoices,
                    SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_invoices,
                    COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as total_revenue,
                    COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount ELSE 0 END), 0) as unpaid_amount,
                    COUNT(DISTINCT customer_id) as total_customers,
                    COUNT(DISTINCT CASE WHEN status = 'paid' THEN customer_id ELSE NULL END) as paid_customers
                FROM invoices
                WHERE (invoice_type != 'voucher' OR invoice_type IS NULL)
                AND DATE(created_at) >= ? AND DATE(created_at) <= ?
            `;
            
            this.db.get(sql, [startDate, endDate], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        total_invoices: parseInt(row.total_invoices) || 0,
                        paid_invoices: parseInt(row.paid_invoices) || 0,
                        unpaid_invoices: parseInt(row.unpaid_invoices) || 0,
                        total_revenue: parseFloat(row.total_revenue) || 0,
                        unpaid_amount: parseFloat(row.unpaid_amount) || 0,
                        total_customers: parseInt(row.total_customers) || 0,
                        paid_customers: parseInt(row.paid_customers) || 0
                    });
                }
            });
        });
    }

    // Fungsi untuk mendapatkan daftar voucher revenue dengan filter tanggal
    // Menggunakan tabel voucher_revenue (bukan invoices), karena invoice hanya untuk pelanggan PPPoE
    async getVoucherInvoices(startDate, endDate) {
        return new Promise(async (resolve, reject) => {
            try {
                logger.info(`getVoucherInvoices called: startDate=${startDate}, endDate=${endDate}`);
                
                // Dapatkan semua voucher revenue dari billing.db
                let sql = `
                    SELECT 
                        id,
                        username as voucher_username,
                        price as amount,
                        profile,
                        created_at,
                        used_at,
                        status,
                        usage_count,
                        notes
                    FROM voucher_revenue
                    WHERE date(created_at) >= date(?)
                    AND date(created_at) <= date(?)
                `;
                
                const params = [startDate, endDate];
                
                sql += ` ORDER BY created_at DESC`;
                
                logger.info(`Executing SQL: ${sql} with params: [${params.join(', ')}]`);
                
                this.db.all(sql, params, async (err, voucherRows) => {
                    if (err) {
                        logger.error(`Error getting voucher revenue: ${err.message}`);
                        reject(err);
                        return;
                    }
                    
                    logger.info(`Found ${voucherRows ? voucherRows.length : 0} voucher revenue rows from database`);
                    
                    // Optimasi: Query radacct sekali saja untuk semua voucher menggunakan batch query
                    // Jangan query per voucher karena sangat lambat!
                    try {
                        const { getRadiusConnection } = require('./mikrotik');
                        const conn = await getRadiusConnection();
                        
                        // Ambil semua username dari voucherRows
                        const usernames = (voucherRows || []).map(v => v.voucher_username).filter(u => u);
                        
                        if (usernames.length === 0) {
                            await conn.end();
                            resolve(voucherRows || []);
                            return;
                        }
                        
                        // Batch query: ambil semua usage info sekaligus dengan satu query
                        const placeholders = usernames.map(() => '?').join(',');
                        const [usageRows] = await conn.execute(`
                            SELECT 
                                username,
                                MIN(acctstarttime) as first_used_at,
                                MAX(acctstoptime) as last_used_at,
                                COUNT(*) as usage_count
                            FROM radacct
                            WHERE username IN (${placeholders})
                            AND acctstarttime IS NOT NULL
                            GROUP BY username
                        `, usernames);
                        
                        await conn.end();
                        
                        // Buat map untuk lookup cepat
                        const usageMap = new Map();
                        (usageRows || []).forEach(usage => {
                            usageMap.set(usage.username, {
                                first_used_at: usage.first_used_at || null,
                                last_used_at: usage.last_used_at || null,
                                usage_count: parseInt(usage.usage_count) || 0
                            });
                        });
                        
                        // Helper untuk menentukan status penggunaan
                        const normalizeUsageInfo = (voucher) => {
                            const usage = usageMap.get(voucher.voucher_username);
                            const fallbackFirstUsed = (voucher.used_at && voucher.used_at !== '0000-00-00 00:00:00') ? voucher.used_at : null;
                            const firstUsedAt = usage && usage.first_used_at ? usage.first_used_at : fallbackFirstUsed;
                            const usageCount = usage ? usage.usage_count : (voucher.usage_count || 0);
                            const numericUsage = parseInt(usageCount, 10) || 0;
                            const hasUsage = numericUsage > 0 || (firstUsedAt && firstUsedAt !== '0000-00-00 00:00:00');
                            const statusFromDb = (voucher.status || '').toLowerCase();
                            const isPaid = statusFromDb === 'paid' || hasUsage;
                            
                            return {
                                ...voucher,
                                first_used_at: firstUsedAt,
                                last_used_at: usage && usage.last_used_at ? usage.last_used_at : (voucher.used_at || null),
                                usage_count: numericUsage,
                                computed_status: isPaid ? 'paid' : 'unpaid',
                                usage_status_label: isPaid ? 'Sudah Digunakan' : 'Belum Digunakan',
                                usage_status_badge: isPaid ? 'success' : 'secondary'
                            };
                        };
                        
                        const vouchersWithUsage = (voucherRows || []).map(normalizeUsageInfo);
                        
                        logger.info(`Returning ${vouchersWithUsage.length} vouchers with usage info (batch query)`);
                        resolve(vouchersWithUsage || []);
                    } catch (radiusError) {
                        logger.error(`Error connecting to RADIUS: ${radiusError.message}`);
                        logger.info(`Returning ${voucherRows ? voucherRows.length : 0} vouchers from database only`);
                        // Jika error, tetap return data dari voucher_revenue dengan normalisasi status dasar
                        const fallback = (voucherRows || []).map(voucher => {
                            const fallbackFirstUsed = (voucher.used_at && voucher.used_at !== '0000-00-00 00:00:00') ? voucher.used_at : null;
                            const numericUsage = parseInt(voucher.usage_count || 0, 10) || 0;
                            const hasUsage = numericUsage > 0 || Boolean(fallbackFirstUsed);
                            const isPaid = (voucher.status || '').toLowerCase() === 'paid' || hasUsage;
                            return {
                                ...voucher,
                                first_used_at: fallbackFirstUsed,
                                last_used_at: fallbackFirstUsed,
                                usage_count: numericUsage,
                                computed_status: isPaid ? 'paid' : 'unpaid',
                                usage_status_label: isPaid ? 'Sudah Digunakan' : 'Belum Digunakan',
                                usage_status_badge: isPaid ? 'success' : 'secondary'
                            };
                        });
                        resolve(fallback);
                    }
                });
            } catch (error) {
                logger.error(`Error in getVoucherInvoices: ${error.message}`);
                reject(error);
            }
        });
    }

    // Fungsi untuk mendapatkan daftar invoice PPPoE dengan filter tanggal
    async getPPPoEInvoices(startDate, endDate, status = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    i.*,
                    c.name as customer_name,
                    c.username as customer_username,
                    c.phone as customer_phone,
                    p.name as package_name,
                    p.speed as package_speed
                FROM invoices i
                LEFT JOIN customers c ON i.customer_id = c.id
                LEFT JOIN packages p ON i.package_id = p.id
                WHERE (i.invoice_type != 'voucher' OR i.invoice_type IS NULL)
                AND DATE(i.created_at) >= ? AND DATE(i.created_at) <= ?
            `;
            
            const params = [startDate, endDate];
            
            if (status) {
                sql += ` AND i.status = ?`;
                params.push(status);
            }
            
            sql += ` ORDER BY i.created_at DESC`;
            
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }
}

// Create singleton instance
const billingManager = new BillingManager();

billingManager.calculateVoucherStats = function(invoices = []) {
    const totalVouchers = invoices.length;
    const paidInvoices = invoices.filter(inv => inv.computed_status === 'paid');
    const unpaidInvoices = invoices.filter(inv => inv.computed_status !== 'paid');
    
    const toNumber = (value) => {
        const num = parseFloat(value);
        return Number.isFinite(num) ? num : 0;
    };
    
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + toNumber(inv.amount || inv.price || 0), 0);
    const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + toNumber(inv.amount || inv.price || 0), 0);
    const averagePrice = paidInvoices.length > 0 ? totalRevenue / paidInvoices.length : 0;
    
    return {
        total_vouchers: totalVouchers,
        paid_vouchers: paidInvoices.length,
        unpaid_vouchers: unpaidInvoices.length,
        total_revenue: totalRevenue,
        unpaid_amount: unpaidAmount,
        average_price: averagePrice
    };
};

billingManager.filterVoucherInvoicesByStatus = function(invoices = [], status = 'all') {
    if (!status || status === 'all') return invoices;
    const normalizedStatus = status.toLowerCase();
    return invoices.filter(inv => (inv.computed_status || '').toLowerCase() === normalizedStatus);
};

billingManager.normalizeVoucherDate = function(dateValue) {
    if (!dateValue) {
        return new Date().toISOString();
    }

    if (dateValue instanceof Date) {
        return dateValue.toISOString();
    }

    if (typeof dateValue === 'string') {
        let normalized = dateValue.trim();
        if (!normalized) {
            return new Date().toISOString();
        }

        // Replace space with T for ISO compliance
        if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(normalized)) {
            normalized = normalized.replace(' ', 'T');
        }

        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }

        // Fallback: assume local time string
        const fallback = normalized.replace(' ', 'T');
        const parsedFallback = new Date(fallback);
        if (!Number.isNaN(parsedFallback.getTime())) {
            return parsedFallback.toISOString();
        }
    }

    return new Date().toISOString();
};

billingManager.buildVoucherTransactions = function(voucherInvoices = []) {
    return voucherInvoices
        .filter(inv => (inv.computed_status || '').toLowerCase() === 'paid')
        .map(inv => {
            const amount = parseFloat(inv.amount || inv.price || 0) || 0;
            const dateSource = inv.first_used_at || inv.used_at || inv.created_at;
            const normalizedDate = this.normalizeVoucherDate(dateSource);
            const descriptionParts = [`Voucher ${inv.voucher_username}`];
            if (inv.profile) {
                descriptionParts.push(`(${inv.profile})`);
            }
            return {
                type: 'income',
                date: normalizedDate,
                amount,
                payment_method: 'voucher',
                gateway_name: 'Voucher',
                invoice_number: inv.invoice_number || `VCHR-${inv.voucher_username}`,
                customer_name: inv.voucher_username,
                customer_phone: '',
                description: descriptionParts.join(' '),
                notes: inv.notes || '',
                collector_name: '',
                commission_amount: 0
            };
        });
};

module.exports = billingManager; 