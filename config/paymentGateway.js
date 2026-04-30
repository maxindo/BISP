const crypto = require('crypto');
const { getSetting } = require('./settingsManager');
const { getPaymentGatewayConfig, DEFAULT_CONFIG } = require('./paymentGatewayConfig');

class PaymentGatewayManager {

    constructor() {
        this.settings = { payment_gateway: DEFAULT_CONFIG };
        this.gateways = {};
        this.activeGateway = DEFAULT_CONFIG.active;
        this.initialized = false;
        this.initPromise = this.loadSettingsAndInitialize();
    }

    async loadSettingsAndInitialize() {
        try {
            const config = await getPaymentGatewayConfig();
            this.settings = { payment_gateway: config };
        } catch (error) {
            console.error('[PAYMENT_GATEWAY] Failed to load config, using defaults:', error.message);
            this.settings = { payment_gateway: DEFAULT_CONFIG };
        }

        this.initializeGateways();
        this.activeGateway = this.settings.payment_gateway ? this.settings.payment_gateway.active : null;
        this.initialized = true;
        return { active: this.activeGateway, initialized: Object.keys(this.gateways) };
    }

    initializeGateways() {
        
        // Only initialize enabled gateways
        if (this.settings.payment_gateway && this.settings.payment_gateway.midtrans && this.settings.payment_gateway.midtrans.enabled) {
            try {
                console.log('[PAYMENT_GATEWAY] Initializing Midtrans with config:', this.settings.payment_gateway.midtrans);
                this.gateways.midtrans = new MidtransGateway(this.settings.payment_gateway.midtrans);
                console.log('[PAYMENT_GATEWAY] Midtrans initialized successfully');
            } catch (error) {
                console.error('Failed to initialize Midtrans gateway:', error.message);
                console.error('Midtrans config provided:', this.settings.payment_gateway.midtrans);
            }
        } else {
            console.log('[PAYMENT_GATEWAY] Midtrans not enabled or config missing');
        }
        
        if (this.settings.payment_gateway && this.settings.payment_gateway.xendit && this.settings.payment_gateway.xendit.enabled) {
            try {
                this.gateways.xendit = new XenditGateway(this.settings.payment_gateway.xendit);
            } catch (error) {
                console.error('Failed to initialize Xendit gateway:', error);
            }
        }
        
        if (this.settings.payment_gateway && this.settings.payment_gateway.tripay && this.settings.payment_gateway.tripay.enabled) {
            try {
                this.gateways.tripay = new TripayGateway(this.settings.payment_gateway.tripay);
            } catch (error) {
                console.error('Failed to initialize Tripay gateway:', error);
            }
        }
        
        if (this.settings.payment_gateway && this.settings.payment_gateway.duitku && this.settings.payment_gateway.duitku.enabled) {
            try {
                console.log('[PAYMENT_GATEWAY] Initializing Duitku with config:', this.settings.payment_gateway.duitku);
                this.gateways.duitku = new DuitkuGateway(this.settings.payment_gateway.duitku);
                console.log('[PAYMENT_GATEWAY] Duitku initialized successfully');
            } catch (error) {
                console.error('Failed to initialize Duitku gateway:', error.message);
                console.error('Duitku config provided:', this.settings.payment_gateway.duitku);
            }
        } else {
            console.log('[PAYMENT_GATEWAY] Duitku not enabled or config missing');
        }
        
        this.activeGateway = this.settings.payment_gateway ? this.settings.payment_gateway.active : null;
    }

    async ensureInitialized() {
        if (this.initialized) return;
        if (!this.initPromise) {
            this.initPromise = this.loadSettingsAndInitialize();
        }
        try {
            await this.initPromise;
        } catch (error) {
            console.error('[PAYMENT_GATEWAY] Initialization error:', error.message);
            this.settings = { payment_gateway: DEFAULT_CONFIG };
            this.initializeGateways();
            this.initialized = true;
        }
    }

    getActiveGateway() {
        return this.activeGateway;
    }

    // Reload settings and reinitialize gateways without server restart
    async reload() {
        this.initialized = false;
        this.initPromise = this.loadSettingsAndInitialize();
        return this.initPromise;
    }

    async createPayment(invoice, gateway = null) {
        await this.ensureInitialized();
        const selectedGateway = gateway || this.activeGateway;
        
        if (!selectedGateway) {
            throw new Error('No payment gateway is active');
        }
        
        if (!this.gateways[selectedGateway]) {
            throw new Error(`Gateway ${selectedGateway} is not initialized or not available`);
        }

        if (!this.settings.payment_gateway || !this.settings.payment_gateway[selectedGateway] || !this.settings.payment_gateway[selectedGateway].enabled) {
            throw new Error(`Gateway ${selectedGateway} is not enabled`);
        }

        try {
            const result = await this.gateways[selectedGateway].createPayment(invoice);
            return {
                ...result,
                gateway: selectedGateway
            };
        } catch (error) {
            console.error(`Error creating payment with ${selectedGateway}:`, error);
            throw error;
        }
    }

