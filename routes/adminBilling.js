const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const billingManager = require('../config/billing');
const logger = require('../config/logger');
const serviceSuspension = require('../config/serviceSuspension');
const { getSetting, getSettingsWithCache, setSetting, clearSettingsCache } = require('../config/settingsManager');
const { getPaymentGatewayConfig, setActivePaymentGateway, updatePaymentGatewayConfig: updatePaymentGatewayConfigStore } = require('../config/paymentGatewayConfig');
const { exec } = require('child_process');
const multer = require('multer');
const upload = multer();
const ExcelJS = require('exceljs');
const { adminAuth } = require('./adminAuth');

// Configure multer for image uploads
const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/img/'));
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'package-' + uniqueSuffix + '.jpg');
    }
});

const imageUpload = multer({ 
    storage: imageStorage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only JPG files
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
            cb(null, true);
        } else {
            cb(new Error('Only JPG files are allowed'));
        }
    }
});

// Configure multer for customer photo uploads
const customerPhotoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/img/'));
    },
    filename: function (req, file, cb) {
        const phone = req.body.phone || req.params.phone || 'unknown';
        const type = file.fieldname === 'ktp_photo' ? 'ktp' : 'house';
        const ext = path.extname(file.originalname) || '.jpg';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `customer-${phone}-${type}-${uniqueSuffix}${ext}`);
    }
});

const customerPhotoUpload = multer({ 
    storage: customerPhotoStorage,
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan (JPG, PNG, GIF)'));
        }
    }
});

// Ensure JSON body parsing for this router
router.use(express.json());
// Enable form submissions (application/x-www-form-urlencoded)
router.use(express.urlencoded({ extended: true }));

// Helper: validate optional base URL (allow empty, otherwise must start with http/https)
const isValidOptionalHttpUrl = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return true;
    return /^https?:\/\//i.test(s);
};

// Middleware untuk mendapatkan pengaturan aplikasi
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        footerInfo: getSetting('footer_info', ''),
        logoFilename: getSetting('logo_filename', 'logo.png'),
        company_slogan: getSetting('company_slogan', ''),
        company_website: getSetting('company_website', ''),
        invoice_notes: getSetting('invoice_notes', ''),
        payment_bank_name: getSetting('payment_bank_name', ''),
        payment_account_number: getSetting('payment_account_number', ''),
        payment_account_holder: getSetting('payment_account_holder', ''),
        payment_cash_address: getSetting('payment_cash_address', ''),
        payment_cash_hours: getSetting('payment_cash_hours', ''),
        contact_phone: getSetting('contact_phone', ''),
        contact_email: getSetting('contact_email', ''),
        contact_address: getSetting('contact_address', ''),
        contact_whatsapp: getSetting('contact_whatsapp', ''),
        suspension_grace_period_days: getSetting('suspension_grace_period_days', '3'),
        isolir_profile: getSetting('isolir_profile', 'isolir')
    };
    next();
};

