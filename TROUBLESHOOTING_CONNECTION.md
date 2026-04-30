# 🔧 Troubleshooting: ERR_CONNECTION_REFUSED pada Server Baru

## ❌ Masalah: `ERR_CONNECTION_REFUSED` saat mengakses UI

Error ini terjadi ketika server tidak berjalan atau tidak listening di IP/port yang benar.

## 🔍 Langkah Troubleshooting

### 1. ✅ Cek Apakah Aplikasi Sudah Berjalan

```bash
# Cek dengan PM2
pm2 status

# Cek dengan systemctl (jika menggunakan systemd)
systemctl status cvlintasmultimedia

# Cek dengan netstat/ss
ss -tlnp | grep :4555
# atau
netstat -tlnp | grep :4555
```

**Jika aplikasi tidak berjalan:**
```bash
cd /path/to/BillCVLmedia
npm install
pm2 start app.js --name cvlmedia
pm2 save
```

### 2. ✅ Cek Dependencies Sudah Terinstall

```bash
cd /path/to/BillCVLmedia
npm install

# Jika ada error dengan sqlite3
npm rebuild sqlite3
# atau
npm install sqlite3 --build-from-source
```

### 3. ✅ Cek File `settings.json` Sudah Ada

```bash
cd /path/to/BillCVLmedia
ls -la settings.json

# Jika belum ada, copy dari template
cp settings.example.json settings.json
# atau
cp settings.server.template.json settings.json

# Edit settings.json
nano settings.json
```

**Minimal konfigurasi di `settings.json`:**
```json
{
  "server_port": 4555,
  "admins.0": "6281368888498",
  "genieacs_url": "http://192.168.8.89:7557",
  "genieacs_username": "admin",
  "genieacs_password": "admin",
  "mikrotik_host": "192.168.8.1",
  "mikrotik_user": "admin",
  "mikrotik_password": "admin"
}
```

### 4. ✅ Cek Port di Firewall

```bash
# Cek apakah port 4555 sudah dibuka
sudo ufw status
# atau
sudo firewall-cmd --list-ports

# Jika belum dibuka, buka port 4555
sudo ufw allow 4555/tcp
sudo ufw reload
# atau untuk firewalld
sudo firewall-cmd --permanent --add-port=4555/tcp
sudo firewall-cmd --reload
```

### 5. ✅ Cek Aplikasi Listening di IP yang Benar

```bash
# Cek IP server
ip addr show
# atau
hostname -I

# Cek apakah aplikasi listening di semua interface (0.0.0.0) atau hanya localhost
ss -tlnp | grep :4555
# Harus menunjukkan: 0.0.0.0:4555 atau 172.17.28.192:4555
```

**Jika hanya listening di 127.0.0.1 (localhost):**
- Edit `app.js` untuk bind ke 0.0.0.0 atau IP spesifik

### 6. ✅ Cek Database Sudah Di-Setup

```bash
cd /path/to/BillCVLmedia

# Cek apakah database sudah ada
ls -la data/billing.db

# Jika belum ada, jalankan setup script lengkap
bash setup.sh

# Script ini akan otomatis:
# - Setup payment gateway tables
# - Setup technician tables (PENTING!)
# - Run SQL migrations
# - Setup default data
```

**Jika error: `SQLITE_ERROR: no such table: technicians`**

Ini berarti tabel technicians belum dibuat. Jalankan script ini:

```bash
cd /path/to/BillCVLmedia

# Jalankan script untuk membuat tabel technicians
node scripts/add-technician-tables.js

# Setelah itu, restart aplikasi
pm2 restart BillCVLmedia
# atau
pm2 restart cvlmedia
```

### 7. ✅ Cek Logs Aplikasi

```bash
# Cek logs PM2
pm2 logs cvlmedia --lines 50

# Cek logs aplikasi langsung
tail -f logs/app.log
# atau
tail -f logs/error.log
```

**Cari error seperti:**
- Port already in use
- Cannot find module
- Database error
- Permission denied

### 8. ✅ Test Koneksi Lokal Dulu

```bash
# Test dari server sendiri
curl http://localhost:4555
curl http://127.0.0.1:4555
curl http://172.17.28.192:4555

# Jika localhost berhasil tapi IP tidak, berarti masalah di firewall atau binding
```

### 9. ✅ Cek Node.js Version

```bash
node --version
# Harus >= 14.0.0 (direkomendasikan v18+)

npm --version
# Harus >= 6.0.0
```

### 10. ✅ Setup Script Lengkap

Jika semua di atas sudah dicek, jalankan setup script lengkap:

```bash
cd /path/to/BillCVLmedia

# 1. Install dependencies
npm install

# 2. Setup database
bash setup.sh
# Script ini akan otomatis:
# - Setup payment gateway tables
# - Setup technician tables
# - Run SQL migrations
# - Setup default data
# - Install PM2
# - Start aplikasi

# 3. Cek status
pm2 status
pm2 logs cvlmedia --lines 20
```

## 🚀 Quick Fix Commands

```bash
# Stop aplikasi yang mungkin konflik
pm2 stop all
pkill -f node

# Install dependencies
cd /path/to/BillCVLmedia
npm install

# Setup database LENGKAP (PENTING!)
bash setup.sh

# Jika error "no such table: technicians", jalankan ini:
node scripts/add-technician-tables.js

# Start aplikasi
pm2 start app.js --name cvlmedia
pm2 save

# Buka firewall
sudo ufw allow 4555/tcp
sudo ufw reload

# Cek status
pm2 status
pm2 logs cvlmedia
```