    async createPaymentWithMethod(invoice, gateway = null, method = null, paymentType = 'invoice') {
        await this.ensureInitialized();
        const selectedGateway = gateway || this.activeGateway;
        
        if (!selectedGateway) {
            throw new Error('No payment gateway is active');
        }
        
        if (!this.gateways[selectedGateway]) {
            console.error(`[PAYMENT_GATEWAY] Gateway ${selectedGateway} not found in initialized gateways`);
            console.error(`[PAYMENT_GATEWAY] Available gateways:`, Object.keys(this.gateways));
            console.error(`[PAYMENT_GATEWAY] Gateway config enabled:`, this.settings.payment_gateway?.[selectedGateway]?.enabled);
            throw new Error(`Gateway ${selectedGateway} is not initialized or not available`);
        }

        if (!this.settings.payment_gateway || !this.settings.payment_gateway[selectedGateway] || !this.settings.payment_gateway[selectedGateway].enabled) {
            throw new Error(`Gateway ${selectedGateway} is not enabled`);
        }

        try {
            // Pass method to gateway for Tripay and Duitku
            console.log(`[PAYMENT_GATEWAY] Creating payment with gateway: ${selectedGateway}, method: ${method}, type: ${paymentType}`);
            let result;
            if ((selectedGateway === 'tripay' || selectedGateway === 'duitku') && method && method !== 'all') {
                console.log(`[PAYMENT_GATEWAY] Using ${selectedGateway} with specific method: ${method}`);
                result = await this.gateways[selectedGateway].createPaymentWithMethod(invoice, method, paymentType);
            } else {
                console.log(`[PAYMENT_GATEWAY] Using default gateway method for ${selectedGateway}`);
                result = await this.gateways[selectedGateway].createPayment(invoice, paymentType);
            }
            
            return {
                ...result,
                gateway: selectedGateway,
                payment_method: method
            };
        } catch (error) {
            console.error(`Error creating payment with ${selectedGateway} (method: ${method}):`, error);
            throw error;
        }
    }

    async handleWebhook(payload, gateway) {
        await this.ensureInitialized();
        if (!this.gateways[gateway]) {
            throw new Error(`Gateway ${gateway} is not initialized or not available`);
        }

        try {
            // Support either raw body or { body, headers }
            const body = payload && payload.body ? payload.body : payload;
            const headers = payload && payload.headers ? payload.headers : {};
            console.log(`[PAYMENT_GATEWAY] Processing webhook from ${gateway}:`, JSON.stringify(body, null, 2));

            const result = await this.gateways[gateway].handleWebhook(body, headers);
            console.log(`[PAYMENT_GATEWAY] Raw result from ${gateway}:`, JSON.stringify(result, null, 2));

            // Normalize the result to ensure consistent format
            const normalizedResult = {
                order_id: result.order_id || result.merchant_ref || result.external_id || body.order_id,
                status: result.status || body.status || 'pending',
                amount: result.amount || body.amount || body.gross_amount,
                payment_type: result.payment_type || body.payment_type || body.payment_method,
                fraud_status: result.fraud_status || body.fraud_status || 'accept',
                reference: result.reference || result.invoice_id || null
            };
            
            console.log(`[PAYMENT_GATEWAY] Normalized webhook result for ${gateway}:`, normalizedResult);
            
            // Log additional info for debugging
            if (normalizedResult.status) {
                console.log(`[PAYMENT_GATEWAY] Payment status: ${normalizedResult.status}`);
            }
            if (normalizedResult.order_id) {
                console.log(`[PAYMENT_GATEWAY] Order ID: ${normalizedResult.order_id}`);
            }
            
            return normalizedResult;
        } catch (error) {
            console.error(`[PAYMENT_GATEWAY] Error handling webhook from ${gateway}:`, error);
            throw error;
        }
    }

    async getGatewayStatus() {
        await this.ensureInitialized();
        const status = {};
        
        // Check all configured gateways
        if (this.settings.payment_gateway) {
            if (this.settings.payment_gateway.midtrans) {
                status.midtrans = {
                    enabled: this.settings.payment_gateway.midtrans.enabled,
                    active: 'midtrans' === this.activeGateway,
                    initialized: !!this.gateways.midtrans
                };
            }
            
            if (this.settings.payment_gateway.xendit) {
                status.xendit = {
                    enabled: this.settings.payment_gateway.xendit.enabled,
                    active: 'xendit' === this.activeGateway,
                    initialized: !!this.gateways.xendit
                };
            }
            
            if (this.settings.payment_gateway.tripay) {
                status.tripay = {
                    enabled: this.settings.payment_gateway.tripay.enabled,
                    active: 'tripay' === this.activeGateway,
                    initialized: !!this.gateways.tripay
                };
            }
            
            if (this.settings.payment_gateway.duitku) {
                status.duitku = {
                    enabled: this.settings.payment_gateway.duitku.enabled,
                    active: 'duitku' === this.activeGateway,
                    initialized: !!this.gateways.duitku
                };
            }
        }
        
        return status;
    }