// Mobile Admin Billing Dashboard
router.get('/mobile', getAppSettings, async (req, res) => {
    try {
        // Get basic stats for mobile dashboard
        const totalCustomers = await billingManager.getTotalCustomers();
        const totalInvoices = await billingManager.getTotalInvoices();
        const totalRevenue = await billingManager.getTotalRevenue();
        const pendingPayments = await billingManager.getPendingPayments();
        
        // Redirect to responsive desktop dashboard
        res.redirect('/admin/billing/dashboard');
    } catch (error) {
        logger.error('Error loading mobile billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile billing dashboard',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Customers Management
// Mobile Customers - Redirect to responsive desktop version
router.get('/mobile/customers', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/customers');
    } catch (error) {
        logger.error('Error loading mobile customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile customers',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Invoices - Redirect to responsive desktop version
router.get('/mobile/invoices', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/invoices');
    } catch (error) {
        logger.error('Error loading mobile invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile invoices',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Mobile Payments - Redirect to responsive desktop version
router.get('/mobile/payments', getAppSettings, async (req, res) => {
    try {
        // Redirect to responsive desktop version
        res.redirect('/admin/billing/payments');
    } catch (error) {
        logger.error('Error loading mobile payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile payments',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Monthly Reset Management
router.post('/api/monthly-reset', adminAuth, async (req, res) => {
    try {
        console.log('🔄 Manual monthly reset requested...');
        
        const MonthlyResetSystem = require('../scripts/monthly-reset-simple');
        const resetSystem = new MonthlyResetSystem();
        
        const result = await resetSystem.runMonthlyReset();
        
        res.json({
            success: true,
            message: 'Monthly reset completed successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in manual monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Error in monthly reset: ' + error.message
        });
    }
});

// Get monthly reset status
router.get('/api/monthly-reset-status', adminAuth, async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get last reset date
        const lastReset = await new Promise((resolve, reject) => {
            db.get(`
                SELECT value FROM system_settings 
                WHERE key = 'monthly_reset_date'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.value : null);
            });
        });
        
        // Get current month stats
        const currentStats = await new Promise((resolve, reject) => {
            const MonthlyResetSystem = require('../scripts/monthly-reset-simple');
            const resetSystem = new MonthlyResetSystem();
            resetSystem.getCurrentStatistics()
                .then(stats => resolve(stats))
                .catch(err => reject(err));
        });
        
        db.close();
        
        res.json({
            success: true,
            data: {
                lastReset: lastReset,
                currentStats: currentStats,
                nextReset: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error getting monthly reset status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting reset status: ' + error.message
        });
    }
});

// Mobile Collector Management
router.get('/mobile/collector', getAppSettings, async (req, res) => {
    try {
        // Get collectors list for mobile
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get collectors with statistics - dengan validasi data
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       COALESCE(SUM(cp.payment_amount), 0) as total_collected,
                       COALESCE(SUM(cp.commission_amount), 0) as total_commission
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                GROUP BY c.id
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    // Validasi dan format data collectors
                    const validCollectors = (rows || []).map(row => ({
                        ...row,
                        commission_rate: Math.max(0, Math.min(100, parseFloat(row.commission_rate || 5))),
                        total_payments: parseInt(row.total_payments || 0),
                        total_collected: Math.round(parseFloat(row.total_collected || 0)),
                        total_commission: Math.round(parseFloat(row.total_commission || 0)),
                        name: row.name || 'Unknown Collector',
                        status: row.status || 'active'
                    }));
                    resolve(validCollectors);
                }
            });
        });
        
        // Calculate statistics
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        
        const todayPayments = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COALESCE(SUM(payment_amount), 0) as total
                FROM collector_payments 
                WHERE collected_at >= ? AND collected_at < ? AND status = 'completed'
            `, [startOfDay.toISOString(), endOfDay.toISOString()], (err, row) => {
                if (err) reject(err);
                else resolve(Math.round(parseFloat(row ? row.total : 0))); // Rounding untuk konsistensi
            });
        });
        
        const totalCollectors = collectors.length;
        
        db.close();
        
        res.render('admin/billing/mobile-collector', {
            title: 'Tukang Tagih - Mobile',
            appSettings: req.appSettings,
            collectors: collectors,
            statistics: {
                totalCollectors: totalCollectors,
                todayPayments: todayPayments
            }
        });
    } catch (error) {
        logger.error('Error loading mobile collectors:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile collectors',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// API: Get customer invoices for collector payment
router.get('/api/customer-invoices/:customerId', adminAuth, async (req, res) => {
    try {
        const { customerId } = req.params;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const invoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT i.*, p.name as package_name
                FROM invoices i
                LEFT JOIN packages p ON i.package_id = p.id
                WHERE i.customer_id = ? AND i.status = 'unpaid'
                ORDER BY i.created_at DESC
            `, [customerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: invoices
        });
        
    } catch (error) {
        console.error('Error getting customer invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting customer invoices: ' + error.message
        });
    }
});

// API: Submit collector payment
router.post('/api/collector-payment', adminAuth, async (req, res) => {
    try {
        const { collector_id, customer_id, payment_amount, payment_method, notes, invoice_ids } = req.body;
        
        if (!collector_id || !customer_id || !payment_amount) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Validasi jumlah pembayaran
        const paymentAmountNum = Number(payment_amount);
        if (paymentAmountNum <= 0 || paymentAmountNum > 999999999) {
            return res.status(400).json({
                success: false,
                message: 'Jumlah pembayaran tidak valid (harus > 0 dan < 999,999,999)'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Mulai transaction untuk operasi kompleks
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        try {
            // Get collector commission rate
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT commission_rate FROM collectors WHERE id = ?', [collector_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            return res.status(400).json({
                success: false,
                message: 'Collector not found'
            });
        }
        
        const commissionRate = collector.commission_rate || 5;
        
        // Validasi commission rate
        if (commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({
                success: false,
                message: 'Rate komisi tidak valid (harus antara 0-100%)'
            });
        }
        
        const commissionAmount = Math.round((paymentAmountNum * commissionRate) / 100); // Rounding untuk komisi
        
        // Insert collector payment (ensure legacy 'amount' column is populated)
        const paymentId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO collector_payments (
                    collector_id, customer_id, amount, payment_amount, commission_amount,
                    payment_method, notes, status, collected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)
            `, [collector_id, customer_id, paymentAmountNum, paymentAmountNum, commissionAmount, payment_method, notes], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        // Update invoices if specified, else auto-allocate to oldest unpaid invoices
        if (invoice_ids && invoice_ids.length > 0) {
            for (const invoiceId of invoice_ids) {
                // Tandai invoice lunas
                await billingManager.updateInvoiceStatus(Number(invoiceId), 'paid', payment_method);
                // Catat entri payment sesuai nilai invoice dengan collector info
                const inv = await billingManager.getInvoiceById(Number(invoiceId));
                const invAmount = parseFloat(inv?.amount || 0) || 0;
                await billingManager.recordCollectorPayment({
                    invoice_id: Number(invoiceId),
                    amount: invAmount,
                    payment_method,
                    reference_number: '',
                    notes: notes || `Collector ${collector_id}`,
                    collector_id: collector_id,
                    commission_amount: Math.round((invAmount * commissionRate) / 100)
                });
            }
        } else {
            // Auto allocate payment to unpaid invoices (oldest first)
            let remaining = Number(payment_amount) || 0;
            if (remaining > 0) {
                const unpaidInvoices = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT id, amount FROM invoices 
                        WHERE customer_id = ? AND status = 'unpaid'
                        ORDER BY due_date ASC, id ASC
                    `, [customer_id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });
                for (const inv of unpaidInvoices) {
                    const invAmount = Number(inv.amount) || 0;
                    if (remaining >= invAmount && invAmount > 0) {
                        await billingManager.updateInvoiceStatus(inv.id, 'paid', payment_method);
                        await billingManager.recordCollectorPayment({
                            invoice_id: inv.id,
                            amount: invAmount,
                            payment_method,
                            reference_number: '',
                            notes: notes || `Collector ${collector_id}`,
                            collector_id: collector_id,
                            commission_amount: Math.round((invAmount * commissionRate) / 100)
                        });
                        remaining -= invAmount;
                        if (remaining <= 0) break;
                    } else {
                        break; // skip partial for now
                    }
                }
            }
        }
        
            // Commit transaction jika semua operasi berhasil
            await new Promise((resolve, reject) => {
                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
        } catch (error) {
            // Rollback transaction jika ada error
            await new Promise((resolve) => {
                db.run('ROLLBACK', () => resolve());
            });
            throw error;
        } finally {
            db.close();
        }
        
        res.json({
            success: true,
            message: 'Payment recorded successfully',
            payment_id: paymentId,
            commission_amount: commissionAmount
        });
        
    } catch (error) {
        console.error('Error recording collector payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment: ' + error.message
        });
    }
});

// Mobile Collector Payment Input
router.get('/mobile/collector/payment', getAppSettings, async (req, res) => {
    try {
        // Get collectors and customers for payment form
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const [collectors, customers] = await Promise.all([
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM collectors WHERE status = "active" ORDER BY name', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM customers WHERE status = "active" ORDER BY name', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            })
        ]);
        
        db.close();
        
        res.render('admin/billing/mobile-collector-payment', {
            title: 'Input Pembayaran - Mobile',
            appSettings: req.appSettings,
            collectors: collectors,
            customers: customers
        });
    } catch (error) {
        logger.error('Error loading collector payment form:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment form',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Reports
router.get('/collector-reports', getAppSettings, async (req, res) => {
    try {
        const { dateFrom, dateTo, collector } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if collectors table exists
        const tableExists = await new Promise((resolve, reject) => {
            db.get(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='collectors'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });
        
        if (!tableExists) {
            db.close();
            return res.render('admin/billing/collector-reports', {
                title: 'Laporan Kolektor',
                appSettings: req.appSettings,
                collectors: [],
                summary: {
                    total_collectors: 0,
                    total_payments: 0,
                    total_commissions: 0,
                    total_setoran: 0
                },
                filters: {
                    dateFrom: dateFrom || '',
                    dateTo: dateTo || '',
                    collector: collector || ''
                },
                error: 'Tabel kolektor belum tersedia. Silakan tambahkan kolektor terlebih dahulu.'
            });
        }
        
        // Set default date range (last 30 days)
        const defaultDateTo = new Date();
        const defaultDateFrom = new Date();
        defaultDateFrom.setDate(defaultDateFrom.getDate() - 30);
        
        const startDate = dateFrom || defaultDateFrom.toISOString().split('T')[0];
        const endDate = dateTo || defaultDateTo.toISOString().split('T')[0];
        
        // Build date filter
        const dateFilter = `AND cp.collected_at >= '${startDate}' AND cp.collected_at <= '${endDate} 23:59:59'`;
        
        // Build collector filter
        const collectorFilter = collector ? `AND c.id = ${collector}` : '';
        
        // Get collectors with statistics
        const collectors = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                       COUNT(cp.id) as total_payments,
                       COALESCE(SUM(cp.payment_amount), 0) as total_payment_amount,
                       COALESCE(SUM(cp.commission_amount), 0) as total_commission,
                       COALESCE(SUM(cp.payment_amount - cp.commission_amount), 0) as total_setoran
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                    ${dateFilter}
                WHERE c.status = 'active' ${collectorFilter}
                GROUP BY c.id
                ORDER BY c.name
            `, (err, rows) => {
                if (err) {
                    console.error('Error in collectors query:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
        
        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_collectors,
                    COALESCE(SUM(cp.payment_amount), 0) as total_payments,
                    COALESCE(SUM(cp.commission_amount), 0) as total_commissions,
                    COALESCE(SUM(cp.payment_amount - cp.commission_amount), 0) as total_setoran
                FROM collectors c
                LEFT JOIN collector_payments cp ON c.id = cp.collector_id 
                    AND cp.status = 'completed'
                    ${dateFilter}
                WHERE c.status = 'active' ${collectorFilter}
            `, (err, row) => {
                if (err) {
                    console.error('Error in summary query:', err);
                    reject(err);
                } else {
                    resolve(row || {
                        total_collectors: 0,
                        total_payments: 0,
                        total_commissions: 0,
                        total_setoran: 0
                    });
                }
            });
        });
        
        db.close();
        
        res.render('admin/billing/collector-reports', {
            title: 'Laporan Kolektor',
            appSettings: req.appSettings,
            collectors: collectors,
            summary: summary,
            filters: {
                dateFrom: startDate,
                dateTo: endDate,
                collector: collector || ''
            }
        });
        
    } catch (error) {
        logger.error('Error loading collector reports:', error);
        res.status(500).render('error', { 
            message: 'Error loading collector reports',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Details
router.get('/collector-details/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const { dateFrom, dateTo } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Set default date range (last 30 days)
        const defaultDateTo = new Date();
        const defaultDateFrom = new Date();
        defaultDateFrom.setDate(defaultDateFrom.getDate() - 30);
        
        const startDate = dateFrom || defaultDateFrom.toISOString().split('T')[0];
        const endDate = dateTo || defaultDateTo.toISOString().split('T')[0];
        
        // Get collector details
        const collector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM collectors WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!collector) {
            db.close();
            return res.status(404).render('error', { 
                message: 'Kolektor tidak ditemukan',
                error: {}
            });
        }
        
        // Get collector payments with date filter
        const payments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cp.*, c.name as customer_name, c.phone as customer_phone
                FROM collector_payments cp
                LEFT JOIN customers c ON cp.customer_id = c.id
                WHERE cp.collector_id = ? 
                AND cp.collected_at >= ? 
                AND cp.collected_at <= ?
                ORDER BY cp.collected_at DESC
            `, [id, startDate, endDate + ' 23:59:59'], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Get collector statistics
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_payments,
                    COALESCE(SUM(payment_amount), 0) as total_payment_amount,
                    COALESCE(SUM(commission_amount), 0) as total_commission,
                    COALESCE(SUM(payment_amount - commission_amount), 0) as total_setoran
                FROM collector_payments 
                WHERE collector_id = ? 
                AND collected_at >= ? 
                AND collected_at <= ?
                AND status = 'completed'
            `, [id, startDate, endDate + ' 23:59:59'], (err, row) => {
                if (err) reject(err);
                else resolve(row || {
                    total_payments: 0,
                    total_payment_amount: 0,
                    total_commission: 0,
                    total_setoran: 0
                });
            });
        });
        
        db.close();
        
        res.render('admin/billing/collector-details', {
            title: `Detail Kolektor - ${collector.name}`,
            appSettings: req.appSettings,
            collector: collector,
            payments: payments,
            stats: stats,
            filters: {
                dateFrom: startDate,
                dateTo: endDate
            }
        });
        
    } catch (error) {
        logger.error('Error loading collector details:', error);
        res.status(500).render('error', { 
            message: 'Error loading collector details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Collector Remittance
router.get('/collector-remittance', getAppSettings, async (req, res) => {
    try {
        // Get collectors with pending amounts from payments table
        const collectors = await billingManager.getCollectorsWithPendingAmounts();
        
        // Get recent remittances from expenses table (commission expenses)
        const remittances = await billingManager.getCommissionExpenses();
        
        res.render('admin/billing/collector-remittance', {
            title: 'Terima Setoran Kolektor',
            appSettings: req.appSettings,
            collectors: collectors,
            remittances: remittances
        });
        
    } catch (error) {
        logger.error('Error loading collector remittance:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat data setoran kolektor',
            error: error.message 
        });
    }
});

// API: Record Collector Remittance
router.post('/api/collector-remittance', adminAuth, async (req, res) => {
    try {
        const { collector_id, remittance_amount, payment_method, notes, remittance_date } = req.body;
        
        if (!collector_id || !remittance_amount || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Semua field wajib diisi'
            });
        }
        
        // Use billing manager to record remittance
        const result = await billingManager.recordCollectorRemittance({
            collector_id,
            amount: parseFloat(remittance_amount),
            payment_method,
            notes: notes || '',
            remittance_date: remittance_date || new Date().toISOString()
        });
        
        res.json({
            success: true,
            message: 'Setoran berhasil diterima',
            data: result
        });
        
    } catch (error) {
        console.error('Error recording collector remittance:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording remittance: ' + error.message
        });
    }
});

// Mobile Map Management - Now using responsive mapping-new.ejs
router.get('/mobile/map', getAppSettings, async (req, res) => {
    try {
        // Redirect to main mapping page (responsive)
        res.redirect('/admin/billing/mapping');
    } catch (error) {
        logger.error('Error loading mobile map:', error);
        res.status(500).render('error', { 
            message: 'Error loading mobile map',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// GET: Redirect untuk cable routes ke cable-network
router.get('/cables', adminAuth, (req, res) => {
    res.redirect('/admin/cable-network/cables');
});

// GET: Redirect untuk ODP ke cable-network
router.get('/odp', adminAuth, (req, res) => {
    res.redirect('/admin/cable-network/odp');
});

// Dashboard Billing
router.get('/dashboard', getAppSettings, async (req, res) => {
    try {
        // Jalankan cleanup data konsistensi terlebih dahulu
        await billingManager.cleanupDataConsistency();
        
        const stats = await billingManager.getBillingStats();
        const overdueInvoices = await billingManager.getOverdueInvoices();
        const recentInvoices = await billingManager.getInvoices();
        
        res.render('admin/billing/dashboard', {
            title: 'Dashboard Billing',
            stats,
            overdueInvoices: overdueInvoices.slice(0, 10),
            recentInvoices: recentInvoices.slice(0, 10),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading billing dashboard:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat dashboard billing',
            error: error.message 
        });
    }
});

// Laporan Keuangan
router.get('/financial-report', getAppSettings, async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        
        // Default date range: current month (auto reset setiap tanggal 1)
        const now = new Date();
        // Jika tanggal 1, gunakan bulan berjalan. Jika tidak, tetap gunakan bulan berjalan
        const startDate = start_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = end_date || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const financialData = await billingManager.getFinancialReport(startDate, endDate, type);
        
        res.render('admin/billing/financial-report', {
            title: 'Laporan Keuangan',
            financialData,
            startDate,
            endDate,
            type: type || 'all',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading financial report:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat laporan keuangan',
            error: error.message 
        });
    }
});

// API untuk data laporan keuangan
router.get('/api/financial-report', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const financialData = await billingManager.getFinancialReport(start_date, end_date, type);
        res.json({ success: true, data: financialData });
    } catch (error) {
        logger.error('Error getting financial report data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Laporan Keuangan Voucher
router.get('/reports/voucher', getAppSettings, adminAuth, async (req, res) => {
    try {
        const { start_date, end_date, status } = req.query;
        
        // Default date range: current month
        const now = new Date();
        // Pastikan menggunakan timezone lokal untuk mendapatkan tanggal yang benar
        const year = now.getFullYear();
        const month = now.getMonth();
        const startDate = start_date || new Date(year, month, 1).toISOString().split('T')[0];
        // Tanggal terakhir bulan ini
        const endDate = end_date || new Date(year, month + 1, 0).toISOString().split('T')[0];
        
        logger.info(`Voucher report query: startDate=${startDate}, endDate=${endDate}, status=${status || 'all'}`);
        
        // Catatan: Auto-update dihapus untuk performa
        // Script update_voucher_invoices_on_use.js sebaiknya dijalankan via cron job
        // atau manual via tombol "Update Status" di UI
        
        const allInvoices = await billingManager.getVoucherInvoices(startDate, endDate);
        const filteredInvoices = billingManager.filterVoucherInvoicesByStatus(allInvoices, status || 'all');
        const stats = billingManager.calculateVoucherStats(filteredInvoices);
        
        logger.info(`Found ${filteredInvoices.length} voucher invoices for date range ${startDate} to ${endDate} (status=${status || 'all'})`);
        
        res.render('admin/billing/report-voucher', {
            title: 'Laporan Keuangan Voucher',
            stats,
            invoices: filteredInvoices,
            startDate,
            endDate,
            status: status || 'all',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading voucher report:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat laporan keuangan voucher',
            error: error.message 
        });
    }
});

// Laporan Keuangan PPPoE
router.get('/reports/pppoe', getAppSettings, adminAuth, async (req, res) => {
    try {
        const { start_date, end_date, status } = req.query;
        
        // Default date range: current month
        const now = new Date();
        const startDate = start_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = end_date || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const stats = await billingManager.getPPPoEReportStats(startDate, endDate);
        const invoices = await billingManager.getPPPoEInvoices(startDate, endDate, status || null);
        
        res.render('admin/billing/report-pppoe', {
            title: 'Laporan Keuangan PPPoE',
            stats,
            invoices,
            startDate,
            endDate,
            status: status || 'all',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading PPPoE report:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat laporan keuangan PPPoE',
            error: error.message 
        });
    }
});

// API untuk create missing voucher invoices retroaktif
router.post('/api/create-missing-voucher-invoices', adminAuth, async (req, res) => {
    try {
        const { getAllVouchersFromRadius, getVoucherInvoices, createInvoiceForVoucher } = require('../scripts/create_missing_voucher_invoices');
        
        // Get all vouchers from RADIUS
        const vouchers = await getAllVouchersFromRadius();
        
        // Get existing invoice usernames
        const existingInvoices = await getVoucherInvoices();
        
        // Filter vouchers yang belum punya invoice
        const vouchersWithoutInvoice = vouchers.filter(v => {
            return !existingInvoices.includes(v.username);
        });
        
        if (vouchersWithoutInvoice.length === 0) {
            return res.json({ 
                success: true, 
                message: 'Semua voucher sudah punya invoice',
                created: 0
            });
        }
        
        // Create invoices untuk voucher yang belum punya
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        
        for (const voucher of vouchersWithoutInvoice) {
            try {
                await createInvoiceForVoucher(voucher.username, voucher.profile);
                successCount++;
            } catch (error) {
                errorCount++;
                errors.push({ username: voucher.username, error: error.message });
                logger.error(`Error creating invoice for ${voucher.username}:`, error);
            }
        }
        
        // Refresh stats
        const stats = await billingManager.getBillingStats();
        
        res.json({ 
            success: true, 
            message: `Berhasil membuat ${successCount} invoice untuk voucher yang belum punya invoice`,
            created: successCount,
            errors: errorCount,
            errorDetails: errors.length > 0 ? errors : null,
            stats
        });
    } catch (error) {
        logger.error('Error creating missing voucher invoices:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal membuat invoice untuk voucher: ' + error.message 
        });
    }
});

// API untuk update invoice voucher menjadi paid saat voucher digunakan
router.post('/api/update-voucher-invoices', adminAuth, async (req, res) => {
    try {
        const { updateVoucherInvoiceToPaid } = require('../scripts/update_voucher_invoices_on_use');
        const { getUsedVouchers } = require('../scripts/update_voucher_invoices_on_use');
        
        // Get vouchers that have been used
        const usedVouchers = await getUsedVouchers();
        
        if (usedVouchers.length === 0) {
            return res.json({ 
                success: true, 
                message: 'Tidak ada voucher yang digunakan saat ini',
                updated: 0
            });
        }
        
        // Update invoices
        let updatedCount = 0;
        for (const username of usedVouchers) {
            try {
                const result = await updateVoucherInvoiceToPaid(username);
                if (result) {
                    updatedCount++;
                }
            } catch (error) {
                logger.error(`Error updating invoice for ${username}:`, error);
            }
        }
        
        // Refresh stats
        const stats = await billingManager.getBillingStats();
        
        res.json({ 
            success: true, 
            message: `Berhasil update ${updatedCount} invoice voucher`,
            updated: updatedCount,
            stats
        });
    } catch (error) {
        logger.error('Error updating voucher invoices:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk cleanup data konsistensi
router.post('/api/cleanup-data', adminAuth, async (req, res) => {
    try {
        await billingManager.cleanupDataConsistency();
        const stats = await billingManager.getBillingStats();
        
        res.json({ 
            success: true, 
            message: 'Data konsistensi berhasil diperbaiki',
            stats 
        });
    } catch (error) {
        logger.error('Error cleaning up data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk mendapatkan statistik real-time
router.get('/api/stats', adminAuth, async (req, res) => {
    try {
        const stats = await billingManager.getBillingStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting billing stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Revenue summary API (payments-based)
router.get('/api/revenue/summary', adminAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        function getDateStr(d) { return new Date(d).toISOString().split('T')[0]; }
        const todayStr = getDateStr(new Date());
        const weekAgoStr = getDateStr(new Date(Date.now() - 6 * 24 * 3600 * 1000));

        const dateFrom = from || weekAgoStr;
        const dateTo = to || todayStr;

        const [todayRevenue, weekRevenue, monthRevenue] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) = date(?)
                `, [todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) BETWEEN date(?) AND date(?)
                `, [weekAgoStr, todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
                `, [], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
        ]);

        db.close();
        res.json({ success: true, data: { todayRevenue, weekRevenue, monthRevenue, dateFrom, dateTo } });
    } catch (error) {
        logger.error('Error getting revenue summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Halaman Semua Invoice (Invoice List)
router.get('/invoice-list', getAppSettings, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, customer_username, type } = req.query;
        const offset = (page - 1) * limit;
        
        // Prepare filters object
        const filters = {};
        if (status) filters.status = status;
        if (customer_username) filters.customer_username = customer_username;
        if (type) filters.type = type;
        
        // Get invoices with filters
        const invoices = await billingManager.getInvoicesWithFilters(filters, limit, offset);
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        // Get total count for pagination with filters
        const totalCount = await billingManager.getInvoicesCountWithFilters(filters);
        
        res.render('admin/billing/invoice-list', {
            title: 'Semua Invoice',
            invoices,
            customers,
            packages,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                limit: parseInt(limit)
            },
            filters: {
                status: status || '',
                customer_username: customer_username || '',
                type: type || ''
            },
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice list:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice list',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Halaman Invoice by Type
router.get('/invoices-by-type', adminAuth, async (req, res) => {
    try {
        // Get invoices by type
        const monthlyInvoices = await billingManager.getInvoicesByType('monthly');
        const voucherInvoices = await billingManager.getInvoicesByType('voucher');
        const manualInvoices = await billingManager.getInvoicesByType('manual');
        
        // Get stats by type
        const monthlyStats = await billingManager.getInvoiceStatsByType('monthly');
        const voucherStats = await billingManager.getInvoiceStatsByType('voucher');
        const manualStats = await billingManager.getInvoiceStatsByType('manual');
        
        res.render('admin/billing/invoices-by-type', {
            title: 'Invoice by Type',
            monthlyInvoices: monthlyInvoices.slice(0, 50), // Limit to 50 per type
            voucherInvoices: voucherInvoices.slice(0, 50),
            manualInvoices: manualInvoices.slice(0, 50),
            monthlyStats,
            voucherStats,
            manualStats
        });
    } catch (error) {
        logger.error('Error loading invoices by type:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat halaman invoice by type',
            error: error.message 
        });
    }
});

// API untuk cleanup voucher manual
router.post('/api/voucher-cleanup', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.cleanupExpiredVoucherInvoices();
        
        res.json({
            success: result.success,
            message: result.message,
            cleaned: result.cleaned,
            expiredInvoices: result.expiredInvoices || []
        });
    } catch (error) {
        logger.error('Error in manual voucher cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan cleanup voucher',
            error: error.message
        });
    }
});

// API untuk melihat expired voucher invoices
router.get('/api/expired-vouchers', adminAuth, async (req, res) => {
    try {
        const expiredInvoices = await billingManager.getExpiredVoucherInvoices();
        
        res.json({
            success: true,
            data: expiredInvoices,
            count: expiredInvoices.length
        });
    } catch (error) {
        logger.error('Error getting expired voucher invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data expired voucher',
            error: error.message
        });
    }
});

// Halaman Monthly Summary
router.get('/monthly-summary', adminAuth, async (req, res) => {
    try {
        const summaries = await billingManager.getAllMonthlySummaries(24); // Last 24 months
        
        res.render('admin/billing/monthly-summary', {
            title: 'Summary Bulanan',
            summaries,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading monthly summary:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat summary bulanan',
            error: error.message 
        });
    }
});

// API untuk generate summary bulanan manual
router.post('/api/generate-monthly-summary', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.generateMonthlySummary();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            stats: result.stats
        });
    } catch (error) {
        logger.error('Error generating monthly summary:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate summary bulanan',
            error: error.message
        });
    }
});

// API untuk manual monthly reset
router.post('/api/monthly-reset', adminAuth, async (req, res) => {
    try {
        const result = await billingManager.performMonthlyReset();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            previousYear: result.previousYear,
            previousMonth: result.previousMonth,
            collectorsProcessed: result.collectorsProcessed
        });
    } catch (error) {
        logger.error('Error performing monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan monthly reset',
            error: error.message
        });
    }
});

// API untuk manual trigger monthly reset via scheduler
router.post('/api/trigger-monthly-reset', adminAuth, async (req, res) => {
    try {
        const scheduler = require('../config/scheduler');
        const result = await scheduler.triggerMonthlyReset();
        
        res.json({
            success: result.success,
            message: result.message,
            year: result.year,
            month: result.month,
            previousYear: result.previousYear,
            previousMonth: result.previousMonth,
            collectorsProcessed: result.collectorsProcessed
        });
    } catch (error) {
        logger.error('Error triggering monthly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal trigger monthly reset',
            error: error.message
        });
    }
});

// API untuk mendapatkan summary bulanan
router.get('/api/monthly-summary', adminAuth, async (req, res) => {
    try {
        const { year, month } = req.query;
        
        if (year && month) {
            const summary = await billingManager.getMonthlySummary(parseInt(year), parseInt(month));
            res.json({
                success: true,
                data: summary
            });
        } else {
            const summaries = await billingManager.getAllMonthlySummaries(12);
            res.json({
                success: true,
                data: summaries
            });
        }
    } catch (error) {
        logger.error('Error getting monthly summary:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil summary bulanan',
            error: error.message
        });
    }
});

// Export laporan keuangan bulanan ke Excel
router.get('/export/monthly-summary.xlsx', adminAuth, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const summaries = await billingManager.getAllMonthlySummaries(24);
        
        // Buat workbook Excel
        const workbook = new ExcelJS.Workbook();
        
        // Sheet 1: Summary Data
        const summarySheet = workbook.addWorksheet('Summary Bulanan');
        summarySheet.columns = [
            { header: 'Tahun', key: 'year', width: 8 },
            { header: 'Bulan', key: 'month', width: 10 },
            { header: 'Total Pelanggan', key: 'total_customers', width: 15 },
            { header: 'Pelanggan Aktif', key: 'active_customers', width: 15 },
            { header: 'Invoice Bulanan', key: 'monthly_invoices', width: 15 },
            { header: 'Invoice Voucher', key: 'voucher_invoices', width: 15 },
            { header: 'Lunas Bulanan', key: 'paid_monthly_invoices', width: 15 },
            { header: 'Lunas Voucher', key: 'paid_voucher_invoices', width: 15 },
            { header: 'Belum Lunas Bulanan', key: 'unpaid_monthly_invoices', width: 18 },
            { header: 'Belum Lunas Voucher', key: 'unpaid_voucher_invoices', width: 18 },
            { header: 'Pendapatan Bulanan', key: 'monthly_revenue', width: 18 },
            { header: 'Pendapatan Voucher', key: 'voucher_revenue', width: 18 },
            { header: 'Total Pendapatan', key: 'total_revenue', width: 18 },
            { header: 'Belum Dibayar', key: 'total_unpaid', width: 15 },
            { header: 'Tanggal Generate', key: 'created_at', width: 20 }
        ];
        
        // Tambahkan data summary
        summaries.forEach(summary => {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            summarySheet.addRow({
                year: summary.year,
                month: monthNames[summary.month - 1],
                total_customers: summary.total_customers,
                active_customers: summary.active_customers,
                monthly_invoices: summary.monthly_invoices,
                voucher_invoices: summary.voucher_invoices,
                paid_monthly_invoices: summary.paid_monthly_invoices,
                paid_voucher_invoices: summary.paid_voucher_invoices,
                unpaid_monthly_invoices: summary.unpaid_monthly_invoices,
                unpaid_voucher_invoices: summary.unpaid_voucher_invoices,
                monthly_revenue: summary.monthly_revenue,
                voucher_revenue: summary.voucher_revenue,
                total_revenue: summary.total_revenue,
                total_unpaid: summary.total_unpaid,
                created_at: new Date(summary.created_at).toLocaleDateString('id-ID')
            });
        });
        
        // Format currency untuk kolom revenue
        summarySheet.getColumn('monthly_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('voucher_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('total_revenue').numFmt = '"Rp" #,##0.00';
        summarySheet.getColumn('total_unpaid').numFmt = '"Rp" #,##0.00';
        
        // Sheet 2: Analisis Trend
        const trendSheet = workbook.addWorksheet('Analisis Trend');
        trendSheet.columns = [
            { header: 'Metrik', key: 'metric', width: 25 },
            { header: 'Nilai Terbaru', key: 'latest', width: 20 },
            { header: 'Nilai Sebelumnya', key: 'previous', width: 20 },
            { header: 'Growth (%)', key: 'growth', width: 15 },
            { header: 'Status', key: 'status', width: 15 }
        ];
        
        if (summaries.length >= 2) {
            const latest = summaries[0];
            const previous = summaries[1];
            
            const metrics = [
                { name: 'Total Revenue', latest: latest.total_revenue, previous: previous.total_revenue },
                { name: 'Monthly Revenue', latest: latest.monthly_revenue, previous: previous.monthly_revenue },
                { name: 'Voucher Revenue', latest: latest.voucher_revenue, previous: previous.voucher_revenue },
                { name: 'Total Customers', latest: latest.total_customers, previous: previous.total_customers },
                { name: 'Active Customers', latest: latest.active_customers, previous: previous.active_customers },
                { name: 'Monthly Invoices', latest: latest.monthly_invoices, previous: previous.monthly_invoices },
                { name: 'Voucher Invoices', latest: latest.voucher_invoices, previous: previous.voucher_invoices }
            ];
            
            metrics.forEach(metric => {
                const growth = ((metric.latest - metric.previous) / metric.previous * 100).toFixed(1);
                let status = 'Stable';
                if (growth > 5) status = 'Growth';
                else if (growth < -5) status = 'Decline';
                
                trendSheet.addRow({
                    metric: metric.name,
                    latest: metric.latest,
                    previous: metric.previous,
                    growth: growth + '%',
                    status: status
                });
            });
        }
        
        // Sheet 3: KPI Summary
        const kpiSheet = workbook.addWorksheet('KPI Summary');
        kpiSheet.columns = [
            { header: 'KPI', key: 'kpi', width: 30 },
            { header: 'Nilai', key: 'value', width: 20 },
            { header: 'Keterangan', key: 'description', width: 40 }
        ];
        
        if (summaries.length > 0) {
            const latest = summaries[0];
            const avgRevenue = summaries.reduce((sum, s) => sum + s.total_revenue, 0) / summaries.length;
            const bestMonth = summaries.reduce((max, s) => s.total_revenue > max.total_revenue ? s : max);
            
            const kpis = [
                { kpi: 'Total Revenue Terbaru', value: `Rp ${latest.total_revenue.toLocaleString('id-ID')}`, description: 'Pendapatan total bulan terbaru' },
                { kpi: 'Rata-rata Revenue', value: `Rp ${avgRevenue.toLocaleString('id-ID')}`, description: 'Rata-rata pendapatan per bulan' },
                { kpi: 'Bulan Terbaik', value: `${bestMonth.month}/${bestMonth.year}`, description: `Rp ${bestMonth.total_revenue.toLocaleString('id-ID')}` },
                { kpi: 'Total Pelanggan', value: latest.total_customers, description: 'Jumlah pelanggan terdaftar' },
                { kpi: 'Pelanggan Aktif', value: latest.active_customers, description: 'Pelanggan dengan status aktif' },
                { kpi: 'Collection Rate', value: `${((latest.paid_monthly_invoices + latest.paid_voucher_invoices) / (latest.monthly_invoices + latest.voucher_invoices) * 100).toFixed(1)}%`, description: 'Persentase invoice yang dibayar' }
            ];
            
            kpis.forEach(kpi => {
                kpiSheet.addRow(kpi);
            });
        }
        
        // Set response header
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-keuangan-bulanan-${new Date().toISOString().split('T')[0]}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting monthly summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Export laporan keuangan ke Excel
router.get('/export/financial-report.xlsx', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const financialData = await billingManager.getFinancialReport(start_date, end_date, type);
        
        // Buat workbook Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Keuangan');
        
        // Set header
        worksheet.columns = [
            { header: 'Tanggal', key: 'date', width: 15 },
            { header: 'Tipe', key: 'type', width: 12 },
            { header: 'Jumlah', key: 'amount', width: 15 },
            { header: 'Metode Pembayaran', key: 'payment_method', width: 20 },
            { header: 'Gateway', key: 'gateway_name', width: 15 },
            { header: 'No. Invoice', key: 'invoice_number', width: 20 },
            { header: 'Pelanggan', key: 'customer_name', width: 25 },
            { header: 'Telepon', key: 'customer_phone', width: 15 }
        ];
        
        // Tambahkan data transaksi
        financialData.transactions.forEach(transaction => {
            worksheet.addRow({
                date: new Date(transaction.date).toLocaleDateString('id-ID'),
                type: transaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
                amount: transaction.amount || 0,
                payment_method: transaction.payment_method || '-',
                gateway_name: transaction.gateway_name || '-',
                invoice_number: transaction.invoice_number || '-',
                customer_name: transaction.customer_name || '-',
                customer_phone: transaction.customer_phone || '-'
            });
        });
        
        // Tambahkan summary di sheet terpisah
        const summarySheet = workbook.addWorksheet('Ringkasan');
        summarySheet.columns = [
            { header: 'Item', key: 'item', width: 25 },
            { header: 'Nilai', key: 'value', width: 20 }
        ];
        
        summarySheet.addRow({ item: 'Total Pemasukan', value: `Rp ${financialData.summary.totalIncome.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Total Pengeluaran', value: `Rp ${financialData.summary.totalExpense.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Laba Bersih', value: `Rp ${financialData.summary.netProfit.toLocaleString('id-ID')}` });
        summarySheet.addRow({ item: 'Jumlah Transaksi', value: financialData.summary.transactionCount });
        summarySheet.addRow({ item: 'Periode', value: `${financialData.dateRange.startDate} - ${financialData.dateRange.endDate}` });
        
        // Set response header
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-keuangan-${start_date}-${end_date}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting financial report:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
// Customers list for live table updates
router.get('/customers/list', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        return res.json({ success: true, customers });
    } catch (error) {
        logger.error('Error loading customers list:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers list', error: error.message });
    }
});

// Customers summary for live updates
router.get('/customers/summary', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const total = customers.length;
        const paid = customers.filter(c => c.payment_status === 'paid').length;
        const unpaid = customers.filter(c => c.payment_status === 'unpaid').length;
        const noInvoice = customers.filter(c => c.payment_status === 'no_invoice').length;
        const active = customers.filter(c => c.status === 'active').length;
        const isolir = customers.filter(c => c.payment_status === 'overdue' || c.status === 'suspended').length;

        return res.json({
            success: true,
            data: { total, paid, unpaid, noInvoice, active, isolir }
        });
    } catch (error) {
        logger.error('Error loading customers summary:', error);
        return res.status(500).json({ success: false, message: 'Error loading customers summary', error: error.message });
    }
});

// Bulk delete customers
router.post('/customers/bulk-delete', async (req, res) => {
    try {
        const { phones } = req.body || {};
        if (!Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar pelanggan (phones) kosong atau tidak valid' });
        }

        const results = [];
        let success = 0;
        let failed = 0;

        for (const phone of phones) {
            try {
                const deleted = await billingManager.deleteCustomer(String(phone));
                results.push({ phone, success: true });
                success++;
            } catch (e) {
                // Map known errors to friendly messages
                let msg = e.message || 'Gagal menghapus';
                if (msg.includes('invoice(s) still exist')) {
                    msg = 'Masih memiliki tagihan, hapus tagihan terlebih dahulu';
                } else if (msg.includes('Customer not found')) {
                    msg = 'Pelanggan tidak ditemukan';
                }
                results.push({ phone, success: false, message: msg });
                failed++;
            }
        }

        return res.json({ success: true, summary: { success, failed, total: phones.length }, results });
    } catch (error) {
        logger.error('Error bulk deleting customers:', error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan hapus massal pelanggan', error: error.message });
    }
});

// Export customers to XLSX
router.get('/export/customers.xlsx', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Customers');

        // Get PPPoE passwords and router_id for each customer
        const { getUserAuthModeAsync, getRadiusConnection, getMikrotikConnection } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        const db = require('../config/billing').db;
        
        // Enrich customers with pppoe_password and router_id
        const enrichedCustomers = await Promise.all(customers.map(async (customer) => {
            const enriched = { ...customer };
            
            // Get router_id from customer_router_map
            if (customer.id) {
                try {
                    const routerMap = await new Promise((resolve, reject) => {
                        db.get('SELECT router_id FROM customer_router_map WHERE customer_id = ?', [customer.id], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    if (routerMap && routerMap.router_id) {
                        enriched.router_id = routerMap.router_id;
                    }
                } catch (e) {
                    // No router mapping found, skip
                }
            }
            
            // Get PPPoE password if pppoe_username exists
            if (customer.pppoe_username) {
                try {
                    if (authMode === 'radius') {
                        const conn = await getRadiusConnection();
                        try {
                            const [rows] = await conn.execute(
                                "SELECT value as password FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1",
                                [customer.pppoe_username]
                            );
                            await conn.end();
                            if (rows && rows.length > 0) {
                                enriched.pppoe_password = rows[0].password;
                            }
                        } catch (radiusError) {
                            await conn.end();
                            logger.warn(`Failed to get password from RADIUS for ${customer.pppoe_username}: ${radiusError.message}`);
                        }
                    } else {
                        const conn = await getMikrotikConnection();
                        if (conn) {
                            try {
                                const secrets = await conn.write('/ppp/secret/print', ['?name=' + customer.pppoe_username]);
                                if (secrets && secrets.length > 0) {
                                    enriched.pppoe_password = secrets[0].password || null;
                                }
                            } catch (mikrotikError) {
                                logger.warn(`Failed to get password from Mikrotik for ${customer.pppoe_username}: ${mikrotikError.message}`);
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`Error getting PPPoE password for ${customer.pppoe_username}: ${e.message}`);
                }
            }
            
            return enriched;
        }));

        // Header lengkap dengan koordinat map dan data lainnya
        const headers = [
            'ID', 'Username', 'Nama', 'Phone', 'PPPoE Username', 'PPPoE Password', 'Email', 'Alamat',
            'Latitude', 'Longitude', 'Package ID', 'Package Name', 'PPPoE Profile', 
            'Router ID', 'Status', 'Auto Suspension', 'Billing Day', 'Join Date', 'Created At'
        ];
        
        // Set header dengan styling
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6E6FA' }
        };

        // Set column widths
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: 'Username', key: 'username', width: 15 },
            { header: 'Nama', key: 'name', width: 25 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'PPPoE Username', key: 'pppoe_username', width: 20 },
            { header: 'PPPoE Password', key: 'pppoe_password', width: 20 },
            { header: 'Email', key: 'email', width: 25 },
            { header: 'Alamat', key: 'address', width: 35 },
            { header: 'Latitude', key: 'latitude', width: 12 },
            { header: 'Longitude', key: 'longitude', width: 12 },
            { header: 'Package ID', key: 'package_id', width: 10 },
            { header: 'Package Name', key: 'package_name', width: 20 },
            { header: 'PPPoE Profile', key: 'pppoe_profile', width: 15 },
            { header: 'Router ID', key: 'router_id', width: 10 },
            { header: 'Status', key: 'status', width: 10 },
            { header: 'Auto Suspension', key: 'auto_suspension', width: 15 },
            { header: 'Billing Day', key: 'billing_day', width: 12 },
            { header: 'Join Date', key: 'join_date', width: 15 },
            { header: 'Created At', key: 'created_at', width: 15 }
        ];

        enrichedCustomers.forEach(c => {
            const row = worksheet.addRow([
                c.id || '',
                c.username || '',
                c.name || '',
                c.phone || '',
                c.pppoe_username || '',
                c.pppoe_password || '',
                c.email || '',
                c.address || '',
                c.latitude || '',
                c.longitude || '',
                c.package_id || '',
                c.package_name || '',
                c.pppoe_profile || 'default',
                c.router_id || '',
                c.status || 'active',
                typeof c.auto_suspension !== 'undefined' ? c.auto_suspension : 1,
                c.billing_day || 15,
                c.join_date ? new Date(c.join_date).toLocaleDateString('id-ID') : '',
                c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID') : ''
            ]);

            // Highlight rows dengan koordinat valid
            if (c.latitude && c.longitude) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF0F8FF' }
                };
            }
        });

        // Add summary sheet
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.addRow(['Export Summary']);
        summarySheet.addRow(['Total Customers', enrichedCustomers.length]);
        summarySheet.addRow(['Customers with Coordinates', enrichedCustomers.filter(c => c.latitude && c.longitude).length]);
        summarySheet.addRow(['Customers without Coordinates', enrichedCustomers.filter(c => !c.latitude || !c.longitude).length]);
        summarySheet.addRow(['Customers with PPPoE Password', enrichedCustomers.filter(c => c.pppoe_password).length]);
        summarySheet.addRow(['Export Date', new Date().toLocaleString('id-ID')]);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="customers_complete.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        logger.error('Error exporting customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error exporting customers (XLSX)', error: error.message });
    }
});

// Import customers from XLSX file
router.post('/import/customers/xlsx', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File XLSX tidak ditemukan' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ success: false, message: 'Worksheet tidak ditemukan dalam file' });
        }

        // Build header map from first row with support for both formats
        const headerRow = worksheet.getRow(1);
        const headerMap = {};
        headerRow.eachCell((cell, colNumber) => {
            const key = String(cell.value || '').toLowerCase().trim();
            if (key) headerMap[key] = colNumber;
        });

        // Support for Indonesian headers (from new export format)
        const indonesianHeaderMap = {
            'nama': 'name',
            'phone': 'phone',
            'pppoe username': 'pppoe_username',
            'pppoe password': 'pppoe_password',
            'email': 'email',
            'alamat': 'address',
            'package id': 'package_id',
            'pppoe profile': 'pppoe_profile',
            'status': 'status',
            'router id': 'router_id',
            'auto suspension': 'auto_suspension',
            'billing day': 'billing_day'
        };

        // Create unified header map
        const unifiedHeaderMap = {};
        Object.keys(headerMap).forEach(key => {
            const normalizedKey = indonesianHeaderMap[key] || key;
            unifiedHeaderMap[normalizedKey] = headerMap[key];
        });

        const getVal = (row, key) => {
            const col = unifiedHeaderMap[key];
            return col ? (row.getCell(col).value ?? '') : '';
        };

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            try {
                const name = String(getVal(row, 'name') || '').trim();
                const phone = String(getVal(row, 'phone') || '').trim();
                if (!name || !phone) {
                    failed++; errors.push({ row: rowNumber, error: 'Nama/Phone wajib' }); return;
                }

                const raw = {
                    name,
                    phone,
                    pppoe_username: String(getVal(row, 'pppoe_username') || '').trim(),
                    pppoe_password: String(getVal(row, 'pppoe_password') || '').trim(),
                    email: String(getVal(row, 'email') || '').trim(),
                    address: String(getVal(row, 'address') || '').trim(),
                    package_id: getVal(row, 'package_id') ? Number(getVal(row, 'package_id')) : null,
                    pppoe_profile: String(getVal(row, 'pppoe_profile') || 'default').trim(),
                    status: String(getVal(row, 'status') || 'active').trim(),
                    router_id: getVal(row, 'router_id') ? (isNaN(getVal(row, 'router_id')) ? getVal(row, 'router_id') : Number(getVal(row, 'router_id'))) : null,
                    auto_suspension: (() => {
                        const v = getVal(row, 'auto_suspension');
                        const n = parseInt(String(v), 10);
                        return Number.isFinite(n) ? n : 1;
                    })(),
                    billing_day: (() => {
                        // If the cell is empty or whitespace, default to 1
                        const rawVal = getVal(row, 'billing_day');
                        const rawStr = String(rawVal ?? '').trim();
                        if (rawStr === '') return 1;
                        const v = parseInt(rawStr, 10);
                        const n = Number.isFinite(v) ? Math.min(Math.max(v, 1), 28) : 1;
                        return n;
                    })()
                };

                // Process upsert
                // Wrap in async using IIFE pattern not available here; queue in array then Promise.all is complex.
                // For simplicity, push to pending array.
                row._pending = raw; // temp store
            } catch (e) {
                failed++;
                errors.push({ row: rowNumber, error: e.message });
            }
        });

        // Now sequentially process rows for DB ops
        for (let r = 2; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            const raw = row._pending;
            if (!raw) continue;
            try {
                // Validasi data wajib
                if (!raw.name || !raw.phone) {
                    failed++;
                    errors.push({ row: r, error: 'Nama dan nomor telepon wajib diisi' });
                    continue;
                }

                // Validasi nomor telepon format
                const phoneRegex = /^[0-9+\-\s()]+$/;
                if (!phoneRegex.test(raw.phone)) {
                    failed++;
                    errors.push({ row: r, error: 'Format nomor telepon tidak valid' });
                    continue;
                }

                const existing = await billingManager.getCustomerByPhone(raw.phone);
                const customerData = {
                    name: raw.name.trim(),
                    phone: raw.phone.trim(),
                    pppoe_username: raw.pppoe_username ? raw.pppoe_username.trim() : '',
                    email: raw.email ? raw.email.trim() : '',
                    address: raw.address ? raw.address.trim() : '',
                    package_id: raw.package_id || null,
                    pppoe_profile: raw.pppoe_profile || 'default',
                    status: raw.status || 'active',
                    auto_suspension: typeof raw.auto_suspension !== 'undefined' ? parseInt(raw.auto_suspension) : 1,
                    billing_day: raw.billing_day ? Math.min(Math.max(parseInt(raw.billing_day), 1), 28) : 15
                };

                let result;
                if (existing) {
                    result = await billingManager.updateCustomer(raw.phone, customerData);
                    updated++;
                    logger.info(`Updated customer: ${raw.name} (${raw.phone})`);
                } else {
                    result = await billingManager.createCustomer(customerData);
                    created++;
                    logger.info(`Created customer: ${raw.name} (${raw.phone}) with ID: ${result.id}`);
                }

                // Handle PPPoE user creation/update if pppoe_username and password provided
                if (raw.pppoe_username && raw.pppoe_password) {
                    try {
                        const pppoe_username = String(raw.pppoe_username).trim();
                        const pppoe_password = String(raw.pppoe_password).trim();
                        const pppoe_profile = raw.pppoe_profile || 'default';
                        const router_id = raw.router_id || null;

                        if (pppoe_username && pppoe_password) {
                            const { addPPPoEUser, getUserAuthModeAsync } = require('../config/mikrotik');
                            
                            // Helper function untuk get router by ID
                            const getRouterById = async (routerId) => {
                                try {
                                    const db = require('../config/billing').db;
                                    return new Promise((resolve, reject) => {
                                        db.get('SELECT * FROM routers WHERE id = ?', [parseInt(routerId)], (err, row) => {
                                            if (err) reject(err);
                                            else resolve(row || null);
                                        });
                                    });
                                } catch (err) {
                                    logger.warn(`Failed to get router by ID ${routerId}: ${err.message}`);
                                    return null;
                                }
                            };

                            // Get customer data after create/update to ensure we have the ID
                            const customer = await billingManager.getCustomerByPhone(raw.phone);
                            if (!customer || !customer.id) {
                                logger.error(`[IMPORT] Customer not found or missing ID for phone ${raw.phone}`);
                                throw new Error(`Customer not found or missing ID for phone ${raw.phone}`);
                            }

                            const authMode = await getUserAuthModeAsync();
                            logger.info(`[IMPORT] Creating/updating PPPoE user ${pppoe_username} with profile ${pppoe_profile} (Mode: ${authMode}) for customer ${customer.id}`);

                            // Handle router_id: jika "RADIUS", set routerObj ke null
                            let routerObj = null;
                            if (router_id && router_id !== '' && router_id !== 'RADIUS' && router_id !== 'radius') {
                                routerObj = await getRouterById(router_id);
                                if (routerObj) {
                                    logger.info(`[IMPORT] Using router: ${routerObj.name} (${routerObj.nas_ip})`);
                                }
                            }

                            logger.info(`[IMPORT] Calling addPPPoEUser with: username=${pppoe_username}, profile=${pppoe_profile}, customer.id=${customer.id}`);
                            const addRes = await addPPPoEUser({ 
                                username: pppoe_username, 
                                password: pppoe_password, 
                                profile: pppoe_profile, 
                                customer: { id: customer.id },
                                routerObj: routerObj
                            });

                            if (addRes && addRes.success) {
                                logger.info(`✅ [IMPORT] PPPoE user ${pppoe_username} created/updated successfully in ${authMode} mode`);
                            } else {
                                const errorMsg = addRes?.message || addRes?.error || 'Unknown error';
                                logger.error(`❌ [IMPORT] Failed to create/update PPPoE user ${pppoe_username}: ${errorMsg}`);
                                logger.error(`[IMPORT] Full response:`, JSON.stringify(addRes));
                            }
                        } else {
                            logger.warn(`[IMPORT] Skipping PPPoE user creation: username or password is empty for phone ${raw.phone}`);
                        }
                    } catch (pppoeError) {
                        logger.error(`[IMPORT] Error creating/updating PPPoE user for ${raw.phone}:`, pppoeError);
                        logger.error(`[IMPORT] Error stack:`, pppoeError.stack);
                        // Don't fail the import if PPPoE creation fails, but log the error
                        errors.push({ row: r, error: `PPPoE creation failed: ${pppoeError.message}` });
                    }
                } else {
                    logger.debug(`[IMPORT] Skipping PPPoE user creation for ${raw.phone}: pppoe_username or pppoe_password not provided`);
                }
            } catch (e) {
                failed++;
                errors.push({ row: r, error: e.message });
                logger.error(`Error processing row ${r}:`, e);
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (XLSX):', error);
        res.status(500).json({ success: false, message: 'Error importing customers (XLSX)', error: error.message });
    }
});

// Export customers to JSON
router.get('/export/customers.json', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        
        // Get PPPoE passwords and router_id for each customer
        const { getUserAuthModeAsync, getRadiusConnection, getMikrotikConnection } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        const db = require('../config/billing').db;
        
        // Enrich customers with pppoe_password and router_id
        const enrichedCustomers = await Promise.all(customers.map(async (customer) => {
            const enriched = { ...customer };
            
            // Get router_id from customer_router_map
            if (customer.id) {
                try {
                    const routerMap = await new Promise((resolve, reject) => {
                        db.get('SELECT router_id FROM customer_router_map WHERE customer_id = ?', [customer.id], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    if (routerMap && routerMap.router_id) {
                        enriched.router_id = routerMap.router_id;
                    }
                } catch (e) {
                    logger.debug(`No router mapping found for customer ${customer.id}`);
                }
            }
            
            // Get PPPoE password if pppoe_username exists
            if (customer.pppoe_username) {
                try {
                    if (authMode === 'radius') {
                        const conn = await getRadiusConnection();
                        try {
                            const [rows] = await conn.execute(
                                "SELECT value as password FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1",
                                [customer.pppoe_username]
                            );
                            await conn.end();
                            if (rows && rows.length > 0) {
                                enriched.pppoe_password = rows[0].password;
                            }
                        } catch (radiusError) {
                            await conn.end();
                            logger.warn(`Failed to get password from RADIUS for ${customer.pppoe_username}: ${radiusError.message}`);
                        }
                    } else {
                        const conn = await getMikrotikConnection();
                        if (conn) {
                            try {
                                const secrets = await conn.write('/ppp/secret/print', ['?name=' + customer.pppoe_username]);
                                if (secrets && secrets.length > 0) {
                                    enriched.pppoe_password = secrets[0].password || null;
                                }
                            } catch (mikrotikError) {
                                logger.warn(`Failed to get password from Mikrotik for ${customer.pppoe_username}: ${mikrotikError.message}`);
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`Error getting PPPoE password for ${customer.pppoe_username}: ${e.message}`);
                }
            }
            
            return enriched;
        }));
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.json');
        res.json({ success: true, customers: enrichedCustomers });
    } catch (error) {
        logger.error('Error exporting customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers (JSON)',
            error: error.message
        });
    }
});

// Import customers from JSON file
router.post('/import/customers/json', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File JSON tidak ditemukan' });
        }

        const content = req.file.buffer.toString('utf8');
        let payload;
        try {
            payload = JSON.parse(content);
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Format JSON tidak valid' });
        }

        const items = Array.isArray(payload) ? payload : (payload.customers || []);
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada data pelanggan pada file' });
        }

        let created = 0, updated = 0, failed = 0;
        const errors = [];

        for (const raw of items) {
            try {
                const name = (raw.name || '').toString().trim();
                const phone = (raw.phone || '').toString().trim();
                if (!name || !phone) {
                    failed++; errors.push({ phone, error: 'Nama/Phone wajib' }); continue;
                }

                const existing = await billingManager.getCustomerByPhone(phone);
                const customerData = {
                    name,
                    phone,
                    pppoe_username: raw.pppoe_username || '',
                    email: raw.email || '',
                    address: raw.address || '',
                    package_id: raw.package_id || null,
                    pppoe_profile: raw.pppoe_profile || 'default',
                    status: raw.status || 'active',
                    auto_suspension: raw.auto_suspension !== undefined ? parseInt(raw.auto_suspension, 10) : 1,
                    billing_day: raw.billing_day ? Math.min(Math.max(parseInt(raw.billing_day), 1), 28) : 1
                };

                let result;
                if (existing) {
                    result = await billingManager.updateCustomer(phone, customerData);
                    updated++;
                } else {
                    result = await billingManager.createCustomer(customerData);
                    created++;
                }

                // Handle PPPoE user creation/update if pppoe_username and password provided
                if (raw.pppoe_username && raw.pppoe_password) {
                    try {
                        const pppoe_username = String(raw.pppoe_username).trim();
                        const pppoe_password = String(raw.pppoe_password).trim();
                        const pppoe_profile = raw.pppoe_profile || 'default';
                        const router_id = raw.router_id || null;

                        if (pppoe_username && pppoe_password) {
                            const { addPPPoEUser, getUserAuthModeAsync } = require('../config/mikrotik');
                            
                            // Helper function untuk get router by ID
                            const getRouterById = async (routerId) => {
                                try {
                                    const db = require('../config/billing').db;
                                    return new Promise((resolve, reject) => {
                                        db.get('SELECT * FROM routers WHERE id = ?', [parseInt(routerId)], (err, row) => {
                                            if (err) reject(err);
                                            else resolve(row || null);
                                        });
                                    });
                                } catch (err) {
                                    logger.warn(`Failed to get router by ID ${routerId}: ${err.message}`);
                                    return null;
                                }
                            };

                            // Get customer data after create/update to ensure we have the ID
                            const customer = await billingManager.getCustomerByPhone(phone);
                            if (!customer || !customer.id) {
                                logger.error(`[IMPORT] Customer not found or missing ID for phone ${phone}`);
                                throw new Error(`Customer not found or missing ID for phone ${phone}`);
                            }

                            const authMode = await getUserAuthModeAsync();
                            logger.info(`[IMPORT] Creating/updating PPPoE user ${pppoe_username} with profile ${pppoe_profile} (Mode: ${authMode}) for customer ${customer.id}`);

                            // Handle router_id: jika "RADIUS", set routerObj ke null
                            let routerObj = null;
                            if (router_id && router_id !== '' && router_id !== 'RADIUS' && router_id !== 'radius') {
                                routerObj = await getRouterById(router_id);
                                if (routerObj) {
                                    logger.info(`[IMPORT] Using router: ${routerObj.name} (${routerObj.nas_ip})`);
                                }
                            }

                            logger.info(`[IMPORT] Calling addPPPoEUser with: username=${pppoe_username}, profile=${pppoe_profile}, customer.id=${customer.id}`);
                            const addRes = await addPPPoEUser({ 
                                username: pppoe_username, 
                                password: pppoe_password, 
                                profile: pppoe_profile, 
                                customer: { id: customer.id },
                                routerObj: routerObj
                            });

                            if (addRes && addRes.success) {
                                logger.info(`✅ [IMPORT] PPPoE user ${pppoe_username} created/updated successfully in ${authMode} mode`);
                            } else {
                                const errorMsg = addRes?.message || addRes?.error || 'Unknown error';
                                logger.error(`❌ [IMPORT] Failed to create/update PPPoE user ${pppoe_username}: ${errorMsg}`);
                                logger.error(`[IMPORT] Full response:`, JSON.stringify(addRes));
                            }
                        } else {
                            logger.warn(`[IMPORT] Skipping PPPoE user creation: username or password is empty for phone ${phone}`);
                        }
                    } catch (pppoeError) {
                        logger.error(`[IMPORT] Error creating/updating PPPoE user for ${phone}:`, pppoeError);
                        logger.error(`[IMPORT] Error stack:`, pppoeError.stack);
                        // Don't fail the import if PPPoE creation fails, but log the error
                        errors.push({ phone, error: `PPPoE creation failed: ${pppoeError.message}` });
                    }
                } else {
                    logger.debug(`[IMPORT] Skipping PPPoE user creation for ${phone}: pppoe_username or pppoe_password not provided`);
                }
            } catch (e) {
                failed++;
                errors.push({ phone: raw && raw.phone, error: e.message });
            }
        }

        res.json({ success: true, summary: { created, updated, failed }, errors });
    } catch (error) {
        logger.error('Error importing customers (JSON):', error);
        res.status(500).json({
            success: false,
            message: 'Error importing customers (JSON)',
            error: error.message
        });
    }
});

// Auto Invoice Management
router.get('/auto-invoice', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const thisMonthInvoices = await billingManager.getInvoices();
        const thisMonthInvoicesCount = thisMonthInvoices.filter(invoice => {
            const invoiceDate = new Date(invoice.created_at);
            return invoiceDate >= startOfMonth && invoiceDate <= endOfMonth;
        }).length;
        
        // Calculate next run date
        const nextRunDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        
        res.render('admin/billing/auto-invoice', {
            title: 'Auto Invoice Management',
            activeCustomersCount: activeCustomers.length,
            thisMonthInvoicesCount,
            nextRunDate: nextRunDate.toLocaleDateString('id-ID'),
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading auto invoice page:', error);
        res.status(500).render('error', { 
            message: 'Error loading auto invoice page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Generate invoices manually
router.post('/auto-invoice/generate', async (req, res) => {
    try {
        const invoiceScheduler = require('../config/scheduler');
        await invoiceScheduler.triggerMonthlyInvoices();
        
        res.json({
            success: true,
            message: 'Invoice generation completed',
            count: 'auto' // Will be logged by scheduler
        });
    } catch (error) {
        logger.error('Error generating invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating invoices: ' + error.message
        });
    }
});

// Preview invoices that will be generated
router.get('/auto-invoice/preview', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.package_id);
        
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const customersNeedingInvoices = [];
        
        for (const customer of activeCustomers) {
            // Check if invoice already exists for this month
            const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
                customer.username,
                startOfMonth,
                endOfMonth
            );
            
            if (existingInvoices.length === 0) {
                // Get customer's package
                const package = await billingManager.getPackageById(customer.package_id);
                if (package) {
                    const dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 15);
                    
                    // Calculate price with PPN
                    const basePrice = package.price;
                    const taxRate = (package.tax_rate === 0 || (typeof package.tax_rate === 'number' && package.tax_rate > -1))
                        ? Number(package.tax_rate)
                        : 11.00;
                    const priceWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
                    
                    customersNeedingInvoices.push({
                        username: customer.username,
                        name: customer.name,
                        package_name: package.name,
                        package_price: basePrice,
                        tax_rate: taxRate,
                        price_with_tax: priceWithTax,
                        due_date: dueDate.toISOString().split('T')[0]
                    });
                }
            }
        }
        
        res.json({
            success: true,
            customers: customersNeedingInvoices
        });
    } catch (error) {
        logger.error('Error previewing invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error previewing invoices: ' + error.message
        });
    }
});

