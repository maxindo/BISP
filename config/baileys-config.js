/**
 * Konfigurasi Baileys WhatsApp Gateway
 */
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

/**
 * Cek apakah Baileys enabled
 * @returns {boolean}
 */
function isBaileysEnabled() {
    const setting = getSetting('baileys_enabled', 'false');
    // Handle both string and boolean
    if (typeof setting === 'boolean') return setting;
    if (typeof setting === 'string') return setting.toLowerCase() === 'true';
    return false;
}

/**
 * Dapatkan konfigurasi Baileys
 * @returns {object} Konfigurasi Baileys
 */
function getBaileysConfig() {
    return {
        enabled: isBaileysEnabled(),
        sessionPath: getSetting('whatsapp_session_path', './whatsapp-session'),
        logLevel: getSetting('whatsapp_log_level', 'silent')
    };
}

module.exports = {
    isBaileysEnabled,
    getBaileysConfig
};

