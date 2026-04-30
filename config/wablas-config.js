/**
 * Konfigurasi Wablas API
 */
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

/**
 * Dapatkan konfigurasi Wablas
 * @returns {object} Konfigurasi Wablas
 */
function getWablasConfig() {
    // Default URL sesuai dokumentasi: https://bdg.wablas.com
    // User bisa override dengan wablas_api_url di settings.json
    return {
        apiKey: getSetting('wablas_api_key', process.env.WABLAS_API_KEY || ''),
        secretKey: getSetting('wablas_secret_key', process.env.WABLAS_SECRET_KEY || ''),
        apiUrl: getSetting('wablas_api_url', process.env.WABLAS_API_URL || 'https://bdg.wablas.com'),
        webhookSecret: getSetting('wablas_webhook_secret', process.env.WABLAS_WEBHOOK_SECRET || ''),
        enabled: (() => {
            const setting = getSetting('wablas_enabled', 'false');
            // Handle both string and boolean
            if (typeof setting === 'boolean') return setting;
            if (typeof setting === 'string') return setting.toLowerCase() === 'true';
            return false;
        })(),
        deviceId: getSetting('wablas_device_id', process.env.WABLAS_DEVICE_ID || ''),
        // Rate limiting
        minDelay: parseInt(getSetting('wablas_min_delay', process.env.WABLAS_MIN_DELAY || '1000'), 10),
        maxRetries: parseInt(getSetting('wablas_max_retries', process.env.WABLAS_MAX_RETRIES || '3'), 10),
        retryDelay: parseInt(getSetting('wablas_retry_delay', process.env.WABLAS_RETRY_DELAY || '2000'), 10)
    };
}

/**
 * Validasi konfigurasi Wablas
 * @returns {boolean} True jika valid
 */
function validateWablasConfig() {
    const config = getWablasConfig();
    const errors = [];

    if (!config.apiKey) {
        errors.push('Wablas API key tidak dikonfigurasi');
    }

    if (!config.apiUrl) {
        errors.push('Wablas API URL tidak dikonfigurasi');
    }

    if (errors.length > 0) {
        logger.warn('⚠️ Wablas configuration errors:', errors);
        return false;
    }

    return true;
}

/**
 * Cek apakah Wablas enabled dan valid
 * @returns {boolean}
 */
function isWablasEnabled() {
    const config = getWablasConfig();
    return config.enabled && validateWablasConfig();
}

module.exports = {
    getWablasConfig,
    validateWablasConfig,
    isWablasEnabled
};

