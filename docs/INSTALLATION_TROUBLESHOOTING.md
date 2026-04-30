# 🔧 Panduan Troubleshooting Instalasi

## ❌ Error: `SQLITE_ERROR: no such table: invoices`

### 🎯 **Masalah yang Ditemukan**

Ketika menjalankan script `node scripts/add-payment-gateway-tables.js` pada instalasi baru, muncul error:

```
Error adding payment_gateway column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_token column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_url column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_status column: Error: SQLITE_ERROR: no such table: invoices
```

### 🔍 **Penyebab Masalah**

1. **Script `add-payment-gateway-tables.js` dirancang untuk instalasi fresh**, tetapi database sudah memiliki struktur yang lebih lengkap
2. **Tabel `invoices` sudah ada** dengan kolom-kolom payment gateway yang sudah terintegrasi
3. **Script mencoba menambahkan kolom yang sudah ada**, sehingga terjadi konflik

### ✅ **Solusi yang Diterapkan**

Script `add-payment-gateway-tables.js` telah diperbaiki dengan fitur-fitur berikut:

#### 🔍 **Smart Detection**
- **Cek keberadaan tabel** sebelum melakukan operasi
- **Cek keberadaan kolom** sebelum menambahkan kolom baru
- **Prevent duplicate operations** untuk menghindari error

#### 🛠️ **Improved Error Handling**
- **Graceful error handling** dengan try-catch
- **Informative logging** untuk setiap operasi
- **Idempotent operations** - bisa dijalankan berulang kali tanpa error

#### 📋 **New Features**
```javascript
// Function to check if table exists
function checkTableExists(tableName) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// Function to check if column exists in table
function checkColumnExists(tableName, columnName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
            if (err) reject(err);
            else {
                const exists = rows.some(col => col.name === columnName);
                resolve(exists);
            }
        });
    });
}
```

### 🚀 **Cara Menggunakan Script yang Sudah Diperbaiki**

#### **1. Jalankan Script**
```bash
cd /path/to/cvlintasmultimedia
node scripts/add-payment-gateway-tables.js
```

#### **2. Output yang Diharapkan**
```
🔍 Checking payment gateway database setup...
✅ invoices table found
✅ payment_gateway_transactions table already exists
✅ payment_gateway column already exists in invoices table
✅ payment_token column already exists in invoices table
✅ payment_url column already exists in invoices table
✅ payment_status column already exists in invoices table
📝 Creating indexes...
✅ Index created for payment_gateway_transactions invoice_id
✅ Index created for payment_gateway_transactions order_id
🎉 Payment gateway database setup completed successfully!
```

### 📋 **Struktur Database yang Benar**

#### **Tabel `invoices`**
```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'unpaid',
    payment_date DATETIME,
    payment_method TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Payment Gateway Columns (sudah terintegrasi)
    payment_url TEXT,
    payment_token VARCHAR(255),
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_gateway VARCHAR(50),
    -- Additional columns
    base_amount DECIMAL(10,2),
    tax_rate DECIMAL(5,2),
    description TEXT NULL,
    package_name TEXT NULL,
    invoice_type TEXT DEFAULT 'monthly' CHECK (invoice_type IN ('monthly', 'voucher', 'manual')),
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (package_id) REFERENCES packages (id)
);
```

#### **Tabel `payment_gateway_transactions`**
```sql
CREATE TABLE payment_gateway_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    gateway VARCHAR(50),
    order_id VARCHAR(100),
    payment_url TEXT,
    token VARCHAR(255),
    amount DECIMAL(10,2),
    status VARCHAR(50),
    payment_type VARCHAR(50),
    fraud_status VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(50),
    gateway_name VARCHAR(50),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
```

### 🔄 **Proses Instalasi yang Benar**

#### **1. Setup Awal**
```bash
# Clone repository
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd cvlintasmultimedia

# Install dependencies
npm install

# Setup database (jalankan aplikasi sekali untuk membuat tabel)
npm start
# Tekan Ctrl+C setelah aplikasi berjalan
```

#### **2. Setup Payment Gateway**
```bash
# Jalankan script payment gateway
node scripts/add-payment-gateway-tables.js
```

#### **3. Konfigurasi**
```bash
# Edit settings.json sesuai kebutuhan
nano settings.json

# Jalankan aplikasi
npm start
```

### 🛡️ **Prevention Tips**

#### **Untuk Developer**
1. **Selalu cek keberadaan tabel/kolom** sebelum operasi database
2. **Gunakan `CREATE TABLE IF NOT EXISTS`** untuk tabel baru
3. **Gunakan `ALTER TABLE` dengan cek kolom** untuk modifikasi
4. **Test script pada database yang sudah ada**

