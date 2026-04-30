const logger = require('./logger');
const billingManager = require('./billing');
const { getMikrotikConnectionForCustomer, suspendUserRadius, unsuspendUserRadius } = require('./mikrotik');
const { findDeviceByPhoneNumber, findDeviceByPPPoE, setParameterValues } = require('./genieacs');
const { getSetting } = require('./settingsManager');
const staticIPSuspension = require('./staticIPSuspension');
const { getRadiusConfigValue } = require('./radiusConfig');

// Helper untuk get user_auth_mode (prioritaskan database)
async function getUserAuthMode() {
    try {
        const mode = await getRadiusConfigValue('user_auth_mode', null);
        if (mode !== null) return mode;
    } catch (e) {
        // Fallback ke settings.json
    }
    return getSetting('user_auth_mode', 'mikrotik');
}

class ServiceSuspensionManager {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Pastikan profile isolir (berdasarkan setting) tersedia di Mikrotik jika perlu
     * Hanya auto-create bila nama profil = 'isolir'
     */
    async ensureIsolirProfile(customer) {
        try {
            const mikrotik = await getMikrotikConnectionForCustomer(customer);
            
            const selectedProfile = getSetting('isolir_profile', 'isolir');
            // Cek apakah profile isolir sudah ada
            const profiles = await mikrotik.write('/ppp/profile/print', [
                `?name=${selectedProfile}`
            ]);
            
            if (profiles && profiles.length > 0) {
                logger.info(`Isolir profile '${selectedProfile}' already exists in Mikrotik`);
                return profiles[0]['.id'];
            }
            
            // Buat profile jika belum ada, menggunakan nama sesuai setting
            const newProfile = await mikrotik.write('/ppp/profile/add', [
                `=name=${selectedProfile}`,
                '=local-address=0.0.0.0',
                '=remote-address=0.0.0.0',
                '=rate-limit=0/0',
                '=comment=SUSPENDED_PROFILE',
                '=shared-users=1'
            ]);
            
            const profileId = newProfile[0]['ret'];
            logger.info('Created isolir profile in Mikrotik with ID:', profileId);
            return profileId;
            
        } catch (error) {
            logger.error('Error ensuring isolir profile:', error);
            throw error;
        }
    }

