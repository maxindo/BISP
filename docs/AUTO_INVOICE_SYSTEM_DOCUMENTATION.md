# 📅 Sistem Auto-Invoice dan Reminder

## 📋 Deskripsi

Sistem auto-invoice telah diperbaiki untuk memastikan:
1. **Invoice terbit otomatis setiap tanggal 1** setiap bulan
2. **Tidak ada duplikasi invoice** saat jatuh tempo
3. **Reminder otomatis** untuk invoice yang jatuh tempo atau terlambat
4. **Logika renewal** yang benar untuk tanggal jatuh tempo

## ⏰ Jadwal Otomatis

### **Cron Jobs yang Aktif:**

| Waktu | Fungsi | Deskripsi |
|-------|--------|-----------|
| `0 8 1 * *` | Generate Monthly Invoices | Membuat invoice untuk semua pelanggan aktif setiap tanggal 1 jam 08:00 |
| `0 9 * * *` | Due Date Reminders | Mengirim reminder untuk invoice yang jatuh tempo atau terlambat setiap hari jam 09:00 |
| `0 */6 * * *` | Voucher Cleanup | Membersihkan voucher yang expired setiap 6 jam |
| `59 23 1 * *` | Monthly Summary | Generate summary bulanan setiap tanggal 1 jam 23:59 |
| `1 0 1 * *` | Monthly Reset | Reset counter bulanan setiap tanggal 1 jam 00:01 |

**Timezone:** Asia/Jakarta

## 🔄 Logika Invoice Generation

### **1. Generate Monthly Invoices (Tanggal 1)**

**Fungsi:** `generateMonthlyInvoices()`

**Proses:**
1. Ambil semua pelanggan aktif yang memiliki package
2. Cek apakah sudah ada invoice untuk bulan ini (mencegah duplikasi)
3. Hitung tanggal jatuh tempo berdasarkan `renewal_type`:
   - **Fix Date:** Gunakan `fix_date` atau `billing_day`
   - **Renewal:** Gunakan `billing_day`
4. Buat invoice dengan PPN calculation
5. Kirim notifikasi WhatsApp

**Contoh:**
```javascript
// Fix Date customer
if (renewalType === 'fix_date') {
    const fixDate = customer.fix_date || customer.billing_day || 15;
    const targetDay = Math.min(fixDate, 28);
    const finalDay = Math.min(targetDay, lastDayOfMonth);
    dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), finalDay);
}

// Renewal customer
else {
    const billingDay = Math.min(Math.max(parseInt(customer.billing_day), 1), 28);
    const targetDay = Math.min(billingDay, lastDayOfMonth);
    dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), targetDay);
}
```

### **2. Due Date Reminders (Harian)**

**Fungsi:** `sendDueDateReminders()`

**Proses:**
1. Ambil semua invoice dengan status 'unpaid'
2. Filter invoice yang jatuh tempo hari ini atau terlambat
3. Kirim reminder WhatsApp untuk setiap invoice
4. **TIDAK membuat invoice baru** (hanya reminder)

**Filter:**
```javascript
const dueInvoices = invoices.filter(invoice => {
    if (invoice.status !== 'unpaid') return false;
    
    const dueDate = new Date(invoice.due_date);
    const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    
    // Send reminder for invoices due today or overdue (0 or negative days)
    return daysUntilDue <= 0;
});
```

## 🚫 Pencegahan Duplikasi

### **1. Cek Invoice Existing**
```javascript
const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
    customer.username,
    startOfMonth,
    endOfMonth
);

if (existingInvoices.length > 0) {
    logger.info(`Invoice already exists for customer ${customer.username} this month`);
    continue; // Skip creating new invoice
}
```

### **2. Hapus Auto-Generate dari Payment**
- **Sebelum:** `recordPayment()` otomatis membuat invoice berikutnya
- **Sesudah:** `recordPayment()` hanya mencatat pembayaran
- **Alasan:** Mencegah duplikasi dengan scheduler bulanan

## 📊 Status Saat Ini