// Save auto invoice settings
router.post('/auto-invoice/settings', async (req, res) => {
    try {
        const { due_date_day, auto_invoice_enabled, invoice_notes } = req.body;
        
        // Save settings to database or config file
        // For now, we'll just log the settings
        logger.info('Auto invoice settings updated:', {
            due_date_day,
            auto_invoice_enabled,
            invoice_notes
        });
        
        res.json({
            success: true,
            message: 'Settings saved successfully'
        });
    } catch (error) {
        logger.error('Error saving auto invoice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving settings: ' + error.message
        });
    }
});

// WhatsApp Settings Routes
router.get('/whatsapp-settings', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/whatsapp-settings', {
            title: 'WhatsApp Notification Settings',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading WhatsApp settings page:', error);
        res.status(500).render('error', {
            message: 'Error loading WhatsApp settings page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Email Settings Routes (placed right after WhatsApp settings)
router.get('/email-settings', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/email-settings', {
            title: 'Email Notification Settings',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading Email settings page:', error);
        res.status(500).render('error', {
            message: 'Error loading Email settings page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get WhatsApp templates
router.get('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templates = whatsappNotifications.getTemplates();
        
        res.json({
            success: true,
            templates: templates
        });
    } catch (error) {
        logger.error('Error getting WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting templates: ' + error.message
        });
    }
});

// Save WhatsApp templates
router.post('/whatsapp-settings/templates', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const templateData = req.body;
        
        // Update templates (more efficient for multiple updates)
        const updatedCount = whatsappNotifications.updateTemplates(templateData);
        
        res.json({
            success: true,
            message: `${updatedCount} templates saved successfully`
        });
    } catch (error) {
        logger.error('Error saving WhatsApp templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving templates: ' + error.message
        });
    }
});

// Get WhatsApp rate limit settings
router.get('/whatsapp-settings/rate-limit', async (req, res) => {
    try {
        // Prefer nested object if exists, fallback to flattened keys
        const nested = getSetting('whatsapp_rate_limit', null);
        const settings = nested && typeof nested === 'object' ? {
            maxMessagesPerBatch: nested.maxMessagesPerBatch ?? 10,
            delayBetweenBatches: nested.delayBetweenBatches ?? 30,
            delayBetweenMessages: nested.delayBetweenMessages ?? 2,
            maxRetries: nested.maxRetries ?? 2,
            dailyMessageLimit: nested.dailyMessageLimit ?? 0,
            enabled: nested.enabled ?? true
        } : {
            maxMessagesPerBatch: getSetting('whatsapp_rate_limit.maxMessagesPerBatch', 10),
            delayBetweenBatches: getSetting('whatsapp_rate_limit.delayBetweenBatches', 30),
            delayBetweenMessages: getSetting('whatsapp_rate_limit.delayBetweenMessages', 2),
            maxRetries: getSetting('whatsapp_rate_limit.maxRetries', 2),
            dailyMessageLimit: getSetting('whatsapp_rate_limit.dailyMessageLimit', 0),
            enabled: getSetting('whatsapp_rate_limit.enabled', true)
        };
        
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        logger.error('Error getting WhatsApp rate limit settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting rate limit settings: ' + error.message
        });
    }
});

// Save WhatsApp rate limit settings
router.post('/whatsapp-settings/rate-limit', async (req, res) => {
    try {
        const { maxMessagesPerBatch, delayBetweenBatches, delayBetweenMessages, maxRetries, dailyMessageLimit, enabled } = req.body;
        
        // Validate input
        if (maxMessagesPerBatch < 1 || maxMessagesPerBatch > 100) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal pesan per batch harus antara 1-100'
            });
        }
        
        if (delayBetweenBatches < 1 || delayBetweenBatches > 300) {
            return res.status(400).json({
                success: false,
                message: 'Jeda antar batch harus antara 1-300 detik'
            });
        }
        
        if (delayBetweenMessages < 0 || delayBetweenMessages > 10) {
            return res.status(400).json({
                success: false,
                message: 'Jeda antar pesan harus antara 0-10 detik'
            });
        }
        
        if (maxRetries < 0 || maxRetries > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal retry harus antara 0-5'
            });
        }
        
        if (dailyMessageLimit < 0 || dailyMessageLimit > 1000) {
            return res.status(400).json({
                success: false,
                message: 'Batas harian harus antara 0-1000'
            });
        }
        
        // Save settings
        const parsed = {
            maxMessagesPerBatch: parseInt(maxMessagesPerBatch),
            delayBetweenBatches: parseInt(delayBetweenBatches),
            delayBetweenMessages: parseInt(delayBetweenMessages),
            maxRetries: parseInt(maxRetries),
            dailyMessageLimit: parseInt(dailyMessageLimit),
            enabled: (enabled === true || enabled === 'true')
        };
        // Save flattened keys for backward compatibility
        setSetting('whatsapp_rate_limit.maxMessagesPerBatch', parsed.maxMessagesPerBatch);
        setSetting('whatsapp_rate_limit.delayBetweenBatches', parsed.delayBetweenBatches);
        setSetting('whatsapp_rate_limit.delayBetweenMessages', parsed.delayBetweenMessages);
        setSetting('whatsapp_rate_limit.maxRetries', parsed.maxRetries);
        setSetting('whatsapp_rate_limit.dailyMessageLimit', parsed.dailyMessageLimit);
        setSetting('whatsapp_rate_limit.enabled', parsed.enabled);
        // Also save as nested object for readability
        setSetting('whatsapp_rate_limit', parsed);
        // Ensure new reads reflect immediately
        clearSettingsCache();
        
        res.json({
            success: true,
            message: 'Pengaturan rate limiting berhasil disimpan'
        });
    } catch (error) {
        logger.error('Error saving WhatsApp rate limit settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving rate limit settings: ' + error.message
        });
    }
});

// WhatsApp Groups Settings
router.get('/whatsapp-settings/groups', async (req, res) => {
    try {
        // Prefer nested object if exists
        const nested = getSetting('whatsapp_groups', null);
        const enabled = nested && typeof nested === 'object' ? (nested.enabled !== false) : getSetting('whatsapp_groups.enabled', true);
        // groups can be stored as array or object with numeric keys
        let ids = nested && Array.isArray(nested.ids) ? nested.ids : getSetting('whatsapp_groups.ids', []);
        if (!Array.isArray(ids)) {
            const asObj = getSetting('whatsapp_groups', {});
            ids = [];
            Object.keys(asObj).forEach(k => {
                if (k.match(/^ids\.\d+$/)) {
                    ids.push(asObj[k]);
                }
            });
        }
        res.json({ success: true, groups: { enabled, ids } });
    } catch (error) {
        logger.error('Error getting WhatsApp groups:', error);
        res.status(500).json({ success: false, message: 'Error getting WhatsApp groups: ' + error.message });
    }
});

router.post('/whatsapp-settings/groups', async (req, res) => {
    try {
        const enabled = req.body.enabled === true || req.body.enabled === 'true';
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        // Basic validation for WhatsApp group JIDs
        for (const id of ids) {
            if (typeof id !== 'string' || !id.endsWith('@g.us')) {
                return res.status(400).json({ success: false, message: `Invalid group id: ${id}` });
            }
        }

        // Save flattened keys
        setSetting('whatsapp_groups.enabled', enabled);
        setSetting('whatsapp_groups.ids', ids);
        // Save nested object for readability
        setSetting('whatsapp_groups', { enabled, ids });
        // Also write numeric keys for compatibility
        ids.forEach((val, idx) => setSetting(`whatsapp_groups.ids.${idx}`, val));
        // Ensure cache refresh
        clearSettingsCache();

        res.json({ success: true, message: 'WhatsApp groups updated' });
    } catch (error) {
        logger.error('Error saving WhatsApp groups:', error);
        res.status(500).json({ success: false, message: 'Error saving WhatsApp groups: ' + error.message });
    }
});


router.post('/system/restart', async (req, res) => {
    try {
        const repoPath = getSetting('repo_path', process.cwd());
        const appNameSetting = getSetting('pm2_restart_target', null)
            || getSetting('pm2_app_name', null)
            || process.env.PM2_APP_NAME
            || 'cvlmedia';
        const appResolvedFromFallback = (!getSetting('pm2_restart_target', null) && !getSetting('pm2_app_name', null) && !process.env.PM2_APP_NAME);
        const opts = { cwd: repoPath, windowsHide: true, shell: process.platform === 'win32' ? undefined : '/bin/bash' };
        const pm2Cmd = `pm2 restart ${appNameSetting} || pm2 reload ${appNameSetting}`;
        exec(pm2Cmd, opts, (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({ success: false, message: 'Restart failed', error: stderr || error.message, log: stdout, app: appNameSetting, fallbackUsed: appResolvedFromFallback });
            }
            exec('pm2 save', opts, () => {
                res.json({ success: true, message: 'Billing system restarted', log: stdout, app: appNameSetting, fallbackUsed: appResolvedFromFallback });
            });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Unexpected error', error: e.message });
    }
});

router.get('/system/server-info', async (req, res) => {
    try {
        const appVersion = getSetting('app_version', '4.1');
        const pm2App = getSetting('pm2_restart_target', null)
            || getSetting('pm2_app_name', null)
            || process.env.PM2_APP_NAME
            || 'cvlmedia';
        const now = new Date();

        res.json({
            success: true,
            serverTimeIso: now.toISOString(),
            serverTimeLocale: now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            appVersion,
            pm2App: pm2App || null
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load server info', error: e.message });
    }
});

// Get WhatsApp status
router.get('/whatsapp-settings/status', async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.phone);
        
        const invoices = await billingManager.getInvoices();
        const pendingInvoices = invoices.filter(i => i.status === 'unpaid');
        
        // Get WhatsApp status - cek dari provider manager dulu, lalu fallback ke global
        let whatsappStatus = { connected: false, status: 'disconnected' };
        
        try {
            // Coba ambil dari provider manager (untuk Wablas/Baileys)
            const { getProviderManager } = require('../config/whatsapp-provider-manager');
            const providerManager = getProviderManager();
            
            if (providerManager && providerManager.isInitialized()) {
                const provider = providerManager.getProvider();
                if (provider) {
                    const providerStatus = provider.getStatus();
                    whatsappStatus = {
                        connected: provider.isConnected() || providerStatus.connected || false,
                        status: providerStatus.status || (provider.isConnected() ? 'connected' : 'disconnected'),
                        provider: providerManager.getProviderType()
                    };
                }
            }
        } catch (providerError) {
            // Fallback ke whatsapp-core jika provider manager tidak tersedia
            try {
                const whatsappCore = require('../config/whatsapp-core');
                const coreStatus = whatsappCore.getWhatsAppStatus();
                if (coreStatus) {
                    whatsappStatus = {
                        connected: coreStatus.connected || false,
                        status: coreStatus.status || 'disconnected'
                    };
                }
            } catch (coreError) {
                // Final fallback ke global
                whatsappStatus = global.whatsappStatus || { connected: false, status: 'disconnected' };
            }
        }
        
        // Jika masih belum dapat status, cek global
        if (!whatsappStatus || (!whatsappStatus.connected && !whatsappStatus.status)) {
            whatsappStatus = global.whatsappStatus || { connected: false, status: 'disconnected' };
        }
        
        res.json({
            success: true,
            whatsappStatus: whatsappStatus.connected ? 'Connected' : 'Disconnected',
            activeCustomers: activeCustomers.length,
            pendingInvoices: pendingInvoices.length,
            nextReminder: 'Daily at 09:00'
        });
    } catch (error) {
        logger.error('Error getting WhatsApp status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting status: ' + error.message
        });
    }
});

// Test WhatsApp notification
router.post('/whatsapp-settings/test', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { phoneNumber, templateKey } = req.body;
        
        // Test data for different templates
        const testData = {
            invoice_created: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                notes: 'Tagihan bulanan'
            },
            due_date_reminder: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                due_date: '15 Januari 2024',
                days_remaining: '3',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            payment_received: {
                customer_name: 'Test Customer',
                invoice_number: 'INV-2024-001',
                amount: '500,000',
                payment_method: 'Transfer Bank',
                payment_date: '10 Januari 2024',
                reference_number: 'TRX123456'
            },
            service_disruption: {
                disruption_type: 'Gangguan Jaringan',
                affected_area: 'Seluruh Area',
                estimated_resolution: '2 jam',
                support_phone: getSetting('contact_whatsapp', '0813-6888-8498')
            },
            service_announcement: {
                announcement_content: 'Pengumuman penting untuk semua pelanggan.'
            },
            service_suspension: {
                customer_name: 'Test Customer',
                reason: 'Tagihan terlambat lebih dari 7 hari'
            },
            service_restoration: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps'
            },
            welcome_message: {
                customer_name: 'Test Customer',
                package_name: 'Paket Premium',
                package_speed: '50 Mbps',
                wifi_password: 'test123456',
                support_phone: getSetting('contact_whatsapp', '0813-6888-8498')
            }
        };
        
        const result = await whatsappNotifications.testNotification(phoneNumber, templateKey, testData[templateKey]);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Test notification sent successfully'
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending test notification: ' + error.message
        });
    }
});

// Send broadcast message
router.post('/whatsapp-settings/broadcast', async (req, res) => {
    try {
        const whatsappNotifications = require('../config/whatsapp-notifications');
        const { type, message, disruptionType, affectedArea, estimatedResolution } = req.body;
        
        let result;
        
        if (type === 'service_disruption') {
            result = await whatsappNotifications.sendServiceDisruptionNotification({
                type: disruptionType || 'Gangguan Jaringan',
                area: affectedArea || 'Seluruh Area',
                estimatedTime: estimatedResolution || 'Sedang dalam penanganan'
            });
        } else if (type === 'service_announcement') {
            result = await whatsappNotifications.sendServiceAnnouncement({
                content: message
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid broadcast type'
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                sent: result.sent,
                failed: result.failed,
                total: result.total,
                customer_sent: result.customer_sent || 0,
                customer_failed: result.customer_failed || 0,
                group_sent: result.group_sent || 0,
                group_failed: result.group_failed || 0,
                message: `Broadcast sent successfully. Customer: ${result.customer_sent || 0} ok / ${result.customer_failed || 0} fail, Group: ${result.group_sent || 0} ok / ${result.group_failed || 0} fail`
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending broadcast:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending broadcast: ' + error.message
        });
    }
});

// Get Email templates
router.get('/email-settings/templates', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        const templates = emailNotifications.getTemplates();
        
        res.json({
            success: true,
            templates: templates
        });
    } catch (error) {
        logger.error('Error getting Email templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting templates: ' + error.message
        });
    }
});

// Save Email templates
router.post('/email-settings/templates', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        const templateData = req.body;
        
        // Update templates
        const updatedCount = emailNotifications.updateTemplates(templateData);
        
        res.json({
            success: true,
            message: `${updatedCount} templates saved successfully`
        });
    } catch (error) {
        logger.error('Error saving Email templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving templates: ' + error.message
        });
    }
});

