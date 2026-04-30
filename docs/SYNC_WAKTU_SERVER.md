# ⏰ Sinkronisasi Waktu Server, Database, dan Aplikasi

## 📋 Status
Semua komponen (Server Ubuntu, Database MariaDB, dan Aplikasi Billing) sudah dikonfigurasi untuk menggunakan waktu yang sama mengikuti timezone server.

## ✅ Konfigurasi yang Sudah Dilakukan

### 1. Server Ubuntu
- **Timezone**: Asia/Jakarta (WIB, UTC+7)
- **NTP Service**: Aktif
- **Command**: `sudo timedatectl set-timezone Asia/Jakarta`

### 2. Database MariaDB
- **Timezone**: SYSTEM (mengikuti timezone server)
- **Konfigurasi**: Tidak ada hardcode timezone di config
- **Status**: Database menggunakan timezone dari system

### 3. Aplikasi Billing
- **Timezone**: Mengikuti server via `getServerTimezone()`
- **Konfigurasi**: `app.js` membaca timezone dari system
- **Status**: Aplikasi menggunakan timezone server secara otomatis

## 🔍 Verifikasi

### Cek Waktu Server
```bash
date
# Output: [waktu dalam WIB]
```

### Cek Waktu Database
```sql
SELECT NOW(), @@session.time_zone;
-- Output: [waktu yang sama dengan server, timezone: SYSTEM]
```

### Cek Waktu Aplikasi
Aplikasi akan menggunakan timezone yang sama dengan server saat dijalankan.

## 🔄 Sinkronisasi NTP

Untuk memastikan waktu server selalu akurat, NTP service sudah diaktifkan:

```bash
# Cek status NTP
sudo systemctl status systemd-timesyncd

# Restart NTP jika perlu
sudo systemctl restart systemd-timesyncd

# Force sync
sudo timedatectl set-ntp true
```

## 📝 Catatan Penting

### 1. Database Timezone
Database menggunakan `SYSTEM` timezone, yang berarti:
- Mengikuti timezone server secara otomatis
- Tidak perlu hardcode timezone di config
- Akan berubah otomatis jika timezone server berubah

### 2. Aplikasi Timezone
Aplikasi membaca timezone dari:
1. Environment variable `TZ` (jika ada)
2. File `/etc/timezone`
3. Command `timedatectl show -p Timezone --value`
4. Fallback ke UTC jika tidak ditemukan

### 3. Restart Services
Setelah perubahan timezone, restart services:
```bash
# Restart aplikasi
pm2 restart all

# Restart database (jika perlu)
sudo systemctl restart mariadb
```

## 🎯 Hasil

Semua komponen sekarang menggunakan waktu yang sama:
- ✅ Server Ubuntu: Asia/Jakarta (WIB)
- ✅ Database MariaDB: SYSTEM (mengikuti server)
- ✅ Aplikasi Billing: Mengikuti server via `getServerTimezone()`

Tidak ada lagi perbedaan waktu antara server, database, dan aplikasi.

---

**Last Updated**: 2025-12-09