#### **Untuk User**
1. **Jalankan aplikasi sekali** sebelum menjalankan script database
2. **Backup database** sebelum menjalankan script migrasi
3. **Baca error message** dengan teliti untuk troubleshooting

### 📞 **Support**

Jika masih mengalami masalah:

1. **Cek log aplikasi** untuk error detail
2. **Verifikasi struktur database** dengan sqlite3
3. **Hubungi support**: 0813-6888-8498

---

## ❌ Error: `SQLITE_ERROR: no such column: invoice_type`

### 🎯 **Masalah yang Ditemukan**

Setelah `git clone` dan `setup.sh`, billing dashboard error dengan pesan:
```
SQLITE_ERROR: no such column: invoice_type
```

### 🔍 **Penyebab Masalah**

1. **Database kosong di server baru** - tidak ada data invoice untuk testing query
2. **Query billing dashboard** menggunakan kolom `invoice_type` yang memerlukan data untuk testing
3. **Tidak ada data default** yang dibuat saat fresh install

### ✅ **Solusi yang Diterapkan**

#### 🆕 **Script Baru: `setup-default-data.js`**

Script ini akan membuat data default yang diperlukan:

```javascript
// Script akan mengecek dan membuat:
- Default packages (jika belum ada)
- Default technicians (jika belum ada)  
- Default voucher pricing (jika belum ada)
- Default agents (jika belum ada)
- Default collectors (jika belum ada)
- Sample invoice untuk testing kolom invoice_type
```

#### 🔧 **Update `setup.sh`**

Script `setup.sh` sekarang otomatis menjalankan:
```bash
# Setup default data
if [ -f "scripts/setup-default-data.js" ]; then
    node scripts/setup-default-data.js
    echo "✅ Default data setup completed"
fi
```

### 🚀 **Cara Menggunakan**

#### **1. Setup Otomatis (Recommended)**
```bash
# Clone repository
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd cvlintasmultimedia

# Install dependencies
npm install

# Jalankan setup script lengkap
bash setup.sh
```

#### **2. Manual Setup**
```bash
# Jika sudah ada aplikasi yang error
node scripts/setup-default-data.js
pm2 restart cvlintasmultimedia
```

### 📋 **Output yang Diharapkan**

```
🚀 Setting up default data for new server...

📦 Step 1: Checking packages...
   ✅ Found 16 existing packages

👨‍💼 Step 2: Checking technicians...
   ✅ Found 1 existing technicians

🎫 Step 3: Checking voucher pricing...
   ✅ Found 9 existing voucher pricing

👤 Step 4: Checking agents...
   👤 No agents found, creating default agent...
   ✅ Default agent created (ID: 1)
   ✅ Agent balance created: Rp 100,000

💰 Step 5: Checking collectors...
   💰 No collectors found, creating default collector...
   ✅ Default collector created (ID: 7)

📄 Step 6: Creating sample invoice for testing...
   📄 No invoices found, creating sample invoice...
   ✅ Sample invoice created (ID: 80)

🎉 Default data setup completed successfully!
```

### 🛡️ **Prevention**

- **Script `setup.sh` sudah diupdate** untuk otomatis menjalankan `setup-default-data.js`
- **Database kosong** akan otomatis terisi dengan data default
- **Billing dashboard** akan berfungsi normal setelah setup

---

## ❌ Error: `SQLITE_ERROR: no such table: technicians`

### 🎯 **Masalah yang Ditemukan**

Aplikasi error saat startup karena tabel `technicians` tidak ada.

### 🔍 **Penyebab Masalah**

Script `add-technician-tables.js` tidak dijalankan saat setup.

### ✅ **Solusi yang Diterapkan**

Script `setup.sh` sudah diupdate untuk otomatis menjalankan:
```bash
# Setup technician tables
if [ -f "scripts/add-technician-tables.js" ]; then
    node scripts/add-technician-tables.js
    echo "✅ Technician tables setup completed"
fi
```

### 🚀 **Manual Fix**

```bash
node scripts/add-technician-tables.js
pm2 restart cvlintasmultimedia
```

---

## ❌ Error: `Cannot find module './settings'`

### 🎯 **Masalah yang Ditemukan**

Aplikasi error saat startup karena import module salah.

### 🔍 **Penyebab Masalah**

File `config/billing.js` memiliki import yang salah di baris 3102 dan 3212.

### ✅ **Solusi yang Diterapkan**

Import sudah diperbaiki di kode - tidak akan terjadi lagi.

### 🚀 **Manual Fix**

```bash
pm2 restart cvlintasmultimedia
```

---

## ❌ Error: `SQLITE_ERROR: no such column: whatsapp_group_id`