    async getAvailablePaymentMethods() {
        await this.ensureInitialized();
        const methods = [];
        
        // Check each enabled gateway and get their available methods
        if (this.settings.payment_gateway) {
            // Midtrans methods (if enabled)
            if (this.settings.payment_gateway.midtrans && this.settings.payment_gateway.midtrans.enabled && this.gateways.midtrans) {
                methods.push({
                    gateway: 'midtrans',
                    method: 'all',
                    name: 'Kartu Kredit/Debit & E-Wallet',
                    icon: 'bi-credit-card',
                    color: 'primary'
                });
            }
            
            // Xendit methods (if enabled)
            if (this.settings.payment_gateway.xendit && this.settings.payment_gateway.xendit.enabled && this.gateways.xendit) {
                methods.push({
                    gateway: 'xendit',
                    method: 'all',
                    name: 'Xendit Payment',
                    icon: 'bi-credit-card-2-front',
                    color: 'info'
                });
            }
            
            // Tripay methods (if enabled)
            if (this.settings.payment_gateway.tripay && this.settings.payment_gateway.tripay.enabled && this.gateways.tripay) {
                try {
                    const tripayMethods = await this.gateways.tripay.getAvailablePaymentMethods();
                    methods.push(...tripayMethods);
                } catch (error) {
                    console.error('Error getting Tripay payment methods:', error);
                    // Fallback to default methods if API call fails
                    const defaultTripayMethods = [
                        { gateway: 'tripay', method: 'QRIS', name: 'QRIS', icon: 'bi-qr-code', color: 'info' },
                        { gateway: 'tripay', method: 'DANA', name: 'DANA', icon: 'bi-wallet2', color: 'success' },
                        { gateway: 'tripay', method: 'GOPAY', name: 'GoPay', icon: 'bi-wallet', color: 'warning' },
                        { gateway: 'tripay', method: 'OVO', name: 'OVO', icon: 'bi-phone', color: 'danger' },
                        { gateway: 'tripay', method: 'BRIVA', name: 'Bank BRI', icon: 'bi-bank', color: 'dark' },
                        { gateway: 'tripay', method: 'SHOPEEPAY', name: 'ShopeePay', icon: 'bi-bag', color: 'secondary' }
                    ];
                    methods.push(...defaultTripayMethods);
                }
            }
            
            // Duitku methods (if enabled)
            if (this.settings.payment_gateway.duitku && this.settings.payment_gateway.duitku.enabled && this.gateways.duitku) {
                try {
                    const duitkuMethods = await this.gateways.duitku.getAvailablePaymentMethods();
                    methods.push(...duitkuMethods);
                } catch (error) {
                    console.error('Error getting Duitku payment methods:', error);
                    // Fallback to default methods if API call fails
                    const defaultDuitkuMethods = [
                        { gateway: 'duitku', method: 'VC', name: 'Kartu Kredit/Debit', icon: 'bi-credit-card', color: 'primary', type: 'card', fee_customer: 'Gratis' },
                        { gateway: 'duitku', method: 'BT', name: 'Virtual Account Bank', icon: 'bi-bank', color: 'dark', type: 'bank', fee_customer: 'Gratis' },
                        { gateway: 'duitku', method: 'QRIS', name: 'QRIS', icon: 'bi-qr-code', color: 'info', type: 'ewallet', fee_customer: 'Gratis' }
                    ];
                    methods.push(...defaultDuitkuMethods);
                }
            }
        }
        
        return methods;
    }
}

class MidtransGateway {

    constructor(config) {
        if (!config || !config.server_key || !config.client_key) {
            throw new Error('Midtrans configuration is incomplete. Missing server_key or client_key.');
        }
        
        this.config = config;
        this.midtransClient = require('midtrans-client');
        this.snap = new this.midtransClient.Snap({
            isProduction: config.production,
            serverKey: config.server_key,
            clientKey: config.client_key
        });
    }

    async createPayment(invoice) {
        // Validate email to avoid Midtrans 400 on invalid format
        const email = (invoice.customer_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.customer_email))
            ? invoice.customer_email
            : undefined;

        // Derive application base URL for callbacks (prefer config.base_url, fallback to settings)
        const hostSettingMid = getSetting('server_host', 'localhost');
        const hostMid = (hostSettingMid && String(hostSettingMid).trim()) || 'localhost';
        const portMid = getSetting('server_port', '3003');
        const defaultAppBaseMid = `http://${hostMid}${portMid ? `:${portMid}` : ''}`;
        const rawBaseMid = (this.config.base_url || defaultAppBaseMid || '').toString().trim();
        const appBaseUrlMid = rawBaseMid.replace(/\/+$/, '');

        const parameter = {
            transaction_details: {
                order_id: `INV-${invoice.invoice_number}`,
                gross_amount: parseInt(invoice.amount)
            },
            customer_details: {
                first_name: invoice.customer_name,
                phone: invoice.customer_phone || '',
                ...(email ? { email } : {})
            },
            item_details: [{
                id: invoice.package_id || 'PACKAGE-001',
                price: parseInt(invoice.amount),
                quantity: 1,
                name: invoice.package_name || 'Internet Package'
            }],
            callbacks: {
                finish: `${appBaseUrlMid}/payment/finish`,
                error: `${appBaseUrlMid}/payment/error`,
                pending: `${appBaseUrlMid}/payment/pending`
            }
        };

        const transaction = await this.snap.createTransaction(parameter);
        