// Get Email connection status
router.get('/email-settings/status', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        // Reload transporter to get latest SMTP settings
        emailNotifications.reloadTransporter();
        const isConfigured = emailNotifications.isConfigured();
        const connectionTest = await emailNotifications.testConnection();
        
        // Get stats
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.email);
        const pendingInvoices = await billingManager.getUnpaidInvoices();
        
        res.json({
            success: true,
            emailConfigured: isConfigured,
            connectionStatus: connectionTest.success ? 'Connected' : 'Not Connected',
            connectionError: connectionTest.error || null,
            activeCustomersWithEmail: activeCustomers.length,
            pendingInvoices: pendingInvoices.length
        });
    } catch (error) {
        logger.error('Error getting Email status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting status: ' + error.message
        });
    }
});

// Test SMTP Connection (POST endpoint for testing)
router.post('/email-settings/status', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        // Reload transporter to get latest SMTP settings
        emailNotifications.reloadTransporter();
        const isConfigured = emailNotifications.isConfigured();
        const connectionTest = await emailNotifications.testConnection();
        
        // Get stats
        const customers = await billingManager.getCustomers();
        const activeCustomers = customers.filter(c => c.status === 'active' && c.email);
        const pendingInvoices = await billingManager.getUnpaidInvoices();
        
        res.json({
            success: true,
            emailConfigured: isConfigured,
            connectionStatus: connectionTest.success ? 'Connected' : 'Not Connected',
            connectionError: connectionTest.error || null,
            activeCustomersWithEmail: activeCustomers.length,
            pendingInvoices: pendingInvoices.length
        });
    } catch (error) {
        logger.error('Error testing Email connection:', error);
        res.status(500).json({
            success: false,
            message: 'Error testing connection: ' + error.message,
            connectionStatus: 'Error',
            connectionError: error.message
        });
    }
});

// Test Email notification
router.post('/email-settings/test', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        const { emailAddress, templateKey } = req.body;
        
        if (!emailAddress || !emailAddress.includes('@')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email address'
            });
        }
        
        if (!templateKey) {
            return res.status(400).json({
                success: false,
                message: 'Template key is required'
            });
        }
        
        const result = await emailNotifications.testNotification(emailAddress, templateKey);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Test email sent successfully'
            });
        } else {
            res.json({
                success: false,
                message: 'Error sending test email: ' + result.error
            });
        }
    } catch (error) {
        logger.error('Error sending test email:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending test email: ' + error.message
        });
    }
});

// Send Email broadcast message
router.post('/email-settings/broadcast', async (req, res) => {
    try {
        const emailNotifications = require('../config/email-notifications');
        const { type, message, disruptionType, affectedArea, estimatedResolution } = req.body;
        
        let result;
        
        if (type === 'service_disruption') {
            result = await emailNotifications.sendServiceDisruptionNotification({
                type: disruptionType || 'Gangguan Jaringan',
                area: affectedArea || 'Seluruh Area',
                estimatedTime: estimatedResolution || 'Sedang dalam penanganan'
            });
        } else if (type === 'service_announcement') {
            result = await emailNotifications.sendServiceAnnouncement({
                content: message
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid broadcast type'
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                sent: result.sent,
                failed: result.failed,
                total: result.total,
                message: `Broadcast sent successfully. ${result.sent} sent / ${result.failed} failed`
            });
        } else {
            res.json({
                success: false,
                message: result.error
            });
        }
    } catch (error) {
        logger.error('Error sending email broadcast:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending broadcast: ' + error.message
        });
    }
});

// API: Get RADIUS groupnames (for dropdown/autocomplete)
router.get('/api/radius/groupnames', async (req, res) => {
    try {
        const { getRadiusConnection } = require('../config/mikrotik');
        const conn = await getRadiusConnection();
        
        // Get unique groupnames from radgroupreply and radusergroup
        const [groupReplyRows] = await conn.execute(`
            SELECT DISTINCT groupname 
            FROM radgroupreply 
            WHERE groupname IS NOT NULL AND groupname != ''
            ORDER BY groupname ASC
        `);
        
        const [userGroupRows] = await conn.execute(`
            SELECT DISTINCT groupname 
            FROM radusergroup 
            WHERE groupname IS NOT NULL AND groupname != ''
            ORDER BY groupname ASC
        `);
        
        await conn.end();
        
        // Combine and deduplicate groupnames
        const groupnamesSet = new Set();
        (groupReplyRows || []).forEach(row => groupnamesSet.add(row.groupname));
        (userGroupRows || []).forEach(row => groupnamesSet.add(row.groupname));
        
        const groupnames = Array.from(groupnamesSet).sort();
        
        res.json({
            success: true,
            groupnames: groupnames
        });
    } catch (error) {
        logger.error('Error getting RADIUS groupnames:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil daftar groupname dari RADIUS',
            error: error.message,
            groupnames: []
        });
    }
});

// Paket Management
router.get('/packages', getAppSettings, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        // Fetch routers for NAS selection
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Get user auth mode for conditional display
        const { getUserAuthModeAsync } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        
        res.render('admin/billing/packages', {
            title: 'Kelola Paket',
            packages,
            routers,
            appSettings: req.appSettings,
            authMode // Pass auth mode ke view
        });
    } catch (error) {
        logger.error('Error loading packages:', error);
        res.status(500).render('error', { 
            message: 'Error loading packages',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/packages', imageUpload.single('image'), async (req, res) => {
    try {
        const { 
            name, speed, price, tax_rate, description, pppoe_profile, router_id, nas_ip,
            upload_limit, download_limit, burst_limit_upload, burst_limit_download, 
            burst_threshold, burst_time 
        } = req.body;
        
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            tax_rate: parseFloat(tax_rate) >= 0 ? parseFloat(tax_rate) : 0,
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default',
            router_id: router_id ? parseInt(router_id) : null,
            nas_ip: nas_ip ? nas_ip.trim() : null,
            upload_limit: upload_limit ? upload_limit.trim() : null,
            download_limit: download_limit ? download_limit.trim() : null,
            burst_limit_upload: burst_limit_upload ? burst_limit_upload.trim() : null,
            burst_limit_download: burst_limit_download ? burst_limit_download.trim() : null,
            burst_threshold: burst_threshold ? burst_threshold.trim() : null,
            burst_time: burst_time ? burst_time.trim() : null
        };

        // Add image filename if uploaded
        if (req.file) {
            packageData.image = req.file.filename;
        }

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const newPackage = await billingManager.createPackage(packageData);
        logger.info(`Package created: ${newPackage.name} with tax_rate: ${newPackage.tax_rate}, router_id: ${newPackage.router_id}`);
        
        // Auto-sync limits berdasarkan mode (RADIUS atau API)
        const { getUserAuthModeAsync, syncPackageLimitsToRadius, syncPackageLimitsToMikrotik, getPPPoEProfiles, addPPPoEProfile, buildMikrotikRateLimit } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        
        let syncResult = null;
        if (authMode === 'radius') {
            // Sync ke RADIUS (radgroupreply)
            try {
                // Convert profile name ke format groupname (lowercase dengan underscore)
                const groupname = newPackage.pppoe_profile.toLowerCase().replace(/\s+/g, '_');
                syncResult = await syncPackageLimitsToRadius({
                    groupname: groupname,
                    upload_limit: newPackage.upload_limit,
                    download_limit: newPackage.download_limit,
                    burst_limit_upload: newPackage.burst_limit_upload,
                    burst_limit_download: newPackage.burst_limit_download,
                    burst_threshold: newPackage.burst_threshold,
                    burst_time: newPackage.burst_time
                });
                if (syncResult && syncResult.success) {
                    logger.info(`✅ Package limits synced to RADIUS for group: ${groupname}`);
                }
            } catch (syncError) {
                logger.warn(`Failed to sync limits to RADIUS: ${syncError.message}`);
            }
        } else {
            // Sync ke Mikrotik (PPPoE profile rate-limit) - hanya jika router_id ada
            if (newPackage.router_id && newPackage.pppoe_profile) {
                try {
                    const sqlite3 = require('sqlite3').verbose();
                    const db = new sqlite3.Database('./data/billing.db');
                    const routerObj = await new Promise((resolve, reject) => {
                        db.get('SELECT * FROM routers WHERE id=?', [newPackage.router_id], (err, row) => {
                            db.close();
                            if (err) reject(err);
                            else resolve(row || null);
                        });
                    });
                    
                    if (routerObj) {
                        // Check if profile exists
                        const profilesResult = await getPPPoEProfiles(routerObj);
                        const profileExists = profilesResult.success && profilesResult.data && 
                            profilesResult.data.some(p => (p.name || p['name']) === newPackage.pppoe_profile);
                        
                        if (profileExists) {
                            // Update existing profile dengan limits
                            syncResult = await syncPackageLimitsToMikrotik({
                                profile_name: newPackage.pppoe_profile,
                                upload_limit: newPackage.upload_limit,
                                download_limit: newPackage.download_limit,
                                burst_limit_upload: newPackage.burst_limit_upload,
                                burst_limit_download: newPackage.burst_limit_download,
                                burst_threshold: newPackage.burst_threshold,
                                burst_time: newPackage.burst_time
                            }, routerObj);
                            if (syncResult && syncResult.success) {
                                logger.info(`✅ Package limits synced to Mikrotik profile: ${newPackage.pppoe_profile}`);
                            }
                        } else {
                            // Create profile baru dengan limits
                            const rateLimit = buildMikrotikRateLimit({
                                upload_limit: newPackage.upload_limit,
                                download_limit: newPackage.download_limit,
                                burst_limit_upload: newPackage.burst_limit_upload,
                                burst_limit_download: newPackage.burst_limit_download,
                                burst_threshold: newPackage.burst_threshold,
                                burst_time: newPackage.burst_time
                            });
                            
                            const profileData = {
                                name: newPackage.pppoe_profile,
                                'remote-address': 'POOL-PPPOE-NEW',
                                'rate-limit': rateLimit || undefined
                            };
                            
                            const createResult = await addPPPoEProfile(profileData, routerObj);
                            if (createResult && createResult.success) {
                                syncResult = { success: true, message: 'Profile created with limits' };
                                logger.info(`✅ PPPoE profile created with limits: ${newPackage.pppoe_profile}`);
                            }
                        }
                    }
                } catch (profileError) {
                    logger.warn(`Failed to sync limits to Mikrotik: ${profileError.message}`);
                }
            }
        }
        
        res.json({
            success: true,
            message: syncResult && syncResult.success 
                ? `Paket berhasil ditambahkan dan limits di-sync ke ${authMode === 'radius' ? 'RADIUS' : 'Mikrotik'}`
                : 'Paket berhasil ditambahkan',
            package: newPackage,
            syncResult
        });
    } catch (error) {
        logger.error('Error creating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating package',
            error: error.message
        });
    }
});

router.put('/packages/:id', imageUpload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, speed, price, tax_rate, description, pppoe_profile, router_id, nas_ip,
            upload_limit, download_limit, burst_limit_upload, burst_limit_download, 
            burst_threshold, burst_time 
        } = req.body;
        
        const packageData = {
            name: name.trim(),
            speed: speed.trim(),
            price: parseFloat(price),
            tax_rate: parseFloat(tax_rate) >= 0 ? parseFloat(tax_rate) : 0,
            description: description.trim(),
            pppoe_profile: pppoe_profile ? pppoe_profile.trim() : 'default',
            router_id: router_id ? parseInt(router_id) : null,
            nas_ip: nas_ip ? nas_ip.trim() : null,
            upload_limit: upload_limit ? upload_limit.trim() : null,
            download_limit: download_limit ? download_limit.trim() : null,
            burst_limit_upload: burst_limit_upload ? burst_limit_upload.trim() : null,
            burst_limit_download: burst_limit_download ? burst_limit_download.trim() : null,
            burst_threshold: burst_threshold ? burst_threshold.trim() : null,
            burst_time: burst_time ? burst_time.trim() : null
        };

        // Add image filename if uploaded
        if (req.file) {
            packageData.image = req.file.filename;
        }

        if (!packageData.name || !packageData.speed || !packageData.price) {
            return res.status(400).json({
                success: false,
                message: 'Nama, kecepatan, dan harga harus diisi'
            });
        }

        const updatedPackage = await billingManager.updatePackage(id, packageData);
        logger.info(`Package updated: ${updatedPackage.name} with tax_rate: ${updatedPackage.tax_rate}, router_id: ${updatedPackage.router_id}`);
        
        // Auto-sync limits berdasarkan mode (RADIUS atau API)
        const { getUserAuthModeAsync, syncPackageLimitsToRadius, syncPackageLimitsToMikrotik, getPPPoEProfiles, addPPPoEProfile, buildMikrotikRateLimit } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        
        let syncResult = null;
        if (authMode === 'radius') {
            // Sync ke RADIUS (radgroupreply)
            try {
                // Convert profile name ke format groupname (lowercase dengan underscore)
                const groupname = updatedPackage.pppoe_profile.toLowerCase().replace(/\s+/g, '_');
                syncResult = await syncPackageLimitsToRadius({
                    groupname: groupname,
                    upload_limit: updatedPackage.upload_limit,
                    download_limit: updatedPackage.download_limit,
                    burst_limit_upload: updatedPackage.burst_limit_upload,
                    burst_limit_download: updatedPackage.burst_limit_download,
                    burst_threshold: updatedPackage.burst_threshold,
                    burst_time: updatedPackage.burst_time
                });
                if (syncResult && syncResult.success) {
                    logger.info(`✅ Package limits synced to RADIUS for group: ${groupname}`);
                }
            } catch (syncError) {
                logger.warn(`Failed to sync limits to RADIUS: ${syncError.message}`);
            }
        } else {
            // Sync ke Mikrotik (PPPoE profile rate-limit) - hanya jika router_id ada
            if (updatedPackage.router_id && updatedPackage.pppoe_profile) {
                try {
                    const sqlite3 = require('sqlite3').verbose();
                    const db = new sqlite3.Database('./data/billing.db');
                    const routerObj = await new Promise((resolve, reject) => {
                        db.get('SELECT * FROM routers WHERE id=?', [updatedPackage.router_id], (err, row) => {
                            db.close();
                            if (err) reject(err);
                            else resolve(row || null);
                        });
                    });
                    
                    if (routerObj) {
                        // Check if profile exists
                        const profilesResult = await getPPPoEProfiles(routerObj);
                        const profileExists = profilesResult.success && profilesResult.data && 
                            profilesResult.data.some(p => (p.name || p['name']) === updatedPackage.pppoe_profile);
                        
                        if (profileExists) {
                            // Update existing profile dengan limits
                            syncResult = await syncPackageLimitsToMikrotik({
                                profile_name: updatedPackage.pppoe_profile,
                                upload_limit: updatedPackage.upload_limit,
                                download_limit: updatedPackage.download_limit,
                                burst_limit_upload: updatedPackage.burst_limit_upload,
                                burst_limit_download: updatedPackage.burst_limit_download,
                                burst_threshold: updatedPackage.burst_threshold,
                                burst_time: updatedPackage.burst_time
                            }, routerObj);
                            if (syncResult && syncResult.success) {
                                logger.info(`✅ Package limits synced to Mikrotik profile: ${updatedPackage.pppoe_profile}`);
                            }
                        } else {
                            // Create profile baru dengan limits
                            const rateLimit = buildMikrotikRateLimit({
                                upload_limit: updatedPackage.upload_limit,
                                download_limit: updatedPackage.download_limit,
                                burst_limit_upload: updatedPackage.burst_limit_upload,
                                burst_limit_download: updatedPackage.burst_limit_download,
                                burst_threshold: updatedPackage.burst_threshold,
                                burst_time: updatedPackage.burst_time
                            });
                            
                            const profileData = {
                                name: updatedPackage.pppoe_profile,
                                'remote-address': 'POOL-PPPOE-NEW',
                                'rate-limit': rateLimit || undefined
                            };
                            
                            const createResult = await addPPPoEProfile(profileData, routerObj);
                            if (createResult && createResult.success) {
                                syncResult = { success: true, message: 'Profile created with limits' };
                                logger.info(`✅ PPPoE profile created with limits: ${updatedPackage.pppoe_profile}`);
                            }
                        }
                    }
                } catch (profileError) {
                    logger.warn(`Failed to sync limits to Mikrotik: ${profileError.message}`);
                }
            }
        }
        
        res.json({
            success: true,
            message: syncResult && syncResult.success 
                ? `Paket berhasil diupdate dan limits di-sync ke ${authMode === 'radius' ? 'RADIUS' : 'Mikrotik'}`
                : 'Paket berhasil diupdate',
            package: updatedPackage,
            syncResult
        });
    } catch (error) {
        logger.error('Error updating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating package',
            error: error.message
        });
    }
});

// Get package detail (HTML view)
router.get('/packages/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).render('error', {
                message: 'Paket tidak ditemukan',
                error: 'Package not found',
                appSettings: req.appSettings
            });
        }

        const customers = await billingManager.getCustomersByPackage(parseInt(id));
        
        res.render('admin/billing/package-detail', {
            title: 'Detail Paket',
            package,
            customers,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading package detail:', error);
        res.status(500).render('error', {
            message: 'Error loading package detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Get package data for editing (JSON API)
router.get('/api/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Paket tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            package: package
        });
    } catch (error) {
        logger.error('Error getting package data:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting package data',
            error: error.message
        });
    }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await billingManager.deletePackage(id);
        logger.info(`Package deleted: ${id}`);
        
        res.json({
            success: true,
            message: 'Paket berhasil dihapus'
        });
    } catch (error) {
        logger.error('Error deleting package:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting package',
            error: error.message
        });
    }
});

