/**
 * Interface abstrak untuk WhatsApp Gateway Provider
 * Semua provider (Baileys, Wablas) harus mengimplementasikan interface ini
 */
const logger = require('./logger');

class WhatsAppProvider {
    constructor() {
        this.messageListeners = [];
        this.connectionListeners = [];
        this.providerName = this.constructor.name;
    }

    /**
     * Kirim pesan teks
     * @param {string} phoneNumber - Nomor telepon (format: 62812... atau 0812...)
     * @param {string} message - Isi pesan
     * @param {object} options - Opsi tambahan (delay, priority, dll)
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendMessage(phoneNumber, message, options = {}) {
        throw new Error(`${this.providerName}: sendMessage must be implemented`);
    }

    /**
     * Kirim media (gambar/dokumen)
     * @param {string} phoneNumber - Nomor telepon
     * @param {string} mediaPath - Path file media
     * @param {string} caption - Caption untuk media
     * @param {object} options - Opsi tambahan
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendMedia(phoneNumber, mediaPath, caption = '', options = {}) {
        throw new Error(`${this.providerName}: sendMedia must be implemented`);
    }

    /**
     * Kirim pesan bulk dengan rate limiting
     * @param {Array<{phone: string, message: string, options?: object}>} messages - Array pesan
     * @returns {Promise<{sent: number, failed: number, errors: Array}>}
     */
    async sendBulkMessages(messages) {
        throw new Error(`${this.providerName}: sendBulkMessages must be implemented`);
    }

    /**
     * Daftarkan listener untuk pesan masuk
     * @param {function} callback - Callback function(message)
     */
    onMessage(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        this.messageListeners.push(callback);
        logger.debug(`📥 Registered message listener for ${this.providerName}`);
    }

    /**
     * Daftarkan listener untuk update koneksi
     * @param {function} callback - Callback function(update)
     */
    onConnectionUpdate(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        this.connectionListeners.push(callback);
        logger.debug(`🔌 Registered connection listener for ${this.providerName}`);
    }

    /**
     * Hapus semua listener
     */
    removeAllListeners() {
        this.messageListeners = [];
        this.connectionListeners = [];
        logger.debug(`🗑️ Removed all listeners for ${this.providerName}`);
    }

    /**
     * Normalisasi nomor telepon ke format standar (62812...)
     * @param {string} phone - Nomor telepon (berbagai format)
     * @returns {string} Nomor yang sudah dinormalisasi
     */
    formatPhoneNumber(phone) {
        if (!phone) return '';
        
        // Hapus karakter non-digit kecuali +
        let cleanNumber = String(phone).replace(/[^0-9+]/g, '');
        
        // Hapus + jika ada
        if (cleanNumber.startsWith('+')) {
            cleanNumber = cleanNumber.slice(1);
        }
        
        // Konversi format lokal (08...) ke internasional (62...)
        if (cleanNumber.startsWith('0')) {
            cleanNumber = '62' + cleanNumber.slice(1);
        }
        
        // Pastikan dimulai dengan 62
        if (!cleanNumber.startsWith('62')) {
            cleanNumber = '62' + cleanNumber;
        }
        
        return cleanNumber;
    }

    /**
     * Buat JID format untuk kompatibilitas (62812...@s.whatsapp.net)
     * @param {string} phoneNumber - Nomor telepon
     * @returns {string} JID format
     */
    createJID(phoneNumber) {
        const formattedNumber = this.formatPhoneNumber(phoneNumber);
        return formattedNumber ? `${formattedNumber}@s.whatsapp.net` : null;
    }

    /**
     * Cek apakah provider terhubung
     * @returns {boolean}
     */
    isConnected() {
        return false;
    }

    /**
     * Dapatkan status detail provider
     * @returns {object} Status object
     */
    getStatus() {
        return {
            connected: false,
            provider: this.providerName,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        };
    }

    /**
     * Inisialisasi provider (untuk dipanggil setelah konstruksi)
     * @returns {Promise<void>}
     */
    async initialize() {
        logger.info(`🚀 Initializing ${this.providerName}...`);
        // Override di subclass jika perlu
    }

    /**
     * Cleanup resources (untuk dipanggil saat shutdown)
     * @returns {Promise<void>}
     */
    async cleanup() {
        logger.info(`🧹 Cleaning up ${this.providerName}...`);
        this.removeAllListeners();
    }

    /**
     * Trigger event pesan masuk (untuk digunakan oleh implementasi)
     * @protected
     * @param {object} message - Message object
     */
    _triggerMessage(message) {
        if (this.messageListeners.length === 0) {
            logger.warn(`⚠️ No message listeners registered for ${this.providerName}`);
            return;
        }
        
        logger.debug(`📨 Triggering message event for ${this.providerName}:`, {
            from: message.senderNumber,
            text: message.messageText?.substring(0, 50)
        });
        
        this.messageListeners.forEach(callback => {
            try {
                callback(message);
            } catch (error) {
                logger.error(`❌ Error in message listener:`, error);
            }
        });
    }

    /**
     * Trigger event update koneksi (untuk digunakan oleh implementasi)
     * @protected
     * @param {object} update - Connection update object
     */
    _triggerConnectionUpdate(update) {
        if (this.connectionListeners.length === 0) {
            return;
        }
        
        logger.debug(`🔌 Triggering connection update for ${this.providerName}:`, update);
        
        this.connectionListeners.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                logger.error(`❌ Error in connection listener:`, error);
            }
        });
    }
}

module.exports = WhatsAppProvider;
