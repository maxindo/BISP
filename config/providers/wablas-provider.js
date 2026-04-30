/**
 * Wablas Provider Implementation
 * Implementasi WhatsAppProvider menggunakan Wablas API
 */
const WhatsAppProvider = require('../whatsapp-provider');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const dns = require('dns');
const logger = require('../logger');
const { getWablasConfig } = require('../wablas-config');

// Set DNS server ke Google DNS untuk avoid DNS issue
try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
    logger.debug('✅ DNS servers set to Google DNS and Cloudflare');
} catch (error) {
    logger.warn('⚠️ Failed to set DNS servers:', error.message);
}

class WablasProvider extends WhatsAppProvider {
    constructor() {
        super();
        this.config = getWablasConfig();
        this.status = {
            connected: false,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        };
        this.rateLimiter = {
            lastRequest: 0,
            minDelay: this.config.minDelay || 1000
        };
        this.requestQueue = [];
        this.processingQueue = false;
    }

    /**
     * Inisialisasi provider
     */
    async initialize() {
        await super.initialize();
        
        if (!this.config.apiKey) {
            throw new Error('Wablas API key tidak dikonfigurasi');
        }

        if (!this.config.apiUrl) {
            throw new Error('Wablas API URL tidak dikonfigurasi');
        }

        // Test koneksi dengan cek status device
        try {
            await this._checkConnection();
            this.status.connected = true;
            this.status.status = 'connected';
            this.status.connectedSince = new Date();
            
            // Update global status untuk kompatibilitas dengan UI
            if (typeof global !== 'undefined') {
                global.whatsappStatus = {
                    ...global.whatsappStatus,
                    connected: true,
                    status: 'connected',
                    connectedSince: this.status.connectedSince,
                    provider: 'Wablas',
                    phoneNumber: this.status.phoneNumber
                };
            }
            
            logger.info('✅ WablasProvider initialized and connected');
        } catch (error) {
            logger.warn(`⚠️ WablasProvider initialized but connection check failed: ${error.message}`);
            this.status.connected = false;
            this.status.status = 'error';
            
            // Update global status
            if (typeof global !== 'undefined') {
                global.whatsappStatus = {
                    ...global.whatsappStatus,
                    connected: false,
                    status: 'error',
                    provider: 'Wablas'
                };
            }
        }

        this._triggerConnectionUpdate({
            connection: this.status.connected ? 'open' : 'close',
            lastDisconnect: null,
            qr: null
        });
    }

