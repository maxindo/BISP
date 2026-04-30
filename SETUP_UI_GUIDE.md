# 🚀 Panduan Setup Billing System di UI - Dari Instalasi Hingga Produksi

## 📋 Daftar Isi

1. [Persiapan Setelah Instalasi](#persiapan-setelah-instalasi)
2. [Akses Web Interface](#akses-web-interface)
3. [Konfigurasi Step-by-Step](#konfigurasi-step-by-step)
4. [Verifikasi dan Testing](#verifikasi-dan-testing)
5. [Checklist Siap Produksi](#checklist-siap-produksi)

---

## 🎯 Persiapan Setelah Instalasi

### 1. Pastikan Aplikasi Berjalan

Setelah menjalankan `setup.sh`, pastikan aplikasi sudah berjalan:

```bash
# Cek status aplikasi
pm2 status

# Jika belum running, start aplikasi
pm2 start app.js --name cvlmedia

# Simpan konfigurasi PM2
pm2 save
```

### 2. Edit settings.json (Opsional - Bisa juga via UI)

Jika perlu, edit `settings.json` untuk konfigurasi dasar:

```bash
nano settings.json
```

**Minimal yang perlu diubah:**
- `admins.0`: Nomor WhatsApp admin
- `admin_username`: Username login admin
- `admin_password`: Password login admin (ubah dari default!)
- `server_host`: IP server atau domain
- `server_port`: Port aplikasi (default: 3003)

### 3. Akses Web Interface

Buka browser dan akses:
- **Local**: `http://localhost:3003`
- **Network**: `http://YOUR_SERVER_IP:3003`

**Default Login:**
- Username: `admin`
- Password: `admin`

⚠️ **PENTING**: Ubah password admin segera setelah login pertama!

---

## 🌐 Akses Web Interface

### Login ke Admin Panel

1. Buka browser dan akses: `http://YOUR_SERVER_IP:3003/admin/login`
2. Login dengan:
   - Username: `admin`
   - Password: `admin` (default)
3. Setelah login, Anda akan diarahkan ke Dashboard

---

## ⚙️ Konfigurasi Step-by-Step

Ikuti urutan konfigurasi berikut untuk memastikan semua setting dilakukan dengan benar:

### **STEP 1: Setting Umum** 📝

**Menu**: `Settingan` → `Setting Umum` atau `/admin/settings`

#### 1.1 Informasi Perusahaan

1. **Company Header**: Nama perusahaan (contoh: "JINOM-HOMENET")
2. **Company Slogan**: Tagline perusahaan
3. **Company Website**: Website perusahaan
4. **Logo**: Upload logo perusahaan (format: PNG, JPG, atau SVG, max 2MB)
5. **Footer Info**: Informasi footer (contoh: "Info Hubungi: 0813-6888-8498")

#### 1.2 Informasi Kontak

1. **Contact Phone**: Nomor telepon perusahaan
2. **Contact Email**: Email perusahaan
3. **Contact Address**: Alamat perusahaan
4. **Contact WhatsApp**: Nomor WhatsApp untuk customer service

#### 1.3 Informasi Pembayaran

1. **Payment Bank Name**: Nama bank (contoh: "BRI")
2. **Payment Account Number**: Nomor rekening
3. **Payment Account Holder**: Nama pemilik rekening
4. **Payment Cash Address**: Alamat untuk pembayaran tunai
5. **Payment Cash Hours**: Jam operasional (contoh: "08:00 - 20:00")
6. **Invoice Notes**: Catatan pada invoice

#### 1.4 Admin & Teknisi

1. **Admin Phone Numbers**: 
   - Tambahkan nomor WhatsApp admin (format: 628xxxxxxxxxx)
   - Bisa multiple admin
2. **Technician Phone Numbers**:
   - Tambahkan nomor WhatsApp teknisi
   - Bisa multiple teknisi
3. **Technician Group ID**: ID grup WhatsApp untuk teknisi (opsional)

#### 1.5 Konfigurasi Aplikasi

1. **App Name**: Nama aplikasi yang ditampilkan
2. **Server Host**: IP atau domain server
3. **Server Port**: Port aplikasi (default: 3003)
4. **Customer Portal OTP**: Enable/disable OTP untuk customer portal

**Klik "Simpan" setelah selesai mengisi semua field.**

---

### **STEP 2: Setting RADIUS** 🔐

**Menu**: `Settingan` → `Setting RADIUS` atau `/admin/radius`

⚠️ **PENTING**: Sistem ini menggunakan mode RADIUS 100%, jadi semua operasi user management dilakukan melalui database RADIUS.

#### 2.1 Konfigurasi Koneksi RADIUS

1. **Mode Autentikasi**: Otomatis ter-set ke "RADIUS" (tidak bisa diubah)
2. **RADIUS Host**: 
   - Jika FreeRADIUS di server yang sama: `localhost`
   - Jika di server berbeda: IP server FreeRADIUS (contoh: `192.168.1.100`)
3. **RADIUS User**: 
   - User database MySQL untuk akses database RADIUS
   - Default: `billing` atau `radius`
4. **RADIUS Password**: Password untuk user database
5. **RADIUS Database**: Nama database RADIUS (default: `radius`)

#### 2.2 Test Koneksi

1. Klik tombol **"Test Koneksi"** untuk memastikan koneksi berhasil
2. Jika berhasil, akan muncul pesan: "✅ Koneksi RADIUS berhasil!"
3. Jika gagal, periksa:
   - Apakah FreeRADIUS sudah terinstall dan running?
   - Apakah user database sudah dibuat dengan permission yang benar?
   - Apakah password benar?
   - Apakah firewall tidak memblokir koneksi?

#### 2.3 Simpan Konfigurasi

1. Klik **"Simpan"** untuk menyimpan konfigurasi
2. Pastikan muncul pesan sukses: "Pengaturan RADIUS berhasil disimpan ke database"

**Catatan**: 
- Konfigurasi RADIUS disimpan di database (`app_settings` table), bukan di `settings.json`
- Setelah disimpan, aplikasi akan otomatis menggunakan koneksi RADIUS untuk semua operasi

---

### **STEP 3: Setting Koneksi** 🔌

**Menu**: `Settingan` → `Setting Koneksi` atau `/admin/connection-settings`

Halaman ini memiliki 2 tab: **GenieACS Servers** dan **Routers**

#### 3.1 Tab: GenieACS Servers

Konfigurasi server GenieACS untuk monitoring perangkat:

1. **Add New Server**:
   - **Name**: Nama server (contoh: "GenieACS Main")
   - **URL**: URL GenieACS API (contoh: `http://192.168.1.100:7557`)
   - **Username**: Username untuk akses GenieACS
   - **Password**: Password untuk akses GenieACS
   - **Description**: Deskripsi server (opsional)

2. Klik **"Add Server"** untuk menambahkan
3. Untuk edit atau delete, gunakan tombol di tabel

**Verifikasi**:
- Pastikan URL GenieACS dapat diakses dari server billing
- Test koneksi dengan mengklik tombol test (jika ada)

#### 3.2 Tab: Routers

Konfigurasi router Mikrotik (untuk monitoring dan operasi tambahan):

1. **Add New Router**:
   - **Name**: Nama router (contoh: "Router Main")
   - **NAS IP**: IP address router Mikrotik
   - **Port**: Port API Mikrotik (default: 8728)
   - **Username**: Username API Mikrotik
   - **Password**: Password API Mikrotik
   - **Description**: Deskripsi router (opsional)

2. Klik **"Add Router"** untuk menambahkan
3. Untuk edit atau delete, gunakan tombol di tabel

**Catatan**: 
- Router ini digunakan untuk monitoring dan operasi tambahan
- User management dilakukan melalui RADIUS, bukan melalui API ini
- Pastikan router sudah dikonfigurasi untuk menggunakan RADIUS (lihat dokumentasi RADIUS)

---

### **STEP 4: Konfigurasi Hotspot (Jika Menggunakan Hotspot)** 📶

**Menu**: `HOTSPOT & VOUCHER` → `Server Hotspot` atau `/admin/hotspot/servers`

#### 4.1 Tambah Server Hotspot

1. Klik **"Add Server"**
2. Isi form:
   - **Name**: Nama server hotspot
   - **NAS IP**: IP address router hotspot
   - **Port**: Port API (default: 8728)
   - **Username**: Username API
   - **Password**: Password API
3. Klik **"Save"**

#### 4.2 Konfigurasi Profile Hotspot

**Menu**: `HOTSPOT & VOUCHER` → `Users Profiles` atau `/admin/hotspot/profiles`

1. Buat profile hotspot sesuai kebutuhan
2. Profile akan disinkronkan ke database RADIUS

---

### **STEP 5: Konfigurasi PPPoE (Jika Menggunakan PPPoE)** 🌐

**Menu**: `PPP CONNECTION` → `Profile PPPoE` atau `/admin/pppoe/profiles`

1. Buat profile PPPoE sesuai kebutuhan
2. Profile akan disinkronkan ke database RADIUS

---

### **STEP 6: Konfigurasi WhatsApp Bot** 📱

#### 6.1 Scan QR Code

1. **Menu**: `Settingan` → `Setting Umum` → Tab "WhatsApp"
2. Klik **"Refresh QR Code"** jika QR code belum muncul
3. Scan QR code dengan WhatsApp di smartphone
4. Tunggu sampai status berubah menjadi "Connected"

#### 6.2 Verifikasi Koneksi

1. Setelah terhubung, status akan menampilkan:
   - ✅ **Connected**: Bot sudah terhubung
   - Nomor WhatsApp yang digunakan
   - Info koneksi

2. Test dengan mengirim pesan ke nomor bot:
   - Kirim: `menu` atau `status`
   - Bot harus merespon

#### 6.3 Konfigurasi Notifikasi

Di **Setting Umum** → Tab "Notifikasi", konfigurasi:
- **PPPoE Notifications**: Enable/disable notifikasi login/logout
- **Offline Notifications**: Enable/disable notifikasi device offline
- **Rx Power Notifications**: Enable/disable notifikasi signal lemah
- **Trouble Report**: Enable/disable fitur laporan gangguan

---

### **STEP 7: Konfigurasi Paket & Harga** 💰

#### 7.1 Tambah Paket Internet

**Menu**: `Billing & Accounting` → `Paket Internet` atau `/admin/packages`

1. Klik **"Tambah Paket"**
2. Isi form:
   - **Nama Paket**: Nama paket (contoh: "Paket 10 Mbps")
   - **Kecepatan**: Kecepatan upload/download
   - **Harga**: Harga bulanan
   - **PPN**: Persentase PPN (jika ada)
   - **Profile**: Profile PPPoE atau Hotspot yang digunakan
3. Klik **"Simpan"**

#### 7.2 Konfigurasi Harga Voucher (Jika Menggunakan Voucher)

**Menu**: `HOTSPOT & VOUCHER` → `Buat Voucher` → Tab "Harga Voucher"

1. Set harga untuk setiap durasi voucher
2. Klik **"Simpan"**

---

### **STEP 8: Konfigurasi Auto Suspension** ⚠️

**Menu**: `Settingan` → `Setting Umum` → Tab "Auto Suspension"

1. **Auto Suspension Enabled**: Enable/disable fitur auto isolir
2. **Suspension Grace Period Days**: Hari tenggang sebelum isolir (contoh: 1 hari)
3. **Isolir Profile**: Nama profile isolir di RADIUS (contoh: "isolir")
4. **Suspension Bandwidth Limit**: Limit bandwidth saat isolir (contoh: "1k/1k")

**Klik "Simpan"**

---

## ✅ Verifikasi dan Testing

### 1. Verifikasi Koneksi RADIUS

1. Buka menu: `Settingan` → `Setting RADIUS`
2. Klik **"Test Koneksi"**
3. Pastikan muncul: "✅ Koneksi RADIUS berhasil!"

### 2. Test Tambah User

1. Buka menu: `PPP CONNECTION` → `User PPPoE` (atau `HOTSPOT & VOUCHER` → `Users Profiles`)
2. Klik **"Tambah User"**
3. Isi form dan simpan
4. Verifikasi user muncul di database RADIUS:
   ```bash
   mysql -u billing -p radius -e "SELECT username FROM radcheck WHERE username='USERNAME_YANG_DIBUAT';"
   ```

### 3. Test Login User

1. Test login dengan user yang baru dibuat
2. Pastikan user bisa login dan terhubung
3. Cek accounting di database RADIUS:
   ```bash
   mysql -u billing -p radius -e "SELECT * FROM radacct WHERE username='USERNAME' ORDER BY acctstarttime DESC LIMIT 1;"
   ```

### 4. Test WhatsApp Bot

1. Kirim pesan ke nomor bot: `menu`
2. Pastikan bot merespon dengan menu
3. Test perintah admin: `cekstatus NOMOR_PELANGGAN`

### 5. Test Notifikasi

1. Buat invoice untuk customer
2. Pastikan notifikasi WhatsApp terkirim
3. Test notifikasi isolir (jika ada customer yang jatuh tempo)

### 6. Test Web Portal Customer

1. Akses: `http://YOUR_SERVER_IP:3003`
2. Login dengan akun customer
3. Pastikan semua fitur berfungsi:
   - Lihat invoice
   - Lihat history pembayaran
   - Lihat status koneksi
   - Laporan gangguan

---

## 📋 Checklist Siap Produksi

Gunakan checklist berikut untuk memastikan sistem siap untuk produksi:

### ✅ Konfigurasi Dasar

- [ ] Password admin sudah diubah dari default
- [ ] Informasi perusahaan sudah lengkap (nama, logo, kontak)
- [ ] Informasi pembayaran sudah lengkap (rekening, alamat)
- [ ] Nomor admin WhatsApp sudah ditambahkan
- [ ] Nomor teknisi WhatsApp sudah ditambahkan (jika ada)

### ✅ Konfigurasi RADIUS

- [ ] Koneksi RADIUS berhasil di-test
- [ ] Konfigurasi RADIUS sudah disimpan
- [ ] User database RADIUS memiliki permission yang benar
- [ ] FreeRADIUS sudah running dan terkonfigurasi dengan benar
- [ ] Mikrotik sudah dikonfigurasi untuk menggunakan RADIUS

### ✅ Konfigurasi Koneksi

- [ ] GenieACS server sudah ditambahkan dan bisa diakses
- [ ] Router Mikrotik sudah ditambahkan (jika diperlukan)
- [ ] Test koneksi ke semua server/router berhasil

### ✅ Konfigurasi WhatsApp

- [ ] WhatsApp bot sudah terhubung (status: Connected)
- [ ] QR code sudah di-scan dan bot aktif
- [ ] Test perintah WhatsApp berhasil
- [ ] Notifikasi WhatsApp sudah dikonfigurasi

### ✅ Konfigurasi Paket & Profile

- [ ] Paket internet sudah dibuat
- [ ] Profile PPPoE/Hotspot sudah dibuat
- [ ] Profile sudah tersinkron ke database RADIUS
- [ ] Harga voucher sudah dikonfigurasi (jika menggunakan voucher)

### ✅ Testing Fungsional

- [ ] Test tambah user berhasil
- [ ] Test login user berhasil
- [ ] Test accounting masuk ke database RADIUS
- [ ] Test isolir/restore user berhasil
- [ ] Test notifikasi berhasil
- [ ] Test web portal customer berfungsi

### ✅ Keamanan

- [ ] Password admin sudah kuat
- [ ] Firewall sudah dikonfigurasi (jika ada)
- [ ] SSL/HTTPS sudah dikonfigurasi (disarankan untuk produksi)
- [ ] Backup database sudah dikonfigurasi

### ✅ Monitoring & Maintenance

- [ ] PM2 sudah dikonfigurasi untuk auto-start
- [ ] Log monitoring sudah dikonfigurasi
- [ ] Backup otomatis sudah dikonfigurasi (jika ada)
- [ ] Dokumentasi sudah lengkap

---

## 🚨 Troubleshooting

### Masalah: Koneksi RADIUS Gagal

**Solusi:**
1. Pastikan FreeRADIUS sudah running: `systemctl status freeradius`
2. Cek user database: `mysql -u root -p -e "SELECT User, Host FROM mysql.user WHERE User='billing';"`
3. Cek permission user: `mysql -u root -p -e "SHOW GRANTS FOR 'billing'@'localhost';"`
4. Test koneksi manual: `mysql -u billing -p radius -e "SELECT 1;"`

### Masalah: WhatsApp Bot Tidak Terhubung

**Solusi:**
1. Refresh QR code di menu Setting
2. Pastikan WhatsApp di smartphone terhubung ke internet
3. Cek log aplikasi: `pm2 logs cvlmedia`
4. Restart aplikasi: `pm2 restart cvlmedia`

### Masalah: User Tidak Bisa Login

**Solusi:**
1. Cek user di database RADIUS: `mysql -u billing -p radius -e "SELECT * FROM radcheck WHERE username='USERNAME';"`
2. Cek profile user: `mysql -u billing -p radius -e "SELECT * FROM radusergroup WHERE username='USERNAME';"`
3. Cek log FreeRADIUS: `tail -f /var/log/freeradius/radius.log`
4. Pastikan Mikrotik sudah dikonfigurasi untuk menggunakan RADIUS

### Masalah: Notifikasi Tidak Terkirim

**Solusi:**
1. Pastikan WhatsApp bot sudah terhubung
2. Cek nomor admin sudah benar di settings
3. Cek log aplikasi untuk error: `pm2 logs cvlmedia`
4. Test kirim pesan manual ke nomor bot

---

## 📞 Support

Jika mengalami masalah yang tidak bisa diselesaikan:

1. **Cek Dokumentasi**:
   - `RADIUS_MODE_README.md` - Dokumentasi mode RADIUS
   - `INSTALL.md` - Panduan instalasi
   - `docs/` - Dokumentasi lengkap

2. **Cek Log**:
   - Aplikasi: `pm2 logs cvlmedia`
   - FreeRADIUS: `tail -f /var/log/freeradius/radius.log`

3. **Hubungi Support**:
   - WhatsApp: 0813-6888-8498
   - Email: alijayanet@gmail.com

---

## 🎉 Selesai!

Setelah semua checklist terpenuhi, sistem billing Anda siap untuk produksi!

**Langkah Terakhir:**
1. Buat backup database: `pm2 logs cvlmedia > backup_logs.txt`
2. Dokumentasikan konfigurasi yang sudah dilakukan
3. Monitor sistem selama beberapa hari pertama
4. Siapkan rencana maintenance rutin

**Selamat! Sistem billing Anda sudah siap digunakan! 🚀**