        return {
            payment_url: transaction.redirect_url,
            token: transaction.token,
            order_id: parameter.transaction_details.order_id
        };
    }

    async handleWebhook(payload, _headers = {}) {
        try {
            // Verify signature
            const expectedSignature = crypto
                .createHash('sha512')
                .update(payload.order_id + payload.status_code + payload.gross_amount + this.config.server_key)
                .digest('hex');

            if (payload.signature_key !== expectedSignature) {
                throw new Error('Invalid signature');
            }

            // Map Midtrans status to our standard status
            let status = payload.transaction_status;
            if (payload.transaction_status === 'settlement' || payload.transaction_status === 'capture') {
                status = 'settlement';
            } else if (payload.transaction_status === 'pending') {
                status = 'pending';
            } else if (payload.transaction_status === 'deny' || payload.transaction_status === 'expire' || payload.transaction_status === 'cancel') {
                status = 'failed';
            }

            const result = {
                order_id: payload.order_id,
                status: status,
                amount: payload.gross_amount,
                payment_type: payload.payment_type,
                fraud_status: payload.fraud_status || 'accept'
            };

            console.log(`[MIDTRANS] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[MIDTRANS] Webhook error:`, error);
            throw error;
        }
    }
}

class XenditGateway {

    constructor(config) {
        if (!config || !config.api_key) {
            throw new Error('Xendit configuration is incomplete. Missing api_key.');
        }
        
        if (!config.api_key.startsWith('xnd_')) {
            throw new Error('Invalid Xendit API key. API key must start with "xnd_".');
        }
        
        this.config = config;
        const { Xendit } = require('xendit-node');
        this.xenditClient = new Xendit({
            secretKey: config.api_key
        });
    }

    async createPayment(invoice) {
        // Derive application base URL for redirects (prefer config.base_url, fallback to settings)
        const hostSettingXe = getSetting('server_host', 'localhost');
        const hostXe = (hostSettingXe && String(hostSettingXe).trim()) || 'localhost';
        const portXe = getSetting('server_port', '3003');
        const defaultAppBaseXe = `http://${hostXe}${portXe ? `:${portXe}` : ''}`;
        const rawBaseXe = (this.config.base_url || defaultAppBaseXe || '').toString().trim();
        const appBaseUrlXe = rawBaseXe.replace(/\/+$/, '');

        const invoiceData = {
            externalID: `INV-${invoice.invoice_number}`,
            amount: parseInt(invoice.amount),
            description: `Pembayaran ${invoice.package_name}`,
            customer: {
                givenNames: invoice.customer_name,
                email: invoice.customer_email || 'customer@example.com',
                mobileNumber: invoice.customer_phone || ''
            },
            successRedirectURL: `${appBaseUrlXe}/payment/success`,
            failureRedirectURL: `${appBaseUrlXe}/payment/failed`
        };

        const xenditInvoice = await this.xenditClient.Invoice.createInvoice(invoiceData);
        
        return {
            payment_url: xenditInvoice.invoice_url,
            token: xenditInvoice.id,
            order_id: invoiceData.externalID
        };
    }

    async handleWebhook(payload, headers = {}) {
        try {
            // Prefer header-based verification using Xendit callback token
            const headerToken = headers['x-callback-token'] || headers['X-Callback-Token'] || headers['X-CALLBACK-TOKEN'];
            if (this.config.callback_token) {
                if (!headerToken || headerToken !== this.config.callback_token) {
                    // Fallback: some older integrations may send a body signature; keep backward-compat only if present
                    if (!payload || !payload.signature) {
                        throw new Error('Invalid callback token');
                    }
                    const legacySig = crypto
                        .createHmac('sha256', this.config.callback_token)
                        .update(JSON.stringify(payload))
                        .digest('hex');
                    if (payload.signature !== legacySig) {
                        throw new Error('Invalid signature');
                    }
                }
            }

            // Map Xendit status to our standard status
            let status = 'pending';
            if (payload.status === 'PAID') status = 'success';
            else if (payload.status === 'PENDING') status = 'pending';
            else if (payload.status === 'EXPIRED' || payload.status === 'FAILED') status = 'failed';

            const result = {
                order_id: payload.external_id,
                status: status,
                amount: payload.amount,
                payment_type: payload.payment_channel,
                invoice_id: payload.id
            };

            console.log(`[XENDIT] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[XENDIT] Webhook error:`, error);
            throw error;
        }
    }
}

class TripayGateway {

    constructor(config) {
        if (!config || !config.api_key || !config.private_key || !config.merchant_code) {
            throw new Error('Tripay configuration is incomplete. Missing api_key, private_key, or merchant_code.');
        }
        
        this.config = config;
        // Use proper API base path for production and sandbox
        this.baseUrl = config.production ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
    }

    async createPayment(invoice, paymentType = 'invoice') {
        return this.createPaymentWithMethod(invoice, this.config.method || 'BRIVA', paymentType);
    }

