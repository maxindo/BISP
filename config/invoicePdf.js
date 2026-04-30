const path = require('path');
const ejs = require('ejs');
const puppeteer = require('puppeteer');
const logger = require('./logger');
const billingManager = require('./billing');
const { getSetting } = require('./settingsManager');

function buildAppSettings() {
    return {
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
}

async function renderInvoice(invoiceId) {
    const invoice = await billingManager.getInvoiceById(invoiceId);
    if (!invoice) {
        throw new Error(`Invoice not found for ID ${invoiceId}`);
    }

    const templatePath = path.join(__dirname, '../views/admin/billing/invoice-print.ejs');

    const html = await ejs.renderFile(
        templatePath,
        {
            title: 'Cetak Invoice',
            invoice,
            appSettings: buildAppSettings()
        },
        { async: true }
    );

    return { html, invoice };
}

async function generateInvoicePdf(invoiceId) {
    try {
        const { html, invoice } = await renderInvoice(invoiceId);

        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0.4cm',
                bottom: '0.4cm',
                left: '0.4cm',
                right: '0.4cm'
            }
        });

        await browser.close();

        const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);

        return {
            buffer,
            fileName: `Invoice-${invoice.invoice_number || invoiceId}.pdf`,
            invoice
        };
    } catch (error) {
        logger.error('Error generating invoice PDF:', error);
        throw error;
    }
}

module.exports = {
    generateInvoicePdf
};

