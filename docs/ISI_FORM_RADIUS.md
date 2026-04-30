# 📝 Cara Isi Form Setting RADIUS

Berdasarkan setup FreeRADIUS Anda saat ini, berikut cara mengisi form:

## 🔍 Status Saat Ini

✅ FreeRADIUS sudah terinstall dan running  
✅ Database `radius` sudah ada  
✅ User MySQL `radius` sudah ada dengan password: `radius`

## 📋 Cara Isi Form

### **Opsi 1: Pakai User 'radius' (Quick Start - untuk testing)**

Isi form sebagai berikut:

| Field | Isian |
|-------|-------|
| **Mode Autentikasi** | Pilih **"RADIUS"** |
| **RADIUS Host** | `localhost` |
| **RADIUS User** | `radius` |
| **RADIUS Password** | `radius` |
| **RADIUS Database** | `radius` |

✅ **Klik Simpan**

### **Opsi 2: Setup Billing User (Recommended - untuk production)**

#### Step 1: Setup Billing User
```bash
cd /home/enos/FreeRADIUSPaket
sudo bash scripts/setup_billing_user.sh
```

Script akan:
- Membuat user `billing` di MySQL
- Generate password secara random
- Menampilkan credentials yang harus diisi

**⚠️ PENTING: Simpan credentials yang muncul!**

#### Step 2: Isi Form dengan Credentials dari Script

Contoh output script:
```
Host: localhost
User: billing
Password: abc123xyz456...
Database: radius
```

Isi form:
| Field | Isian |
|-------|-------|
| **Mode Autentikasi** | Pilih **"RADIUS"** |
| **RADIUS Host** | `localhost` |
| **RADIUS User** | `billing` |
| **RADIUS Password** | `abc123xyz456...` (password dari script) |
| **RADIUS Database** | `radius` |

✅ **Klik Simpan**

## 🧪 Test Koneksi

Setelah save, test apakah koneksi berhasil:

### Jika pakai user 'radius':
```bash
mysql -u radius -p'radius' -h localhost radius -e "SELECT COUNT(*) as total_users FROM radcheck;"
```

### Jika pakai user 'billing':
```bash
mysql -u billing -p'PASSWORD_DARI_SCRIPT' -h localhost radius -e "SELECT COUNT(*) as total_users FROM radcheck;"
```

Jika muncul angka (jumlah user), berarti koneksi **berhasil**! ✅

## ⚙️ Penjelasan Field

### **Mode Autentikasi**
- **RADIUS**: CVLMEDIA akan langsung akses database FreeRADIUS
- **Mikrotik API**: CVLMEDIA akan akses Mikrotik langsung (tanpa RADIUS)

### **RADIUS Host**
- IP atau hostname server FreeRADIUS
- Jika di server yang sama: `localhost`
- Jika di server berbeda: IP server (misal: `192.168.1.100`)

### **RADIUS User**
- Username untuk koneksi ke database MySQL/MariaDB
- Bisa pakai `radius` (default) atau `billing` (setelah setup)

### **RADIUS Password**
- Password untuk user database di atas
- Jika pakai user `radius`: password biasanya `radius` (cek di `/etc/freeradius/3.0/mods-available/sql`)
- Jika pakai user `billing`: password dari output script `setup_billing_user.sh`

### **RADIUS Database**
- Nama database FreeRADIUS
- Biasanya: `radius`

## ⚠️ Troubleshooting

### Form tidak bisa save
- Pastikan sudah login sebagai admin
- Cek browser console untuk error
- Refresh halaman dan coba lagi

### Error "Access denied for user"
- Pastikan password benar
- Pastikan user ada di database: `SELECT User FROM mysql.user WHERE User = 'radius';`
- Jika belum ada user `billing`, jalankan script setup dulu

### Error "Can't connect to MySQL"
- Pastikan MySQL/MariaDB running: `systemctl status mysql`
- Pastikan RADIUS Host benar
- Cek firewall tidak block port 3306

## ✅ Setelah Save

Setelah klik **Simpan**:
1. ✅ Konfigurasi tersimpan di database CVLMEDIA (`app_settings` table)
2. ✅ CVLMEDIA langsung bisa akses database RADIUS
3. ✅ Semua operasi CRUD user PPPoE akan otomatis pakai RADIUS

## 📝 Rekomendasi

- **Untuk Testing**: Pakai Opsi 1 (user `radius`)
- **Untuk Production**: Pakai Opsi 2 (user `billing`) - lebih secure dan dedicated untuk billing

---

**Last Updated:** 2024-11-03

