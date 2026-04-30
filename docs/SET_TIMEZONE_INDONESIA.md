# ⏰ Setting Timezone Server ke Waktu Indonesia (WIB)

## 📋 Status
Timezone server sudah diubah dari **UTC** ke **Asia/Jakarta (WIB, UTC+7)**.

## ✅ Perubahan yang Dilakukan

### 1. Set Timezone System
```bash
sudo timedatectl set-timezone Asia/Jakarta
```

### 2. Enable NTP Sync
```bash
sudo timedatectl set-ntp true
```

### 3. Sync Hardware Clock
```bash
sudo hwclock --systohc
```

## 🔍 Verifikasi

### Cek Timezone
```bash
timedatectl
```

**Output yang diharapkan:**
```
Time zone: Asia/Jakarta (WIB, +0700)
Local time: [waktu lokal Indonesia]
```

### Cek Waktu
```bash
date
```

**Output yang diharapkan:**
```
[waktu dalam format Indonesia dengan WIB]
```

## 📝 Catatan Penting

### 1. Aplikasi Node.js
Aplikasi sudah dikonfigurasi untuk menggunakan timezone server secara otomatis:
- File: `app.js` - Set `process.env.TZ` dari `getServerTimezone()`
- File: `config/settingsManager.js` - Function `getServerTimezone()` membaca dari system

### 2. Database
Database (MariaDB/MySQL) juga perlu diset timezone-nya:
```sql
SET GLOBAL time_zone = '+07:00';
SET time_zone = '+07:00';
```

Atau tambahkan di `/etc/mysql/mariadb.conf.d/50-server.cnf`:
```ini
[mysqld]
default-time-zone = '+07:00'
```

### 3. FreeRADIUS
FreeRADIUS akan menggunakan timezone system secara otomatis.

### 4. Log Files
Log files sudah dikonfigurasi untuk menggunakan timezone Asia/Jakarta:
- File: `config/logger.js` - Default timezone: `Asia/Jakarta`

## 🔄 Restart Services

Setelah perubahan timezone, restart services yang menggunakan waktu:

```bash
# Restart aplikasi Node.js
pm2 restart all
# atau
systemctl restart your-app-service

# Restart MariaDB (jika perlu)
sudo systemctl restart mariadb

# Restart FreeRADIUS (jika perlu)
sudo systemctl restart freeradius
```

## 🐛 Troubleshooting

### Waktu tidak sinkron

**Solusi:**
```bash
# Restart NTP service
sudo systemctl restart systemd-timesyncd

# Force sync
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd

# Cek status
timedatectl status
```

### Database masih menggunakan UTC

**Solusi:**
```sql
-- Set timezone untuk session
SET time_zone = '+07:00';

-- Set timezone global (perlu restart MariaDB)
SET GLOBAL time_zone = '+07:00';

-- Verifikasi
SELECT NOW();
```

### Aplikasi masih menunjukkan waktu salah

**Solusi:**
1. Restart aplikasi Node.js
2. Pastikan `getServerTimezone()` membaca timezone yang benar
3. Cek log aplikasi untuk konfirmasi timezone

## 📚 Referensi

- **WIB (Waktu Indonesia Barat)**: UTC+7
- **WITA (Waktu Indonesia Tengah)**: UTC+8
- **WIT (Waktu Indonesia Timur)**: UTC+9

Untuk server di Indonesia, gunakan **Asia/Jakarta** (WIB).

---

**Last Updated**: 2025-12-09