// Customer Management
router.get('/customers', getAppSettings, async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        // Ensure routers table exists and load routers for dropdown & filter
        const db = require('../config/billing').db;
        await new Promise((resolve) => db.run(`CREATE TABLE IF NOT EXISTS routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nas_ip TEXT NOT NULL, nas_identifier TEXT, secret TEXT, location TEXT, pop TEXT, UNIQUE(nas_ip))`, () => resolve()));
        
        // Get auth mode untuk auto-select NAS
        const { getUserAuthModeAsync } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        
        // Load routers dari database
        const routers = await new Promise((resolve) => db.all(`SELECT id, name, nas_ip FROM routers ORDER BY id`, (err, rows) => resolve(rows || [])));
        
        // Jika mode RADIUS, cek apakah ada router "RADIUS" atau buat virtual entry
        let radiusRouterId = null;
        if (authMode === 'radius') {
            // Cek apakah sudah ada router dengan nama "RADIUS"
            const radiusRouter = await new Promise((resolve) => db.get(`SELECT id FROM routers WHERE name = 'RADIUS' OR nas_ip = 'RADIUS' LIMIT 1`, (err, row) => resolve(row || null)));
            if (radiusRouter) {
                radiusRouterId = radiusRouter.id;
            } else {
                // Buat virtual router RADIUS untuk display (tidak disimpan ke DB)
                routers.unshift({ id: 'RADIUS', name: 'RADIUS', nas_ip: 'RADIUS Server' });
            }
        }
        
        // OPTIMASI: Gunakan pagination untuk menghindari load semua customer sekaligus
        // Default: 50 customers per page (bisa diubah via query parameter)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const search = req.query.search ? String(req.query.search).trim() : '';
        const statusFilter = req.query.status ? String(req.query.status).trim() : '';
        
        const routerFilter = req.query.router ? parseInt(req.query.router) : null;
        
        // Build filters object
        const filters = {};
        if (routerFilter) filters.router_id = routerFilter;
        if (search) filters.search = search;
        if (statusFilter) filters.status = statusFilter;
        
        let customersResult;
        if (routerFilter) {
            // Jika ada router filter, gunakan query khusus dengan pagination
            const countSql = `
                SELECT COUNT(*) as total
                FROM customers c
                LEFT JOIN customer_router_map m ON m.customer_id = c.id
                WHERE m.router_id = ?
            `;
            
            const sql = `
                SELECT c.*, p.name as package_name, p.price as package_price, p.image as package_image, p.tax_rate,
                       r.name as router_name,
                       CASE 
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid' 
                               AND i.due_date < date('now')
                           ) THEN 'overdue'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'unpaid'
                           ) THEN 'unpaid'
                           WHEN EXISTS (
                               SELECT 1 FROM invoices i 
                               WHERE i.customer_id = c.id 
                               AND i.status = 'paid'
                           ) THEN 'paid'
                           ELSE 'no_invoice'
                       END as payment_status
                FROM customers c
                LEFT JOIN packages p ON c.package_id = p.id
                LEFT JOIN customer_router_map m ON m.customer_id = c.id
                LEFT JOIN routers r ON r.id = m.router_id
                WHERE m.router_id = ?
                ORDER BY c.id DESC
                LIMIT ? OFFSET ?
            `;
            
            const [countRow, customers] = await Promise.all([
                new Promise((resolve) => db.get(countSql, [routerFilter], (err, row) => resolve(err ? { total: 0 } : row))),
                new Promise((resolve) => db.all(sql, [routerFilter, limit, offset], (err, rows) => {
                    if (err) resolve([]);
                    else {
                        const processedRows = rows.map(row => {
                            if (row.package_price && row.tax_rate !== null) {
                                row.package_price = row.package_price * (1 + (row.tax_rate || 0) / 100);
                            }
                            return row;
                        });
                        resolve(processedRows);
                    }
                }))
            ]);
            
            const totalCount = countRow ? countRow.total : 0;
            customersResult = {
                customers: customers,
                totalCount: totalCount,
                page: page,
                totalPages: Math.ceil(totalCount / limit),
                limit: limit,
                offset: offset
            };
        } else {
            // Gunakan method pagination yang sudah dioptimasi
            customersResult = await billingManager.getCustomersPaginated(limit, offset, filters);
        }
        
        const customers = customersResult.customers;
        
        // Get ODPs for dropdown selection (termasuk sub ODP)
        const odps = await new Promise((resolve, reject) => {
            const db = require('../config/billing').db;
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status, o.parent_odp_id,
                       p.name as parent_name, p.code as parent_code
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                WHERE o.status = 'active' 
                ORDER BY p.name, o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        res.render('admin/billing/customers', {
            title: 'Kelola Pelanggan',
            customers,
            packages,
            odps,
            routers,
            routerFilter,
            authMode, // Pass auth mode ke view
            radiusRouterId, // Pass radius router ID jika ada
            pagination: {
                currentPage: customersResult.page,
                totalPages: customersResult.totalPages,
                totalCount: customersResult.totalCount,
                limit: customersResult.limit,
                hasNextPage: customersResult.page < customersResult.totalPages,
                hasPrevPage: customersResult.page > 1
            },
            search: search,
            statusFilter: statusFilter,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading customers:', error);
        res.status(500).render('error', { 
            message: 'Error loading customers',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/customers', customerPhotoUpload.fields([
    { name: 'ktp_photo', maxCount: 1 },
    { name: 'house_photo', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, username, phone, pppoe_username, email, address, package_id, odp_id, pppoe_profile, auto_suspension, billing_day, renewal_type, fix_date, create_pppoe_user, pppoe_password, static_ip, assigned_ip, mac_address, latitude, longitude, cable_type, cable_length, port_number, cable_status, cable_notes, router_id } = req.body;
        
        // Validate required fields
        if (!name || !username || !phone || !package_id) {
            return res.status(400).json({
                success: false,
                message: 'Nama, username, telepon, dan paket harus diisi'
            });
        }
        
        // Validate username format
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username hanya boleh berisi huruf kecil, angka, dan underscore'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        }

        const customerData = {
            name,
            username,
            phone,
            pppoe_username,
            email,
            address,
            package_id,
            odp_id: odp_id || null,
            pppoe_profile: profileToUse,
            status: 'active',
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : 1,
            billing_day: (() => {
                const v = parseInt(billing_day, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return 15;
            })(),
            renewal_type: renewal_type || 'renewal',
            fix_date: renewal_type === 'fix_date' ? (() => {
                const v = parseInt(fix_date, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return 15;
            })() : null,
            static_ip: static_ip || null,
            assigned_ip: assigned_ip || null,
            mac_address: mac_address || null,
            latitude: latitude !== undefined && latitude !== '' ? parseFloat(latitude) : undefined,
            longitude: longitude !== undefined && longitude !== '' ? parseFloat(longitude) : undefined,
            // Cable connection data
            cable_type: cable_type || null,
            cable_length: cable_length ? parseInt(cable_length) : null,
            port_number: port_number ? parseInt(port_number) : null,
            cable_status: cable_status || 'connected',
            cable_notes: cable_notes || null
        };
        
        // Handle photo uploads
        if (req.files) {
            if (req.files.ktp_photo && req.files.ktp_photo[0]) {
                // Get filename from multer
                const filename = req.files.ktp_photo[0].filename;
                // Ensure path starts with /img/
                const ktpPhotoPath = '/img/' + filename;
                customerData.ktp_photo_path = ktpPhotoPath;
                logger.info('Uploaded KTP photo for new customer:', ktpPhotoPath, 'Full path:', req.files.ktp_photo[0].path);
            }
            if (req.files.house_photo && req.files.house_photo[0]) {
                // Get filename from multer
                const filename = req.files.house_photo[0].filename;
                // Ensure path starts with /img/
                const housePhotoPath = '/img/' + filename;
                customerData.house_photo_path = housePhotoPath;
                logger.info('Uploaded house photo for new customer:', housePhotoPath, 'Full path:', req.files.house_photo[0].path);
            }
        }

        const result = await billingManager.createCustomer(customerData);
        // Map customer ke router jika dipilih
        // Handle khusus untuk mode RADIUS: router_id bisa berupa "RADIUS" (string)
        let mappedRouterId = null;
        try {
            if (router_id && router_id !== '' && router_id !== 'RADIUS') {
                // Mode API: router_id adalah integer ID router
                const db = require('../config/billing').db;
                mappedRouterId = parseInt(router_id);
                if (!isNaN(mappedRouterId)) {
                    await new Promise((resolve, reject) => {
                        db.run(`INSERT OR REPLACE INTO customer_router_map (customer_id, router_id) VALUES (?, ?)`, [result.id, mappedRouterId], (err) => err ? reject(err) : resolve());
                    });
                }
            } else if (router_id === 'RADIUS') {
                // Mode RADIUS: tidak perlu mapping ke router spesifik, semua menggunakan RADIUS database
                logger.info(`Customer ${result.id} menggunakan mode RADIUS - tidak perlu router mapping`);
            }
        } catch (e) {
            logger.warn('Gagal menyimpan mapping customer_router_map: ' + e.message);
        }

        // Optional: create PPPoE user (support both API and RADIUS mode)
        // Auto-create jika checkbox dicentang atau jika pppoe_username diisi
        let pppoeCreate = { attempted: false, created: false, message: '' };
        try {
            const shouldCreate = create_pppoe_user === 1 || create_pppoe_user === '1' || create_pppoe_user === true || create_pppoe_user === 'true';
            // Jika checkbox dicentang atau pppoe_username diisi, buat PPPoE user
            if ((shouldCreate || pppoe_username) && pppoe_username) {
                pppoeCreate.attempted = true;
                
                // Generate password jika tidak diberikan
                const passwordToUse = (pppoe_password && String(pppoe_password).trim())
                    ? String(pppoe_password).trim()
                    : (Math.random().toString(36).slice(-8) + Math.floor(Math.random()*10));

                const { addPPPoEUser, getUserAuthModeAsync } = require('../config/mikrotik');
                
                // Helper function untuk get router by ID
                const getRouterById = async (routerId) => {
                    try {
                        const db = require('../config/billing').db;
                        return new Promise((resolve, reject) => {
                            db.get('SELECT * FROM routers WHERE id = ?', [parseInt(routerId)], (err, row) => {
                                if (err) reject(err);
                                else resolve(row || null);
                            });
                        });
                    } catch (err) {
                        logger.warn(`Failed to get router by ID ${routerId}: ${err.message}`);
                        return null;
                    }
                };
                
                // Cek mode autentikasi untuk logging
                const authMode = await getUserAuthModeAsync();
                logger.info(`Creating PPPoE user ${pppoe_username} with profile ${profileToUse} (Mode: ${authMode})`);
                
                // Pass customer object dengan id untuk per-router connection di mode API
                // Di mode RADIUS, routerObj tidak diperlukan karena semua router pakai database yang sama
                // Handle router_id: jika "RADIUS", set routerObj ke null
                let routerObj = null;
                if (router_id && router_id !== '' && router_id !== 'RADIUS') {
                    routerObj = await getRouterById(router_id);
                }
                const addRes = await addPPPoEUser({ 
                    username: pppoe_username, 
                    password: passwordToUse, 
                    profile: profileToUse, 
                    customer: { id: result.id },
                    routerObj: routerObj
                });
                
                if (addRes && addRes.success) {
                    pppoeCreate.created = true;
                    pppoeCreate.message = `User PPPoE berhasil dibuat di ${authMode === 'radius' ? 'RADIUS' : 'Mikrotik'}`;
                    pppoeCreate.password = passwordToUse; // Return password untuk ditampilkan ke user
                    logger.info(`✅ PPPoE user ${pppoe_username} created successfully in ${authMode} mode`);
                } else {
                    pppoeCreate.created = false;
                    pppoeCreate.message = (addRes && addRes.message) ? addRes.message : 'Gagal membuat user PPPoE';
                    logger.error(`❌ Failed to create PPPoE user ${pppoe_username}: ${addRes?.message || 'Unknown error'}`);
                }
            }
        } catch (e) {
            logger.error('Gagal membuat user PPPoE (opsional): ' + e.message);
            pppoeCreate.created = false;
            pppoeCreate.message = e.message;
        }

        res.json({
            success: true,
            message: 'Pelanggan berhasil ditambahkan',
            customer: result,
            pppoeCreate
        });
    } catch (error) {
        logger.error('Error creating customer:', error);
        
        // Handle specific error messages dengan penjelasan yang jelas
        let errorMessage = 'Gagal menambahkan pelanggan';
        let statusCode = 500;
        let errorDetails = '';
        
        if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('customers.phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar';
                errorDetails = 'Nomor telepon yang Anda masukkan sudah digunakan oleh pelanggan lain. Silakan gunakan nomor telepon yang berbeda atau cek data pelanggan yang sudah ada.';
            } else if (error.message.includes('customers.username')) {
                errorMessage = 'Username sudah digunakan';
                errorDetails = 'Username yang Anda masukkan sudah digunakan oleh pelanggan lain. Silakan gunakan username yang berbeda.';
            } else if (error.message.includes('customers.customer_id')) {
                errorMessage = 'ID Pelanggan duplikat';
                errorDetails = 'Terjadi konflik ID Pelanggan. Silakan coba lagi atau hubungi administrator.';
            } else {
                errorMessage = 'Data duplikat terdeteksi';
                errorDetails = 'Data yang Anda masukkan sudah ada dalam sistem. Silakan cek kembali nomor telepon, username, atau data lainnya.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            if (error.message.includes('package_id')) {
                errorMessage = 'Paket tidak valid';
                errorDetails = 'Paket yang dipilih tidak ditemukan atau tidak aktif. Silakan pilih paket yang tersedia dari daftar paket.';
            } else if (error.message.includes('odp_id')) {
                errorMessage = 'ODP tidak valid';
                errorDetails = 'ODP (Optical Distribution Point) yang dipilih tidak ditemukan. Silakan pilih ODP yang tersedia atau kosongkan field ini.';
            } else {
                errorMessage = 'Data referensi tidak valid';
                errorDetails = 'Salah satu data referensi (paket, ODP, dll) tidak valid. Silakan cek kembali pilihan Anda.';
            }
            statusCode = 400;
        } else if (error.message.includes('NOT NULL constraint failed')) {
            if (error.message.includes('name')) {
                errorMessage = 'Nama pelanggan wajib diisi';
                errorDetails = 'Field nama pelanggan tidak boleh kosong. Silakan isi nama pelanggan.';
            } else if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon wajib diisi';
                errorDetails = 'Field nomor telepon tidak boleh kosong. Silakan isi nomor telepon pelanggan.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username wajib diisi';
                errorDetails = 'Field username tidak boleh kosong. Username akan otomatis terisi dari nama jika dikosongkan.';
            } else if (error.message.includes('package_id')) {
                errorMessage = 'Paket wajib dipilih';
                errorDetails = 'Anda harus memilih paket untuk pelanggan. Silakan pilih paket dari dropdown.';
            } else {
                errorMessage = 'Data wajib tidak lengkap';
                errorDetails = 'Beberapa field wajib tidak diisi. Silakan lengkapi semua field yang bertanda (*).';
            }
            statusCode = 400;
        } else if (error.message.includes('Failed to generate customer ID')) {
            errorMessage = 'Gagal membuat ID Pelanggan';
            errorDetails = 'Sistem tidak dapat membuat ID Pelanggan unik. Silakan coba lagi atau hubungi administrator.';
            statusCode = 500;
        } else if (error.message.includes('Database not initialized')) {
            errorMessage = 'Database tidak siap';
            errorDetails = 'Database belum siap digunakan. Silakan tunggu beberapa saat dan coba lagi, atau hubungi administrator.';
            statusCode = 500;
        } else {
            // Error umum - tampilkan pesan asli untuk debugging
            errorMessage = 'Terjadi kesalahan saat menambahkan pelanggan';
            errorDetails = error.message || 'Silakan cek kembali data yang Anda masukkan atau hubungi administrator jika masalah berlanjut.';
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            details: errorDetails,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get customer detail
router.get('/customers/:phone', getAppSettings, async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`Loading customer detail for phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        logger.info(`Customer found:`, customer);
        
        if (!customer) {
            logger.warn(`Customer not found for phone: ${phone}`);
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: req.appSettings
            });
        }

        // Get PPPoE password (from RADIUS or Mikrotik API)
        let pppoePassword = null;
        let authMode = null;
        try {
            const { getUserAuthModeAsync, getRadiusConnection, getMikrotikConnection } = require('../config/mikrotik');
            authMode = await getUserAuthModeAsync();
            const pppoeUsername = customer.pppoe_username || customer.username;
            
            if (pppoeUsername) {
                if (authMode === 'radius') {
                    // Get password from RADIUS database
                    const conn = await getRadiusConnection();
                    try {
                        const [rows] = await conn.execute(`
                            SELECT value as password 
                            FROM radcheck 
                            WHERE username = ? AND attribute = 'Cleartext-Password'
                            LIMIT 1
                        `, [pppoeUsername]);
                        await conn.end();
                        if (rows && rows.length > 0) {
                            pppoePassword = rows[0].password;
                        }
                    } catch (radiusError) {
                        logger.warn(`Failed to get password from RADIUS for ${pppoeUsername}: ${radiusError.message}`);
                        await conn.end();
                    }
                } else {
                    // Get password from Mikrotik API
                    try {
                        const conn = await getMikrotikConnection();
                        if (conn) {
                            const secrets = await conn.write('/ppp/secret/print', ['?name=' + pppoeUsername]);
                            if (secrets && secrets.length > 0) {
                                pppoePassword = secrets[0].password || null;
                            }
                        }
                    } catch (mikrotikError) {
                        logger.warn(`Failed to get password from Mikrotik for ${pppoeUsername}: ${mikrotikError.message}`);
                    }
                }
            }
        } catch (passwordError) {
            logger.warn(`Error getting PPPoE password: ${passwordError.message}`);
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        // Load trouble report history for this customer (by phone)
        let troubleReports = [];
        try {
            const { getTroubleReportsByPhone } = require('../config/troubleReport');
            troubleReports = getTroubleReportsByPhone(customer.phone || phone) || [];
        } catch (e) {
            logger.warn('Unable to load trouble reports for customer:', e.message);
        }
        
        logger.info(`Rendering customer detail page for: ${phone}`);
        
        // Try to render with minimal data first
        try {
            res.render('admin/billing/customer-detail', {
                title: 'Detail Pelanggan',
                customer,
                pppoePassword, // Pass password to view
                authMode, // Pass auth mode to view
                invoices: invoices || [],
                packages: packages || [],
                troubleReports,
                appSettings: req.appSettings
            });
        } catch (renderError) {
            logger.error('Error rendering customer detail page:', renderError);
            res.status(500).render('error', {
                message: 'Error rendering customer detail page',
                error: renderError.message,
                appSettings: req.appSettings
            });
        }
    } catch (error) {
        logger.error('Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API route for getting customer data (for editing)
router.get('/api/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        logger.info(`API: Loading customer data for editing phone: ${phone}`);
        
        const customer = await billingManager.getCustomerByPhone(phone);
        // Ambil router mapping
        let routerMapping = null;
        try {
            const db = require('../config/billing').db;
            routerMapping = await new Promise((resolve) => db.get(`SELECT router_id FROM customer_router_map WHERE customer_id = ?`, [customer?.id || -1], (err, row) => resolve(row || null)));
        } catch (_) {}
        
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        return res.json({
            success: true,
            customer: Object.assign({}, customer || {}, { router_id: routerMapping ? routerMapping.router_id : null }),
            message: 'Customer data loaded successfully'
        });
    } catch (error) {
        logger.error('API: Error loading customer data:', error);
        return res.status(500).json({
            success: false,
            message: 'Error loading customer data',
            error: error.message
        });
    }
});

// Debug route for customer detail
router.get('/customers/:username/debug', getAppSettings, async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Debug: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Debug: Customer found:`, customer);
        
        if (!customer) {
            return res.json({
                success: false,
                message: 'Customer not found',
                username: username
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        return res.json({
            success: true,
            customer: customer,
            invoices: invoices,
            packages: packages,
            message: 'Debug data loaded successfully'
        });
    } catch (error) {
        logger.error('Debug: Error loading customer detail:', error);
        return res.json({
            success: false,
            message: 'Error loading customer detail',
            error: error.message
        });
    }
});

// Test route with simple template (no auth for debugging)
router.get('/customers/:username/test', async (req, res) => {
    try {
        const { username } = req.params;
        logger.info(`Test: Loading customer detail for username: ${username}`);
        
        const customer = await billingManager.getCustomerByUsername(username);
        logger.info(`Test: Customer found:`, customer);
        
        if (!customer) {
            return res.status(404).render('error', {
                message: 'Pelanggan tidak ditemukan',
                error: 'Customer not found',
                appSettings: {}
            });
        }

        const invoices = await billingManager.getInvoicesByCustomer(customer.id);
        const packages = await billingManager.getPackages();
        
        logger.info(`Test: Rendering simple template for: ${username}`);
        res.render('admin/billing/customer-detail-test', {
            title: 'Detail Pelanggan - Test',
            customer,
            invoices: invoices || [],
            packages: packages || [],
            appSettings: {}
        });
    } catch (error) {
        logger.error('Test: Error loading customer detail:', error);
        res.status(500).render('error', {
            message: 'Error loading customer detail',
            error: error.message,
            appSettings: {}
        });
    }
});

router.put('/customers/:phone', customerPhotoUpload.fields([
    { name: 'ktp_photo', maxCount: 1 },
    { name: 'house_photo', maxCount: 1 }
]), async (req, res) => {
    try {
        const { phone } = req.params;
        
        // Debug: Log request body to see what we're receiving
        logger.debug('PUT /customers/:phone - Request body:', JSON.stringify(req.body));
        logger.debug('PUT /customers/:phone - Request files:', req.files ? Object.keys(req.files) : 'No files');
        
        // Extract form data from req.body (multer puts form fields here)
        const name = req.body.name;
        const username = req.body.username;
        const package_id = req.body.package_id;
        const pppoe_username = req.body.pppoe_username;
        const email = req.body.email;
        const address = req.body.address;
        const odp_id = req.body.odp_id;
        const pppoe_profile = req.body.pppoe_profile;
        const status = req.body.status;
        const auto_suspension = req.body.auto_suspension;
        const billing_day = req.body.billing_day;
        const renewal_type = req.body.renewal_type;
        const fix_date = req.body.fix_date;
        const latitude = req.body.latitude;
        const longitude = req.body.longitude;
        const static_ip = req.body.static_ip;
        const assigned_ip = req.body.assigned_ip;
        const mac_address = req.body.mac_address;
        const cable_type = req.body.cable_type;
        const cable_length = req.body.cable_length;
        const port_number = req.body.port_number;
        const cable_status = req.body.cable_status;
        const cable_notes = req.body.cable_notes;
        const router_id = req.body.router_id;
        
        // Validate required fields - check for empty strings too
        if (!name || name.trim() === '' || !username || username.trim() === '' || !package_id || package_id.toString().trim() === '') {
            logger.warn('PUT /customers/:phone - Validation failed:', { 
                name: name || 'MISSING', 
                username: username || 'MISSING', 
                package_id: package_id || 'MISSING',
                bodyKeys: Object.keys(req.body),
                bodyValues: {
                    name: req.body.name,
                    username: req.body.username,
                    package_id: req.body.package_id
                }
            });
            return res.status(400).json({
                success: false,
                message: 'Nama, username, dan paket harus diisi'
            });
        }
        
        // Validate username format
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username hanya boleh berisi huruf kecil, angka, dan underscore'
            });
        }
        
        // Get current customer data
        const currentCustomer = await billingManager.getCustomerByPhone(phone);
        if (!currentCustomer) {
            return res.status(404).json({
                success: false,
                message: 'Pelanggan tidak ditemukan'
            });
        }

        // Get package to get default profile if not specified
        let profileToUse = pppoe_profile;
        if (!profileToUse && package_id) {
            const packageData = await billingManager.getPackageById(package_id);
            profileToUse = packageData?.pppoe_profile || 'default';
        } else if (!profileToUse) {
            profileToUse = currentCustomer.pppoe_profile || 'default';
        }

        // Extract new phone from request body, fallback to current if not provided
        const newPhone = req.body.phone || currentCustomer.phone;
        
        const customerData = {
            name: name,
            username: username,
            phone: newPhone,
            pppoe_username: pppoe_username || currentCustomer.pppoe_username,
            email: email || currentCustomer.email,
            address: address || currentCustomer.address,
            package_id: package_id,
            odp_id: odp_id !== undefined ? odp_id : currentCustomer.odp_id,
            pppoe_profile: profileToUse,
            status: status || currentCustomer.status,
            auto_suspension: auto_suspension !== undefined ? parseInt(auto_suspension) : currentCustomer.auto_suspension,
            billing_day: (function(){
                const v = parseInt(billing_day, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return currentCustomer.billing_day ?? 1;
            })(),
            renewal_type: renewal_type !== undefined ? renewal_type : (currentCustomer.renewal_type || 'renewal'),
            fix_date: renewal_type === 'fix_date' ? (function(){
                const v = parseInt(fix_date, 10);
                if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                return currentCustomer.fix_date ?? 15;
            })() : (renewal_type === undefined && currentCustomer.renewal_type === 'fix_date' ? currentCustomer.fix_date : null),
            latitude: latitude !== undefined ? parseFloat(latitude) : currentCustomer.latitude,
            longitude: longitude !== undefined ? parseFloat(longitude) : currentCustomer.longitude,
            static_ip: static_ip !== undefined ? static_ip : currentCustomer.static_ip,
            assigned_ip: assigned_ip !== undefined ? assigned_ip : currentCustomer.assigned_ip,
            mac_address: mac_address !== undefined ? mac_address : currentCustomer.mac_address,
            // Cable connection data
            cable_type: cable_type !== undefined ? cable_type : currentCustomer.cable_type,
            cable_length: cable_length !== undefined ? parseInt(cable_length) : currentCustomer.cable_length,
            port_number: port_number !== undefined ? parseInt(port_number) : currentCustomer.port_number,
            cable_status: cable_status !== undefined ? cable_status : currentCustomer.cable_status,
            cable_notes: cable_notes !== undefined ? cable_notes : currentCustomer.cable_notes
        };
        
        // Handle photo uploads - only update if new files are uploaded
        if (req.files) {
            if (req.files.ktp_photo && req.files.ktp_photo[0]) {
                // Delete old photo if exists
                if (currentCustomer.ktp_photo_path) {
                    try {
                        const oldPhotoPath = path.join(__dirname, '../public', currentCustomer.ktp_photo_path);
                        if (fs.existsSync(oldPhotoPath)) {
                            fs.unlinkSync(oldPhotoPath);
                            logger.info('Deleted old KTP photo:', oldPhotoPath);
                        }
                    } catch (e) {
                        logger.warn('Failed to delete old KTP photo: ' + e.message);
                    }
                }
                // Get filename from multer
                const filename = req.files.ktp_photo[0].filename;
                // Ensure path starts with /img/
                const ktpPhotoPath = '/img/' + filename;
                customerData.ktp_photo_path = ktpPhotoPath;
                logger.info('Uploaded new KTP photo:', ktpPhotoPath, 'Full path:', req.files.ktp_photo[0].path);
            }
            if (req.files.house_photo && req.files.house_photo[0]) {
                // Delete old photo if exists
                if (currentCustomer.house_photo_path) {
                    try {
                        const oldPhotoPath = path.join(__dirname, '../public', currentCustomer.house_photo_path);
                        if (fs.existsSync(oldPhotoPath)) {
                            fs.unlinkSync(oldPhotoPath);
                            logger.info('Deleted old house photo:', oldPhotoPath);
                        }
                    } catch (e) {
                        logger.warn('Failed to delete old house photo: ' + e.message);
                    }
                }
                // Get filename from multer
                const filename = req.files.house_photo[0].filename;
                // Ensure path starts with /img/
                const housePhotoPath = '/img/' + filename;
                customerData.house_photo_path = housePhotoPath;
                logger.info('Uploaded new house photo:', housePhotoPath, 'Full path:', req.files.house_photo[0].path);
            }
        }
        
        // PENTING: Cek perubahan status sebelum update
        const oldStatus = currentCustomer.status;
        const newStatus = status || currentCustomer.status;
        const statusChanged = newStatus !== oldStatus;
        
        // Use current phone for lookup, allow phone to be updated in customerData
        const result = await billingManager.updateCustomerByPhone(phone, customerData);

        // PENTING: Jika status berubah, sync ke RADIUS/Mikrotik
        if (statusChanged && customerData.pppoe_username) {
            try {
                const serviceSuspension = require('../config/serviceSuspension');
                const updatedCustomer = await billingManager.getCustomerByPhone(customerData.phone || phone);
                
                if (newStatus === 'suspended' && oldStatus !== 'suspended') {
                    // Status berubah ke suspended -> isolir
                    logger.info(`[BILLING] Status changed to suspended for ${updatedCustomer.username}, calling suspendCustomerService...`);
                    await serviceSuspension.suspendCustomerService(updatedCustomer, 'Status changed to suspended via admin panel');
                    logger.info(`[BILLING] Successfully suspended customer ${updatedCustomer.username}`);
                } else if (newStatus === 'active' && oldStatus === 'suspended') {
                    // Status berubah dari suspended ke active -> restore
                    logger.info(`[BILLING] Status changed from suspended to active for ${updatedCustomer.username}, calling restoreCustomerService...`);
                    await serviceSuspension.restoreCustomerService(updatedCustomer, 'Status changed to active via admin panel');
                    logger.info(`[BILLING] Successfully restored customer ${updatedCustomer.username}`);
                }
            } catch (statusSyncError) {
                logger.error(`[BILLING] Failed to sync status change for ${customerData.username}:`, statusSyncError.message);
                // Jangan gagalkan update customer jika error sync status
            }
        }

        // Update NAS mapping jika router_id diberikan
        try {
            if (router_id) {
                const db = require('../config/billing').db;
                const customerAfter = await billingManager.getCustomerByPhone(customerData.phone);
                if (customerAfter && customerAfter.id) {
                    await new Promise((resolve, reject) => {
                        db.run(`INSERT OR REPLACE INTO customer_router_map (customer_id, router_id) VALUES (?, ?)`, [customerAfter.id, parseInt(router_id)], (err) => err ? reject(err) : resolve());
                    });
                }
            }
        } catch (e) {
            logger.warn('Gagal update mapping customer_router_map: ' + e.message);
        }

        // Optional: create or update PPPoE user (support both API and RADIUS mode)
        // Auto-create jika checkbox dicentang atau jika pppoe_username baru/diubah
        let pppoeCreate = { attempted: false, created: false, updated: false, message: '' };
        try {
            const shouldCreate = req.body.create_pppoe_user === 1 || req.body.create_pppoe_user === '1' || req.body.create_pppoe_user === true || req.body.create_pppoe_user === 'true';
            const newPPPoEUsername = pppoe_username || currentCustomer.pppoe_username;
            const pppoePassword = req.body.pppoe_password || null;
            
            // Helper function untuk get router by ID
            const getRouterById = async (routerId) => {
                try {
                    const db = require('../config/billing').db;
                    return new Promise((resolve, reject) => {
                        db.get('SELECT * FROM routers WHERE id = ?', [parseInt(routerId)], (err, row) => {
                            if (err) reject(err);
                            else resolve(row || null);
                        });
                    });
                } catch (err) {
                    logger.warn(`Failed to get router by ID ${routerId}: ${err.message}`);
                    return null;
                }
            };
            
            // Jika checkbox dicentang atau pppoe_username baru/diubah, buat/update PPPoE user
            if ((shouldCreate || (newPPPoEUsername && newPPPoEUsername !== currentCustomer.pppoe_username)) && newPPPoEUsername) {
                pppoeCreate.attempted = true;
                
                // Generate password jika tidak diberikan
                const passwordToUse = (pppoePassword && String(pppoePassword).trim())
                    ? String(pppoePassword).trim()
                    : (Math.random().toString(36).slice(-8) + Math.floor(Math.random()*10));

                const { addPPPoEUser, editPPPoEUser, getUserAuthModeAsync, getPPPoEUsers } = require('../config/mikrotik');
                
                // Cek mode autentikasi untuk logging
                const authMode = await getUserAuthModeAsync();
                logger.info(`Creating/updating PPPoE user ${newPPPoEUsername} with profile ${profileToUse} (Mode: ${authMode})`);
                
                // Cek apakah user sudah ada di RADIUS atau Mikrotik
                const existingUsers = await getPPPoEUsers();
                const userExists = existingUsers.some(u => u.name === newPPPoEUsername || u.username === newPPPoEUsername);
                
                let addRes;
                const updatedCustomer = await billingManager.getCustomerByPhone(customerData.phone || phone);
                const customerId = updatedCustomer ? updatedCustomer.id : result.id;
                
                if (userExists && currentCustomer.pppoe_username === newPPPoEUsername) {
                    // Update existing user (password atau profile)
                    if (authMode === 'radius') {
                        const { editPPPoEUserRadius } = require('../config/mikrotik');
                        addRes = await editPPPoEUserRadius({ 
                            username: newPPPoEUsername, 
                            password: passwordToUse, 
                            profile: profileToUse 
                        });
                    } else {
                        // Mode Mikrotik: cari ID user dulu
                        const existingUser = existingUsers.find(u => (u.name === newPPPoEUsername || u.username === newPPPoEUsername));
                        if (existingUser && existingUser.id) {
                            addRes = await editPPPoEUser({ 
                                id: existingUser.id, 
                                username: newPPPoEUsername, 
                                password: passwordToUse, 
                                profile: profileToUse 
                            });
                        } else {
                            // Fallback: create new jika tidak ketemu ID
                            // Handle router_id: jika "RADIUS", set routerObj ke null
                            let routerObj = null;
                            if (router_id && router_id !== '' && router_id !== 'RADIUS') {
                                routerObj = await getRouterById(router_id);
                            }
                            addRes = await addPPPoEUser({ 
                                username: newPPPoEUsername, 
                                password: passwordToUse, 
                                profile: profileToUse, 
                                customer: { id: customerId },
                                routerObj: routerObj
                            });
                        }
                    }
                    pppoeCreate.updated = true;
                } else {
                    // Create new user
                    // Handle router_id: jika "RADIUS", set routerObj ke null
                    let routerObj = null;
                    if (router_id && router_id !== '' && router_id !== 'RADIUS') {
                        routerObj = await getRouterById(router_id);
                    }
                    addRes = await addPPPoEUser({ 
                        username: newPPPoEUsername, 
                        password: passwordToUse, 
                        profile: profileToUse, 
                        customer: { id: customerId },
                        routerObj: routerObj
                    });
                }
                
                if (addRes && addRes.success) {
                    pppoeCreate.created = true;
                    pppoeCreate.message = `User PPPoE berhasil ${pppoeCreate.updated ? 'diupdate' : 'dibuat'} di ${authMode === 'radius' ? 'RADIUS' : 'Mikrotik'}`;
                    pppoeCreate.password = passwordToUse; // Return password untuk ditampilkan ke user
                    logger.info(`✅ PPPoE user ${newPPPoEUsername} ${pppoeCreate.updated ? 'updated' : 'created'} successfully in ${authMode} mode`);
                } else {
                    pppoeCreate.created = false;
                    pppoeCreate.message = (addRes && addRes.message) ? addRes.message : 'Gagal membuat/update user PPPoE';
                    logger.error(`❌ Failed to create/update PPPoE user ${newPPPoEUsername}: ${addRes?.message || 'Unknown error'}`);
                }
            }
        } catch (e) {
            logger.error('Gagal membuat/update user PPPoE (opsional): ' + e.message);
            pppoeCreate.created = false;
            pppoeCreate.message = e.message;
        }
        
        // Jika update berhasil dan customer memiliki PPPoE, update profil di Mikrotik (untuk perubahan package)
        if (result && customerData.pppoe_username) {
            try {
                // Cek apakah paket benar-benar berubah
                const updatedCustomer = await billingManager.getCustomerByPhone(customerData.phone || phone);
                if (updatedCustomer && updatedCustomer.package_id !== currentCustomer.package_id) {
                    logger.info(`[BILLING] Package changed for ${updatedCustomer.username}, updating PPPoE profile...`);
                    await serviceSuspension.restoreCustomerService(updatedCustomer, 'Package changed');
                    logger.info(`[BILLING] PPPoE profile updated successfully for ${updatedCustomer.username}`);
                }
            } catch (mikrotikError) {
                logger.error(`[BILLING] Failed to update PPPoE profile for ${customerData.username}:`, mikrotikError.message);
                // Jangan gagal kan update customer jika error
            }
        }

        res.json({
            success: true,
            message: 'Pelanggan berhasil diupdate',
            customer: result,
            pppoeCreate
        });
    } catch (error) {
        logger.error('Error updating customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal mengupdate pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Pelanggan tidak ditemukan')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('UNIQUE constraint failed')) {
            if (error.message.includes('phone')) {
                errorMessage = 'Nomor telepon sudah terdaftar. Silakan gunakan nomor telepon yang berbeda.';
            } else if (error.message.includes('username')) {
                errorMessage = 'Username sudah digunakan. Silakan coba lagi.';
            } else {
                errorMessage = 'Data sudah ada dalam sistem. Silakan cek kembali.';
            }
            statusCode = 400;
        } else if (error.message.includes('FOREIGN KEY constraint failed')) {
            errorMessage = 'Paket yang dipilih tidak valid. Silakan pilih paket yang tersedia.';
            statusCode = 400;
        } else if (error.message.includes('not null constraint')) {
            errorMessage = 'Data wajib tidak boleh kosong. Silakan lengkapi semua field yang diperlukan.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Accept customer (generate PPPoE and send notifications)
router.post('/customers/:phone/accept', async (req, res) => {
    try {
        const { phone } = req.params;
        
        // Get customer
        const customer = await billingManager.getCustomerByPhone(phone);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Pelanggan tidak ditemukan'
            });
        }
        
        // Check if customer status is 'register'
        if (customer.status !== 'register') {
            return res.status(400).json({
                success: false,
                message: `Pelanggan ini sudah di-accept sebelumnya. Status saat ini: ${customer.status}`
            });
        }
        
        // Get package info
        const packageData = await billingManager.getPackageById(customer.package_id);
        if (!packageData) {
            return res.status(400).json({
                success: false,
                message: 'Paket pelanggan tidak ditemukan'
            });
        }
        
        // Generate PPPoE username if not exists
        let pppoeUsername = customer.pppoe_username;
        if (!pppoeUsername || pppoeUsername.trim() === '') {
            pppoeUsername = billingManager.generatePPPoEUsername(customer.phone);
        }
        
        // Generate PPPoE password
        const pppoePassword = Math.random().toString(36).slice(-8) + Math.floor(Math.random() * 10);
        
        // Get profile from package or use default
        const pppoeProfile = customer.pppoe_profile || packageData.pppoe_profile || 'default';
        
        // Create PPPoE user
        const { addPPPoEUser, getUserAuthModeAsync } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        logger.info(`Accepting customer ${customer.name} - Creating PPPoE user ${pppoeUsername} (Mode: ${authMode})`);
        
        let pppoeCreated = false;
        try {
            // Get router if customer has router mapping
            let routerObj = null;
            try {
                const { getRouterForCustomer } = require('../config/mikrotik');
                routerObj = await getRouterForCustomer(customer);
            } catch (routerError) {
                logger.warn(`Customer ${customer.name} tidak punya router mapping, akan menggunakan router default`);
            }
            
            const pppoeResult = await addPPPoEUser({
                username: pppoeUsername,
                password: pppoePassword,
                profile: pppoeProfile,
                customer: customer,
                routerObj: routerObj
            });
            
            if (pppoeResult && pppoeResult.success) {
                pppoeCreated = true;
                logger.info(`PPPoE user ${pppoeUsername} created successfully`);
            } else {
                logger.warn(`Failed to create PPPoE user: ${pppoeResult?.message || 'Unknown error'}`);
            }
        } catch (pppoeError) {
            logger.error(`Error creating PPPoE user: ${pppoeError.message}`);
            // Continue even if PPPoE creation fails
        }
        
        // Update customer: set status to 'active' and save PPPoE username
        // Note: pppoe_password tidak disimpan di database, hanya di RADIUS/Mikrotik
        const updateData = {
            status: 'active',
            pppoe_username: pppoeUsername
        };
        
        await billingManager.updateCustomerByPhone(phone, updateData);
        
        // Get updated customer with package info
        const updatedCustomer = await billingManager.getCustomerByPhone(phone);
        updatedCustomer.package_name = packageData.name;
        updatedCustomer.package_speed = packageData.speed || 'N/A';
        updatedCustomer.pppoe_password = pppoePassword; // Include password for notifications
        
        // Send Welcome Message via WhatsApp
        let waSent = false;
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            const waResult = await whatsappNotifications.sendWelcomeMessage(updatedCustomer);
            if (waResult && waResult.success) {
                waSent = true;
                logger.info(`Welcome message sent via WhatsApp to ${updatedCustomer.name}`);
            }
        } catch (waError) {
            logger.error('Error sending WhatsApp welcome message:', waError);
        }
        
        // Send Welcome Message via Email
        let emailSent = false;
        try {
            const emailNotifications = require('../config/email-notifications');
            const emailResult = await emailNotifications.sendWelcomeMessage(updatedCustomer);
            if (emailResult && emailResult.success) {
                emailSent = true;
                logger.info(`Welcome message sent via Email to ${updatedCustomer.name}`);
            }
        } catch (emailError) {
            logger.error('Error sending Email welcome message:', emailError);
        }
        
        // Send notification to technicians (Sales Order)
        let techNotifSent = false;
        try {
            const { sendSalesOrderNotification } = require('../config/whatsapp-notifications');
            const techResult = await sendSalesOrderNotification(updatedCustomer);
            if (techResult && techResult.success) {
                techNotifSent = true;
                logger.info(`Sales Order notification sent to technicians for ${updatedCustomer.name}`);
            }
        } catch (techError) {
            logger.error('Error sending Sales Order notification to technicians:', techError);
        }
        
        // Build success message
        let message = 'Pelanggan berhasil di-accept!';
        const details = [];
        if (pppoeCreated) {
            details.push(`PPPoE User: ${pppoeUsername}`);
        }
        if (waSent) {
            details.push('Welcome Message (WA) terkirim');
        }
        if (emailSent) {
            details.push('Welcome Message (Email) terkirim');
        }
        if (techNotifSent) {
            details.push('Notifikasi ke teknisi terkirim');
        }
        
        if (details.length > 0) {
            message += '\n\n' + details.join('\n');
        }
        
        res.json({
            success: true,
            message: message,
            customer: {
                id: updatedCustomer.id,
                name: updatedCustomer.name,
                phone: updatedCustomer.phone,
                pppoe_username: pppoeUsername,
                status: 'active'
            },
            notifications: {
                whatsapp: waSent,
                email: emailSent,
                technician: techNotifSent
            }
        });
    } catch (error) {
        logger.error('Error accepting customer:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal accept pelanggan: ' + error.message
        });
    }
});

// Delete customer
router.delete('/customers/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        
        const deletedCustomer = await billingManager.deleteCustomer(phone);
        logger.info(`Customer deleted: ${phone}`);
        
        res.json({
            success: true,
            message: 'Pelanggan berhasil dihapus',
            customer: deletedCustomer
        });
    } catch (error) {
        logger.error('Error deleting customer:', error);
        
        // Handle specific error messages
        let errorMessage = 'Gagal menghapus pelanggan';
        let statusCode = 500;
        
        if (error.message.includes('Customer not found')) {
            errorMessage = 'Pelanggan tidak ditemukan';
            statusCode = 404;
        } else if (error.message.includes('invoice(s) still exist')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki tagihan. Silakan hapus semua tagihan terlebih dahulu.';
            statusCode = 400;
        } else if (error.message.includes('foreign key constraint')) {
            errorMessage = 'Tidak dapat menghapus pelanggan karena masih memiliki data terkait. Silakan hapus data terkait terlebih dahulu.';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Invoice Management
router.get('/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        res.render('admin/billing/invoices', {
            title: 'Kelola Tagihan',
            invoices,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoices:', error);
        res.status(500).render('error', { 
            message: 'Error loading invoices',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/invoices', async (req, res) => {
    try {
        const { customer_id, package_id, amount, due_date, notes, base_amount, tax_rate } = req.body;
        const safeNotes = (notes || '').toString().trim();
        const invoiceData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: safeNotes
        };
        
        // Add PPN data if available
        if (base_amount !== undefined && tax_rate !== undefined) {
            invoiceData.base_amount = parseFloat(base_amount);
            invoiceData.tax_rate = parseFloat(tax_rate);
        }

        if (!invoiceData.customer_id || !invoiceData.package_id || !invoiceData.amount || !invoiceData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const newInvoice = await billingManager.createInvoice(invoiceData);
        logger.info(`Invoice created: ${newInvoice.invoice_number}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendInvoiceCreatedNotification(invoiceData.customer_id, newInvoice.id);
        } catch (notificationError) {
            logger.error('Error sending invoice notification:', notificationError);
            // Don't fail the invoice creation if notification fails
        }
        
        // Send Email notification
        try {
            const emailNotifications = require('../config/email-notifications');
            await emailNotifications.sendInvoiceCreatedNotification(invoiceData.customer_id, newInvoice.id);
        } catch (notificationError) {
            logger.error('Error sending email invoice notification:', notificationError);
            // Don't fail the invoice creation if notification fails
        }
        
        res.json({
            success: true,
            message: 'Tagihan berhasil dibuat',
            invoice: newInvoice
        });
    } catch (error) {
        logger.error('Error creating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating invoice',
            error: error.message
        });
    }
});

router.put('/invoices/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, payment_method } = req.body;

        const updatedInvoice = await billingManager.updateInvoiceStatus(id, status, payment_method);
        logger.info(`Invoice status updated: ${id} to ${status}`);
        
        res.json({
            success: true,
            message: 'Status tagihan berhasil diupdate',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice status',
            error: error.message
        });
    }
});

// View individual invoice
router.get('/invoices/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-detail', {
            title: 'Detail Invoice',
            invoice,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice detail:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice detail',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Print invoice
router.get('/invoices/:id/print', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-print', {
            title: 'Cetak Invoice',
            invoice,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice print:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice print',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Edit invoice
router.get('/invoices/:id/edit', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        const customers = await billingManager.getCustomers();
        const packages = await billingManager.getPackages();
        
        if (!invoice) {
            return res.status(404).render('error', {
                message: 'Invoice tidak ditemukan',
                error: 'Invoice with ID ' + id + ' not found',
                appSettings: req.appSettings
            });
        }
        
        res.render('admin/billing/invoice-edit', {
            title: 'Edit Invoice',
            invoice,
            customers,
            packages,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading invoice edit:', error);
        res.status(500).render('error', {
            message: 'Error loading invoice edit',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update invoice
router.put('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { customer_id, package_id, amount, due_date, notes } = req.body;
        
        const updateData = {
            customer_id: parseInt(customer_id),
            package_id: parseInt(package_id),
            amount: parseFloat(amount),
            due_date: due_date,
            notes: notes ? notes.trim() : ''
        };

        if (!updateData.customer_id || !updateData.package_id || !updateData.amount || !updateData.due_date) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        const updatedInvoice = await billingManager.updateInvoice(id, updateData);
        logger.info(`Invoice updated: ${updatedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil diperbarui',
            invoice: updatedInvoice
        });
    } catch (error) {
        logger.error('Error updating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating invoice',
            error: error.message
        });
    }
});

// API untuk cleanup orphan voucher invoices
router.post('/api/cleanup-orphan-voucher-invoices', adminAuth, async (req, res) => {
    try {
        const { getVoucherInvoices, checkVoucherExists, deleteInvoice } = require('../scripts/cleanup_orphan_voucher_invoices');
        
        const invoices = await getVoucherInvoices();
        const orphanInvoices = [];
        
        for (const invoice of invoices) {
            const match = invoice.notes.match(/Voucher Hotspot\s+(\S+)/i);
            if (!match || !match[1]) {
                orphanInvoices.push({ invoice, reason: 'Invalid notes format' });
                continue;
            }
            
            const username = match[1];
            const exists = await checkVoucherExists(username);
            
            if (!exists) {
                orphanInvoices.push({ invoice, username, reason: 'Voucher not found in RADIUS' });
            }
        }
        
        if (orphanInvoices.length === 0) {
            return res.json({
                success: true,
                message: 'Tidak ada invoice yang perlu dihapus',
                deleted: 0
            });
        }
        
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        
        for (const { invoice, username } of orphanInvoices) {
            try {
                await deleteInvoice(invoice.id);
                successCount++;
            } catch (error) {
                errorCount++;
                errors.push({ invoice_number: invoice.invoice_number, error: error.message });
            }
        }
        
        return res.json({
            success: true,
            message: `Berhasil menghapus ${successCount} invoice`,
            deleted: successCount,
            failed: errorCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        logger.error('Error cleaning up orphan voucher invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal membersihkan invoice voucher',
            error: error.message
        });
    }
});

// Delete invoice
router.delete('/invoices/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const deletedInvoice = await billingManager.deleteInvoice(id);
        logger.info(`Invoice deleted: ${deletedInvoice.invoice_number}`);
        
        res.json({
            success: true,
            message: 'Invoice berhasil dihapus',
            invoice: deletedInvoice
        });
    } catch (error) {
        logger.error('Error deleting invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting invoice',
            error: error.message
        });
    }
});

// Bulk delete invoices
router.post('/invoices/bulk-delete', adminAuth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar ID tagihan kosong atau tidak valid' });
        }

        const results = [];
        let success = 0;
        let failed = 0;

        for (const rawId of ids) {
            try {
                const id = parseInt(rawId, 10);
                if (!Number.isFinite(id)) throw new Error('ID tidak valid');
                const deletedInvoice = await billingManager.deleteInvoice(id);
                results.push({ id, success: true, invoice_number: deletedInvoice?.invoice_number });
                success++;
            } catch (e) {
                results.push({ id: rawId, success: false, message: e.message });
                failed++;
            }
        }

        return res.json({ success: true, summary: { success, failed, total: ids.length }, results });
    } catch (error) {
        logger.error('Error bulk deleting invoices:', error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan hapus massal tagihan', error: error.message });
    }
});

// Payment Management - Collector Transactions Only
router.get('/payments', getAppSettings, async (req, res) => {
    try {
        // Get filter parameters
        const filters = {
            from: req.query.from || '',
            to: req.query.to || '',
            collector_id: req.query.collector_id || '',
            status: req.query.status || '',
            q: req.query.q || ''
        };
        
        // Get payments with filters
        const payments = await billingManager.getCollectorPaymentsWithFilters(filters);
        
        // Get collectors list for dropdown
        const collectors = await billingManager.getAllCollectors();
        
        res.render('admin/billing/payments', {
            title: 'Transaksi Kolektor',
            payments,
            collectors,
            filters,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// All Payments - Admin and Collector
router.get('/all-payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        res.render('admin/billing/payments', {
            title: 'Riwayat Pembayaran',
            payments,
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading all payments:', error);
        res.status(500).render('error', { 
            message: 'Error loading all payments',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

router.post('/payments', async (req, res) => {
    try {
        const { invoice_id, amount, payment_method, reference_number, notes } = req.body;
        
        // Validate required fields first
        if (!invoice_id || !amount || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Invoice ID, jumlah, dan metode pembayaran harus diisi'
            });
        }
        
        const paymentData = {
            invoice_id: parseInt(invoice_id),
            amount: parseFloat(amount),
            payment_method: payment_method.trim(),
            reference_number: reference_number ? reference_number.trim() : '',
            notes: notes ? notes.trim() : ''
        };

        const newPayment = await billingManager.recordPayment(paymentData);
        
        // Update invoice status to paid
        await billingManager.updateInvoiceStatus(paymentData.invoice_id, 'paid', paymentData.payment_method);
        
        logger.info(`Payment recorded: ${newPayment.id}`);
        
        // Send WhatsApp notification
        try {
            const whatsappNotifications = require('../config/whatsapp-notifications');
            await whatsappNotifications.sendPaymentReceivedNotification(newPayment.id);
        } catch (notificationError) {
            logger.error('Error sending payment notification:', notificationError);
            // Don't fail the payment recording if notification fails
        }
        
        // Send Email notification
        try {
            const emailNotifications = require('../config/email-notifications');
            await emailNotifications.sendPaymentReceivedNotification(newPayment.id);
        } catch (notificationError) {
            logger.error('Error sending email payment notification:', notificationError);
            // Don't fail the payment recording if notification fails
        }
        
        // Attempt immediate restore if eligible
        try {
            const paidInvoice = await billingManager.getInvoiceById(paymentData.invoice_id);
            if (paidInvoice && paidInvoice.customer_id) {
                const customer = await billingManager.getCustomerById(paidInvoice.customer_id);
                if (customer && customer.status === 'suspended') {
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaid = invoices.filter(i => i.status === 'unpaid');
                    if (unpaid.length === 0) {
                        await serviceSuspension.restoreCustomerService(customer);
                    }
                }
            }
        } catch (restoreErr) {
            logger.error('Immediate restore check failed:', restoreErr);
        }
        
        res.json({
            success: true,
            message: 'Pembayaran berhasil dicatat',
            payment: newPayment
        });
    } catch (error) {
        logger.error('Error recording payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording payment',
            error: error.message
        });
    }
});

// Export customers to CSV
router.get('/export/customers', getAppSettings, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        
        // Create CSV content
        let csvContent = 'ID,Username,Nama,Phone,Email,Address,Package,Status,Payment Status,Created At\n';
        
        customers.forEach(customer => {
            const row = [
                customer.id,
                customer.username,
                customer.name,
                customer.phone,
                customer.email || '',
                customer.address || '',
                customer.package_name || '',
                customer.status,
                customer.payment_status,
                new Date(customer.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers',
            error: error.message
        });
    }
});

// Export invoices to CSV
router.get('/export/invoices', getAppSettings, async (req, res) => {
    try {
        const invoices = await billingManager.getInvoices();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Status,Due Date,Created At\n';
        
        invoices.forEach(invoice => {
            const row = [
                invoice.id,
                invoice.invoice_number,
                invoice.customer_name,
                invoice.amount,
                invoice.status,
                new Date(invoice.due_date).toLocaleDateString('id-ID'),
                new Date(invoice.created_at).toLocaleDateString('id-ID')
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting invoices',
            error: error.message
        });
    }
});

// Export payments to CSV
router.get('/export/payments', getAppSettings, async (req, res) => {
    try {
        const payments = await billingManager.getPayments();
        
        // Create CSV content
        let csvContent = 'ID,Invoice Number,Customer,Amount,Payment Method,Payment Date,Reference,Notes\n';
        
        payments.forEach(payment => {
            const row = [
                payment.id,
                payment.invoice_number,
                payment.customer_name,
                payment.amount,
                payment.payment_method,
                new Date(payment.payment_date).toLocaleDateString('id-ID'),
                payment.reference_number || '',
                payment.notes || ''
            ].map(field => `"${field}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
        res.send(csvContent);
        
    } catch (error) {
        logger.error('Error exporting payments:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting payments',
            error: error.message
        });
    }
});

// API Routes untuk AJAX
// Get package profiles for customer form
router.get('/api/packages', async (req, res) => {
    try {
        const packages = await billingManager.getPackages();
        res.json({
            success: true,
            packages: packages
        });
    } catch (error) {
        logger.error('Error getting packages API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});



// API endpoint untuk ODPs
router.get('/api/odps', adminAuth, async (req, res) => {
    try {
        const db = require('../config/billing').db;
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.id, o.name, o.code, o.capacity, o.used_ports, o.status, o.parent_odp_id,
                       o.latitude, o.longitude, o.address, o.notes,
                       p.name as parent_name
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                ORDER BY o.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({
            success: true,
            odps: odps
        });
    } catch (error) {
        logger.error('Error getting ODPs for mobile mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading ODPs data'
        });
    }
});

// Helper function untuk mendapatkan parameter value dari device
function getParameterValue(device, parameterName) {
    if (!device || !parameterName) return null;
    
    // Coba akses langsung
    if (device[parameterName] !== undefined) {
        return device[parameterName];
    }
    
    // Coba dengan path array
    const pathParts = parameterName.split('.');
    let current = device;
    
    for (const part of pathParts) {
        if (current && typeof current === 'object' && current[part] !== undefined) {
            current = current[part];
        } else {
            return null;
        }
    }
    
    // Jika current adalah object dengan _value property, return _value
    if (current && typeof current === 'object' && current._value !== undefined) {
        return current._value;
    }
    
    // Jika current adalah string/number, return langsung
    if (typeof current === 'string' || typeof current === 'number') {
        return current;
    }
    
    return current;
}

// API endpoint untuk mendapatkan PPPoE users dari Mikrotik
router.get('/api/pppoe-users', async (req, res) => {
    try {
        const { getPPPoEUsers } = require('../config/mikrotik');
        const pppoeUsers = await getPPPoEUsers();
        
        res.json({
            success: true,
            data: pppoeUsers.map(user => ({
                username: user.name,
                profile: user.profile,
                active: user.active || false
            }))
        });
    } catch (error) {
        console.error('Error fetching PPPoE users:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data PPPoE users',
            error: error.message
        });
    }
});

// API endpoint untuk devices
router.get('/api/devices', async (req, res) => {
    try {
        console.log('🔍 Loading devices from GenieACS...');
        const { getDevicesCached } = require('../config/genieacs');
        let devices = [];
        
        try {
            devices = await getDevicesCached();
            console.log(`📊 Found ${devices.length} devices from GenieACS`);
        } catch (genieacsError) {
            console.log('⚠️ GenieACS not available, creating fallback data...');
            // Create fallback data from customers
            const db = require('../config/billing').db;
            const customers = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT id, name, phone, pppoe_username, latitude, longitude 
                    FROM customers 
                    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                    LIMIT 10
                `, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            devices = customers.map((customer, index) => ({
                _id: `fallback_${customer.id}`,
                'Device.DeviceInfo.SerialNumber': `SIM${customer.id.toString().padStart(4, '0')}`,
                'Device.DeviceInfo.ModelName': 'Simulated ONU',
                'InternetGatewayDevice.DeviceInfo.UpTime': index % 2 === 0 ? '7 days' : null,
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID': `SSID_${customer.id}`,
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username': customer.pppoe_username,
                _lastInform: new Date().toISOString()
            }));
            
            console.log(`📊 Created ${devices.length} fallback devices from customers`);
        }
        
        // Process devices with customer information
        const processedDevices = [];
        
        for (const device of devices) {
            // Debug: log first device structure
            if (processedDevices.length === 0) {
                console.log('🔍 Sample device structure:', Object.keys(device));
                console.log('🔍 Sample device data:', JSON.stringify(device, null, 2).substring(0, 500) + '...');
                
                // Test parameter extraction
                console.log('🧪 Testing parameter extraction:');
                console.log('- Serial from ID:', device._id);
                console.log('- VirtualParameters.getSerialNumber:', getParameterValue(device, 'VirtualParameters.getSerialNumber'));
                console.log('- DeviceID.SerialNumber:', getParameterValue(device, 'DeviceID.SerialNumber'));
                console.log('- DeviceID.ProductClass:', getParameterValue(device, 'DeviceID.ProductClass'));
                console.log('- DeviceID.Manufacturer:', getParameterValue(device, 'DeviceID.Manufacturer'));
                console.log('- VirtualParameters.getdeviceuptime:', getParameterValue(device, 'VirtualParameters.getdeviceuptime'));
                console.log('- Device.DeviceInfo.VirtualParameters.getdeviceuptime:', getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime'));
                console.log('- InternetGatewayDevice.DeviceInfo.UpTime:', getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime'));
                console.log('- Last Inform:', device._lastInform);
                console.log('- SSID:', getParameterValue(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'));
                console.log('- PPPoE Username:', getParameterValue(device, 'VirtualParameters.pppoeUsername'));
                
                // Test status detection
                const uptime1 = getParameterValue(device, 'VirtualParameters.getdeviceuptime');
                const uptime2 = getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime');
                const uptime3 = getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime');
                const lastInform = device._lastInform;
                const hasUptime = (uptime1 && uptime1 > 0) || (uptime2 && uptime2 > 0) || (uptime3 && uptime3 > 0);
                const isRecentInform = lastInform && (Date.now() - new Date(lastInform).getTime()) < 5 * 60 * 1000;
                console.log('- Status Detection - Uptime1:', uptime1, 'Uptime2:', uptime2, 'Uptime3:', uptime3);
                console.log('- Status Detection - HasUptime:', hasUptime, 'IsRecentInform:', isRecentInform);
                console.log('- Status Detection - Final Status:', hasUptime || isRecentInform ? 'Online' : 'Offline');
                
                // Test model extraction
                const deviceId = device._id || '';
                const modelMatch = deviceId.match(/-([A-Z0-9]+)-/);
                console.log('- Model from ID regex:', modelMatch ? modelMatch[1] : 'No match');
            }
            
            // Extract serial number - try multiple sources
            const deviceId = device._id || '';
            const virtualSerial = getParameterValue(device, 'VirtualParameters.getSerialNumber');
            const deviceIdSerial = getParameterValue(device, 'DeviceID.SerialNumber');
            const extractedSerial = deviceId.replace(/%2D/g, '-').replace(/-XPON-.*/, '');
            
            const serialNumber = virtualSerial || deviceIdSerial || extractedSerial || 'N/A';
            
            const processedDevice = {
                id: device._id,
                serialNumber: serialNumber,
                model: (() => {
                    // Try DeviceID.ProductClass first, then extract from device ID
                    const productClass = getParameterValue(device, 'DeviceID.ProductClass');
                    
                    if (productClass && typeof productClass === 'string') {
                        return productClass;
                    }
                    
                    // Extract model from device ID (e.g., "F663NV3A" from "44FB5A-F663NV3A-ZTEGCB7552E1")
                    const modelMatch = deviceId.match(/-([A-Z0-9]+)-/);
                    return modelMatch ? modelMatch[1] : 'Unknown';
                })(),
                status: (() => {
                    // Try multiple uptime parameters for different device types
                    const uptime1 = getParameterValue(device, 'VirtualParameters.getdeviceuptime');
                    const uptime2 = getParameterValue(device, 'Device.DeviceInfo.VirtualParameters.getdeviceuptime');
                    const uptime3 = getParameterValue(device, 'InternetGatewayDevice.DeviceInfo.UpTime');
                    const lastInform = device._lastInform;
                    
                    // Check if device has uptime > 0
                    const hasUptime = (uptime1 && uptime1 > 0) || (uptime2 && uptime2 > 0) || (uptime3 && uptime3 > 0);
                    
                    // Check if device has recent inform (within last 5 minutes)
                    const isRecentInform = lastInform && (Date.now() - new Date(lastInform).getTime()) < 5 * 60 * 1000;
                    
                    // Device is online if it has uptime OR recent inform
                    return hasUptime || isRecentInform ? 'Online' : 'Offline';
                })(),
                ssid: getParameterValue(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID') || 'N/A',
                lastInform: device._lastInform || new Date().toISOString(),
                latitude: null,
                longitude: null,
                customerName: null,
                customerPhone: null
            };
            
            // Try to find customer by PPPoE username - try multiple sources
            const pppoeUsername = getParameterValue(device, 'VirtualParameters.pppoeUsername') || 
                                 getParameterValue(device, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username');
            if (pppoeUsername && pppoeUsername !== '-') {
                try {
                    const db = require('../config/billing').db;
                    const customer = await new Promise((resolve, reject) => {
                        db.get(`
                            SELECT id, name, phone, latitude, longitude 
                            FROM customers 
                            WHERE pppoe_username = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
                        `, [pppoeUsername], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    
                    if (customer) {
                        processedDevice.latitude = customer.latitude;
                        processedDevice.longitude = customer.longitude;
                        processedDevice.customerName = customer.name;
                        processedDevice.customerPhone = customer.phone;
                    }
                } catch (customerError) {
                    console.log(`⚠️ Error finding customer for device ${processedDevice.serialNumber}:`, customerError.message);
                }
            }
            
            processedDevices.push(processedDevice);
        }
        
        console.log(`✅ Processed ${processedDevices.length} devices`);
        
        res.json({
            success: true,
            devices: processedDevices
        });
    } catch (error) {
        console.error('❌ Error getting devices:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading devices data: ' + error.message
        });
    }
});

// API endpoint untuk cables
router.get('/api/cables', adminAuth, async (req, res) => {
    try {
        const db = require('../config/billing').db;
        const cables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.id, c.name, c.from_odp_id, c.to_odp_id, c.cable_type, c.length,
                       c.status, c.notes,
                       o1.name as from_odp_name, o1.latitude as from_lat, o1.longitude as from_lng,
                       o2.name as to_odp_name, o2.latitude as to_lat, o2.longitude as to_lng
                FROM cable_routes c
                LEFT JOIN odps o1 ON c.from_odp_id = o1.id
                LEFT JOIN odps o2 ON c.to_odp_id = o2.id
                WHERE o1.latitude IS NOT NULL AND o1.longitude IS NOT NULL
                  AND o2.latitude IS NOT NULL AND o2.longitude IS NOT NULL
                ORDER BY c.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Format cables for map
        const formattedCables = cables.map(cable => ({
            id: cable.id,
            name: cable.name,
            from: [cable.from_lat, cable.from_lng],
            to: [cable.to_lat, cable.to_lng],
            type: cable.cable_type,
            length: cable.length,
            status: cable.status
        }));
        
        res.json({
            success: true,
            cables: formattedCables
        });
    } catch (error) {
        logger.error('Error getting cables for mobile mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading cables data'
        });
    }
});

// Mapping & Coordinates Management
// API untuk analisis coverage area
router.get('/api/mapping/coverage', async (req, res) => {
    try {
        const MappingUtils = require('../utils/mappingUtils');
        
        // Ambil data customers
        const customers = await billingManager.getAllCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (customersWithCoords.length < 3) {
            return res.json({
                success: false,
                message: 'Minimal 3 koordinat diperlukan untuk analisis coverage'
            });
        }
        
        // Hitung bounding box
        const coordinates = customersWithCoords.map(c => ({ 
            latitude: c.latitude, 
            longitude: c.longitude 
        }));
        
        const boundingBox = MappingUtils.getBoundingBox(coordinates);
        const center = MappingUtils.getCenterCoordinate(coordinates);
        const coverageArea = MappingUtils.calculateCoverageArea(coordinates);
        
        // Analisis density per area
        const clusters = MappingUtils.createClusters(coordinates, 1000); // 1km radius
        const highDensityAreas = clusters.filter(c => c.count >= 5);
        const mediumDensityAreas = clusters.filter(c => c.count >= 3 && c.count < 5);
        const lowDensityAreas = clusters.filter(c => c.count < 3);
        
        res.json({
            success: true,
            data: {
                coverageArea: parseFloat(coverageArea),
                boundingBox,
                center,
                densityAnalysis: {
                    highDensity: highDensityAreas.length,
                    mediumDensity: mediumDensityAreas.length,
                    lowDensity: lowDensityAreas.length,
                    totalClusters: clusters.length
                },
                clusters: {
                    high: highDensityAreas,
                    medium: mediumDensityAreas,
                    low: lowDensityAreas
                }
            }
        });
    } catch (error) {
        logger.error('Error analyzing coverage:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menganalisis coverage area' 
        });
    }
});

// API untuk update koordinat customer
router.put('/api/mapping/customers/:id/coordinates', async (req, res) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Latitude dan longitude wajib diisi'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        
        // Validasi koordinat
        if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Koordinat tidak valid'
            });
        }
        
        // Update koordinat customer
        const result = await billingManager.updateCustomerCoordinates(parseInt(id), {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        });
        
        if (result) {
            res.json({
                success: true,
                message: 'Koordinat customer berhasil diperbarui',
                data: {
                    id: parseInt(id),
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                }
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }
    } catch (error) {
        logger.error('Error updating customer coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui koordinat customer'
        });
    }
});

// API untuk bulk update koordinat
router.post('/api/mapping/customers/bulk-coordinates', async (req, res) => {
    try {
        const { coordinates } = req.body;
        
        if (!coordinates || !Array.isArray(coordinates)) {
            return res.status(400).json({
                success: false,
                message: 'Data koordinat harus berupa array'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (const coord of coordinates) {
            try {
                const { customer_id, latitude, longitude } = coord;
                
                if (!customer_id || !latitude || !longitude) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Data tidak lengkap'
                    });
                    errorCount++;
                    continue;
                }
                
                // Validasi koordinat
                if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Koordinat tidak valid'
                    });
                    errorCount++;
                    continue;
                }
                
                // Update koordinat
                const result = await billingManager.updateCustomerCoordinates(parseInt(customer_id), {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude)
                });
                
                if (result) {
                    results.push({
                        customer_id,
                        success: true,
                        message: 'Koordinat berhasil diperbarui',
                        data: {
                            latitude: parseFloat(latitude),
                            longitude: parseFloat(longitude),
                            formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                        }
                    });
                    successCount++;
                } else {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Customer tidak ditemukan'
                    });
                    errorCount++;
                }
            } catch (error) {
                results.push({
                    customer_id: coord.customer_id,
                    success: false,
                    message: error.message
                });
                errorCount++;
            }
        }
        
        res.json({
            success: true,
            message: `Bulk update selesai. ${successCount} berhasil, ${errorCount} gagal`,
            data: {
                total: coordinates.length,
                success: successCount,
                error: errorCount,
                results
            }
        });
    } catch (error) {
        logger.error('Error bulk updating coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan bulk update koordinat'
        });
    }
});

// API untuk export mapping data
router.get('/api/mapping/export', async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        // Ambil data mapping
        const customers = await billingManager.getAllCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (format === 'csv') {
            // Export sebagai CSV
            const csvData = customersWithCoords.map(c => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                username: c.username,
                latitude: c.latitude,
                longitude: c.longitude,
                package_name: c.package_name || 'N/A',
                status: c.status,
                address: c.address || 'N/A'
            }));
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.csv"');
            
            // CSV header
            const headers = Object.keys(csvData[0]).join(',');
            const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','));
            
            res.send([headers, ...rows].join('\n'));
        } else {
            // Export sebagai JSON
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.json"');
            
            res.json({
                exportDate: new Date().toISOString(),
                totalCustomers: customersWithCoords.length,
                data: customersWithCoords
            });
        }
    } catch (error) {
        logger.error('Error exporting mapping data:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal export data mapping'
        });
    }
});

