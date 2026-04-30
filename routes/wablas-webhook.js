/**
 * Webhook Handler untuk Wablas
 * Menerima pesan masuk dari Wablas dan meneruskannya ke provider
 */
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { getWablasConfig } = require('../config/wablas-config');
const { getProviderManager } = require('../config/whatsapp-provider-manager');

/**
 * Middleware untuk validasi webhook (optional, jika Wablas menyediakan signature)
 */
function validateWebhook(req, res, next) {
    const config = getWablasConfig();
    
    // Jika ada webhook secret, validasi signature
    if (config.webhookSecret) {
        const signature = req.headers['x-wablas-signature'] || 
                         req.headers['x-signature'] || 
                         req.query.signature;
        
        if (signature !== config.webhookSecret) {
            logger.warn('⚠️ Invalid webhook signature:', {
                received: signature,
                expected: config.webhookSecret ? '***' : 'none'
            });
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }
    
    next();
}

/**
 * Webhook endpoint untuk pesan masuk dari Wablas
 * POST /webhook/wablas
 */
router.post('/webhook/wablas', validateWebhook, async (req, res) => {
    try {
        const webhookData = req.body;
        
        logger.info('📥 Received Wablas webhook:', {
            phone: webhookData.phone || webhookData.from,
            message: webhookData.message?.substring(0, 50),
            type: webhookData.type
        });

        // Validasi payload minimal
        if (!webhookData.phone && !webhookData.from && !webhookData.sender) {
            logger.warn('⚠️ Invalid webhook payload: missing phone/sender');
            return res.status(400).json({ error: 'Invalid payload: missing phone/sender' });
        }

        if (!webhookData.message && !webhookData.text && !webhookData.body) {
            logger.warn('⚠️ Invalid webhook payload: missing message');
            return res.status(400).json({ error: 'Invalid payload: missing message' });
        }

        // Dapatkan provider manager
        const providerManager = getProviderManager();
        
        // Auto-initialize jika belum initialized
        if (!providerManager.isInitialized()) {
            logger.warn('⚠️ ProviderManager not initialized, attempting auto-initialize...');
            try {
                const { isWablasEnabled } = require('../config/wablas-config');
                if (isWablasEnabled()) {
                    await providerManager.initialize({ forceProvider: 'wablas' });
                    logger.info('✅ WablasProvider auto-initialized');
                } else {
                    await providerManager.initialize({ forceProvider: 'baileys' });
                    logger.info('✅ BaileysProvider auto-initialized');
                }
            } catch (initError) {
                logger.error('❌ Failed to auto-initialize ProviderManager:', initError);
                return res.status(503).json({ error: 'Service unavailable - ProviderManager initialization failed' });
            }
        }

        const provider = providerManager.getProvider();

        // Pastikan provider adalah WablasProvider
        if (provider.constructor.name !== 'WablasProvider') {
            logger.warn('⚠️ Wablas webhook received but provider is not WablasProvider');
            // Tetap return 200 untuk menghindari retry dari Wablas
            return res.status(200).json({ success: true, message: 'Provider mismatch' });
        }

        // Handle webhook
        provider.handleIncomingWebhook(webhookData);

        // Selalu return 200 OK ke Wablas (untuk menghindari retry)
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('❌ Error processing Wablas webhook:', error);
        // Tetap return 200 untuk menghindari retry loop dari Wablas
        res.status(200).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * Health check endpoint
 * GET /webhook/wablas/health
 */
router.get('/webhook/wablas/health', (req, res) => {
    try {
        const providerManager = getProviderManager();
        const isInitialized = providerManager.isInitialized();
        const providerType = isInitialized ? providerManager.getProviderType() : null;
        
        res.json({ 
            status: 'ok', 
            provider: providerType || 'not initialized',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            error: error.message 
        });
    }
});

/**
 * Test endpoint untuk simulasi webhook (development only)
 * POST /webhook/wablas/test
 */
router.post('/webhook/wablas/test', async (req, res) => {
    try {
        const testData = {
            phone: req.body.phone || '6281234567890',
            message: req.body.message || 'Test message',
            timestamp: Date.now(),
            type: 'text'
        };

        logger.info('🧪 Test webhook received:', testData);

        const providerManager = getProviderManager();
        if (providerManager.isInitialized()) {
            const provider = providerManager.getProvider();
            if (provider.constructor.name === 'WablasProvider') {
                provider.handleIncomingWebhook(testData);
            }
        }

        res.json({ success: true, message: 'Test webhook processed', data: testData });
    } catch (error) {
        logger.error('❌ Error processing test webhook:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