### **Test Results:**
```
✅ Monthly invoice generation: Every 1st at 08:00
✅ Daily due date reminders: Every day at 09:00
✅ Voucher cleanup: Every 6 hours
✅ Found 10 active customers with packages
✅ Found 10 invoices for current month
✅ Found 3 overdue invoices
✅ Fix Date customers: 0
✅ Renewal customers: 10
```

### **Sample Data:**
- **Active Customers:** 10 pelanggan dengan renewal_type = 'renewal'
- **Current Month Invoices:** 10 invoice (7 paid, 3 unpaid)
- **Overdue Invoices:** 3 invoice terlambat (8-44 hari)

## 🔧 Konfigurasi

### **File Utama:**
- **Scheduler:** `config/scheduler.js`
- **Billing Manager:** `config/billing.js`
- **WhatsApp Notifications:** `config/whatsapp-notifications.js`

### **Database Tables:**
- **customers:** `renewal_type`, `fix_date`, `billing_day`
- **invoices:** `due_date`, `status`, `notes`
- **payments:** `invoice_id`, `amount`, `payment_method`

## 📱 Notifikasi WhatsApp

### **1. Invoice Created Notification**
Dikirim saat invoice baru dibuat (tanggal 1):
```
📋 *TAGIHAN BARU*

Halo [Customer Name],

Tagihan bulanan Anda telah dibuat:

📄 *No. Invoice:* INV-202501-XXXX
💰 *Jumlah:* Rp XXX.XXX
📅 *Jatuh Tempo:* XX Januari 2025
📦 *Paket:* [Package Name]

Silakan lakukan pembayaran sebelum jatuh tempo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CV Lintas Multimedia
Internet Tanpa Batas
```

### **2. Due Date Reminder**
Dikirim untuk invoice yang jatuh tempo atau terlambat:
```
⚠️ *PENGINGAT JATUH TEMPO*

Halo [Customer Name],

Tagihan Anda akan jatuh tempo:

📄 *No. Invoice:* INV-202501-XXXX
💰 *Jumlah:* Rp XXX.XXX
📅 *Jatuh Tempo:* XX Januari 2025
📦 *Paket:* [Package Name]

Silakan lakukan pembayaran segera untuk menghindari denda keterlambatan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CV Lintas Multimedia
Internet Tanpa Batas
```

## 🧪 Testing

### **Test Script:** `scripts/test-auto-invoice-system.js`

**Test Coverage:**
1. ✅ Scheduler configuration
2. ✅ Customers with renewal settings
3. ✅ Current month invoices
4. ✅ Overdue invoices
5. ✅ Renewal type logic
6. ✅ Invoice generation logic
7. ✅ Reminder system

### **Manual Test:**
```bash
# Test manual invoice generation
curl -X POST http://localhost:3003/admin/billing/auto-invoice/generate

# Check scheduler status
curl http://localhost:3003/admin/billing/auto-invoice
```

## 📝 Log Monitoring

### **Log Messages:**
```
[INFO] Starting automatic monthly invoice generation (08:00)...
[INFO] Found X active customers for invoice generation
[INFO] Invoice already exists for customer [username] this month
[INFO] Created invoice INV-XXXX for customer [username]
[INFO] WhatsApp notification sent for invoice INV-XXXX
[INFO] Starting daily due date reminders...
[INFO] Found X invoices due today or overdue
[INFO] Due date reminder sent for invoice INV-XXXX
```

### **Log Files:**
- **Main Log:** `logs/app.log`
- **Error Log:** `logs/error.log`
- **WhatsApp Log:** `logs/whatsapp.log`

## ✅ Checklist Verifikasi

- ✅ Invoice terbit otomatis setiap tanggal 1 jam 08:00
- ✅ Tidak ada duplikasi invoice saat jatuh tempo
- ✅ Reminder dikirim untuk invoice yang jatuh tempo/terlambat
- ✅ Logika renewal (Fix Date vs Renewal) bekerja dengan benar
- ✅ WhatsApp notifications aktif
- ✅ Pencegahan duplikasi dengan date range check
- ✅ Scheduler berjalan dengan timezone Asia/Jakarta
- ✅ Error handling untuk setiap proses
- ✅ Logging yang komprehensif

---

**Status: ✅ COMPLETE**

Sistem auto-invoice telah diperbaiki dan berjalan dengan sempurna sesuai permintaan!
