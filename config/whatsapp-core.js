const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { getSettingsWithCache } = require('./settingsManager');
const { getProviderManager } = require('./whatsapp-provider-manager');

class WhatsAppCore {
    constructor() {
        this.sock = null; // Keep for backward compatibility
        this.genieacsCommandsEnabled = true;
        this.superAdminNumber = this.getSuperAdminNumber();
        this.whatsappStatus = {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        };
        this.providerManager = null;
    }

    // Fungsi untuk mendekripsi nomor admin yang dienkripsi
    decryptAdminNumber(encryptedNumber) {
        try {
            const key = 'ALIJAYA_SECRET_KEY_2025';
            let result = '';
            for (let i = 0; i < encryptedNumber.length; i++) {
                result += String.fromCharCode(encryptedNumber.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (error) {
            console.error('Error decrypting admin number:', error);
            return null;
        }
    }

    // Membaca nomor super admin dari file eksternal
    getSuperAdminNumber() {
        const filePath = path.join(__dirname, 'superadmin.txt');
        if (!fs.existsSync(filePath)) {
            console.warn('⚠️ File superadmin.txt tidak ditemukan, superadmin features disabled');
            return null;
        }
        try {
            const number = fs.readFileSync(filePath, 'utf-8').trim();
            if (!number) {
                console.warn('⚠️ File superadmin.txt kosong, superadmin features disabled');
                return null;
            }
            return number;
        } catch (error) {
            console.error('❌ Error reading superadmin.txt:', error.message);
            return null;
        }
    }

    // Fungsi untuk mengecek apakah nomor adalah admin atau super admin
    isAdminNumber(number) {
        try {
            // Normalisasi nomor
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            // Baca semua settings untuk mencari key yang dimulai dengan 'admins.'
            const allSettings = getSettingsWithCache();
            const adminNumbers = [];
            
            // Cari semua key yang dimulai dengan 'admins.'
            Object.keys(allSettings).forEach(key => {
                if (key.startsWith('admins.') && allSettings[key]) {
                    adminNumbers.push(allSettings[key]);
                }
            });
            
            // Cek apakah nomor ada dalam daftar admin
            return adminNumbers.includes(cleanNumber);
        } catch (error) {
            console.error('Error checking admin number:', error);
            return false;
        }
    }

    // Fungsi untuk mengecek apakah nomor adalah teknisi
    async isTechnicianNumber(number) {
        try {
            // Normalisasi nomor
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            // Cek di database technicians
            const sqlite3 = require('sqlite3').verbose();
            const path = require('path');
            
            const dbPath = path.join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            
            return new Promise((resolve, reject) => {
                const query = `
                    SELECT COUNT(*) as count 
                    FROM technicians 
                    WHERE phone = ? AND is_active = 1
                `;
                
                db.get(query, [cleanNumber], (err, row) => {
                    db.close();
                    if (err) {
                        console.error('Error checking technician number in database:', err);
                        resolve(false);
                    } else {
                        resolve(row && row.count > 0);
                    }
                });
            });
        } catch (error) {
            console.error('Error checking technician number:', error);
            return false;
        }
    }

    // Fungsi untuk mengecek apakah nomor bisa akses fitur teknisi (admin atau teknisi)
    async canAccessTechnicianFeatures(number) {
        const isAdmin = this.isAdminNumber(number);
        const isTechnician = await this.isTechnicianNumber(number);
        return isAdmin || isTechnician;
    }

    // Fungsi untuk mengecek apakah nomor adalah super admin
    isSuperAdminNumber(number) {
        if (!this.superAdminNumber) return false;
        
        try {
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            return cleanNumber === this.superAdminNumber;
        } catch (error) {
            console.error('Error checking super admin number:', error);
            return false;
        }
    }

    // Set socket instance (backward compatibility)
    setSock(sock) {
        this.sock = sock;
        this.whatsappStatus.connected = true;
        this.whatsappStatus.status = 'connected';
        this.whatsappStatus.connectedSince = new Date();
        
        // Update provider manager jika menggunakan Baileys
        if (!this.providerManager) {
            this.providerManager = getProviderManager();
        }
        
        // Set socket ke BaileysProvider jika ada
        if (this.providerManager.isInitialized() && this.providerManager.getProviderType() === 'baileys') {
            this.providerManager.setBaileysSocket(sock);
        }
        
        // Update global status
        global.whatsappStatus = this.whatsappStatus;
    }

    // Get socket instance (backward compatibility)
    getSock() {
        // Coba dapatkan dari provider manager dulu
        if (this.providerManager && this.providerManager.isInitialized()) {
            const provider = this.providerManager.getProvider();
            if (provider && provider.constructor.name === 'BaileysProvider') {
                return provider.sock || this.sock;
            }
        }
        return this.sock;
    }

    // Get provider instance
    getProvider() {
        if (!this.providerManager) {
            this.providerManager = getProviderManager();
        }
        
        if (!this.providerManager.isInitialized()) {
            logger.warn('⚠️ ProviderManager not initialized, initializing now...');
            // Auto-initialize jika belum
            this.providerManager.initialize({ baileysSock: this.sock }).catch(err => {
                logger.error('❌ Failed to auto-initialize provider:', err);
            });
        }
        
        return this.providerManager.getProvider();
    }

    // Get WhatsApp status
    getWhatsAppStatus() {
        // Update dari provider jika tersedia
        if (this.providerManager && this.providerManager.isInitialized()) {
            const provider = this.providerManager.getProvider();
            if (provider) {
                const providerStatus = provider.getStatus();
                // Merge dengan status lokal
                return {
                    ...this.whatsappStatus,
                    ...providerStatus,
                    provider: this.providerManager.getProviderType()
                };
            }
        }
        return this.whatsappStatus;
    }

    // Update WhatsApp status
    updateStatus(status) {
        this.whatsappStatus = { ...this.whatsappStatus, ...status };
        global.whatsappStatus = this.whatsappStatus;
    }

    // Get GenieACS configuration
    getGenieacsConfig() {
        return {
            genieacsUrl: getSetting('genieacs_url'),
            genieacsUsername: getSetting('genieacs_username'),
            genieacsPassword: getSetting('genieacs_password')
        };
    }

    // Format phone number for WhatsApp
    formatPhoneNumber(phoneNumber) {
        if (!phoneNumber) return null;
        
        let cleanNumber = phoneNumber.replace(/\D/g, '');
        if (cleanNumber.startsWith('0')) {
            cleanNumber = '62' + cleanNumber.slice(1);
        }
        if (!cleanNumber.startsWith('62')) {
            cleanNumber = '62' + cleanNumber;
        }
        
        return cleanNumber;
    }

    // Create WhatsApp JID
    createJID(phoneNumber) {
        const formattedNumber = this.formatPhoneNumber(phoneNumber);
        return formattedNumber ? `${formattedNumber}@s.whatsapp.net` : null;
    }

    // Send formatted message (refactored to use provider)
    async sendFormattedMessage(remoteJid, text) {
        try {
            const provider = this.getProvider();
            if (!provider) {
                logger.error('❌ Provider not available');
                return false;
            }

            // Extract phone number from JID
            const phoneNumber = remoteJid.split('@')[0];
            const result = await provider.sendMessage(phoneNumber, text);
            
            return result.success || false;
        } catch (error) {
            logger.error('❌ Error sending formatted message:', error);
            return false;
        }
    }

    // Check if WhatsApp is connected
    isConnected() {
        return this.sock && this.whatsappStatus.connected;
    }

    // Get super admin number
    getSuperAdmin() {
        return this.superAdminNumber;
    }

    // Enable/disable GenieACS commands
    setGenieacsCommandsEnabled(enabled) {
        this.genieacsCommandsEnabled = enabled;
    }

    // Check if GenieACS commands are enabled
    areGenieacsCommandsEnabled() {
        return this.genieacsCommandsEnabled;
    }
}

module.exports = WhatsAppCore;
