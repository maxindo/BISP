const { checkLicenseStatus, isLicenseValid, isTrialExpired } = require('../config/licenseManager');
const logger = require('../config/logger');

/**
 * Middleware untuk mengecek license status sebelum login
 * Jika trial habis atau license tidak valid, block login
 */
async function licenseCheck(req, res, next) {
    try {
        // Skip license check untuk route aktivasi license
        if (req.path.includes('/license') || req.path.includes('/admin/license')) {
            return next();
        }
        
        // Skip license check untuk halaman login (tapi cek di handler login)
        if (req.path === '/admin/login' || req.path === '/admin/login/mobile') {
            return next();
        }
        
        // Untuk route yang sudah login, cek license
        const isValid = await isLicenseValid();
        
        if (!isValid) {
            const isExpired = await isTrialExpired();
            
            if (isExpired) {
                // Jika sudah login tapi trial habis, logout dan redirect
                if (req.session && req.session.isAdmin) {
                    req.session.destroy();
                }
                
                // Redirect ke halaman license activation
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: 'Trial period telah berakhir. Silakan aktivasi license key untuk melanjutkan.',
                        requiresLicense: true
                    });
                }
                
                return res.redirect('/admin/license?error=Trial+period+telah+berakhir');
            }
        }
        
        next();
    } catch (error) {
        logger.error(`Error in licenseCheck middleware: ${error.message}`);
        // Pada error, allow access (fail open untuk development)
        // Di production, bisa diubah ke fail closed
        next();
    }
}

/**
 * Middleware khusus untuk route login
 * Block login jika trial habis atau license tidak valid
 */
async function licenseLoginCheck(req, res, next) {
    try {
        const isValid = await isLicenseValid();
        
        if (!isValid) {
            const isExpired = await isTrialExpired();
            
            if (isExpired) {
                // Block login dan tampilkan pesan
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: 'Trial period telah berakhir. Silakan aktivasi license key untuk melanjutkan.',
                        requiresLicense: true
                    });
                }
                
                // Render login page dengan error
                const { getSettingsWithCache } = require('../config/settingsManager');
                const settings = getSettingsWithCache();
                
                return res.render('adminLogin', {
                    error: 'Trial period telah berakhir. Silakan aktivasi license key terlebih dahulu.',
                    licenseExpired: true,
                    settings
                });
            }
        }
        
        next();
    } catch (error) {
        logger.error(`Error in licenseLoginCheck middleware: ${error.message}`);
        // Allow login pada error (fail open)
        next();
    }
}

module.exports = {
    licenseCheck,
    licenseLoginCheck
};

