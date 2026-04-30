# 📋 Cara Admin Melihat Password PPPoE Customer

## 🔍 Cara Melihat Password di UI

### 1. Melalui Halaman Detail Customer

1. Login ke admin panel
2. Buka menu **Billing > Pelanggan** (`/admin/billing/customers`)
3. Klik nama customer yang ingin dilihat password-nya
4. Atau langsung akses: `/admin/billing/customers/[nomor-telepon]`
5. Di halaman detail, scroll ke bagian **"Informasi Pelanggan"**
6. Password akan ditampilkan di field **"PPPoE Password"**
7. Klik tombol **mata (👁️)** untuk melihat password (show/hide)
8. Klik tombol **clipboard (📋)** untuk copy password ke clipboard

### 2. Melalui API (untuk integrasi)

```javascript
// GET /admin/billing/customers/:phone
// Response akan include pppoePassword jika user_auth_mode = 'radius'
```

## 🔄 Cara Kerja Sistem

### Mode RADIUS
- Password disimpan di database **RADIUS** (tabel `radcheck`)
- Sistem akan **otomatis mengambil** password dari RADIUS saat:
  - Membuka halaman detail customer
  - Melakukan update customer
  - Melihat informasi customer

### Mode Mikrotik API
- Password disimpan di **Mikrotik Router** (PPPoE Secret)
- Sistem akan mengambil password via **Mikrotik API**

## 📝 Catatan Penting

1. **Password tidak disimpan di billing database**
   - Password hanya ada di RADIUS atau Mikrotik
   - Sistem mengambil password secara real-time saat dibutuhkan

2. **Password yang di-generate otomatis**
   - Jika password di-generate otomatis (script sync), password akan ditampilkan di console
   - **SIMPAN PASSWORD** yang ditampilkan saat sync!
   - Atau lihat di halaman detail customer setelah sync

3. **Jika password tidak muncul**
   - Pastikan customer memiliki `pppoe_username`
   - Pastikan user sudah tercreate di RADIUS/Mikrotik
   - Cek konfigurasi `user_auth_mode` di `/admin/radius`
   - Cek koneksi ke RADIUS/Mikrotik

## 🔧 Troubleshooting

### Password tidak muncul di halaman detail

**Cek 1: User sudah tercreate di RADIUS?**
```bash
# Cek di database RADIUS
mysql -u radius -p
USE radius;
SELECT username, value FROM radcheck WHERE username = 'username_customer';
```

**Cek 2: Konfigurasi RADIUS benar?**
- Buka `/admin/radius`
- Pastikan `user_auth_mode = "radius"`
- Pastikan credentials RADIUS benar

**Cek 3: Customer punya pppoe_username?**
```bash
# Cek di billing database
sqlite3 data/billing.db "SELECT pppoe_username FROM customers WHERE phone = 'nomor-telepon';"
```

## 🚀 Sync Customer ke RADIUS

Jika ada customer yang belum tercreate di RADIUS:

```bash
cd /home/enozrotua/cvlmedia
node scripts/sync-customers-to-radius.js
```

Script akan:
- Mencari semua customer aktif dengan `pppoe_username`
- Membuat user di RADIUS jika belum ada
- Menampilkan password yang di-generate
- **SIMPAN PASSWORD** yang ditampilkan!

## 📱 Quick Access

**URL langsung ke detail customer:**
```
https://bill.cvlmedia.my.id/admin/billing/customers/6281368888498
```
(Ganti nomor telepon dengan nomor customer yang ingin dilihat)