    async createPaymentWithMethod(invoice, method, paymentType = 'invoice') {
        // Derive application base URL for callbacks
        const hostSetting = getSetting('server_host', 'localhost');
        const host = (hostSetting && String(hostSetting).trim()) || 'localhost';
        const port = getSetting('server_port', '3003');
        const defaultAppBase = `http://${host}${port ? `:${port}` : ''}`;
        const rawBase = (this.config.base_url || defaultAppBase || '').toString().trim();
        const baseNoSlash = rawBase.replace(/\/+$/, ''); // remove trailing slash
        if (!/^https?:\/\//i.test(baseNoSlash)) {
            throw new Error(`Invalid base_url for Tripay callbacks: "${rawBase}". Please set a full URL starting with http:// or https:// in settings (payment_gateway.tripay.base_url) or set valid server_host/server_port.`);
        }
        const appBaseUrl = baseNoSlash;

        // Use method from customer choice, not admin settings
        const selectedMethod = method || 'BRIVA'; // Default to BRIVA if no method specified
        console.log(`[TRIPAY] Creating payment with method: ${selectedMethod} (from customer choice: ${method})`);

        // Validate and sanitize customer data for Tripay
        const customerName = invoice.customer_name ? invoice.customer_name.trim() : 'Customer';
        const customerEmail = invoice.customer_email ? invoice.customer_email.trim() : 'customer@example.com';
        let customerPhone = invoice.customer_phone ? invoice.customer_phone.trim() : '';
        
        // Tripay has limits on customer name length (max ~50 characters)
        // Very long names cause "Internal service error"
        const sanitizedCustomerName = customerName.length > 50 ? customerName.substring(0, 47) + '...' : customerName;
        
        console.log(`[TRIPAY] Customer name sanitization: "${customerName}" -> "${sanitizedCustomerName}" (length: ${customerName.length} -> ${sanitizedCustomerName.length})`);
        
        // Penyesuaian format nomor telepon khusus beberapa metode e-wallet
        try {
            const digitsOnly = customerPhone.replace(/\D/g, '');
            if (String(selectedMethod).toUpperCase() === 'DANA') {
                // DANA cenderung lebih stabil dengan format lokal 08xxxxxxxxxx
                if (digitsOnly.startsWith('62')) {
                    customerPhone = '0' + digitsOnly.slice(2);
                } else if (!digitsOnly.startsWith('0') && digitsOnly.length >= 9) {
                    customerPhone = '0' + digitsOnly;
                } else {
                    customerPhone = digitsOnly;
                }

                // Enforce length between 10-13 digits for DANA
                const danaDigits = customerPhone.replace(/\D/g, '');
                if (danaDigits.length < 10) {
                    // pad conservatively by duplicating last digit
                    const padLen = 10 - danaDigits.length;
                    customerPhone = danaDigits + (danaDigits.slice(-1) || '0').repeat(padLen);
                } else if (danaDigits.length > 13) {
                    // trim to last 12 digits and ensure starts with 08
                    const last12 = danaDigits.slice(-12);
                    customerPhone = last12.startsWith('8') ? ('0' + last12) : ('0' + last12.replace(/^\d/, '8'));
                }
            } else {
                // Metode lain tetap gunakan nomor bersih (tanpa simbol), prioritaskan E164 sederhana tanpa +
                if (digitsOnly.startsWith('0')) {
                    customerPhone = '62' + digitsOnly.slice(1);
                } else {
                    customerPhone = digitsOnly;
                }
            }
        } catch (_) {
            // keep original customerPhone on parsing issues
        }

        const orderData = {
            method: selectedMethod,
            merchant_ref: `INV-${invoice.invoice_number}`,
            amount: parseInt(invoice.amount),
            customer_name: sanitizedCustomerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            order_items: [{
                name: invoice.package_name || 'Internet Package',
                price: parseInt(invoice.amount),
                quantity: 1
            }],
            callback_url: paymentType === 'voucher' ? `${appBaseUrl}/voucher/payment-webhook` : `${appBaseUrl}/payment/webhook/tripay`,
            return_url: paymentType === 'voucher' ? `${appBaseUrl}/voucher/finish` : `${appBaseUrl}/payment/finish`
        };

        // Extra logging to debug DANA internal errors (safe fields only)
        if (String(selectedMethod).toUpperCase() === 'DANA') {
            console.log('[TRIPAY][DANA] Prepared order data:', {
                merchant_ref: orderData.merchant_ref,
                amount: orderData.amount,
                customer_name: orderData.customer_name,
                customer_phone: orderData.customer_phone,
                callback_url: orderData.callback_url,
                return_url: orderData.return_url
            });
        }

        // Tripay signature: HMAC SHA256 of merchant_code + merchant_ref + amount using private_key
        const rawSign = `${this.config.merchant_code}${orderData.merchant_ref}${orderData.amount}`;
        const signature = crypto
            .createHmac('sha256', this.config.private_key)
            .update(rawSign)
            .digest('hex');

        // Use global fetch if available (Node >= 18), otherwise fallback to node-fetch
        const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
        const response = await fetchFn(`${this.baseUrl}/transaction/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.api_key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                merchant_code: this.config.merchant_code,
                ...orderData,
                signature
            })
        });

        // Harden parsing: ensure JSON, otherwise throw descriptive error
        const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Tripay API returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`);
        }

        const result = await response.json();
        if (!response.ok) {
            throw new Error(`Tripay API error ${response.status}: ${JSON.stringify(result)}`);
        }

