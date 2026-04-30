/**
 * WhatsApp Provider Manager
 * Singleton untuk mengelola provider aktif (Baileys atau Wablas)
 */
const WhatsAppProvider = require('./whatsapp-provider');
const BaileysProvider = require('./providers/baileys-provider');
const WablasProvider = require('./providers/wablas-provider');
const { getWablasConfig, validateWablasConfig, isWablasEnabled } = require('./wablas-config');
const logger = require('./logger');

class WhatsAppProviderManager {
    constructor() {
        this.provider = null;
        this.providerType = null; // 'baileys' | 'wablas'
        this.initialized = false;
    }

    /**
     * Inisialisasi provider berdasarkan konfigurasi
     * @param {object} options - Opsi inisialisasi
     * @param {object} options.baileysSock - Socket Baileys (jika ingin menggunakan Baileys)
     * @param {string} options.forceProvider - Force provider tertentu ('baileys' | 'wablas')
     */
    async initialize(options = {}) {
        if (this.initialized) {
            logger.warn('⚠️ ProviderManager already initialized');
            return this.provider;
        }

        const { baileysSock, forceProvider } = options;

        // Jika ada forceProvider, gunakan itu
        if (forceProvider === 'wablas') {
            if (!validateWablasConfig()) {
                throw new Error('Wablas config is invalid');
            }
            logger.info('🚀 Initializing WablasProvider (forced)...');
            this.provider = new WablasProvider();
            this.providerType = 'wablas';
            await this.provider.initialize();
            this.initialized = true;
            logger.info('✅ WablasProvider initialized');
            return this.provider;
        }

        if (forceProvider === 'baileys' || baileysSock) {
            logger.info('🚀 Initializing BaileysProvider (forced or socket provided)...');
            this.provider = new BaileysProvider(baileysSock);
            this.providerType = 'baileys';
            if (baileysSock) {
                this.provider.setSock(baileysSock);
            }
            this.initialized = true;
            logger.info('✅ BaileysProvider initialized');
            return this.provider;
        }

        // Auto-select berdasarkan konfigurasi
        if (isWablasEnabled()) {
            logger.info('🚀 Initializing WablasProvider (auto-selected)...');
            this.provider = new WablasProvider();
            this.providerType = 'wablas';
            try {
                await this.provider.initialize();
                this.initialized = true;
                logger.info('✅ WablasProvider initialized');
                return this.provider;
            } catch (error) {
                logger.error('❌ Failed to initialize WablasProvider, falling back to Baileys:', error);
                // Fallback ke Baileys jika Wablas gagal
            }
        }

        // Fallback ke Baileys (hanya jika enabled)
        const { isBaileysEnabled } = require('./baileys-config');
        if (isBaileysEnabled()) {
            logger.info('🚀 Initializing BaileysProvider (fallback)...');
            this.provider = new BaileysProvider();
            this.providerType = 'baileys';
            this.initialized = true;
            logger.info('✅ BaileysProvider initialized (fallback mode - requires socket to be set later)');
            return this.provider;
        } else {
            logger.warn('⚠️ Baileys disabled, cannot fallback to BaileysProvider');
            throw new Error('No WhatsApp provider available: Wablas failed and Baileys is disabled');
        }
    }

    /**
     * Get provider aktif
     * @returns {WhatsAppProvider}
     */
    getProvider() {
        if (!this.provider) {
            throw new Error('Provider not initialized. Call initialize() first.');
        }
        return this.provider;
    }

    /**
     * Switch provider (untuk testing/migrasi bertahap)
     * @param {string} type - 'baileys' | 'wablas'
     * @param {object} options - Opsi tambahan
     */
    async switchProvider(type, options = {}) {
        if (this.provider) {
            await this.provider.cleanup();
        }

        if (type === 'wablas') {
            if (!validateWablasConfig()) {
                throw new Error('Wablas config is invalid');
            }
            this.provider = new WablasProvider();
            this.providerType = 'wablas';
            await this.provider.initialize();
            logger.info('🔄 Switched to WablasProvider');
        } else if (type === 'baileys') {
            this.provider = new BaileysProvider(options.sock || null);
            this.providerType = 'baileys';
            if (options.sock) {
                this.provider.setSock(options.sock);
            }
            logger.info('🔄 Switched to BaileysProvider');
        } else {
            throw new Error(`Unknown provider type: ${type}`);
        }

        this.initialized = true;
    }

    /**
     * Set Baileys socket (untuk kompatibilitas dengan kode lama)
     * @param {object} sock - Baileys socket
     */
    setBaileysSocket(sock) {
        if (this.providerType === 'baileys' && this.provider instanceof BaileysProvider) {
            this.provider.setSock(sock);
            logger.info('✅ Baileys socket set');
        } else {
            logger.warn('⚠️ Cannot set Baileys socket: current provider is not BaileysProvider');
        }
    }

    /**
     * Get provider type
     * @returns {string} 'baileys' | 'wablas' | null
     */
    getProviderType() {
        return this.providerType;
    }

    /**
     * Cek apakah provider sudah diinisialisasi
     * @returns {boolean}
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * Cleanup semua provider
     */
    async cleanup() {
        if (this.provider) {
            await this.provider.cleanup();
        }
        this.provider = null;
        this.providerType = null;
        this.initialized = false;
        logger.info('🧹 ProviderManager cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance dari ProviderManager
 * @returns {WhatsAppProviderManager}
 */
function getProviderManager() {
    if (!instance) {
        instance = new WhatsAppProviderManager();
    }
    return instance;
}

/**
 * Reset singleton (untuk testing)
 */
function resetProviderManager() {
    if (instance) {
        instance.cleanup();
    }
    instance = null;
}

module.exports = {
    WhatsAppProviderManager,
    getProviderManager,
    resetProviderManager
};