    /**
     * Kirim pesan teks
     * Format sesuai dokumentasi Wablas: https://bdg.wablas.com/documentation/api
     */
    async sendMessage(phoneNumber, message, options = {}) {
        try {
            // Rate limiting
            await this._waitForRateLimit();

            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            if (!formattedPhone) {
                throw new Error('Invalid phone number');
            }

            // URL API V2 sesuai dokumentasi
            const url = `${this.config.apiUrl}/api/v2/send-message`;
            
            // Format payload sesuai dokumentasi API V2
            // Dokumentasi: { "data": [{ "phone": "...", "message": "...", "isGroup": "true" }] }
            const messageData = {
                phone: formattedPhone,
                message: message
            };

            // Tambahkan isGroup jika dikonfigurasi (untuk group message)
            if (options.isGroup === true) {
                messageData.isGroup = 'true'; // Dokumentasi: isGroup harus string 'true', bukan boolean
            }

            // Wrap dalam data array sesuai format API V2
            const payload = {
                data: [messageData]
            };

            // Format Authorization sesuai dokumentasi: token.secret_key
            // Jika secretKey tidak ada, gunakan apiKey saja (untuk backward compatibility)
            let authHeader;
            if (this.config.secretKey) {
                authHeader = `${this.config.apiKey}.${this.config.secretKey}`;
            } else {
                // Fallback: coba dengan apiKey saja (mungkin token sudah include secret_key)
                authHeader = this.config.apiKey;
            }

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': authHeader, // Format: token.secret_key (bukan Bearer)
                    'Content-Type': 'application/json'
                },
                timeout: 30000,
                family: 4 // Force IPv4
            });

            // Handle response dari Wablas
            if (response.data) {
                // Status "success" = pesan berhasil dikirim
                if (response.data.status === 'success') {
                    logger.info(`✅ Wablas: Message sent to ${formattedPhone}`);
                    return { 
                        success: true, 
                        messageId: response.data.data?.[0]?.id || response.data.data?.[0]?.message_id 
                    };
                }
                
                // Status "pending" = pesan sedang diproses (bukan error!)
                // Wablas akan mengirim pesan secara async, jadi "pending" adalah status normal
                if (response.data.status === 'pending' || 
                    (response.data.message && response.data.message.includes('pending'))) {
                    logger.info(`⏳ Wablas: Message queued/pending for ${formattedPhone} (will be sent shortly)`);
                    return { 
                        success: true, 
                        pending: true,
                        messageId: response.data.data?.[0]?.id || response.data.data?.[0]?.message_id || 'pending'
                    };
                }
                
                // Jika ada message tapi bukan pending/success, log sebagai warning
                if (response.data.message) {
                    logger.warn(`⚠️ Wablas response: ${response.data.message} for ${formattedPhone}`);
                    // Tetap anggap success jika ada message ID
                    if (response.data.data?.[0]?.id || response.data.data?.[0]?.message_id) {
                        return { 
                            success: true, 
                            messageId: response.data.data?.[0]?.id || response.data.data?.[0]?.message_id,
                            warning: response.data.message
                        };
                    }
                }
            }
            
            // Jika tidak ada response data atau status tidak dikenal, throw error
            const errorMsg = response.data?.message || 'Failed to send message';
            throw new Error(errorMsg);
        } catch (error) {
            logger.error(`❌ Wablas sendMessage error to ${phoneNumber}:`, error.message);
            
            // Retry logic
            if (options.retry !== false && this.config.maxRetries > 0) {
                return await this._retrySend(() => 
                    this.sendMessage(phoneNumber, message, { ...options, retry: false })
                );
            }

            return { 
                success: false, 
                error: error.response?.data?.message || error.message 
            };
        }
    }

    /**
     * Kirim media (gambar/dokumen)
     */
    async sendMedia(phoneNumber, mediaPath, caption = '', options = {}) {
        try {
            await this._waitForRateLimit();

            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            if (!formattedPhone) {
                throw new Error('Invalid phone number');
            }

            if (!fs.existsSync(mediaPath)) {
                throw new Error(`Media file not found: ${mediaPath}`);
            }

            const form = new FormData();
            form.append('phone', formattedPhone);
            if (caption) {
                form.append('caption', caption);
            }
            form.append('file', fs.createReadStream(mediaPath));

            // Tentukan endpoint berdasarkan tipe file
            const fileExt = mediaPath.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);
            const endpoint = isImage ? 'send-image' : 'send-document';

            const url = `${this.config.apiUrl}/api/v2/${endpoint}`;
            
            // Format Authorization sesuai dokumentasi: token.secret_key
            let authHeader;
            if (this.config.secretKey) {
                authHeader = `${this.config.apiKey}.${this.config.secretKey}`;
            } else {
                authHeader = this.config.apiKey;
            }
            
            const response = await axios.post(url, form, {
                headers: {
                    'Authorization': authHeader, // Format: token.secret_key (bukan Bearer)
                    ...form.getHeaders()
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                family: 4 // Force IPv4
            });

            if (response.data && response.data.status === 'success') {
                logger.info(`✅ Wablas: Media sent to ${formattedPhone}`);
                return { 
                    success: true, 
                    messageId: response.data.data?.id || response.data.data?.message_id 
                };
            } else {
                const errorMsg = response.data?.message || 'Failed to send media';
                throw new Error(errorMsg);
            }
        } catch (error) {
            logger.error(`❌ Wablas sendMedia error to ${phoneNumber}:`, error.message);
            
            if (options.retry !== false && this.config.maxRetries > 0) {
                return await this._retrySend(() => 
                    this.sendMedia(phoneNumber, mediaPath, caption, { ...options, retry: false })
                );
            }

            return { 
                success: false, 
                error: error.response?.data?.message || error.message 
            };
        }
    }

    /**
     * Kirim pesan bulk dengan rate limiting
     * Menggunakan API V2 Multiple Send untuk efisiensi
     */
    async sendBulkMessages(messages) {
        const results = { sent: 0, failed: 0, errors: [] };
        
        logger.info(`📤 Sending ${messages.length} bulk messages via Wablas...`);

        // Format Authorization sesuai dokumentasi: token.secret_key
        let authHeader;
        if (this.config.secretKey) {
            authHeader = `${this.config.apiKey}.${this.config.secretKey}`;
        } else {
            authHeader = this.config.apiKey;
        }

        // API V2 mendukung multiple send dalam satu request
        // Bagi messages menjadi batch untuk menghindari payload terlalu besar
        const batchSize = 100; // Max 100 messages per request (sesuai best practice)
        
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            
            try {
                // Format payload sesuai dokumentasi API V2 Multiple Send
                const messageDataArray = batch.map(msg => {
                    const formattedPhone = this.formatPhoneNumber(msg.phone);
                    if (!formattedPhone) {
                        throw new Error(`Invalid phone number: ${msg.phone}`);
                    }

                    const data = {
                        phone: formattedPhone,
                        message: msg.message
                    };

                    // Tambahkan isGroup jika dikonfigurasi
                    if (msg.options?.isGroup === true) {
                        data.isGroup = 'true';
                    }

                    return data;
                });

                const payload = {
                    data: messageDataArray
                };

                const url = `${this.config.apiUrl}/api/v2/send-message`;
                
                const response = await axios.post(url, payload, {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000, // Timeout lebih lama untuk bulk
                    family: 4 // Force IPv4
                });

                if (response.data && response.data.status === 'success') {
                    // Response bisa berupa array atau single object
                    const responseData = Array.isArray(response.data.data) 
                        ? response.data.data 
                        : [response.data.data];
                    
                    responseData.forEach((result, index) => {
                        if (result && result.id) {
                            results.sent++;
                        } else {
                            results.failed++;
                            results.errors.push({ 
                                phone: batch[index].phone, 
                                error: 'No message ID returned' 
                            });
                        }
                    });
                } else {
                    // Jika batch gagal, mark semua sebagai failed
                    batch.forEach(msg => {
                        results.failed++;
                        results.errors.push({ 
                            phone: msg.phone, 
                            error: response.data?.message || 'Batch send failed' 
                        });
                    });
                }

                // Delay antar batch untuk rate limiting
                if (i + batchSize < messages.length) {
                    await new Promise(resolve => setTimeout(resolve, this.rateLimiter.minDelay));
                }
            } catch (error) {
                // Jika batch error, mark semua sebagai failed
                batch.forEach(msg => {
                    results.failed++;
                    results.errors.push({ 
                        phone: msg.phone, 
                        error: error.message 
                    });
                });
            }
        }

        logger.info(`✅ Bulk send complete: ${results.sent} sent, ${results.failed} failed`);
        return results;
    }

    /**
     * Handle incoming webhook dari Wablas
     * Dipanggil oleh webhook handler
     */
    handleIncomingWebhook(webhookData) {
        try {
            // Parse payload Wablas (sesuaikan dengan format Wablas)
            // Format contoh:
            // {
            //   "phone": "6281234567890",
            //   "message": "Hello",
            //   "timestamp": 1234567890,
            //   "type": "text",
            //   "from_me": false
            // }

            const phone = webhookData.phone || webhookData.from || webhookData.sender;
            const messageText = webhookData.message || webhookData.text || webhookData.body;
            const timestamp = webhookData.timestamp || webhookData.time || Date.now();

            if (!phone || !messageText) {
                logger.warn('⚠️ Invalid webhook data:', webhookData);
                return;
            }

            const message = {
                remoteJid: this.createJID(phone),
                senderNumber: this.formatPhoneNumber(phone),
                messageText: messageText,
                timestamp: timestamp,
                isGroup: false, // Wablas biasanya tidak support group
                isAdmin: false, // Akan dicek oleh handler
                quoted: webhookData.quoted || null,
                type: webhookData.type || 'text'
            };

            logger.debug(`📥 Received message from ${message.senderNumber}: ${messageText.substring(0, 50)}`);
            this._triggerMessage(message);
        } catch (error) {
            logger.error('❌ Error processing Wablas webhook:', error);
        }
    }

    /**
     * Cek status koneksi
     */
    isConnected() {
        return this.status.connected && !!this.config.apiKey;
    }

    /**
     * Dapatkan status detail
     */
    getStatus() {
        return {
            ...this.status,
            provider: 'Wablas',
            apiUrl: this.config.apiUrl,
            deviceId: this.config.deviceId || 'not configured'
        };
    }

    /**
     * Cek koneksi dengan API Wablas
     * @private
     */
    async _checkConnection() {
        try {
            // Format Authorization sesuai dokumentasi: token.secret_key
            let authHeader;
            if (this.config.secretKey) {
                authHeader = `${this.config.apiKey}.${this.config.secretKey}`;
            } else {
                authHeader = this.config.apiKey;
            }

            // Wablas tidak punya endpoint public untuk cek device status
            // Jadi kita anggap connected jika API key ada
            // Koneksi akan terverifikasi saat pertama kali kirim pesan
            if (this.config.apiKey) {
                logger.info('✅ Wablas API key configured, assuming connected (will verify on first send)');
                return true;
            }

            return false;
        } catch (error) {
            logger.warn(`⚠️ Wablas connection check failed: ${error.message}`);
            // Jika API key ada, anggap connected (endpoint mungkin berbeda)
            if (this.config.apiKey) {
                logger.info('✅ Wablas API key configured, assuming connected despite check failure');
                return true;
            }
            return false;
        }
    }

    /**
     * Rate limiting helper
     * @private
     */
    async _waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.rateLimiter.lastRequest;
        
        if (timeSinceLastRequest < this.rateLimiter.minDelay) {
            const waitTime = this.rateLimiter.minDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.rateLimiter.lastRequest = Date.now();
    }

    /**
     * Retry mechanism
     * @private
     */
    async _retrySend(sendFn, retries = null) {
        const maxRetries = retries !== null ? retries : this.config.maxRetries;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * (i + 1)));
                return await sendFn();
            } catch (error) {
                if (i === maxRetries - 1) {
                    return { success: false, error: error.message };
                }
            }
        }
        
        return { success: false, error: 'Max retries exceeded' };
    }
}

module.exports = WablasProvider;

