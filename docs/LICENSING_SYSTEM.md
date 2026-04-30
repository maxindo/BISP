# Sistem Licensing untuk Billing CVLMEDIA

## 📋 **Mekanisme Kerja**

### **1. Trial Period (10 Hari)**
- **Saat aplikasi pertama kali diinstall**: Sistem otomatis memulai trial 10 hari
- **Tidak perlu license key**: Aplikasi dapat digunakan selama 10 hari tanpa input license
- **Trial dimulai**: Saat aplikasi pertama kali dijalankan atau saat database pertama kali dibuat
- **Trial berakhir**: Setelah 10 hari dari tanggal mulai trial

### **2. License Key (Permanen)**
- **Status**: Permanen (tidak ada batas waktu)
- **Cara aktivasi**: Input license key melalui halaman settings atau halaman khusus
- **Setelah aktivasi**: Trial period diabaikan, aplikasi dapat digunakan selamanya
- **Format**: License key berupa string unik (contoh: `CVLM-XXXX-XXXX-XXXX-XXXX`)

### **3. Blocking Mechanism**
- **Jika trial habis dan tidak ada license**: 
  - **Login diblokir**: Semua attempt login akan ditolak, meskipun username/password benar
  - **Reset password tidak membantu**: Blocking dilakukan di level middleware, bukan di level authentication
  - **Pesan error**: "Trial period telah berakhir. Silakan aktivasi license key untuk melanjutkan."

- **Jika license aktif**: 
  - **Login berjalan normal**: Semua fungsi aplikasi dapat digunakan
  - **Tidak ada batasan waktu**: License permanen berarti tidak ada expiry date

## 🔐 **Struktur Database**

### **Tabel `license`**
```sql
CREATE TABLE IF NOT EXISTS license (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'trial', -- 'trial', 'active', 'expired'
    trial_start_date DATETIME,
    trial_end_date DATETIME,
    activated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### **Kolom Keterangan:**
- `license_key`: Key/license yang diinput oleh user (NULL jika masih trial)
- `status`: Status license ('trial', 'active', 'expired')
- `trial_start_date`: Tanggal mulai trial (otomatis saat pertama kali install)
- `trial_end_date`: Tanggal akhir trial (trial_start_date + 10 hari)
- `activated_at`: Tanggal aktivasi license key (NULL jika belum aktif)

## 🔄 **Flow Sistem**

### **Scenario 1: First Install (Trial)**
1. Aplikasi pertama kali diinstall
2. Sistem cek apakah ada record di tabel `license`
3. Jika tidak ada, buat record baru dengan:
   - `status = 'trial'`
   - `trial_start_date = CURRENT_TIMESTAMP`
   - `trial_end_date = trial_start_date + 10 days`
   - `license_key = NULL`
4. Middleware cek status license setiap request
5. Jika masih dalam trial period, allow access
6. Jika trial habis, block access

### **Scenario 2: Aktivasi License Key**
1. User input license key melalui UI
2. Sistem validasi license key (format, checksum, dll)
3. Jika valid:
   - Update record license:
     - `license_key = <input_key>`
     - `status = 'active'`
     - `activated_at = CURRENT_TIMESTAMP`
   - Trial period diabaikan
   - Allow access selamanya
4. Jika tidak valid:
   - Tampilkan error: "License key tidak valid"
   - Tetap dalam status trial atau expired

### **Scenario 3: Trial Habis (No License)**
1. Middleware cek `trial_end_date` vs `CURRENT_TIMESTAMP`
2. Jika `CURRENT_TIMESTAMP > trial_end_date` dan `status != 'active'`:
   - Update `status = 'expired'`
   - Block semua request (kecuali halaman login dan aktivasi license)
   - Tampilkan pesan: "Trial period telah berakhir. Silakan aktivasi license key."
3. Login ditolak meskipun username/password benar

## 🛡️ **Security Features**

### **1. License Key Generation**
- Format: `CVLM-XXXX-XXXX-XXXX-XXXX` (20 karakter, 4 groups)
- Algoritma: MD5 hash dari server-specific info + salt + timestamp
- Checksum: Validasi format dan checksum sebelum aktivasi

### **2. Tamper Protection**
- License key disimpan di database (bukan di file)
- Tidak bisa diubah manual tanpa validasi
- Middleware cek di setiap request penting

### **3. Reset Protection**
- Reset password tidak mempengaruhi license status
- Blocking dilakukan di middleware, bukan di authentication
- Hanya aktivasi license yang bisa mengembalikan akses

## 📝 **Implementasi**

### **1. Middleware (`middleware/licenseCheck.js`)**
- Cek status license di setiap request
- Allow access jika:
  - Status = 'active' (license aktif)
  - Status = 'trial' dan masih dalam trial period
- Block access jika:
  - Status = 'expired' (trial habis)
  - Status = 'trial' tapi sudah lewat trial_end_date

### **2. License Manager (`config/licenseManager.js`)**
- `initializeLicense()`: Inisialisasi trial saat pertama install
- `checkLicenseStatus()`: Cek status license saat ini
- `validateLicenseKey(key)`: Validasi format dan checksum license key
- `activateLicense(key)`: Aktivasi license key jika valid
- `isTrialExpired()`: Cek apakah trial sudah habis

### **3. Routes (`routes/license.js`)**
- `GET /admin/license`: Halaman aktivasi license
- `POST /admin/license/activate`: Endpoint untuk aktivasi license
- `GET /admin/license/status`: API untuk cek status license

### **4. UI Integration**
- Tambahkan halaman `/admin/license` untuk input license key
- Tampilkan status license di dashboard admin
- Tampilkan countdown trial di dashboard (jika masih trial)

## 🎯 **Cara Penggunaan**

### **Untuk User:**
1. **Saat pertama install**: Aplikasi otomatis dalam mode trial 10 hari
2. **Selama trial**: Gunakan aplikasi seperti biasa, tidak ada perbedaan
3. **Sebelum trial habis**: Input license key melalui `/admin/license`
4. **Setelah aktivasi**: Aplikasi dapat digunakan selamanya

### **Untuk Developer:**
1. Generate license key menggunakan script: `node scripts/generate-license.js`
2. Berikan license key ke user
3. User input license key di aplikasi
4. Sistem otomatis validasi dan aktivasi

## ✅ **Checklist Implementasi**

- [x] Tabel database `license`
- [x] Middleware `licenseCheck`
- [x] License Manager (`config/licenseManager.js`)
- [x] Routes untuk aktivasi license
- [ ] UI untuk input license key (perlu dibuat view EJS)
- [x] Script generate license key (`scripts/generate-license.js`)
- [x] Integrasi ke route login admin
- [ ] Tampilkan status license di dashboard (opsional)
- [ ] Countdown trial di dashboard (opsional)