        if (result.success) {
            return {
                payment_url: result.data.checkout_url,
                token: result.data.reference,
                order_id: orderData.merchant_ref
            };
        } else {
            throw new Error(result.message || 'Failed to create payment');
        }
    }

    async getAvailablePaymentMethods() {
        try {
            // Get available payment channels from Tripay API
            const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
            const response = await fetchFn(`${this.baseUrl}/merchant/payment-channel`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.api_key}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to get payment channels');
            }

            // Map Tripay channels to our format
            const methods = [];
            if (result.data && Array.isArray(result.data)) {
                result.data.forEach(channel => {
                    if (channel.active) {
                        let icon = 'bi-credit-card';
                        let color = 'primary';
                        
                        // Map specific icons and colors for known methods
                        switch (channel.code) {
                            case 'QRIS':
                                icon = 'bi-qr-code';
                                color = 'info';
                                break;
                            case 'DANA':
                                icon = 'bi-wallet2';
                                color = 'success';
                                break;
                            case 'GOPAY':
                                icon = 'bi-wallet';
                                color = 'warning';
                                break;
                            case 'OVO':
                                icon = 'bi-phone';
                                color = 'danger';
                                break;
                            case 'BRIVA':
                            case 'BNIVA':
                            case 'BSIVA':
                            case 'BRIVA':
                                icon = 'bi-bank';
                                color = 'dark';
                                break;
                            case 'SHOPEEPAY':
                                icon = 'bi-bag';
                                color = 'secondary';
                                break;
                            default:
                                if (channel.type === 'ewallet') {
                                    icon = 'bi-wallet';
                                    color = 'info';
                                } else if (channel.type === 'bank') {
                                    icon = 'bi-bank';
                                    color = 'primary';
                                }
                        }
                        
                        // Format fee for display
                        let feeDisplay = '';
                        if (channel.fee_customer) {
                            if (typeof channel.fee_customer === 'object') {
                                if (channel.fee_customer.flat && channel.fee_customer.flat > 0) {
                                    feeDisplay = `Rp ${parseInt(channel.fee_customer.flat).toLocaleString('id-ID')}`;
                                } else if (channel.fee_customer.percent && channel.fee_customer.percent > 0) {
                                    feeDisplay = `${channel.fee_customer.percent}%`;
                                } else {
                                    // Jika ada fee object tapi tidak ada nilai, tampilkan "Gratis"
                                    feeDisplay = 'Gratis';
                                }
                            } else if (channel.fee_customer !== 0 && channel.fee_customer !== '0') {
                                feeDisplay = channel.fee_customer.toString();
                            } else {
                                feeDisplay = 'Gratis';
                            }
                        } else {
                            // Jika tidak ada fee_customer, anggap gratis
                            feeDisplay = 'Gratis';
                        }

                        methods.push({
                            gateway: 'tripay',
                            method: channel.code,
                            name: channel.name,
                            icon: icon,
                            color: color,
                            type: channel.type,
                            fee_customer: feeDisplay,
                            fee_merchant: channel.fee_merchant,
                            minimum_amount: channel.minimum_amount,
                            maximum_amount: channel.maximum_amount
                        });
                    }
                });
            }
            
            console.log(`[TRIPAY] Found ${methods.length} active payment methods`);
            return methods;
        } catch (error) {
            console.error(`[TRIPAY] Error getting payment methods:`, error);
            throw error;
        }
    }

    async handleWebhook(payload, headers = {}) {
        try {
            // Verify Tripay callback signature from header
            const cbSig = headers['x-callback-signature'] || headers['X-Callback-Signature'] || headers['X-CALLBACK-SIGNATURE'];
            const expected = crypto
                .createHmac('sha256', this.config.private_key)
                .update(JSON.stringify(payload))
                .digest('hex');
            if (!cbSig || cbSig !== expected) {
                throw new Error('Invalid signature');
            }

            // Map Tripay status to our standard status
            let status = 'pending';
            if (payload.status === 'PAID') status = 'success';
            else if (payload.status === 'UNPAID') status = 'pending';
            else if (payload.status === 'EXPIRED' || payload.status === 'FAILED') status = 'failed';

            const result = {
                order_id: payload.merchant_ref,
                status: status,
                amount: payload.amount,
                payment_type: payload.payment_method,
                reference: payload.reference
            };

            console.log(`[TRIPAY] Webhook processed:`, result);
            return result;
        } catch (error) {
            console.error(`[TRIPAY] Webhook error:`, error);
            throw error;
        }
    }
}

class DuitkuGateway {

    constructor(config) {
        if (!config || !config.merchant_code || !config.api_key) {
            throw new Error('Duitku configuration is incomplete. Missing merchant_code or api_key.');
        }

        this.config = config;
        // Base URL API Duitku
        // Default (sesuai dokumentasi Payment Page):
        //   Sandbox   : https://sandbox.duitku.com
        //   Production: https://passport.duitku.com
        // Bisa dioverride lewat config.api_base_url jika diperlukan.
        const defaultBase = config.production ? 'https://passport.duitku.com' : 'https://sandbox.duitku.com';
        const rawApiBase = (config.api_base_url || defaultBase || '').toString().trim();
        this.baseUrl = rawApiBase.replace(/\/+$/, ''); // hilangkan trailing slash
    }

    // Create payment default (invoice) – gunakan metode default jika tidak ada pilihan spesifik
    async createPayment(invoice, paymentType = 'invoice') {
        const defaultMethod = this.config.default_method || 'VA'; // VA = Virtual Account generic
        return this.createPaymentWithMethod(invoice, defaultMethod, paymentType);
    }