## ⚠️ Error Khusus: Voucher Masuk ke `/admin/mikrotik` (PPPoE Users)

### Penyebab
Di server baru setelah `git clone`, voucher yang dibuat masuk ke `/admin/mikrotik` padahal seharusnya muncul di `/admin/hotspot`. Ini terjadi karena:
- **Tabel `voucher_revenue` belum dibuat** di database
- Sistem membedakan voucher dari PPPoE users berdasarkan tabel `voucher_revenue`
- Tanpa tabel ini, sistem tidak tahu mana yang voucher dan mana yang PPPoE user

### Solusi Cepat

```bash
cd /path/to/BillCVLmedia

# 1. Buat tabel voucher_revenue (PENTING!)
node scripts/create-voucher-revenue-table.js

# 2. Restart aplikasi
pm2 restart BillCVLmedia
# atau jika nama berbeda
pm2 restart cvlmedia

# 3. Verifikasi tabel sudah dibuat
sqlite3 data/billing.db "SELECT name FROM sqlite_master WHERE type='table' AND name='voucher_revenue';"

# 4. Cek apakah ada voucher yang sudah dibuat sebelumnya
sqlite3 data/billing.db "SELECT COUNT(*) as count FROM voucher_revenue;"
```

### Jika Voucher Sudah Terlanjur Dibuat

Jika voucher sudah dibuat sebelum tabel `voucher_revenue` dibuat, Anda perlu memindahkan data voucher ke tabel `voucher_revenue`:

```bash
cd /path/to/BillCVLmedia

# 1. Pastikan tabel voucher_revenue sudah dibuat
node scripts/create-voucher-revenue-table.js

# 2. Jika voucher sudah dibuat di RADIUS tapi belum ada di voucher_revenue,
#    Anda perlu membuat script untuk migrate data voucher yang sudah ada
#    (hubungi support untuk script migration)
```

### Verifikasi Setup Lengkap

```bash
cd /path/to/BillCVLmedia

# Jalankan setup script lengkap
bash setup.sh

# Script ini akan otomatis:
# - Setup payment gateway tables
# - Setup technician tables
# - Setup voucher_revenue table (BARU!)
# - Run SQL migrations
# - Setup default data
```

### Prevent Future Issues

Pastikan di server baru selalu jalankan:
```bash
bash setup.sh
```

Script ini sekarang sudah mencakup pembuatan tabel `voucher_revenue`.

---

## ⚠️ Error Khusus: `SQLITE_ERROR: no such table: technicians`

### Penyebab
Tabel `technicians` belum dibuat di database. Ini terjadi jika:
- Script `setup.sh` tidak dijalankan dengan lengkap
- Script `add-technician-tables.js` tidak dijalankan
- Database baru dibuat tanpa setup lengkap

### Solusi Cepat

```bash
cd /path/to/BillCVLmedia

# 1. Buat tabel technicians
node scripts/add-technician-tables.js

# 2. Restart aplikasi
pm2 restart BillCVLmedia
# atau jika nama berbeda
pm2 restart cvlmedia

# 3. Cek logs untuk memastikan tidak ada error lagi
pm2 logs BillCVLmedia --lines 20
```

### Verifikasi Tabel Sudah Dibuat

```bash
cd /path/to/BillCVLmedia

# Cek apakah tabel technicians sudah ada
sqlite3 data/billing.db "SELECT name FROM sqlite_master WHERE type='table' AND name='technicians';"

# Jika muncul "technicians", berarti tabel sudah ada
# Jika tidak muncul, jalankan lagi: node scripts/add-technician-tables.js
```

## 🌐 Akses Web Portal

Setelah semua setup selesai, akses:

- **Admin Dashboard**: `http://172.17.28.192:4555/admin/login`
- **Default Login**: admin / admin (atau sesuai konfigurasi)

**Pastikan menggunakan port yang benar (4555) di URL!**

## 📋 Checklist Instalasi

- [ ] Git clone repository sudah selesai
- [ ] `npm install` sudah dijalankan tanpa error
- [ ] File `settings.json` sudah dibuat dan dikonfigurasi
- [ ] Database sudah di-setup (`bash setup.sh`)
- [ ] Aplikasi sudah running (`pm2 status` menunjukkan running)
- [ ] Port 4555 sudah dibuka di firewall
- [ ] Aplikasi listening di IP yang benar (`ss -tlnp | grep :4555`)
- [ ] Test koneksi lokal berhasil (`curl http://localhost:4555`)

## 🆘 Jika Masih Error

1. **Cek logs detail:**
   ```bash
   pm2 logs cvlmedia --lines 100
   ```

2. **Cek error di console:**
   ```bash
   cd /path/to/BillCVLmedia
   node app.js
   # Perhatikan error yang muncul
   ```

3. **Cek database:**
   ```bash
   sqlite3 data/billing.db ".tables"
   sqlite3 data/billing.db "SELECT COUNT(*) FROM packages;"
   ```

4. **Hubungi support:**
   - GitHub Issues: https://github.com/enosrotua/BillCVLmedia/issues
   - WhatsApp: 0813-6888-8498