router.get('/api/customers', adminAuth, async (req, res) => {
    try {
        const customers = await billingManager.getCustomers();
        res.json({
            success: true,
            customers: customers
        });
    } catch (error) {
        logger.error('Error getting customers API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Bulk Operations for Customer Data
// Get current customer data for preview
router.post('/customers/current-data', async (req, res) => {
    try {
        const { customers } = req.body;
        
        if (!customers || !Array.isArray(customers)) {
            return res.status(400).json({
                success: false,
                message: 'Data customers harus berupa array'
            });
        }
        
        const result = [];
        
        for (const customer of customers) {
            if (customer.phone && customer.username) {
                try {
                    const currentCustomer = await billingManager.getCustomerByPhone(customer.phone);
                    
                    // Get current package info
                    let currentPackageName = null;
                    if (currentCustomer && currentCustomer.package_id) {
                        const currentPackage = await billingManager.getPackageById(currentCustomer.package_id);
                        currentPackageName = currentPackage ? currentPackage.name : null;
                    }
                    
                    result.push({
                        phone: customer.phone,
                        name: customer.name,
                        current_username: currentCustomer ? currentCustomer.username : null,
                        new_username: customer.username,
                        current_package_id: currentCustomer ? currentCustomer.package_id : null,
                        current_package_name: currentPackageName,
                        new_package_id: customer.package_id || null,
                        new_package_name: customer.package_name || null,
                        found: !!currentCustomer
                    });
                } catch (error) {
                    logger.error(`Error getting customer by phone ${customer.phone}:`, error);
                    result.push({
                        phone: customer.phone,
                        name: customer.name,
                        current_username: null,
                        new_username: customer.username,
                        current_package_id: null,
                        current_package_name: null,
                        new_package_id: customer.package_id || null,
                        new_package_name: customer.package_name || null,
                        found: false,
                        error: error.message
                    });
                }
            }
        }
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('Error getting current customer data:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting current customer data: ' + error.message
        });
    }
});

// Bulk update customer data
router.post('/customers/update-customer-data', async (req, res) => {
    try {
        const { customers } = req.body;
        
        if (!customers || !Array.isArray(customers)) {
            return res.status(400).json({
                success: false,
                message: 'Data customers harus berupa array'
            });
        }
        
        let updated = 0;
        let total = 0;
        const errors = [];
        
        for (const customer of customers) {
            if (customer.phone && customer.username) {
                total++;
                
                try {
                    // Validate username format
                    if (!/^[a-z0-9_]+$/.test(customer.username)) {
                        errors.push({
                            phone: customer.phone,
                            name: customer.name,
                            error: 'Username hanya boleh berisi huruf kecil, angka, dan underscore'
                        });
                        continue;
                    }
                    
                    // Get current customer
                    const currentCustomer = await billingManager.getCustomerByPhone(customer.phone);
                    
                    if (!currentCustomer) {
                        errors.push({
                            phone: customer.phone,
                            name: customer.name,
                            error: 'Pelanggan tidak ditemukan'
                        });
                        continue;
                    }
                    
                    // Check if package exists (if package_id or package_name is provided)
                    let packageId = currentCustomer.package_id;
                    
                    // If package_id is provided and different, use it
                    if (customer.package_id && customer.package_id !== currentCustomer.package_id) {
                        const packageExists = await billingManager.getPackageById(customer.package_id);
                        if (!packageExists) {
                            errors.push({
                                phone: customer.phone,
                                name: customer.name,
                                error: `Paket dengan ID ${customer.package_id} tidak ditemukan`
                            });
                            continue;
                        }
                        packageId = customer.package_id;
                    }
                    // If package_name is provided, try to find matching package
                    else if (customer.package_name && !customer.package_id) {
                        const packages = await billingManager.getPackages();
                        const matchingPackage = packages.find(pkg => 
                            pkg.name.toLowerCase() === customer.package_name.toLowerCase() && pkg.is_active === 1
                        );
                        
                        if (matchingPackage) {
                            packageId = matchingPackage.id;
                            logger.info(`Found matching package for ${customer.phone}: ${customer.package_name} -> ID ${matchingPackage.id}`);
                        } else {
                            errors.push({
                                phone: customer.phone,
                                name: customer.name,
                                error: `Paket dengan nama "${customer.package_name}" tidak ditemukan atau tidak aktif`
                            });
                            continue;
                        }
                    }
                    
                    // Check if there are any changes
                    const usernameChanged = currentCustomer.username !== customer.username;
                    const packageChanged = packageId !== currentCustomer.package_id;
                    
                    if (!usernameChanged && !packageChanged) {
                        continue; // Skip if no changes
                    }
                    
                    // Update customer data
                    const updateData = {
                        name: currentCustomer.name,
                        username: customer.username,
                        phone: currentCustomer.phone,
                        pppoe_username: currentCustomer.pppoe_username,
                        email: currentCustomer.email,
                        address: currentCustomer.address,
                        package_id: packageId,
                        pppoe_profile: currentCustomer.pppoe_profile,
                        status: currentCustomer.status,
                        auto_suspension: currentCustomer.auto_suspension,
                        billing_day: currentCustomer.billing_day
                    };
                    
                    // Debug logging
                    logger.info(`Updating customer ${customer.phone} with data:`, {
                        old_package_id: currentCustomer.package_id,
                        new_package_id: packageId,
                        username_changed: usernameChanged,
                        package_changed: packageChanged,
                        update_data: updateData
                    });
                    
                    await billingManager.updateCustomerByPhone(customer.phone, updateData);
                    updated++;
                    
                    let logMessage = `Customer data updated for ${customer.phone}:`;
                    if (usernameChanged) {
                        logMessage += ` username: ${currentCustomer.username} -> ${customer.username}`;
                    }
                    if (packageChanged) {
                        logMessage += ` package: ${currentCustomer.package_id} -> ${packageId}`;
                    }
                    
                    logger.info(logMessage);
                    
                } catch (error) {
                    logger.error(`Error updating customer data for ${customer.phone}:`, error);
                    errors.push({
                        phone: customer.phone,
                        name: customer.name,
                        error: error.message
                    });
                }
            }
        }
        
        res.json({
            success: true,
            message: `Berhasil mengupdate ${updated} dari ${total} pelanggan`,
            updated: updated,
            total: total,
            errors: errors
        });
        
    } catch (error) {
        logger.error('Error bulk updating customer data:', error);
        res.status(500).json({
            success: false,
            message: 'Error bulk updating customer data: ' + error.message
        });
    }
});

router.get('/api/invoices', async (req, res) => {
    try {
        const { customer_username } = req.query;
        const invoices = await billingManager.getInvoices(customer_username);
        res.json(invoices);
    } catch (error) {
        logger.error('Error getting invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

// WhatsApp Notifications
// Send WhatsApp Notification for Invoice
router.post('/invoices/send-whatsapp', async (req, res) => {
    try {
        const { phoneNumber, customerName, status, amount, dueDate, invoiceNumber, packageName } = req.body;
        
        if (!phoneNumber || !customerName || !amount || !dueDate) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }
        
        // Format phone number
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '62' + formattedPhone.slice(1);
        } else if (!formattedPhone.startsWith('62')) {
            formattedPhone = '62' + formattedPhone;
        }
        
        // Create message based on status using template system like gembok-bill
        let message = '';
        const companyHeader = getSetting('company_header', 'CV Lintas Multimedia');
        const footerInfo = getSetting('footer_info', 'Internet Tanpa Batas');
        
        if (status === 'paid') {
            message = `✅ *PEMBAYARAN DITERIMA*

Halo ${customerName},

Terima kasih! Pembayaran Anda telah kami terima:

📄 *No. Invoice:* ${invoiceNumber || 'N/A'}
💰 *Jumlah:* Rp ${parseFloat(amount).toLocaleString('id-ID')}
💳 *Metode Pembayaran:* Manual Admin
📅 *Tanggal Pembayaran:* ${new Date().toLocaleDateString('id-ID')}
📦 *Paket:* ${packageName || 'N/A'}

Layanan internet Anda akan tetap aktif. Terima kasih atas kepercayaan Anda.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${companyHeader}
${footerInfo}`;
        } else {
            // Calculate days remaining
            const today = new Date();
            const due = new Date(dueDate);
            const daysRemaining = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
            
            if (daysRemaining < 0) {
                // Overdue notification
                message = `🚨 *TAGIHAN TERLAMBAT*

Halo ${customerName},

Tagihan Anda telah melewati jatuh tempo:

📄 *No. Invoice:* ${invoiceNumber || 'N/A'}
💰 *Jumlah:* Rp ${parseFloat(amount).toLocaleString('id-ID')}
📅 *Jatuh Tempo:* ${new Date(dueDate).toLocaleDateString('id-ID')}
📦 *Paket:* ${packageName || 'N/A'}
⚠️ *Status:* TERLAMBAT ${Math.abs(daysRemaining)} hari

Silakan lakukan pembayaran segera untuk menghindari denda keterlambatan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${companyHeader}
${footerInfo}`;
            } else {
                // Due date reminder
                message = `⚠️ *PERINGATAN JATUH TEMPO*

Halo ${customerName},

Tagihan Anda akan jatuh tempo dalam ${daysRemaining} hari:

📄 *No. Invoice:* ${invoiceNumber || 'N/A'}
💰 *Jumlah:* Rp ${parseFloat(amount).toLocaleString('id-ID')}
📅 *Jatuh Tempo:* ${new Date(dueDate).toLocaleDateString('id-ID')}
📦 *Paket:* ${packageName || 'N/A'}

Silakan lakukan pembayaran segera untuk menghindari denda keterlambatan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${companyHeader}
${footerInfo}`;
            }
        }
        
        // Send WhatsApp message using the existing WhatsApp system
        logger.info(`Sending WhatsApp notification to ${formattedPhone} for customer ${customerName}`);
        logger.info(`Message content: ${message.substring(0, 100)}...`);
        
        const sendMessage = require('../config/sendMessage');
        const result = await sendMessage.sendMessage(formattedPhone, message);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Notifikasi WhatsApp berhasil dikirim'
            });
        } else {
            res.json({
                success: false,
                message: 'Gagal mengirim notifikasi WhatsApp: ' + (result.error || 'Unknown error')
            });
        }
        
    } catch (error) {
        logger.error('Error sending WhatsApp notification:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat mengirim notifikasi'
        });
    }
});

// Payment Gateway Integration
// Payment Settings Routes
router.get('/payment-settings', getAppSettings, async (req, res) => {
    try {
        const paymentConfig = await getPaymentGatewayConfig();
        const settings = getSettingsWithCache();
        settings.payment_gateway = paymentConfig;
        res.render('admin/billing/payment-settings', {
            title: 'Payment Gateway Settings',
            settings: settings,
            appSettings: req.appSettings,
            pg: paymentConfig,
            mid: paymentConfig.midtrans,
            xe: paymentConfig.xendit,
            tp: paymentConfig.tripay,
            dk: paymentConfig.duitku,
            gatewayStatus: await billingManager.getGatewayStatus(),
            saved: req.query.saved === '1'
        });
    } catch (error) {
        logger.error('Error loading payment settings:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment settings',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Update active gateway
router.post('/payment-settings/active-gateway', async (req, res) => {
    try {
        const { activeGateway } = req.body;
        const updatedConfig = await setActivePaymentGateway(activeGateway);
        const reloadInfo = await billingManager.reloadPaymentGateway();

        res.json({
            success: true,
            message: 'Active gateway updated successfully',
            config: updatedConfig,
            reload: reloadInfo
        });
    } catch (error) {
        logger.error('Error updating active gateway:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating active gateway',
            error: error.message
        });
    }
});

// Update gateway configuration
router.post('/payment-settings/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const config = req.body || {};

        const updatedGateway = await updatePaymentGatewayConfigStore(gateway, config);
        const reloadInfo = await billingManager.reloadPaymentGateway();

        res.json({
            success: true,
            message: `${gateway} configuration updated successfully`,
            gateway: updatedGateway,
            reload: reloadInfo
        });
    } catch (error) {
        logger.error(`Error updating ${req.params.gateway} configuration:`, error);
        res.status(500).json({
            success: false,
            message: `Error updating ${req.params.gateway} configuration`,
            error: error.message
        });
    }
});

// Test gateway connection
router.post('/payment-settings/test/:gateway', async (req, res) => {
    try {
        const { gateway } = req.params;
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentManager = new PaymentGatewayManager();
        
        // Test the gateway by trying to create a test payment
        const testInvoice = {
            invoice_number: 'TEST-001',
            amount: 10000,
            package_name: 'Test Package',
            customer_name: 'Test Customer',
            customer_phone: '08123456789',
            customer_email: 'test@example.com'
        };
        
        // Guard: Tripay minimum amount validation to avoid gateway rejection
        if (gateway === 'tripay' && Number(testInvoice.amount) < 10000) {
            return res.status(400).json({
                success: false,
                message: 'Minimal nominal Tripay adalah Rp 10.000'
            });
        }
        
        const result = await paymentManager.createPayment(testInvoice, gateway);
        
        res.json({
            success: true,
            message: `${gateway} connection test successful`,
            data: result
        });
    } catch (error) {
        logger.error(`Error testing ${req.params.gateway} connection:`, error);
        res.status(500).json({
            success: false,
            message: `${req.params.gateway} connection test failed: ${error.message}`
        });
    }
});

router.get('/api/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await billingManager.getInvoiceById(id);
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice tidak ditemukan'
            });
        }
        
        res.json({
            success: true,
            invoice: invoice
        });
    } catch (error) {
        logger.error('Error getting invoice by ID API:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Route /api/stats sudah ada di atas dengan adminAuth middleware

router.get('/api/overdue', async (req, res) => {
    try {
        const overdueInvoices = await billingManager.getOverdueInvoices();
        res.json(overdueInvoices);
    } catch (error) {
        logger.error('Error getting overdue invoices API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manual test auto suspension
router.post('/test-auto-suspension', adminAuth, async (req, res) => {
    try {
        logger.info('Manual test auto suspension triggered by admin');
        
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndSuspendOverdueCustomers();
        
        res.json({
            success: true,
            message: 'Test auto suspension completed',
            result: result
        });
        
    } catch (error) {
        logger.error('Error in manual test auto suspension:', error);
        res.status(500).json({
            success: false,
            message: 'Error testing auto suspension: ' + error.message
        });
    }
});

// Service Suspension Management Routes
router.post('/service-suspension/suspend/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body;
        
        // Validasi input
        if (!username || username.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Username tidak boleh kosong'
            });
        }

        const customer = await billingManager.getCustomerByUsername(username.trim());
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Cek apakah customer sudah suspended
        if (customer.status === 'suspended') {
            return res.status(400).json({
                success: false,
                message: 'Customer sudah dalam status suspended'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.suspendCustomerService(customer, reason || 'Manual suspension');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service suspended successfully' : 'Failed to suspend service',
            results: result.results,
            customer: result.customer,
            reason: result.reason || (reason || 'Manual suspension')
        });
    } catch (error) {
        logger.error('Error suspending service:', error);
        res.status(500).json({
            success: false,
            message: 'Error suspending service: ' + error.message
        });
    }
});

router.post('/service-suspension/restore/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { reason } = req.body || {};
        
        // Validasi input
        if (!username || username.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Username tidak boleh kosong'
            });
        }

        const customer = await billingManager.getCustomerByUsername(username.trim());
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Cek apakah customer sudah active
        if (customer.status === 'active') {
            return res.status(400).json({
                success: false,
                message: 'Customer sudah dalam status active'
            });
        }

        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.restoreCustomerService(customer, reason || 'Manual restore');
        
        res.json({
            success: result.success,
            message: result.success ? 'Service restored successfully' : 'Failed to restore service',
            results: result.results,
            customer: result.customer,
            reason: result.reason || (reason || 'Manual restore')
        });
    } catch (error) {
        logger.error('Error restoring service:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring service: ' + error.message
        });
    }
});