    // Create payment dengan pilihan channel (VA, QRIS, e-wallet, dsb)
    async createPaymentWithMethod(invoice, method, paymentType = 'invoice') {
        // Derive base URL aplikasi untuk callback & redirect
        const hostSetting = getSetting('server_host', 'localhost');
        const host = (hostSetting && String(hostSetting).trim()) || 'localhost';
        const port = getSetting('server_port', '3003');
        const defaultAppBase = `http://${host}${port ? `:${port}` : ''}`;
        const rawBase = (this.config.base_url || defaultAppBase || '').toString().trim();
        const baseNoSlash = rawBase.replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(baseNoSlash)) {
            throw new Error(`Invalid base_url for Duitku callbacks: "${rawBase}". Please set a full URL starting with http:// or https:// in settings (payment_gateway.duitku.base_url) or set valid server_host/server_port.`);
        }
        const appBaseUrl = baseNoSlash;

        const orderId = `INV-${invoice.invoice_number}`;
        const amount = parseInt(invoice.amount);

        const customerName = (invoice.customer_name || 'Customer').toString().trim();
        const customerEmail = (invoice.customer_email || 'customer@example.com').toString().trim();
        const customerPhone = (invoice.customer_phone || '').toString().trim();

        // Tentukan paymentMethod yang akan dikirim (wajib menurut API Duitku)
        const selectedMethod = method || this.config.default_method || 'VA';
        
        // Body umum Payment Page Duitku
        const payload = {
            merchantCode: this.config.merchant_code,
            paymentAmount: amount,
            merchantOrderId: orderId,
            productDetails: invoice.package_name || 'Internet Package',
            email: customerEmail,
            customerVaName: customerName,
            phoneNumber: customerPhone,
            callbackUrl: paymentType === 'voucher' ? `${appBaseUrl}/voucher/payment-webhook` : `${appBaseUrl}/payment/webhook/duitku`,
            returnUrl: paymentType === 'voucher' ? `${appBaseUrl}/voucher/finish` : `${appBaseUrl}/payment/finish`,
            paymentMethod: selectedMethod,
            expiryPeriod: this.config.expiry_period || 60
        };

        // Bersihkan field undefined
        Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

        // Signature: md5(merchantCode + merchantOrderId + paymentAmount + apiKey)
        // Sesuai dokumentasi Duitku untuk endpoint merchant/v2/inquiry
        const signatureRaw = `${payload.merchantCode}${payload.merchantOrderId}${payload.paymentAmount}${this.config.api_key}`;
        const signature = crypto.createHash('md5').update(signatureRaw).digest('hex');
        payload.signature = signature;

        const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;

        const endpoint = this.config.invoice_endpoint || '/webapi/api/merchant/v2/inquiry';
        const url = `${this.baseUrl}${endpoint}`;