### 🎯 **Masalah yang Ditemukan**

Aplikasi error saat mengirim pesan ke technician group:
```
Error: SQLITE_ERROR: no such column: whatsapp_group_id
```

### 🔍 **Penyebab Masalah**

Kolom `whatsapp_group_id` belum ditambahkan ke tabel `technicians`. Migration SQL belum dijalankan.

### ✅ **Solusi yang Diterapkan**

#### 🆕 **Script Baru: `run-migrations.js`**

Script ini akan menjalankan semua SQL migrations dari folder `migrations/`:

```javascript
// Script features:
- Menjalankan semua SQL migrations secara berurutan
- Tracking migrations yang sudah diapply
- Handle triggers, transactions, dan edge cases
- Idempotent (aman dijalankan berulang kali)
- Skip error yang tidak relevan
```

#### 🔧 **Update `setup.sh`**

Script `setup.sh` sekarang otomatis menjalankan:
```bash
# Run SQL migrations
if [ -f "scripts/run-migrations.js" ]; then
    node scripts/run-migrations.js
    echo "✅ SQL migrations completed"
fi
```

### 🚀 **Cara Menggunakan**

#### **1. Setup Otomatis (Recommended)**
```bash
# Clone dan setup
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd cvlintasmultimedia
npm install
bash setup.sh
```

#### **2. Manual Fix**
```bash
# Jika sudah ada aplikasi yang error
node scripts/run-migrations.js
pm2 restart cvlintasmultimedia
```

### 📋 **Output yang Diharapkan**

```
🚀 Running database migrations...

📋 Found 26 migration files
✅ Already applied: 0 migrations

🔄 Applying add_whatsapp_group_to_technicians.sql...
   ✅ add_whatsapp_group_to_technicians.sql applied successfully

🎉 Migrations completed!
   📊 Applied 26 new migrations
   ✅ Total migrations: 26
```

### 🛡️ **Prevention**

- **Script `setup.sh` sudah diupdate** untuk otomatis menjalankan migrations
- **Kolom `whatsapp_group_id`** akan otomatis ditambahkan
- **Semua SQL migrations** akan diapply secara otomatis

---

## 🔄 **Setup Script Lengkap untuk Server Baru**

### **Proses Setup yang Benar**

```bash
# 1. Clone repository
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd cvlintasmultimedia

# 2. Install dependencies
npm install

# 3. Jalankan setup script lengkap
bash setup.sh

# 4. Start aplikasi
pm2 start app.js --name cvlintasmultimedia
pm2 save
pm2 startup
```

### **Script `setup.sh` Sekarang Akan Otomatis:**

- ✅ Setup payment gateway tables
- ✅ Setup technician tables  
- ✅ Run SQL migrations (26 migrations)
- ✅ Setup default data (packages, technicians, voucher pricing, agents, collectors, sample invoice)
- ✅ Membuat logs directory
- ✅ Install PM2
- ✅ Start aplikasi

### **Verifikasi Setup Berhasil**

```bash
# 1. Cek status aplikasi
pm2 status

# 2. Cek logs aplikasi
pm2 logs cvlintasmultimedia --lines 20

# 3. Cek database
sqlite3 data/billing.db "SELECT COUNT(*) as packages FROM packages;"
sqlite3 data/billing.db "SELECT COUNT(*) as technicians FROM technicians;"
sqlite3 data/billing.db "SELECT COUNT(*) as invoices FROM invoices;"

# 4. Akses web interface
# Buka browser ke http://server-ip:3003
# Login dengan kredensial admin
# Cek billing dashboard tidak error
```

---

## 🆘 **Troubleshooting Lanjutan**

### **Jika Masih Ada Masalah:**

```bash
# 1. Cek semua logs
pm2 logs cvlintasmultimedia --lines 50

# 2. Cek database schema
sqlite3 data/billing.db ".schema invoices"
sqlite3 data/billing.db ".schema technicians"

# 3. Reset database (HATI-HATI - akan menghapus semua data)
rm data/billing.db
bash setup.sh

# 4. Manual setup step by step
node scripts/add-payment-gateway-tables.js
node scripts/add-technician-tables.js
node scripts/run-migrations.js
node scripts/setup-default-data.js
pm2 restart cvlintasmultimedia
```

---

## 📞 **Contact Support**

Jika masalah masih berlanjut, hubungi:
- **Email:** info@alijaya.com
- **Phone:** 0813-6888-8498
- **GitHub:** https://github.com/enosrotua/cvlintasmultimedia/issues

---

**Dokumentasi ini dibuat untuk membantu troubleshooting instalasi CV Lintas Multimedia.**