router.post('/service-suspension/check-overdue', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndSuspendOverdueCustomers();
        
        res.json({
            success: true,
            message: 'Overdue customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking overdue customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking overdue customers: ' + error.message
        });
    }
});

router.post('/service-suspension/check-paid', async (req, res) => {
    try {
        const serviceSuspension = require('../config/serviceSuspension');
        const result = await serviceSuspension.checkAndRestorePaidCustomers();
        
        res.json({
            success: true,
            message: 'Paid customers check completed',
            ...result
        });
    } catch (error) {
        logger.error('Error checking paid customers:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking paid customers: ' + error.message
        });
    }
});

// Service Suspension Settings Page
router.get('/service-suspension', getAppSettings, async (req, res) => {
    try {
        // Get authentication mode
        const { getUserAuthModeAsync } = require('../config/mikrotik');
        const authMode = await getUserAuthModeAsync();
        
        res.render('admin/billing/service-suspension', {
            title: 'Service Suspension',
            appSettings: req.appSettings,
            authMode: authMode || 'mikrotik'
        });
    } catch (error) {
        logger.error('Error loading service suspension page:', error);
        res.status(500).render('error', { 
            message: 'Error loading service suspension page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Service Suspension: Grace Period Setting API
router.get('/service-suspension/grace-period', adminAuth, async (req, res) => {
    try {
        const value = getSetting('suspension_grace_period_days', '3');
        res.json({ success: true, grace_period_days: value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/service-suspension/grace-period', adminAuth, async (req, res) => {
    try {
        const { grace_period_days } = req.body || {};
        if (!grace_period_days || typeof grace_period_days !== 'string') {
            return res.status(400).json({ success: false, message: 'grace_period_days tidak valid' });
        }

        const days = parseInt(grace_period_days.trim(), 10);
        if (isNaN(days) || days < 1 || days > 30) {
            return res.status(400).json({ success: false, message: 'Grace period harus antara 1-30 hari' });
        }

        const ok = setSetting('suspension_grace_period_days', days.toString());
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke settings.json' });
        }

        // Clear cache agar pengaturan baru langsung berlaku
        clearSettingsCache();

        res.json({ success: true, grace_period_days: days.toString() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Service Suspension: Isolir Profile Setting API
router.get('/service-suspension/isolir-profile', adminAuth, async (req, res) => {
    try {
        const value = getSetting('isolir_profile', 'isolir');
        res.json({ success: true, isolir_profile: value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/service-suspension/isolir-profile', adminAuth, async (req, res) => {
    try {
        const { isolir_profile } = req.body || {};
        if (!isolir_profile || typeof isolir_profile !== 'string') {
            return res.status(400).json({ success: false, message: 'isolir_profile tidak valid' });
        }

        const profile = isolir_profile.trim();
        if (!profile) {
            return res.status(400).json({ success: false, message: 'Profile tidak boleh kosong' });
        }

        const ok = setSetting('isolir_profile', profile);
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Gagal menyimpan ke settings.json' });
        }

        // Clear cache agar pengaturan baru langsung berlaku
        clearSettingsCache();

        res.json({ success: true, isolir_profile: profile });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Payment Monitor
router.get('/payment-monitor', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/payment-monitor', {
            title: 'Payment Monitor',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading payment monitor:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment monitor',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Manual Isolir by Invoice ID
router.post('/invoices/:id/isolir', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Isolir manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.suspendCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Isolir berhasil' : (result?.error || 'Gagal isolir') });
    } catch (error) {
        logger.error('Error manual isolir:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Manual Restore by Invoice ID
router.post('/invoices/:id/restore', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = (req.body && req.body.reason) || 'Restore manual dari Admin';

        const invoice = await billingManager.getInvoiceById(id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });

        const customer = await billingManager.getCustomerById(invoice.customer_id);
        if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

        const result = await serviceSuspension.restoreCustomerService(customer, reason);
        return res.json({ success: !!result?.success, data: result, message: result?.success ? 'Restore berhasil' : (result?.error || 'Gagal restore') });
    } catch (error) {
        logger.error('Error manual restore:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Route untuk mengelola expenses
router.get('/expenses', getAppSettings, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const expenses = await billingManager.getExpenses(start_date, end_date);
        
        res.render('admin/billing/expenses', {
            title: 'Manajemen Pengeluaran',
            expenses,
            startDate: start_date || '',
            endDate: end_date || '',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading expenses:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat data pengeluaran',
            error: error.message 
        });
    }
});

// API untuk menambah expense
router.post('/api/expenses', async (req, res) => {
    try {
        const { amount, category, account_expenses, expense_date, payment_method, notes } = req.body;
        
        if (!amount || !category || !expense_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const expense = await billingManager.addExpense({
            amount: parseFloat(amount),
            category,
            account_expenses: account_expenses || null,
            expense_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: expense, message: 'Pengeluaran berhasil ditambahkan' });
    } catch (error) {
        logger.error('Error adding expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk get expense by id
router.get('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const expenses = await billingManager.getExpenses();
        const expense = expenses.find(exp => exp.id === parseInt(id));
        
        if (!expense) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pengeluaran tidak ditemukan' 
            });
        }
        
        res.json({ success: true, data: expense });
    } catch (error) {
        logger.error('Error getting expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk update expense
router.put('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, category, account_expenses, expense_date, payment_method, notes } = req.body;
        
        if (!amount || !category || !expense_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const expense = await billingManager.updateExpense(parseInt(id), {
            amount: parseFloat(amount),
            category,
            account_expenses: account_expenses || null,
            expense_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: expense, message: 'Pengeluaran berhasil diperbarui' });
    } catch (error) {
        logger.error('Error updating expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk delete expense
router.delete('/api/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await billingManager.deleteExpense(parseInt(id));
        
        res.json({ success: true, data: result, message: 'Pengeluaran berhasil dihapus' });
    } catch (error) {
        logger.error('Error deleting expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk statistik komisi kolektor
router.get('/api/commission-stats', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const stats = await billingManager.getCommissionStats(start_date, end_date);
        
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting commission stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route untuk mengelola income (pemasukan)
router.get('/income', getAppSettings, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const incomes = await billingManager.getIncomes(start_date, end_date);
        
        res.render('admin/billing/income', {
            title: 'Manajemen Pemasukan',
            incomes,
            startDate: start_date || '',
            endDate: end_date || '',
            page: 'income',
            appSettings: req.appSettings
        });
    } catch (error) {
        logger.error('Error loading income:', error);
        res.status(500).render('error', { 
            message: 'Gagal memuat data pemasukan',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API untuk menambah income
router.post('/api/income', async (req, res) => {
    try {
        const { description, amount, category, income_date, payment_method, notes } = req.body;
        
        if (!description || !amount || !category || !income_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const income = await billingManager.addIncome({
            description,
            amount: parseFloat(amount),
            category,
            income_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: income, message: 'Pemasukan berhasil ditambahkan' });
    } catch (error) {
        logger.error('Error adding income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk update income
router.put('/api/income/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { description, amount, category, income_date, payment_method, notes } = req.body;
        
        if (!description || !amount || !category || !income_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Semua field wajib diisi' 
            });
        }
        
        const income = await billingManager.updateIncome(parseInt(id), {
            description,
            amount: parseFloat(amount),
            category,
            income_date,
            payment_method: payment_method || '',
            notes: notes || ''
        });
        
        res.json({ success: true, data: income, message: 'Pemasukan berhasil diperbarui' });
    } catch (error) {
        logger.error('Error updating income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API untuk delete income
router.delete('/api/income/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await billingManager.deleteIncome(parseInt(id));
        
        res.json({ success: true, data: result, message: 'Pemasukan berhasil dihapus' });
    } catch (error) {
        logger.error('Error deleting income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Export Laporan Laba Rugi to Excel
router.get('/export/profit-loss.xlsx', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        // Default date range: current month
        const now = new Date();
        const startDate = start_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = end_date || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const financialData = await billingManager.getFinancialReport(startDate, endDate, 'all');
        
        if (!financialData || !financialData.profitLossData) {
            return res.status(404).json({ success: false, message: 'Data laba rugi tidak ditemukan' });
        }
        
        const profitLossData = financialData.profitLossData;
        
        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Laba Rugi');
        
        // Set column widths
        worksheet.columns = [
            { header: 'Keterangan', key: 'keterangan', width: 60 },
            { header: 'Jumlah (Rp)', key: 'jumlah', width: 25 }
        ];
        
        // Style header
        worksheet.getRow(1).font = { bold: true, size: 12 };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { ...worksheet.getRow(1).font, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        
        // Add title
        worksheet.insertRow(1, ['LAPORAN LABA RUGI', '']);
        worksheet.mergeCells('A1:B1');
        worksheet.getRow(1).font = { bold: true, size: 14 };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(1).height = 25;
        
        // Add period
        worksheet.insertRow(2, [`Periode: ${startDate} s/d ${endDate}`, '']);
        worksheet.mergeCells('A2:B2');
        worksheet.getRow(2).alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(2).height = 20;
        
        // Add empty row
        worksheet.insertRow(3, ['', '']);
        
        // Add header row
        worksheet.insertRow(4, ['Keterangan', 'Jumlah (Rp)']);
        worksheet.getRow(4).font = { bold: true };
        worksheet.getRow(4).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE7E6E6' }
        };
        worksheet.getRow(4).alignment = { vertical: 'middle', horizontal: 'center' };
        
        let currentRow = 5;
        
        // PENDAPATAN USAHA
        worksheet.insertRow(currentRow, ['PENDAPATAN USAHA', '']);
        worksheet.getRow(currentRow).font = { bold: true };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD4EDDA' }
        };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan Bulanan Pembayaran Pelanggan', profitLossData.revenue.monthlyPayment]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan Voucher', profitLossData.revenue.voucher]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan lain-lain dari Manajemen Pendapatan', profitLossData.revenue.otherIncome]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Total Pendapatan Usaha', profitLossData.revenue.total]);
        worksheet.getRow(currentRow).font = { bold: true };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC3E6CB' }
        };
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // PENGELUARAN
        worksheet.insertRow(currentRow, ['PENGELUARAN', '']);
        worksheet.getRow(currentRow).font = { bold: true };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8D7DA' }
        };
        currentRow++;
        
        // Add expenses by category
        const expensesByCategory = profitLossData.expenses.byCategory;
        const categoryOrder = ['Harga Pokok Penjualan (HPP)', 'Beban Operasional (OPEX)', 'Beban Lainnya'];
        
        categoryOrder.forEach(category => {
            if (expensesByCategory[category]) {
                const categoryTotal = profitLossData.expenses.totalByCategory[category] || 0;
                worksheet.insertRow(currentRow, [category, categoryTotal]);
                worksheet.getRow(currentRow).font = { bold: true };
                worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
                currentRow++;
                
                Object.keys(expensesByCategory[category]).forEach(account => {
                    const accountAmount = expensesByCategory[category][account];
                    worksheet.insertRow(currentRow, [`  ${account}`, accountAmount]);
                    worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
                    currentRow++;
                });
            }
        });
        
        // Handle other categories
        Object.keys(expensesByCategory).forEach(category => {
            if (!categoryOrder.includes(category)) {
                const categoryTotal = profitLossData.expenses.totalByCategory[category] || 0;
                worksheet.insertRow(currentRow, [category, categoryTotal]);
                worksheet.getRow(currentRow).font = { bold: true };
                worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
                currentRow++;
                
                Object.keys(expensesByCategory[category]).forEach(account => {
                    const accountAmount = expensesByCategory[category][account];
                    worksheet.insertRow(currentRow, [`  ${account}`, accountAmount]);
                    worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
                    currentRow++;
                });
            }
        });
        
        worksheet.insertRow(currentRow, ['Total Pengeluaran', profitLossData.expenses.total]);
        worksheet.getRow(currentRow).font = { bold: true };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE5C3C6' }
        };
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // LABA BERSIH
        const isProfit = profitLossData.netProfit >= 0;
        worksheet.insertRow(currentRow, ['LABA BERSIH', profitLossData.netProfit]);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isProfit ? 'FFD4EDDA' : 'FFF8D7DA' }
        };
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        
        // Set alignment for all rows
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 4) {
                row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
            }
        });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-laba-rugi-${startDate}-${endDate}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting profit loss to Excel:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Root billing page - redirect to dashboard
router.get('/', getAppSettings, async (req, res) => {
    res.redirect('/admin/billing/dashboard');
});

// Devices page
router.get('/devices', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/devices', {
            title: 'Network Devices',
            user: req.user,
            settings: req.appSettings
        });
    } catch (error) {
        console.error('Error rendering devices page:', error);
        res.status(500).render('error', { 
            message: 'Error loading devices page',
            error: error 
        });
    }
});

// New Mapping page
router.get('/mapping-new', getAppSettings, async (req, res) => {
    try {
        res.render('admin/billing/mapping-new', {
            title: 'Network Mapping - New',
            user: req.user,
            settings: req.appSettings
        });
    } catch (error) {
        console.error('Error rendering new mapping page:', error);
        res.status(500).render('error', { 
            message: 'Error loading mapping page',
            error: error 
        });
    }
});

// Mapping page - Redirect to new mapping page
router.get('/mapping', getAppSettings, async (req, res) => {
    try {
        // Redirect to new mapping page
        return res.redirect('/admin/billing/mapping-new');
    } catch (error) {
        logger.error('Error redirecting to mapping page:', error);
        res.status(500).render('error', {
            message: 'Error redirecting to mapping page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// Mobile Mapping page
router.get('/mobile/mapping', getAppSettings, async (req, res) => {
    try {
        // Get mapping data for mobile
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        // Calculate stats
        const totalCustomers = customersWithCoords.length;
        const activeCustomers = customersWithCoords.filter(c => c.status === 'active').length;
        const suspendedCustomers = customersWithCoords.filter(c => c.status === 'suspended').length;
        
        // Use responsive mapping-new.ejs instead of separate mobile version
        res.redirect('/admin/billing/mapping');
    } catch (error) {
        logger.error('Error loading mobile mapping page:', error);
        res.status(500).render('error', {
            message: 'Error loading mobile mapping page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// API untuk mapping data
router.get('/api/mapping/data', async (req, res) => {
    try {
        const MappingUtils = require('../utils/mappingUtils');
        
        // Ambil data customers dengan koordinat
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        // Validasi koordinat customer
        const validatedCustomers = customersWithCoords.map(customer => 
            MappingUtils.validateCustomerCoordinates(customer)
        );
        
        // Hitung statistik mapping
        const totalCustomers = validatedCustomers.length;
        const validCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'valid').length;
        const defaultCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'default').length;
        const invalidCoordinates = validatedCustomers.filter(c => c.coordinateStatus === 'invalid').length;
        
        // Hitung area coverage jika ada minimal 3 koordinat
        let coverageArea = 0;
        if (validCoordinates >= 3) {
            const validCoords = validatedCustomers
                .filter(c => c.coordinateStatus === 'valid')
                .map(c => ({ latitude: c.latitude, longitude: c.longitude }));
            coverageArea = MappingUtils.calculateCoverageArea(validCoords);
        }
        
        // Buat clusters untuk customer
        const customerClusters = MappingUtils.createClusters(
            validatedCustomers.map(c => ({ latitude: c.latitude, longitude: c.longitude })),
            2000 // 2km cluster radius
        );
        
        res.json({
            success: true,
            data: {
                customers: validatedCustomers,
                clusters: customerClusters,
                statistics: {
                    totalCustomers,
                    validCoordinates,
                    defaultCoordinates,
                    invalidCoordinates,
                    coverageArea: parseFloat(coverageArea)
                }
            }
        });
    } catch (error) {
        logger.error('Error getting mapping data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal mengambil data mapping' 
        });
    }
});

// API untuk analisis coverage area
router.get('/api/mapping/coverage', async (req, res) => {
    try {
        const MappingUtils = require('../utils/mappingUtils');
        
        // Ambil data customers
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (customersWithCoords.length < 3) {
            return res.json({
                success: false,
                message: 'Minimal 3 koordinat diperlukan untuk analisis coverage'
            });
        }
        
        // Hitung bounding box
        const coordinates = customersWithCoords.map(c => ({ 
            latitude: c.latitude, 
            longitude: c.longitude 
        }));
        
        const boundingBox = MappingUtils.getBoundingBox(coordinates);
        const center = MappingUtils.getCenterCoordinate(coordinates);
        const coverageArea = MappingUtils.calculateCoverageArea(coordinates);
        
        // Analisis density per area
        const clusters = MappingUtils.createClusters(coordinates, 1000); // 1km radius
        const highDensityAreas = clusters.filter(c => c.count >= 5);
        const mediumDensityAreas = clusters.filter(c => c.count >= 3 && c.count < 5);
        const lowDensityAreas = clusters.filter(c => c.count < 3);
        
        res.json({
            success: true,
            data: {
                coverageArea: parseFloat(coverageArea),
                boundingBox,
                center,
                densityAnalysis: {
                    highDensity: highDensityAreas.length,
                    mediumDensity: mediumDensityAreas.length,
                    lowDensity: lowDensityAreas.length,
                    totalClusters: clusters.length
                },
                clusters: {
                    high: highDensityAreas,
                    medium: mediumDensityAreas,
                    low: lowDensityAreas
                }
            }
        });
    } catch (error) {
        logger.error('Error analyzing coverage:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menganalisis coverage area' 
        });
    }
});

// API untuk update koordinat customer
router.put('/api/mapping/customers/:id/coordinates', async (req, res) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Latitude dan longitude wajib diisi'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        
        // Validasi koordinat
        if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Koordinat tidak valid'
            });
        }
        
        // Update koordinat customer
        const result = await billingManager.updateCustomerCoordinates(parseInt(id), {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        });
        
        if (result) {
            res.json({
                success: true,
                message: 'Koordinat customer berhasil diperbarui',
                data: {
                    id: parseInt(id),
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                }
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }
    } catch (error) {
        logger.error('Error updating customer coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui koordinat customer'
        });
    }
});

// API untuk bulk update koordinat
router.post('/api/mapping/customers/bulk-coordinates', async (req, res) => {
    try {
        const { coordinates } = req.body;
        
        if (!coordinates || !Array.isArray(coordinates)) {
            return res.status(400).json({
                success: false,
                message: 'Data koordinat harus berupa array'
            });
        }
        
        const MappingUtils = require('../utils/mappingUtils');
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (const coord of coordinates) {
            try {
                const { customer_id, latitude, longitude } = coord;
                
                if (!customer_id || !latitude || !longitude) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Data tidak lengkap'
                    });
                    errorCount++;
                    continue;
                }
                
                // Validasi koordinat
                if (!MappingUtils.isValidCoordinate(latitude, longitude)) {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Koordinat tidak valid'
                    });
                    errorCount++;
                    continue;
                }
                
                // Update koordinat
                const result = await billingManager.updateCustomerCoordinates(parseInt(customer_id), {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude)
                });
                
                if (result) {
                    results.push({
                        customer_id,
                        success: true,
                        message: 'Koordinat berhasil diperbarui',
                        data: {
                            latitude: parseFloat(latitude),
                            longitude: parseFloat(longitude),
                            formattedCoordinates: MappingUtils.formatCoordinates(latitude, longitude)
                        }
                    });
                    successCount++;
                } else {
                    results.push({
                        customer_id,
                        success: false,
                        message: 'Customer tidak ditemukan'
                    });
                    errorCount++;
                }
            } catch (error) {
                results.push({
                    customer_id: coord.customer_id,
                    success: false,
                    message: error.message
                });
                errorCount++;
            }
        }
        
        res.json({
            success: true,
            message: `Bulk update selesai. ${successCount} berhasil, ${errorCount} gagal`,
            data: {
                total: coordinates.length,
                success: successCount,
                error: errorCount,
                results
            }
        });
    } catch (error) {
        logger.error('Error bulk updating coordinates:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal melakukan bulk update koordinat'
        });
    }
});

// API untuk export mapping data
router.get('/api/mapping/export', async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        // Ambil data mapping
        const customers = await billingManager.getCustomers();
        const customersWithCoords = customers.filter(c => c.latitude && c.longitude);
        
        if (format === 'csv') {
            // Export sebagai CSV
            const csvData = customersWithCoords.map(c => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                username: c.username,
                latitude: c.latitude,
                longitude: c.longitude,
                package_name: c.package_name || 'N/A',
                status: c.status,
                address: c.address || 'N/A'
            }));
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.csv"');
            
            // CSV header
            const headers = Object.keys(csvData[0]).join(',');
            const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','));
            
            res.send([headers, ...rows].join('\n'));
        } else {
            // Export sebagai JSON
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="mapping_data.json"');
            
            res.json({
                exportDate: new Date().toISOString(),
                totalCustomers: customersWithCoords.length,
                data: customersWithCoords
            });
        }
    } catch (error) {
        logger.error('Error exporting mapping data:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal export data mapping'
        });
    }
});

// Calculate price with tax for package
router.get('/api/packages/:id/price-with-tax', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }
        
        const basePrice = package.price;
        const taxRate = (package.tax_rate === 0 || (typeof package.tax_rate === 'number' && package.tax_rate > -1))
            ? Number(package.tax_rate)
            : 11.00;
        const priceWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
        
        res.json({
            success: true,
            package: {
                id: package.id,
                name: package.name,
                base_price: basePrice,
                tax_rate: taxRate,
                price_with_tax: priceWithTax
            }
        });
    } catch (error) {
        logger.error('Error calculating price with tax:', error);
        res.status(500).json({
            success: false,
            message: 'Error calculating price with tax',
            error: error.message
        });
    }
});

// GET: View individual payment
router.get('/payments/:id', getAppSettings, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get payment data (placeholder - implement getPayment method if needed)
        const payment = {
            id: id,
            customer_name: 'John Doe',
            amount: 150000,
            method: 'Transfer Bank',
            status: 'Pending',
            date: new Date().toISOString(),
            reference: 'PAY' + id.toString().padStart(6, '0'),
            description: 'Pembayaran tagihan bulanan'
        };
        
        res.render('admin/billing/mobile-payment-detail', {
            title: 'Detail Pembayaran - Mobile',
            appSettings: req.appSettings,
            payment: payment
        });
    } catch (error) {
        logger.error('Error loading payment detail:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment detail',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// GET: Billing Settings
router.get('/settings', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        
        res.render('admin/billing/settings', {
            title: 'Pengaturan Billing - Mobile',
            appSettings: req.appSettings,
            settings: settings
        });
    } catch (error) {
        logger.error('Error loading billing settings:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing settings',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// API: Get list of unpaid invoices (tagihan)
router.get('/api/list-tagihan', adminAuth, async (req, res) => {
    try {
        const unpaidInvoices = await billingManager.getUnpaidInvoices();

        // Group by customer for better display
        const customerGroups = {};
        unpaidInvoices.forEach(invoice => {
            if (!customerGroups[invoice.customer_id]) {
                customerGroups[invoice.customer_id] = {
                    customer_name: invoice.customer_name,
                    customer_phone: invoice.customer_phone,
                    total_amount: 0,
                    invoices: []
                };
            }
            customerGroups[invoice.customer_id].total_amount += parseFloat(invoice.amount);
            customerGroups[invoice.customer_id].invoices.push(invoice);
        });

        res.json({
            success: true,
            data: {
                total_customers: Object.keys(customerGroups).length,
                total_invoices: unpaidInvoices.length,
                customers: customerGroups
            }
        });

    } catch (error) {
        console.error('Error getting unpaid invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting unpaid invoices: ' + error.message
        });
    }
});

// API: Get list of paid invoices (bayar)
router.get('/api/list-bayar', adminAuth, async (req, res) => {
    try {
        const paidInvoices = await billingManager.getPaidInvoices();

        // Group by customer for better display
        const customerGroups = {};
        paidInvoices.forEach(invoice => {
            if (!customerGroups[invoice.customer_id]) {
                customerGroups[invoice.customer_id] = {
                    customer_name: invoice.customer_name,
                    customer_phone: invoice.customer_phone,
                    total_amount: 0,
                    invoices: []
                };
            }
            customerGroups[invoice.customer_id].total_amount += parseFloat(invoice.amount);
            customerGroups[invoice.customer_id].invoices.push(invoice);
        });

        res.json({
            success: true,
            data: {
                total_customers: Object.keys(customerGroups).length,
                total_invoices: paidInvoices.length,
                customers: customerGroups
            }
        });

    } catch (error) {
        console.error('Error getting paid invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting paid invoices: ' + error.message
        });
    }
});

// GET: Billing Reports
router.get('/reports', getAppSettings, async (req, res) => {
    try {
        const settings = getSettingsWithCache();
        
        // Get basic stats for reports
        let totalCustomers = 0;
        let totalInvoices = 0;
        let totalRevenue = 0;
        let pendingPayments = 0;
        let detailedStats = {};
        
        try {
            totalCustomers = await billingManager.getTotalCustomers();
            totalInvoices = await billingManager.getTotalInvoices();
            totalRevenue = await billingManager.getTotalRevenue();
            pendingPayments = await billingManager.getPendingPayments();
        } catch (err) {
            logger.error('Error loading basic stats:', err);
        }
        
        // Get detailed stats (with error handling)
        try {
            detailedStats = await billingManager.getReportsStats();
        } catch (err) {
            logger.error('Error loading detailed stats:', err);
            // Set default values if getReportsStats fails
            detailedStats = {
                activeCustomers: 0,
                inactiveCustomers: 0,
                newCustomersThisMonth: 0,
                invoicesThisMonth: 0,
                paidInvoices: 0,
                unpaidInvoices: 0,
                successfulPayments: 0,
                failedPayments: 0,
                retentionRate: 0,
                paymentRate: 0
            };
        }
        
        res.render('admin/billing/reports', {
            title: 'Laporan Billing - Mobile',
            appSettings: req.appSettings,
            stats: {
                totalCustomers,
                totalInvoices,
                totalRevenue,
                pendingPayments,
                ...detailedStats
            }
        });
    } catch (error) {
        logger.error('Error loading billing reports:', error);
        res.status(500).render('error', { 
            message: 'Error loading billing reports',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Terjadi kesalahan saat memuat laporan. Silakan coba lagi.'
        });
    }
});

// API: Get detailed reports statistics
router.get('/api/reports/stats', adminAuth, async (req, res) => {
    try {
        const stats = await billingManager.getReportsStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting reports stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API: Get revenue data for chart (last 30 days)
router.get('/api/reports/revenue-chart', adminAuth, async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Get last 30 days revenue data
        const revenueData = [];
        const today = new Date();
        
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const revenue = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM payments
                    WHERE date(payment_date) = date(?)
                `, [dateStr], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.total || 0);
                });
            });
            
            revenueData.push({
                date: dateStr,
                dateLabel: date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
                revenue: revenue
            });
        }
        
        db.close();
        
        res.json({ 
            success: true, 
            data: revenueData 
        });
    } catch (error) {
        logger.error('Error getting revenue chart data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST: Export Reports to Excel
router.post('/api/reports/export', adminAuth, async (req, res) => {
    try {
        const { reportType } = req.body;
        
        // Get stats
        const stats = await billingManager.getReportsStats();
        
        // Get revenue summary directly from database
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        function getDateStr(d) { return new Date(d).toISOString().split('T')[0]; }
        const todayStr = getDateStr(new Date());
        const weekAgoStr = getDateStr(new Date(Date.now() - 6 * 24 * 3600 * 1000));
        
        const [todayRevenue, weekRevenue, monthRevenue] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) = date(?)
                `, [todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE date(payment_date) BETWEEN date(?) AND date(?)
                `, [weekAgoStr, todayStr], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
            new Promise((resolve, reject) => {
                db.get(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payments
                    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
                `, [], (err, row) => err ? reject(err) : resolve(row?.total || 0));
            }),
        ]);
        
        db.close();
        
        const revenueSummary = {
            todayRevenue,
            weekRevenue,
            monthRevenue
        };
        
        // Merge stats with basic stats
        const totalCustomers = await billingManager.getTotalCustomers();
        const totalInvoices = await billingManager.getTotalInvoices();
        const totalRevenue = await billingManager.getTotalRevenue();
        const pendingPayments = await billingManager.getPendingPayments();
        
        const allStats = {
            ...stats,
            totalCustomers,
            totalInvoices,
            totalRevenue,
            pendingPayments
        };
        
        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Billing');
        
        // Set column widths
        worksheet.columns = [
            { header: 'Keterangan', key: 'keterangan', width: 50 },
            { header: 'Nilai', key: 'nilai', width: 25 }
        ];
        
        // Add title
        worksheet.insertRow(1, ['LAPORAN BILLING', '']);
        worksheet.mergeCells('A1:B1');
        worksheet.getRow(1).font = { bold: true, size: 16 };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(1).height = 30;
        
        // Add date
        const now = new Date();
        worksheet.insertRow(2, [`Tanggal: ${now.toLocaleDateString('id-ID')}`, '']);
        worksheet.mergeCells('A2:B2');
        worksheet.getRow(2).alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(2).height = 20;
        
        // Add empty row
        worksheet.insertRow(3, ['', '']);
        
        let currentRow = 4;
        
        // STATISTIK UMUM
        worksheet.insertRow(currentRow, ['STATISTIK UMUM', '']);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(currentRow).font = { ...worksheet.getRow(currentRow).font, color: { argb: 'FFFFFFFF' } };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Total Pelanggan', allStats.totalCustomers || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Total Tagihan', allStats.totalInvoices || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Total Pendapatan', allStats.totalRevenue || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pembayaran Pending', allStats.pendingPayments || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // LAPORAN PENDAPATAN
        worksheet.insertRow(currentRow, ['LAPORAN PENDAPATAN', '']);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD4EDDA' }
        };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan Hari Ini', revenueSummary.todayRevenue || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan Minggu Ini', revenueSummary.weekRevenue || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pendapatan Bulan Ini', revenueSummary.monthRevenue || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // LAPORAN PELANGGAN
        worksheet.insertRow(currentRow, ['LAPORAN PELANGGAN', '']);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC3E6CB' }
        };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pelanggan Aktif', allStats.activeCustomers || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pelanggan Baru (Bulan Ini)', allStats.newCustomersThisMonth || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pelanggan Non-Aktif', allStats.inactiveCustomers || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Tingkat Retensi', `${allStats.retentionRate || 0}%`]);
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // LAPORAN TAGIHAN
        worksheet.insertRow(currentRow, ['LAPORAN TAGIHAN', '']);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE5B4' }
        };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Tagihan Dibuat (Bulan Ini)', allStats.invoicesThisMonth || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Tagihan Lunas', allStats.paidInvoices || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Tagihan Belum Lunas', allStats.unpaidInvoices || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Tingkat Pembayaran', `${allStats.paymentRate || 0}%`]);
        currentRow++;
        
        // Empty row
        worksheet.insertRow(currentRow, ['', '']);
        currentRow++;
        
        // LAPORAN PEMBAYARAN
        worksheet.insertRow(currentRow, ['LAPORAN PEMBAYARAN', '']);
        worksheet.getRow(currentRow).font = { bold: true, size: 12 };
        worksheet.getRow(currentRow).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE5C3C6' }
        };
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pembayaran Berhasil', allStats.successfulPayments || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pembayaran Pending', allStats.pendingPayments || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        worksheet.insertRow(currentRow, ['Pembayaran Gagal', allStats.failedPayments || 0]);
        worksheet.getRow(currentRow).getCell(2).numFmt = '#,##0';
        currentRow++;
        
        // Set alignment for all rows
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 3) {
                row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
            }
        });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-billing-${now.toISOString().split('T')[0]}.xlsx`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        logger.error('Error exporting reports to Excel:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Calculate price with tax for package
router.get('/api/packages/:id/price-with-tax', async (req, res) => {
    try {
        const { id } = req.params;
        const package = await billingManager.getPackageById(parseInt(id));
        
        if (!package) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }
        
        const basePrice = package.price;
        const taxRate = (package.tax_rate === 0 || (typeof package.tax_rate === 'number' && package.tax_rate > -1))
            ? Number(package.tax_rate)
            : 11.00;
        const priceWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
        
        res.json({
            success: true,
            package: {
                id: package.id,
                name: package.name,
                base_price: basePrice,
                tax_rate: taxRate,
                price_with_tax: priceWithTax
            }
        });
    } catch (error) {
        logger.error('Error calculating price with tax:', error);
        res.status(500).json({
            success: false,
            message: 'Error calculating price with tax',
            error: error.message
        });
    }
});

module.exports = router;