        const response = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Duitku API returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`);
        }

        const result = await response.json();
        if (!response.ok || (result.statusCode && `${result.statusCode}` !== '00')) {
            throw new Error(result.statusMessage || result.Message || `Duitku API error ${response.status}`);
        }

        const paymentUrl = result.paymentUrl || result.deeplinkUrl || result.qrString;
        if (!paymentUrl) {
            throw new Error('Duitku response does not contain paymentUrl/deeplinkUrl/qrString');
        }

        return {
            payment_url: paymentUrl,
            token: result.reference || result.paymentUrl || orderId,
            order_id: orderId
        };
    }

    // Handle webhook/callback dari Duitku
    async handleWebhook(payload, _headers = {}) {
        try {
            const merchantOrderId = payload.merchantOrderId || payload.merchantOrderIdCallback || payload.merchantOrderIdRequest;
            const amount = payload.amount || payload.result || payload.paymentAmount;
            const merchantCode = payload.merchantCode || this.config.merchant_code;
            const signature = payload.signature || payload.signatureRequest || payload.signatureCallback;

            if (!merchantOrderId || !amount || !merchantCode || !signature) {
                throw new Error('Invalid Duitku webhook payload (missing fields)');
            }

            const rawSign = `${merchantCode}${merchantOrderId}${amount}${this.config.api_key}`;
            const expectedSignature = crypto.createHash('sha256').update(rawSign).digest('hex');

            if (signature.toLowerCase() !== expectedSignature.toLowerCase()) {
                throw new Error('Invalid Duitku signature');
            }

            const statusCode = `${payload.statusCode || payload.resultCode || ''}`;
            let status = 'pending';
            if (statusCode === '00') status = 'success';
            else if (['01', '02', '03', '04', '05', '06', '07', '08', '99'].includes(statusCode)) status = 'failed';

            const result = {
                order_id: merchantOrderId,
                status,
                amount: parseInt(amount),
                payment_type: payload.paymentMethod || payload.channel || 'duitku',
                reference: payload.reference || payload.transactionId || null
            };

            console.log('[DUITKU] Webhook processed:', result);
            return result;
        } catch (error) {
            console.error('[DUITKU] Webhook error:', error);
            throw error;
        }
    }

    // Dapatkan daftar channel dari Duitku menggunakan API getpaymentmethod
    async getAvailablePaymentMethods() {
        try {
            const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
            
            // Gunakan endpoint getpaymentmethod sesuai dokumentasi Duitku
            // Endpoint: /webapi/api/merchant/paymentmethod/getpaymentmethod
            const endpoint = '/webapi/api/merchant/paymentmethod/getpaymentmethod';
            const url = `${this.baseUrl}${endpoint}`;

            // Signature untuk getpaymentmethod: sha256(merchantCode + paymentAmount + datetime + apiKey)
            // Kita gunakan amount 10000 sebagai contoh untuk mendapatkan semua metode
            const paymentAmount = 10000;
            const datetime = new Date().toISOString().replace('T', ' ').substring(0, 19); // Format: yyyy-MM-dd HH:mm:ss
            const signatureRaw = `${this.config.merchant_code}${paymentAmount}${datetime}${this.config.api_key}`;
            const signature = crypto.createHash('sha256').update(signatureRaw).digest('hex');

            const payload = {
                merchantcode: this.config.merchant_code,
                amount: paymentAmount,
                datetime: datetime,
                signature: signature
            };

            const response = await fetchFn(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            if (!response.ok || result.responseCode !== '00') {
                throw new Error(result.responseMessage || `Duitku API error ${response.status}`);
            }

            const methods = [];
            if (result.paymentFee && Array.isArray(result.paymentFee)) {
                result.paymentFee.forEach((ch) => {
                    const code = ch.paymentMethod || '';
                    const name = ch.paymentName || `Duitku - ${code}`;
                    
                    // Skip jika tidak ada code
                    if (!code) return;

                    // Tentukan icon dan color berdasarkan jenis payment
                    let icon = 'bi-credit-card';
                    let color = 'primary';
                    let type = 'other';

                    // Mapping untuk Virtual Account - semua kode VA
                    // BC=BCA, M2=Mandiri, I1=BNI, B1=CIMB, BT=Permata, BR=BRI, VA=Maybank, 
                    // A1=ATM Bersama, AG=Artha Graha, NC=BNC, S1=Sampoerna, DM=Danamon, BV=BSI
                    if (/^BC$|^M2$|^I1$|^B1$|^BT$|^BR$|^VA$|^A1$|^AG$|^NC$|^S1$|^DM$|^BV$/i.test(code)) {
                        icon = 'bi-bank';
                        color = 'dark';
                        type = 'bank';
                    } else if (code.toUpperCase() === 'QRIS' || /QRIS/i.test(name)) {
                        icon = 'bi-qr-code';
                        color = 'info';
                        type = 'ewallet';
                    } else if (/^VC$/i.test(code) || /KARTU|CREDIT|DEBIT/i.test(name)) {
                        icon = 'bi-credit-card';
                        color = 'primary';
                        type = 'card';
                    } else if (/OVO|DANA|GOPAY|SHOPEE|LINK|SP|WALLET|EWALLET/i.test(code) || /OVO|DANA|GOPAY|SHOPEE|LINK|WALLET/i.test(name)) {
                        icon = 'bi-wallet';
                        color = 'success';
                        type = 'ewallet';
                    } else if (/RETAIL|ALFAMART|INDOMARET/i.test(name)) {
                        icon = 'bi-shop';
                        color = 'warning';
                        type = 'retail';
                    }

                    // Format fee untuk display
                    let feeDisplay = 'Gratis';
                    if (ch.totalFee) {
                        const fee = parseFloat(ch.totalFee);
                        if (fee > 0) {
                            feeDisplay = `Rp ${fee.toLocaleString('id-ID')}`;
                        }
                    }

                    methods.push({
                        gateway: 'duitku',
                        method: code,
                        name: name,
                        icon: icon,
                        color: color,
                        type: type,
                        fee_customer: feeDisplay,
                        totalFee: ch.totalFee,
                        image_url: ch.paymentImage || ch.imageUrl || null
                    });
                });
            }

            // Jika tidak ada methods dari API, return default minimal
            if (!methods.length) {
                console.warn('[DUITKU] No payment methods returned from API, using fallback');
                return [
                    { gateway: 'duitku', method: 'VC', name: 'Kartu Kredit/Debit', icon: 'bi-credit-card', color: 'primary', type: 'card', fee_customer: 'Gratis' },
                    { gateway: 'duitku', method: 'BT', name: 'Virtual Account Bank', icon: 'bi-bank', color: 'dark', type: 'bank', fee_customer: 'Gratis' },
                    { gateway: 'duitku', method: 'QRIS', name: 'QRIS', icon: 'bi-qr-code', color: 'info', type: 'ewallet', fee_customer: 'Gratis' }
                ];
            }

            console.log(`[DUITKU] Found ${methods.length} payment methods from API`);
            return methods;
        } catch (error) {
            console.error('[DUITKU] Error getting payment methods:', error);
            // Fallback ke default methods jika API error
            return [
                { gateway: 'duitku', method: 'VC', name: 'Kartu Kredit/Debit', icon: 'bi-credit-card', color: 'primary', type: 'card', fee_customer: 'Gratis' },
                { gateway: 'duitku', method: 'BT', name: 'Virtual Account Bank', icon: 'bi-bank', color: 'dark', type: 'bank', fee_customer: 'Gratis' },
                { gateway: 'duitku', method: 'QRIS', name: 'QRIS', icon: 'bi-qr-code', color: 'info', type: 'ewallet', fee_customer: 'Gratis' }
            ];
        }
    }
}

module.exports = PaymentGatewayManager; 