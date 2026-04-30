# 🔄 Migrasi ke Mode RADIUS 100%

Panduan lengkap untuk mengubah billing system dari mode Mikrotik API ke mode RADIUS 100%.

## 📋 Daftar Isi

1. [Overview](#overview)
2. [Persiapan](#persiapan)
3. [Langkah Migrasi](#langkah-migrasi)
4. [Konfigurasi Mikrotik](#konfigurasi-mikrotik)
5. [Verifikasi](#verifikasi)
6. [Troubleshooting](#troubleshooting)

---

## Overview

### Mode RADIUS 100%

Dalam mode RADIUS 100%, semua operasi billing dilakukan melalui database RADIUS:
- ✅ **User Management**: Semua user dikelola di database RADIUS (tabel `radcheck`, `radusergroup`)
- ✅ **Profile Management**: Semua profile dikelola di database RADIUS (tabel `radgroupreply`)
- ✅ **Authentication**: Mikrotik menggunakan RADIUS untuk autentikasi user
- ✅ **Accounting**: Mikrotik mengirim accounting data ke RADIUS
- ❌ **Tidak Ada Koneksi API Mikrotik**: Billing tidak lagi menggunakan RouterOS API untuk mengelola user

### Perbedaan Mode

| Fitur | Mode Mikrotik API | Mode RADIUS 100% |
|-------|-------------------|------------------|
| User Management | Via RouterOS API | Via RADIUS Database |
| Profile Management | Via RouterOS API | Via RADIUS Database |
| Authentication | Local atau RADIUS | RADIUS Only |
| Koneksi ke Mikrotik | RouterOS API (port 8728) | RADIUS Protocol (port 1812/1813) |
| Data Storage | Mikrotik Router | RADIUS Database |

---

## Persiapan

### 1. Backup Data

Sebelum migrasi, backup semua data penting:

```bash
# Backup database billing
cp /home/enos/cvlmedia/data/billing.db /home/enos/cvlmedia/data/billing.db.backup.$(date +%Y%m%d)

# Backup database RADIUS (jika sudah ada)
mysqldump -u root -p radius > /root/radius_backup_$(date +%Y%m%d).sql

# Backup konfigurasi Mikrotik
# Export via Winbox atau terminal: /export file-name=mikrotik_backup.rsc
```

### 2. Pastikan FreeRADIUS Berjalan

```bash
# Cek status FreeRADIUS
systemctl status freeradius

# Jika belum running, start
systemctl start freeradius
systemctl enable freeradius
```

### 3. Pastikan Database RADIUS Siap

```bash
# Test koneksi ke database RADIUS
mysql -u radius -p radius -e "SELECT COUNT(*) FROM radcheck;"

# Pastikan tabel-tabel penting ada:
# - radcheck (untuk user credentials)
# - radusergroup (untuk user-group mapping)
# - radgroupreply (untuk profile attributes)
# - radacct (untuk accounting)
```

### 4. Konfigurasi FreeRADIUS Clients

Pastikan Mikrotik sudah dikonfigurasi sebagai client di FreeRADIUS:

```bash
# Edit /etc/freeradius/3.0/clients.conf
# Tambahkan entry untuk setiap Mikrotik router:

client mikrotik-router-1 {
    ipaddr = 192.168.1.1
    secret = testing123
    nas_type = other
    require_message_authenticator = no
}

# Restart FreeRADIUS
systemctl restart freeradius
```

---

## Langkah Migrasi

### Step 1: Migrasi User dari Mikrotik ke RADIUS

Jika Anda sudah punya user di Mikrotik yang ingin dipindahkan ke RADIUS:

```bash
# Gunakan script migrasi (jika tersedia)
cd /home/enos/cvlmedia/scripts
node sync-customers-to-radius.js

# Atau manual:
# 1. Export user dari Mikrotik
# 2. Import ke RADIUS database
```

**Catatan:** User yang sudah ada di billing database akan otomatis tersinkronisasi ke RADIUS saat mode RADIUS diaktifkan.

### Step 2: Migrasi Profile dari Mikrotik ke RADIUS

Profile di Mikrotik perlu dikonversi ke format RADIUS:

```bash
# Profile di Mikrotik menggunakan format:
# /ppp profile print
# /ip hotspot user profile print

# Profile di RADIUS menggunakan attribute di tabel radgroupreply:
# - MikroTik-Rate-Limit: "10M/10M" atau "10M/10M:20M/20M"
# - Session-Timeout: 3600 (dalam detik)
# - Idle-Timeout: 1800 (dalam detik)
# - Framed-IP-Address: IP address
# - dll
```

**Cara Migrasi:**
1. Export profile dari Mikrotik (via Winbox atau terminal)
2. Konversi ke format RADIUS attributes
3. Insert ke tabel `radgroupreply` di database RADIUS

### Step 3: Aktifkan Mode RADIUS di Billing

1. Login ke billing system
2. Buka menu: **Setting > RADIUS/Api Setup** atau `/admin/radius`
3. Pilih **Mode Autentikasi: RADIUS**
4. Isi konfigurasi RADIUS:
   - **RADIUS Host**: IP address RADIUS server (misal: `localhost` atau `192.168.1.100`)
   - **RADIUS User**: User database untuk billing (misal: `billing` atau `radius`)
   - **RADIUS Password**: Password database
   - **RADIUS Database**: Nama database (default: `radius`)
5. Klik **Simpan**

### Step 4: Test Koneksi RADIUS

Setelah menyimpan konfigurasi, test koneksi:

1. Klik tombol **Test Koneksi** di halaman setting RADIUS
2. Pastikan koneksi berhasil
3. Cek statistik user (total users, active connections, dll)

---

## Konfigurasi Mikrotik

Setelah mode RADIUS diaktifkan di billing, konfigurasi Mikrotik untuk menggunakan RADIUS.

### Untuk PPPoE

Lihat dokumentasi lengkap di: [MIKROTIK_RADIUS_SETUP.md](./MIKROTIK_RADIUS_SETUP.md#konfigurasi-pppoe-dengan-radius)

**Quick Setup:**
```bash
# 1. Tambahkan RADIUS server
/radius add name="RADIUS-Auth" address=192.168.1.100 secret=testing123 service=ppp authentication-port=1812 accounting-port=1813

# 2. Konfigurasi PPPoE server untuk menggunakan RADIUS
/interface pppoe-server server set [find service-name=pppoe] authentication=radius
```

### Untuk Hotspot

Lihat dokumentasi lengkap di: [MIKROTIK_RADIUS_SETUP.md](./MIKROTIK_RADIUS_SETUP.md#konfigurasi-hotspot-dengan-radius)

**Quick Setup:**
```bash
# 1. Tambahkan RADIUS server untuk Hotspot
/radius add name="RADIUS-Hotspot" address=192.168.1.100 secret=testing123 service=hotspot authentication-port=1812 accounting-port=1813

# 2. Konfigurasi Hotspot server untuk menggunakan RADIUS
/ip hotspot set [find name=hotspot1] authentication=radius
```

### Script Konfigurasi Otomatis

Gunakan script yang sudah disediakan:
- `MIKROTIK_RADIUS_PPPOE_CONFIG.rsc` - Untuk PPPoE
- `MIKROTIK_RADIUS_HOTSPOT_CONFIG.rsc` - Untuk Hotspot

Cara menggunakan:
1. Edit file `.rsc` dan sesuaikan IP address, secret, dll
2. Copy ke Mikrotik (via Winbox > Files)
3. Jalankan: `/import file-name=MIKROTIK_RADIUS_PPPOE_CONFIG.rsc`

---

## Verifikasi

### 1. Verifikasi Mode RADIUS Aktif

```bash
# Cek di billing system
# Menu: Setting > RADIUS/Api Setup
# Pastikan "Mode Autentikasi" = "RADIUS"
```

### 2. Verifikasi User di RADIUS

```bash
# Cek user di database RADIUS
mysql -u radius -p radius -e "SELECT username, attribute, value FROM radcheck WHERE attribute='Cleartext-Password' LIMIT 10;"

# Cek user-group mapping
mysql -u radius -p radius -e "SELECT username, groupname FROM radusergroup LIMIT 10;"
```

### 3. Verifikasi Profile di RADIUS

```bash
# Cek profile attributes
mysql -u radius -p radius -e "SELECT groupname, attribute, value FROM radgroupreply LIMIT 10;"
```

### 4. Test Login User

1. Coba login dengan user yang ada di RADIUS database
2. Pastikan user bisa login dan mendapatkan IP address
3. Cek rate limit, session timeout, dll sesuai dengan profile di RADIUS

### 5. Verifikasi Accounting

```bash
# Cek accounting data di RADIUS
mysql -u radius -p radius -e "SELECT username, acctstarttime, acctstoptime FROM radacct ORDER BY acctstarttime DESC LIMIT 10;"
```

---

## Troubleshooting

### Problem 1: Billing tidak bisa koneksi ke RADIUS database

**Solusi:**
```bash
# 1. Test koneksi manual
mysql -u billing -p'PASSWORD' -h localhost radius -e "SELECT 1;"

# 2. Cek konfigurasi di billing
# Menu: Setting > RADIUS/Api Setup
# Pastikan host, user, password, database benar

# 3. Cek user database ada dan punya privileges
mysql -u root -p
SELECT User, Host FROM mysql.user WHERE User = 'billing';
SHOW GRANTS FOR 'billing'@'localhost';
```

### Problem 2: User tidak bisa login (Authentication Failed)

**Solusi:**
```bash
# 1. Cek user ada di RADIUS database
mysql -u radius -p radius -e "SELECT * FROM radcheck WHERE username='USERNAME';"

# 2. Cek RADIUS server di Mikrotik
# /radius print

# 3. Cek log RADIUS
tail -f /var/log/freeradius/radius.log

# 4. Test authentication manual
radtest USERNAME PASSWORD localhost 0 testing123
```

### Problem 3: Profile tidak diterapkan (rate limit tidak bekerja)

**Solusi:**
```bash
# 1. Cek user-group mapping
mysql -u radius -p radius -e "SELECT * FROM radusergroup WHERE username='USERNAME';"

# 2. Cek profile attributes
mysql -u radius -p radius -e "SELECT * FROM radgroupreply WHERE groupname='PROFILE_NAME';"

# 3. Pastikan format attribute benar:
# - MikroTik-Rate-Limit: "10M/10M" atau "10M/10M:20M/20M"
# - Session-Timeout: 3600 (dalam detik)
```

### Problem 4: Accounting tidak berjalan

**Solusi:**
```bash
# 1. Cek accounting port di Mikrotik
# /radius print detail

# 2. Cek log accounting di RADIUS
tail -f /var/log/freeradius/radius.log | grep accounting

# 3. Cek data accounting di database
mysql -u radius -p radius -e "SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL;"
```

---

## Checklist Migrasi

- [ ] Backup database billing
- [ ] Backup database RADIUS (jika sudah ada)
- [ ] Backup konfigurasi Mikrotik
- [ ] Pastikan FreeRADIUS berjalan
- [ ] Pastikan database RADIUS siap
- [ ] Konfigurasi FreeRADIUS clients (Mikrotik sebagai client)
- [ ] Migrasi user dari Mikrotik ke RADIUS (jika perlu)
- [ ] Migrasi profile dari Mikrotik ke RADIUS (jika perlu)
- [ ] Aktifkan mode RADIUS di billing system
- [ ] Test koneksi RADIUS dari billing
- [ ] Konfigurasi Mikrotik untuk menggunakan RADIUS (PPPoE)
- [ ] Konfigurasi Mikrotik untuk menggunakan RADIUS (Hotspot)
- [ ] Test login user
- [ ] Verifikasi accounting berjalan
- [ ] Monitor selama 24 jam untuk memastikan semua berjalan normal

---

## Catatan Penting

1. **Mode RADIUS 100%**: Setelah migrasi, semua operasi billing dilakukan melalui RADIUS database, bukan lagi melalui RouterOS API
2. **Tidak Perlu Koneksi API Mikrotik**: Billing tidak lagi memerlukan koneksi RouterOS API (port 8728) untuk mengelola user
3. **Mikrotik sebagai NAS**: Mikrotik hanya berfungsi sebagai Network Access Server yang meneruskan request ke RADIUS
4. **Data di RADIUS**: Semua user, profile, dan konfigurasi sekarang dikelola di database RADIUS
5. **Backup Rutin**: Lakukan backup rutin database RADIUS karena semua data penting ada di sana

---

**Last Updated:** 2024-12-19
**Version:** 1.0