    /**
     * Suspend layanan pelanggan (blokir internet)
     * Mendukung PPPoE dan IP statik
     */
    async suspendCustomerService(customer, reason = 'Telat bayar') {
        try {
            logger.info(`Suspending service for customer: ${customer.username} (${reason})`);

            const results = {
                mikrotik: false,
                genieacs: false,
                billing: false,
                suspension_type: null
            };

            // Tentukan tipe koneksi pelanggan
            const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || (customer.username && String(customer.username).trim());
            const hasPPPoE = !!pppUser;
            const hasStaticIP = customer.static_ip || customer.ip_address || customer.assigned_ip;
            const hasMacAddress = customer.mac_address;

            // 1. Prioritas suspend PPPoE jika tersedia
            if (hasPPPoE) {
                results.suspension_type = 'pppoe';
                const authMode = await getUserAuthMode();
                
                // Check jika menggunakan RADIUS mode
                if (authMode === 'radius') {
                    try {
                        // PENTING: Putuskan koneksi PPPoE aktif TERLEBIH DAHULU sebelum mengubah group
                        // Agar saat reconnect, langsung dapat IP isolir
                        try {
                            const { disconnectPPPoEUser, getRouterForCustomer, getMikrotikConnectionForRouter } = require('./mikrotik');
                            let routerObj = null;
                            
                            // Coba dapatkan router dari customer mapping
                            try {
                                routerObj = await getRouterForCustomer(customer);
                            } catch (routerError) {
                                // Jika customer tidak punya router mapping, cari di semua router
                                logger.warn(`RADIUS: Customer tidak punya router mapping, mencari di semua router untuk ${pppUser}`);
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
                                            logger.info(`RADIUS: Found active session for ${pppUser} on router ${router.name}`);
                                            break;
                                        }
                                    } catch (e) {
                                        // Continue to next router
                                    }
                                }
                                
                                // Jika tidak ditemukan, gunakan router pertama sebagai fallback
                                if (!routerObj && routers.length > 0) {
                                    routerObj = routers[0];
                                    logger.warn(`RADIUS: No active session found, using first router as fallback: ${routerObj.name}`);
                                }
                            }
                            
                            if (routerObj) {
                                // Disconnect active session TERLEBIH DAHULU menggunakan helper function
                                const disconnectResult = await disconnectPPPoEUser(pppUser, routerObj);
                                
                                if (disconnectResult.success && disconnectResult.disconnected > 0) {
                                    logger.info(`RADIUS: Disconnected ${disconnectResult.disconnected} active PPPoE session(s) for ${pppUser} before changing to isolir group`);
                                    
                                    // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                } else if (disconnectResult.disconnected === 0) {
                                    logger.info(`RADIUS: User ${pppUser} tidak sedang online, langsung ubah group ke isolir`);
                                } else {
                                    logger.warn(`RADIUS: Disconnect result: ${disconnectResult.message}`);
                                }
                            } else {
                                logger.warn(`RADIUS: Tidak ada router yang tersedia untuk disconnect ${pppUser}`);
                            }
                        } catch (disconnectError) {
                            logger.warn(`RADIUS: Failed to disconnect active session for ${pppUser}: ${disconnectError.message}`);
                            // Continue dengan perubahan group meskipun disconnect gagal
                        }
                        
                        // Setelah disconnect, baru ubah group ke isolir
                        const suspendResult = await suspendUserRadius(pppUser);
                        if (suspendResult && suspendResult.success) {
                            results.mikrotik = true;
                            results.radius = true;
                            logger.info(`RADIUS: Successfully suspended user ${pppUser} (moved to isolir group, will get isolir IP on reconnect)`);
                        } else {
                            logger.error(`RADIUS: Suspension failed for ${pppUser}`);
                        }
                    } catch (radiusError) {
                        logger.error(`RADIUS suspension failed for ${customer.username}:`, radiusError.message);
                    }
                } else {
                    // Mode Mikrotik API (original code)
                    try {
                        const mikrotik = await getMikrotikConnectionForCustomer(customer);
                        
                        // Tentukan profile isolir dari setting
                        const selectedProfile = getSetting('isolir_profile', 'isolir');
                        // Pastikan profile isolir ada pada NAS milik customer
                        await this.ensureIsolirProfile(customer);

                        // PENTING: Putuskan koneksi PPPoE aktif TERLEBIH DAHULU sebelum mengubah profile
                        // Agar saat reconnect, langsung dapat IP isolir
                        const { disconnectPPPoEUser } = require('./mikrotik');
                        const disconnectResult = await disconnectPPPoEUser(pppUser, mikrotik);
                        
                        if (disconnectResult.success && disconnectResult.disconnected > 0) {
                            logger.info(`Mikrotik: Disconnected ${disconnectResult.disconnected} active PPPoE session(s) for ${customer.pppoe_username} before changing to isolir profile`);
                            
                            // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else if (disconnectResult.disconnected === 0) {
                            logger.info(`Mikrotik: User ${customer.pppoe_username} tidak sedang online, langsung ubah profile ke isolir`);
                        } else {
                            logger.warn(`Mikrotik: Disconnect result: ${disconnectResult.message}`);
                        }

                        // Setelah disconnect, baru ubah profile ke isolir
                        // Cari .id secret berdasarkan name terlebih dahulu
                        let secretId = null;
                        try {
                            const secrets = await mikrotik.write('/ppp/secret/print', [
                                `?name=${pppUser}`
                            ]);
                            if (secrets && secrets.length > 0) {
                                secretId = secrets[0]['.id'];
                            }
                        } catch (lookupErr) {
                            logger.warn(`Mikrotik: failed to lookup secret id for ${customer.pppoe_username}: ${lookupErr.message}`);
                        }

                        // Update PPPoE user dengan profile isolir, gunakan .id bila tersedia, fallback ke =name=
                        const setParams = secretId
                            ? [`=.id=${secretId}`, `=profile=${selectedProfile}`, `=comment=SUSPENDED - ${reason}`]
                            : [`=name=${pppUser}`, `=profile=${selectedProfile}`, `=comment=SUSPENDED - ${reason}`];

                        await mikrotik.write('/ppp/secret/set', setParams);
                        logger.info(`Mikrotik: Set profile to '${selectedProfile}' for ${customer.pppoe_username} (${secretId ? 'by .id' : 'by name'}) - will get isolir IP on reconnect`);
                        
                        results.mikrotik = true;
                        logger.info(`Mikrotik: Successfully suspended PPPoE user ${customer.pppoe_username} with isolir profile`);
                    } catch (mikrotikError) {
                        logger.error(`Mikrotik PPPoE suspension failed for ${customer.username}:`, mikrotikError.message);
                    }
                }
            }
            // 2. Jika tidak ada PPPoE, coba suspend IP statik
            else if (hasStaticIP || hasMacAddress) {
                results.suspension_type = 'static_ip';
                try {
                    // Tentukan metode suspend dari setting (default: address_list)
                    const suspensionMethod = getSetting('static_ip_suspension_method', 'address_list');
                    
                    const staticResult = await staticIPSuspension.suspendStaticIPCustomer(
                        customer, 
                        reason, 
                        suspensionMethod
                    );
                    
                    if (staticResult.success) {
                        results.mikrotik = true;
                        results.static_ip_method = staticResult.results?.method_used;
                        logger.info(`Static IP suspension successful for ${customer.username} using ${staticResult.results?.method_used}`);
                    } else {
                        logger.error(`Static IP suspension failed for ${customer.username}: ${staticResult.error}`);
                    }
                } catch (staticIPError) {
                    logger.error(`Static IP suspension failed for ${customer.username}:`, staticIPError.message);
                }
            }
            // 3. Jika tidak ada PPPoE atau IP statik, coba cari device untuk suspend WAN
            else {
                results.suspension_type = 'wan_disable';
                logger.warn(`Customer ${customer.username} has no PPPoE username or static IP, trying WAN disable method`);
            }

            // 2. Suspend via GenieACS (disable WAN connection)
            if (customer.phone || customer.pppoe_username) {
                try {
                    let device = null;
                    
                    // Coba cari device by phone number dulu
                    if (customer.phone) {
                        try {
                            device = await findDeviceByPhoneNumber(customer.phone);
                        } catch (phoneError) {
                            logger.warn(`Device not found by phone ${customer.phone}, trying PPPoE...`);
                        }
                    }
                    
                    // Jika tidak ketemu, coba by PPPoE username
                    if (!device && customer.pppoe_username) {
                        try {
                            device = await findDeviceByPPPoE(customer.pppoe_username);
                        } catch (pppoeError) {
                            logger.warn(`Device not found by PPPoE ${customer.pppoe_username}`);
                        }
                    }

                    if (device) {
                        // Disable WAN connection di modem
                        const parameters = [
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", false, "xsd:boolean"],
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", false, "xsd:boolean"]
                        ];

                        await setParameterValues(device._id, parameters);
                        results.genieacs = true;
                        logger.info(`GenieACS: Successfully suspended device ${device._id} for customer ${customer.username}`);
                    } else {
                        logger.warn(`GenieACS: No device found for customer ${customer.username}`);
                    }
                } catch (genieacsError) {
                    logger.error(`GenieACS suspension failed for ${customer.username}:`, genieacsError.message);
                }
            }

            // 3. Update status di billing database
            try {
                if (customer.id) {
                    logger.info(`[SUSPEND] Updating billing status by id=${customer.id} to 'suspended' (username=${customer.username||customer.pppoe_username||'-'})`);
                    await billingManager.setCustomerStatusById(customer.id, 'suspended');
                    results.billing = true;
                } else {
                    // Resolve by username first, then phone, to obtain reliable id
                    let resolved = null;
                    if (customer.pppoe_username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.pppoe_username); } catch (_) {}
                    }
                    if (!resolved && customer.username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.username); } catch (_) {}
                    }
                    if (!resolved && customer.phone) {
                        try { resolved = await billingManager.getCustomerByPhone(customer.phone); } catch (_) {}
                    }
                    if (resolved && resolved.id) {
                        logger.info(`[SUSPEND] Resolved customer id=${resolved.id} (username=${resolved.pppoe_username||resolved.username||'-'}) → set 'suspended'`);
                        await billingManager.setCustomerStatusById(resolved.id, 'suspended');
                        results.billing = true;
                    } else if (customer.phone) {
                        logger.warn(`[SUSPEND] Falling back to update by phone=${customer.phone} (no id resolved)`);
                        await billingManager.updateCustomer(customer.phone, { ...customer, status: 'suspended' });
                        results.billing = true;
                    } else {
                        logger.error(`[SUSPEND] Unable to resolve customer identifier for status update`);
                    }
                }
            } catch (billingError) {
                logger.error(`Billing update failed for ${customer.username}:`, billingError.message);
            }

            // 4. Send WhatsApp notification
            try {
                const whatsappNotifications = require('./whatsapp-notifications');
                await whatsappNotifications.sendServiceSuspensionNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`WhatsApp notification failed for ${customer.username}:`, notificationError.message);
            }
            
            // 5. Send Email notification
            try {
                const emailNotifications = require('./email-notifications');
                await emailNotifications.sendServiceSuspensionNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`Email notification failed for ${customer.username}:`, notificationError.message);
            }

            return {
                success: results.mikrotik || results.genieacs || results.billing,
                results,
                customer: customer.username,
                reason
            };

        } catch (error) {
            logger.error(`Error suspending service for ${customer.username}:`, error);
            throw error;
        }
    }

    /**
     * Restore layanan pelanggan (aktifkan kembali internet)
     * Mendukung PPPoE dan IP statik
     */
    async restoreCustomerService(customer, reason = 'Manual restore') {
        try {
            logger.info(`Restoring service for customer: ${customer.username} (${reason})`);

            const results = {
                mikrotik: false,
                genieacs: false,
                billing: false,
                restoration_type: null
            };

            // Tentukan tipe koneksi pelanggan
            const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || (customer.username && String(customer.username).trim());
            const hasPPPoE = !!pppUser;
            const hasStaticIP = customer.static_ip || customer.ip_address || customer.assigned_ip;
            const hasMacAddress = customer.mac_address;

            // 1. Prioritas restore PPPoE jika tersedia
            if (hasPPPoE) {
                results.restoration_type = 'pppoe';
                const authMode = await getUserAuthMode();
                
                // Check jika menggunakan RADIUS mode
                if (authMode === 'radius') {
                    try {
                        // PENTING: Putuskan koneksi PPPoE aktif TERLEBIH DAHULU sebelum mengubah group
                        // Agar saat reconnect, langsung dapat IP dari package yang benar
                        try {
                            const { disconnectPPPoEUser, getRouterForCustomer, getMikrotikConnectionForRouter } = require('./mikrotik');
                            let routerObj = null;
                            
                            // Coba dapatkan router dari customer mapping
                            try {
                                routerObj = await getRouterForCustomer(customer);
                            } catch (routerError) {
                                // Jika customer tidak punya router mapping, cari di semua router
                                logger.warn(`RADIUS: Customer tidak punya router mapping, mencari di semua router untuk ${pppUser}`);
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
                                            logger.info(`RADIUS: Found active session for ${pppUser} on router ${router.name}`);
                                            break;
                                        }
                                    } catch (e) {
                                        // Continue to next router
                                    }
                                }
                                
                                // Jika tidak ditemukan, gunakan router pertama sebagai fallback
                                if (!routerObj && routers.length > 0) {
                                    routerObj = routers[0];
                                    logger.warn(`RADIUS: No active session found, using first router as fallback: ${routerObj.name}`);
                                }
                            }
                            
                            if (routerObj) {
                                // Disconnect active session TERLEBIH DAHULU menggunakan helper function
                                const disconnectResult = await disconnectPPPoEUser(pppUser, routerObj);
                                
                                if (disconnectResult.success && disconnectResult.disconnected > 0) {
                                    logger.info(`RADIUS: Disconnected ${disconnectResult.disconnected} active PPPoE session(s) for ${pppUser} before restoring to previous package`);
                                    
                                    // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                } else if (disconnectResult.disconnected === 0) {
                                    logger.info(`RADIUS: User ${pppUser} tidak sedang online, langsung ubah group ke package sebelumnya`);
                                } else {
                                    logger.warn(`RADIUS: Disconnect result: ${disconnectResult.message}`);
                                }
                            } else {
                                logger.warn(`RADIUS: Tidak ada router yang tersedia untuk disconnect ${pppUser}`);
                            }
                        } catch (disconnectError) {
                            logger.warn(`RADIUS: Failed to disconnect active session for ${pppUser}: ${disconnectError.message}`);
                            // Continue dengan perubahan group meskipun disconnect gagal
                        }
                        
                        // Setelah disconnect, baru ubah group kembali ke package sebelumnya
                        const unsuspendResult = await unsuspendUserRadius(pppUser);
                        if (unsuspendResult && unsuspendResult.success) {
                            results.mikrotik = true;
                            results.radius = true;
                            logger.info(`RADIUS: Successfully unsuspended user ${pppUser} (restored to previous package, will get package IP on reconnect)`);
                        } else {
                            logger.error(`RADIUS: Unsuspend failed for ${pppUser}`);
                        }
                    } catch (radiusError) {
                        logger.error(`RADIUS unsuspend failed for ${customer.username}:`, radiusError.message);
                    }
                } else {
                    // Mode Mikrotik API (original code)
                    try {
                        const mikrotik = await getMikrotikConnectionForCustomer(customer);
                        
                        // Ambil profile dari customer atau package, fallback ke default
                        let profileToUse = customer.pppoe_profile;
                        if (!profileToUse) {
                            // Coba ambil dari package
                            const packageData = await billingManager.getPackageById(customer.package_id);
                            profileToUse = packageData?.pppoe_profile || getSetting('default_pppoe_profile', 'default');
                        }
                        
                        // PENTING: Putuskan koneksi PPPoE aktif TERLEBIH DAHULU sebelum mengubah profile
                        // Agar saat reconnect, langsung dapat IP dari package yang benar
                        const { disconnectPPPoEUser } = require('./mikrotik');
                        const disconnectResult = await disconnectPPPoEUser(pppUser, mikrotik);
                        
                        if (disconnectResult.success && disconnectResult.disconnected > 0) {
                            logger.info(`Mikrotik: Disconnected ${disconnectResult.disconnected} active PPPoE session(s) for ${customer.pppoe_username} before restoring to ${profileToUse} profile`);
                            
                            // Tunggu sebentar untuk memastikan disconnect benar-benar selesai
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else if (disconnectResult.disconnected === 0) {
                            logger.info(`Mikrotik: User ${customer.pppoe_username} tidak sedang online, langsung ubah profile ke ${profileToUse}`);
                        } else {
                            logger.warn(`Mikrotik: Disconnect result: ${disconnectResult.message}`);
                        }

                        // Setelah disconnect, baru ubah profile ke package normal
                        // Cari .id secret berdasarkan name terlebih dahulu
                        let secretId = null;
                        try {
                            const secrets = await mikrotik.write('/ppp/secret/print', [
                                `?name=${pppUser}`
                            ]);
                            if (secrets && secrets.length > 0) {
                                secretId = secrets[0]['.id'];
                            }
                        } catch (lookupErr) {
                            logger.warn(`Mikrotik: failed to lookup secret id for ${customer.pppoe_username}: ${lookupErr.message}`);
                        }

                        // Update PPPoE user dengan profile normal, gunakan .id bila tersedia, fallback ke =name=
                        const setParams = secretId
                            ? [`=.id=${secretId}`, `=profile=${profileToUse}`, `=comment=ACTIVE - ${reason}`]
                            : [`=name=${pppUser}`, `=profile=${profileToUse}`, `=comment=ACTIVE - ${reason}`];

                        await mikrotik.write('/ppp/secret/set', setParams);
                        logger.info(`Mikrotik: Restored profile to '${profileToUse}' for ${customer.pppoe_username} (${secretId ? 'by .id' : 'by name'}) - will get package IP on reconnect`);

                        results.mikrotik = true;
                        logger.info(`Mikrotik: Successfully restored PPPoE user ${customer.pppoe_username} with ${profileToUse} profile`);
                    } catch (mikrotikError) {
                        logger.error(`Mikrotik PPPoE restoration failed for ${customer.username}:`, mikrotikError.message);
                    }
                }
            }
            // 2. Jika tidak ada PPPoE, coba restore IP statik
            else if (hasStaticIP || hasMacAddress) {
                results.restoration_type = 'static_ip';
                try {
                    const staticResult = await staticIPSuspension.restoreStaticIPCustomer(customer, reason);
                    
                    if (staticResult.success) {
                        results.mikrotik = true;
                        results.static_ip_methods = staticResult.results?.methods_tried;
                        logger.info(`Static IP restoration successful for ${customer.username}. Methods: ${staticResult.results?.methods_tried?.join(', ')}`);
                    } else {
                        logger.error(`Static IP restoration failed for ${customer.username}: ${staticResult.error}`);
                    }
                } catch (staticIPError) {
                    logger.error(`Static IP restoration failed for ${customer.username}:`, staticIPError.message);
                }
            }
            // 3. Jika tidak ada PPPoE atau IP statik, coba enable WAN
            else {
                results.restoration_type = 'wan_enable';
                logger.warn(`Customer ${customer.username} has no PPPoE username or static IP, trying WAN enable method`);
            }

            // 2. Restore via GenieACS (enable WAN connection)
            if (customer.phone || customer.pppoe_username) {
                try {
                    let device = null;
                    
                    // Coba cari device by phone number dulu
                    if (customer.phone) {
                        try {
                            device = await findDeviceByPhoneNumber(customer.phone);
                        } catch (phoneError) {
                            logger.warn(`Device not found by phone ${customer.phone}, trying PPPoE...`);
                        }
                    }
                    
                    // Jika tidak ketemu, coba by PPPoE username
                    if (!device && customer.pppoe_username) {
                        try {
                            device = await findDeviceByPPPoE(customer.pppoe_username);
                        } catch (pppoeError) {
                            logger.warn(`Device not found by PPPoE ${customer.pppoe_username}`);
                        }
                    }

                    if (device) {
                        // Enable WAN connection di modem
                        const parameters = [
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", true, "xsd:boolean"],
                            ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", true, "xsd:boolean"]
                        ];

                        await setParameterValues(device._id, parameters);
                        results.genieacs = true;
                        logger.info(`GenieACS: Successfully restored device ${device._id} for customer ${customer.username}`);
                    } else {
                        logger.warn(`GenieACS: No device found for customer ${customer.username}`);
                    }
                } catch (genieacsError) {
                    logger.error(`GenieACS restoration failed for ${customer.username}:`, genieacsError.message);
                }
            }

            // 3. Update status di billing database
            try {
                if (customer.id) {
                    logger.info(`[RESTORE] Updating billing status by id=${customer.id} to 'active' (username=${customer.username||customer.pppoe_username||'-'})`);
                    await billingManager.setCustomerStatusById(customer.id, 'active');
                    results.billing = true;
                } else {
                    // Resolve by username first, then phone
                    let resolved = null;
                    if (customer.pppoe_username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.pppoe_username); } catch (_) {}
                    }
                    if (!resolved && customer.username) {
                        try { resolved = await billingManager.getCustomerByUsername(customer.username); } catch (_) {}
                    }
                    if (!resolved && customer.phone) {
                        try { resolved = await billingManager.getCustomerByPhone(customer.phone); } catch (_) {}
                    }
                    if (resolved && resolved.id) {
                        logger.info(`[RESTORE] Resolved customer id=${resolved.id} (username=${resolved.pppoe_username||resolved.username||'-'}) → set 'active'`);
                        await billingManager.setCustomerStatusById(resolved.id, 'active');
                        results.billing = true;
                    } else if (customer.phone) {
                        logger.warn(`[RESTORE] Falling back to update by phone=${customer.phone} (no id resolved)`);
                        await billingManager.updateCustomer(customer.phone, { ...customer, status: 'active' });
                        results.billing = true;
                    } else {
                        logger.error(`[RESTORE] Unable to resolve customer identifier for status update`);
                    }
                }
            } catch (billingError) {
                logger.error(`Billing restore update failed for ${customer.username}:`, billingError.message);
            }

            // 4. Send WhatsApp notification
            try {
                const whatsappNotifications = require('./whatsapp-notifications');
                await whatsappNotifications.sendServiceRestorationNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`WhatsApp notification failed for ${customer.username}:`, notificationError.message);
            }
            
            // 5. Send Email notification
            try {
                const emailNotifications = require('./email-notifications');
                await emailNotifications.sendServiceRestorationNotification(customer, reason);
            } catch (notificationError) {
                logger.error(`Email notification failed for ${customer.username}:`, notificationError.message);
            }

            return {
                success: results.mikrotik || results.genieacs || results.billing,
                results,
                customer: customer.username,
                reason
            };

        } catch (error) {
            logger.error(`Error restoring service for ${customer.username}:`, error);
            throw error;
        }
    }

    /**
     * Check dan suspend pelanggan yang telat bayar otomatis
     */
    async checkAndSuspendOverdueCustomers() {
        if (this.isRunning) {
            logger.info('Service suspension check already running, skipping...');
            return;
        }

        try {
            this.isRunning = true;
            logger.info('Starting automatic service suspension check...');

            // Ambil pengaturan grace period
            const gracePeriodDays = parseInt(getSetting('suspension_grace_period_days', '7'));
            const autoSuspensionEnabled = getSetting('auto_suspension_enabled', true) === true || getSetting('auto_suspension_enabled', 'true') === 'true';

            if (!autoSuspensionEnabled) {
                logger.info('Auto suspension is disabled in settings');
                return;
            }

            // Ambil tagihan yang overdue
            const overdueInvoices = await billingManager.getOverdueInvoices();
            logger.info(`Found ${overdueInvoices.length} overdue invoices to check`);
            
            if (overdueInvoices.length === 0) {
                logger.info('No overdue invoices found, skipping suspension check');
                return { checked: 0, suspended: 0, errors: 0, details: [] };
            }
            
            const results = {
                checked: 0,
                suspended: 0,
                errors: 0,
                details: []
            };

            for (const invoice of overdueInvoices) {
                results.checked++;

                try {
                    // Hitung berapa hari telat dengan perhitungan yang lebih akurat
                    const dueDate = new Date(invoice.due_date);
                    const today = new Date();
                    
                    // Normalize dates to start of day to avoid timezone issues
                    const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
                    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    
                    const daysOverdue = Math.floor((todayStart - dueDateStart) / (1000 * 60 * 60 * 24));
                    
                    logger.info(`Customer ${invoice.customer_name}: Due date: ${dueDate.toISOString().split('T')[0]}, Today: ${today.toISOString().split('T')[0]}, Days overdue: ${daysOverdue}, Grace period: ${gracePeriodDays}`);

                    // Skip jika belum melewati grace period
                    if (daysOverdue < gracePeriodDays) {
                        logger.info(`Customer ${invoice.customer_name} overdue ${daysOverdue} days, grace period ${gracePeriodDays} days - skipping`);
                        continue;
                    }

                    // Ambil data customer
                    const customer = await billingManager.getCustomerById(invoice.customer_id);
                    if (!customer) {
                        logger.warn(`Customer not found for invoice ${invoice.invoice_number}`);
                        continue;
                    }

                    // Skip jika sudah suspended
                    if (customer.status === 'suspended') {
                        logger.info(`Customer ${customer.username} already suspended - skipping`);
                        continue;
                    }

                    // Skip jika auto_suspension = 0 (tidak diisolir otomatis)
                    if (customer.auto_suspension === 0) {
                        logger.info(`Customer ${customer.username} has auto_suspension disabled - skipping`);
                        continue;
                    }

                    // Suspend layanan
                    const suspensionResult = await this.suspendCustomerService(customer, `Telat bayar ${daysOverdue} hari`);
                    
                    if (suspensionResult.success) {
                        results.suspended++;
                        results.details.push({
                            customer: customer.username,
                            invoice: invoice.invoice_number,
                            daysOverdue,
                            status: 'suspended'
                        });
                        logger.info(`Successfully suspended service for ${customer.username} (${daysOverdue} days overdue)`);
                    } else {
                        results.errors++;
                        results.details.push({
                            customer: customer.username,
                            invoice: invoice.invoice_number,
                            daysOverdue,
                            status: 'failed'
                        });
                        logger.error(`Failed to suspend service for ${customer.username}`);
                    }

                } catch (customerError) {
                    results.errors++;
                    logger.error(`Error processing customer for invoice ${invoice.invoice_number}:`, customerError);
                }
            }

            logger.info(`Service suspension check completed. Checked: ${results.checked}, Suspended: ${results.suspended}, Errors: ${results.errors}`);
            return results;

        } catch (error) {
            logger.error('Error in automatic service suspension check:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Sync status suspended customers dari billing ke RADIUS
     * Memastikan customer yang statusnya 'suspended' di billing juga di group 'isolir' di RADIUS
     */
    async syncSuspendedStatusToRadius() {
        try {
            logger.info('Starting sync suspended status to RADIUS...');
            
            const { getUserAuthModeAsync } = require('./mikrotik');
            const authMode = await getUserAuthModeAsync();
            
            if (authMode !== 'radius') {
                logger.info('Auth mode bukan RADIUS, skip sync');
                return { synced: 0, alreadyIsolir: 0, errors: 0 };
            }
            
            // Ambil semua customer yang statusnya suspended
            const customers = await billingManager.getCustomers();
            const suspendedCustomers = customers.filter(c => c.status === 'suspended');
            
            logger.info(`Found ${suspendedCustomers.length} customers with status 'suspended'`);
            
            if (suspendedCustomers.length === 0) {
                return { synced: 0, alreadyIsolir: 0, errors: 0 };
            }
            
            const { getRadiusConnection, suspendUserRadius, getMikrotikConnectionForCustomer } = require('./mikrotik');
            const conn = await getRadiusConnection();
            let synced = 0;
            let alreadyIsolir = 0;
            let errors = 0;
            
            for (const customer of suspendedCustomers) {
                const pppUser = (customer.pppoe_username && String(customer.pppoe_username).trim()) || 
                               (customer.username && String(customer.username).trim());
                
                if (!pppUser) {
                    continue;
                }
                
                try {
                    // Cek group saat ini di RADIUS
                    const [currentGroup] = await conn.execute(
                        "SELECT groupname FROM radusergroup WHERE username = ? LIMIT 1",
                        [pppUser]
                    );
                    
                    if (currentGroup && currentGroup.length > 0 && currentGroup[0].groupname === 'isolir') {
                        alreadyIsolir++;
                    } else {
                        // Disconnect active session TERLEBIH DAHULU
                        try {
                            const mikrotik = await getMikrotikConnectionForCustomer(customer);
                            const activeSessions = await mikrotik.write('/ppp/active/print', [
                                `?name=${pppUser}`
                            ]);
                            
                            if (activeSessions && activeSessions.length > 0) {
                                for (const session of activeSessions) {
                                    await mikrotik.write('/ppp/active/remove', [
                                        `=.id=${session['.id']}`
                                    ]);
                                }
                                logger.info(`Disconnected ${activeSessions.length} active session(s) for ${pppUser}`);
                            }
                        } catch (disconnectError) {
                            logger.warn(`Failed to disconnect active session for ${pppUser}: ${disconnectError.message}`);
                        }
                        
                        // Pindahkan ke group isolir
                        const result = await suspendUserRadius(pppUser);
                        if (result && result.success) {
                            synced++;
                            logger.info(`Synced ${pppUser} to isolir group`);
                        } else {
                            errors++;
                            logger.error(`Failed to sync ${pppUser} to isolir: ${result?.message || 'Unknown error'}`);
                        }
                    }
                } catch (error) {
                    errors++;
                    logger.error(`Error syncing ${pppUser}: ${error.message}`);
                }
            }
            
            await conn.end();
            
            logger.info(`Sync suspended status completed: synced=${synced}, alreadyIsolir=${alreadyIsolir}, errors=${errors}`);
            return { synced, alreadyIsolir, errors };
            
        } catch (error) {
            logger.error(`Error in syncSuspendedStatusToRadius: ${error.message}`);
            return { synced: 0, alreadyIsolir: 0, errors: 1 };
        }
    }

    /**
     * Check dan restore pelanggan yang sudah bayar
     */
    async checkAndRestorePaidCustomers() {
        try {
            logger.info('Starting automatic service restoration check...');

            // Ambil semua customer yang suspended
            const customers = await billingManager.getCustomers();
            const suspendedCustomers = customers.filter(c => c.status === 'suspended');

            const results = {
                checked: suspendedCustomers.length,
                restored: 0,
                errors: 0,
                details: []
            };

            for (const customer of suspendedCustomers) {
                try {
                    // Cek apakah customer punya tagihan yang belum dibayar
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');

                    // Jika tidak ada tagihan yang belum dibayar, restore layanan
                    if (unpaidInvoices.length === 0) {
                        const restorationResult = await this.restoreCustomerService(customer);
                        
                        if (restorationResult.success) {
                            results.restored++;
                            results.details.push({
                                customer: customer.username,
                                status: 'restored'
                            });
                            logger.info(`Successfully restored service for ${customer.username}`);
                        } else {
                            results.errors++;
                            results.details.push({
                                customer: customer.username,
                                status: 'failed'
                            });
                            logger.error(`Failed to restore service for ${customer.username}`);
                        }
                    } else {
                        logger.info(`Customer ${customer.username} still has ${unpaidInvoices.length} unpaid invoices - keeping suspended`);
                    }

                } catch (customerError) {
                    results.errors++;
                    logger.error(`Error processing suspended customer ${customer.username}:`, customerError);
                }
            }

            logger.info(`Service restoration check completed. Checked: ${results.checked}, Restored: ${results.restored}, Errors: ${results.errors}`);
            return results;

        } catch (error) {
            logger.error('Error in automatic service restoration check:', error);
            throw error;
        }
    }
}

// Create singleton instance
const serviceSuspensionManager = new ServiceSuspensionManager();

module.exports = serviceSuspensionManager;
