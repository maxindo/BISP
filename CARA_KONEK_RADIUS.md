# 🔗 Cara Koneksi CVLMEDIA ke FreeRADIUS

Panduan lengkap mengisi form **Setting RADIUS** di `/admin/radius`

## 📋 Langkah Setup

### 1. Setup Billing User di FreeRADIUS Database

Jalankan script untuk membuat user database khusus untuk billing:

```bash
cd /home/enos/FreeRADIUSPaket
sudo bash scripts/setup_billing_user.sh
```

Script ini akan:
- ✅ Membuat user `billing` di MySQL/MariaDB
- ✅ Memberikan privileges yang diperlukan
- ✅ Menampilkan **credentials** yang harus diisi di form

**⚠️ PENTING: Simpan credentials yang muncul!**

Contoh output:
```
✅ Billing user created successfully!
📝 Credentials:
   Host: localhost
   User: billing
   Password: abc123xyz456...
   Database: radius
```

### 2. Isi Form di CVLMEDIA

Buka halaman: **Setting > RADIUS/Api Setup** atau `/admin/radius`

Isi form sesuai:

#### **Mode Autentikasi**
- Pilih **"RADIUS"** jika ingin pakai FreeRADIUS database
- Pilih **"Mikrotik API"** jika ingin pakai Mikrotik langsung (tanpa RADIUS)

#### **RADIUS Host**
- Isi: `localhost` (jika FreeRADIUS di server yang sama)
- Atau: IP address FreeRADIUS server (misal: `192.168.1.100`)

#### **RADIUS User**
- Isi: `billing` (user database dari script setup_billing_user.sh)
- Atau: `radius` (jika belum setup billing user)

#### **RADIUS Password**
- Isi: **Password dari output script setup_billing_user.sh**
- Jika belum setup billing user: pakai password user `radius` (cek di `/etc/freeradius/3.0/mods-available/sql`)

#### **RADIUS Database**
- Isi: `radius` (default database FreeRADIUS)

### 3. Klik Simpan

Setelah klik **Simpan**, konfigurasi akan tersimpan di database dan langsung aktif!

## 🔍 Cara Cek Credentials yang Tersedia

### Jika sudah setup billing user:
```bash
# Cek di file credential (jika ada)
cat /root/.freeradius_billing_credentials

# Atau cek di database
mysql -u root
SELECT User, Host FROM mysql.user WHERE User = 'billing';
```

### Jika belum setup billing user:
```bash
# Cek credentials user 'radius' (default)
cat /etc/freeradius/3.0/mods-available/sql | grep -E "^(login|password)"

# Atau cek di database
mysql -u root
SELECT User, Host FROM mysql.user WHERE User = 'radius';
SHOW GRANTS FOR 'radius'@'localhost';
```

## ✅ Contoh Pengisian

### Skenario 1: Sudah Setup Billing User
```
Mode Autentikasi: RADIUS
RADIUS Host: localhost
RADIUS User: billing
RADIUS Password: (password dari setup_billing_user.sh)
RADIUS Database: radius
```

### Skenario 2: Belum Setup, Pakai User 'radius'
```
Mode Autentikasi: RADIUS
RADIUS Host: localhost
RADIUS User: radius
RADIUS Password: (cek di /etc/freeradius/3.0/mods-available/sql)
RADIUS Database: radius
```

### Skenario 3: Pakai Mikrotik API (Tidak Pakai RADIUS)
```
Mode Autentikasi: Mikrotik API
RADIUS Host: (bisa kosong atau localhost)
RADIUS User: (bisa kosong)
RADIUS Password: (bisa kosong)
RADIUS Database: (bisa kosong)
```

## 🧪 Test Koneksi

Setelah setup, test koneksi:

```bash
# Test dari CVLMEDIA server
mysql -u billing -p'YOUR_PASSWORD' -h localhost radius -e "SELECT COUNT(*) FROM radcheck;"

# Atau test dengan user radius
mysql -u radius -p'RADIUS_PASSWORD' -h localhost radius -e "SELECT COUNT(*) FROM radcheck;"
```

Jika berhasil, akan muncul jumlah user di database.

## ⚠️ Troubleshooting

### Error: "Access denied for user 'billing'@'localhost'"
**Solusi**: 
1. Pastikan sudah jalankan `setup_billing_user.sh`
2. Cek password sudah benar
3. Cek user ada di database: `SELECT User FROM mysql.user WHERE User = 'billing';`

### Error: "Can't connect to MySQL server"
**Solusi**:
1. Pastikan MySQL/MariaDB running: `systemctl status mysql` atau `systemctl status mariadb`
2. Pastikan RADIUS Host benar (localhost atau IP server)
3. Cek firewall tidak block port 3306

### Error: "Unknown database 'radius'"
**Solusi**:
1. Pastikan database `radius` sudah dibuat
2. Cek: `mysql -u root -e "SHOW DATABASES;" | grep radius`
3. Jika belum ada, import schema: `mysql -u root radius < /etc/freeradius/3.0/mods-config/sql/main/mysql/schema.sql`

## 📝 Catatan Penting

1. **Password Disimpan di Database CVLMEDIA**: Setelah save, password tersimpan di tabel `app_settings` di database CVLMEDIA (bukan settings.json)

2. **Backup Credentials**: Simpan credentials di tempat aman, karena tidak bisa di-read lagi setelah di-save (password ter-enkripsi/masked)

3. **Multiple Servers**: Jika FreeRADIUS di server berbeda, isi RADIUS Host dengan IP server tersebut

4. **Security**: User `billing` hanya punya privileges untuk SELECT/INSERT/UPDATE/DELETE di database `radius`, tidak bisa akses database lain

---

**Last Updated:** 2024-11-03

