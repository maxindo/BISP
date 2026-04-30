# 🔒 Binding User/Voucher ke Server Hotspot Tertentu di Mode RADIUS

Dokumentasi lengkap untuk mengimplementasikan pembatasan user/voucher agar hanya bisa login di server hotspot tertentu.

## 📋 Daftar Isi

1. [Overview](#overview)
2. [Cara Kerja](#cara-kerja)
3. [Konfigurasi di Billing](#konfigurasi-di-billing)
4. [Konfigurasi di Mikrotik](#konfigurasi-di-mikrotik)
5. [Verifikasi](#verifikasi)
6. [Troubleshooting](#troubleshooting)

---

## Overview

Di mode RADIUS 100%, Anda dapat membatasi user/voucher agar hanya bisa login di server hotspot tertentu. Ini berguna untuk:

- **Location-based Access**: User A hanya bisa login di area SERVER A, User B hanya bisa login di area SERVER B
- **Security**: Mencegah user login di server yang tidak diizinkan
- **Load Balancing**: Distribusi user ke server tertentu

### Contoh Skenario

```
User A → Hanya bisa login di SERVER A
User B → Hanya bisa login di SERVER B

Jika User A mencoba login di area SERVER B → Login DITOLAK
Jika User B mencoba login di area SERVER A → Login DITOLAK
```

---

## Cara Kerja

### 1. Prinsip Dasar

RADIUS menggunakan attribute `Called-Station-Id` untuk mengidentifikasi server hotspot yang menerima request authentication. Attribute ini dikirim oleh Mikrotik ke RADIUS server saat user mencoba login.

### 2. Mekanisme di Database RADIUS

Sistem menyimpan binding server di tabel `radcheck` dengan:
- **Attribute**: `Called-Station-Id`
- **Operator**: `==` (equals - harus sama persis)
- **Value**: Nama server hotspot (misal: `hotspot1`, `hotspot-server-a`)

### 3. Proses Authentication

1. User mencoba login di server hotspot tertentu
2. Mikrotik mengirim request ke RADIUS dengan `Called-Station-Id` = nama server
3. RADIUS memeriksa di `radcheck`:
   - Jika user memiliki `Called-Station-Id` di `radcheck`
   - RADIUS membandingkan `Called-Station-Id` dari request dengan yang ada di database
   - Jika **SAMA** → Authentication **DITERIMA**
   - Jika **BERBEDA** → Authentication **DITOLAK**

### 4. Flow Diagram

```
User A Login di SERVER A
    ↓
Mikrotik mengirim: Called-Station-Id = "hotspot-server-a"
    ↓
RADIUS cek di radcheck:
    User A memiliki Called-Station-Id = "hotspot-server-a"
    ↓
    SAMA → ✅ Authentication DITERIMA

User A Login di SERVER B
    ↓
Mikrotik mengirim: Called-Station-Id = "hotspot-server-b"
    ↓
RADIUS cek di radcheck:
    User A memiliki Called-Station-Id = "hotspot-server-a"
    ↓
    BERBEDA → ❌ Authentication DITOLAK
```

---

## Konfigurasi di Billing

### 1. Membuat User/Voucher dengan Server Binding

Saat membuat user/voucher hotspot, pilih server hotspot yang diizinkan:

**Via Form Tambah User Hotspot:**
- Pilih **Server Hotspot** dari dropdown
- User akan otomatis dibinding ke server tersebut

**Via API/Code:**
```javascript
await addHotspotUserRadius(
    username,           // 'user-a'
    password,           // 'password123'
    profile,            // 'default-hotspot'
    comment,            // 'User A'
    server,             // 'hotspot-server-a' (NAMA SERVER)
    serverMetadata,     // { name: 'hotspot-server-a', nas_ip: '192.168.1.1', ... }
    limits              // { uptimeSeconds: 3600, validitySeconds: 86400 }
);
```

### 2. Data yang Disimpan di RADIUS

Sistem akan menyimpan di database RADIUS:

**Tabel `radcheck`:**
```sql
username = 'user-a'
attribute = 'Called-Station-Id'
op = '=='
value = 'hotspot-server-a'
```

**Tabel `radreply`:**
```sql
username = 'user-a'
attribute = 'Mikrotik-Server'
op = ':='
value = 'hotspot-server-a'
```

### 3. User Tanpa Server Binding (Global)

Jika user dibuat **tanpa** memilih server (atau memilih "All/Semua"), user tersebut bisa login di **semua server hotspot**.

**Cara membuat user global:**
- Biarkan field **Server Hotspot** kosong, atau
- Pilih "All" / "Semua" di dropdown server

---

## Konfigurasi di Mikrotik

### 1. Pastikan Server Hotspot Memiliki Nama yang Unik

Setiap server hotspot di Mikrotik harus memiliki **nama yang unik** dan **sama persis** dengan yang digunakan di billing.

```bash
# Cek nama server hotspot
/ip hotspot print

# Output contoh:
# 0 name="hotspot-server-a" interface=ether1 profile=default
# 1 name="hotspot-server-b" interface=ether2 profile=default
```

### 2. Pastikan RADIUS Mengirim Called-Station-Id

Mikrotik secara otomatis mengirim `Called-Station-Id` ke RADIUS saat authentication. `Called-Station-Id` berisi **nama server hotspot**.

**Verifikasi di FreeRADIUS:**
```bash
# Cek log RADIUS
tail -f /var/log/freeradius/radius.log

# Cari baris yang berisi "Called-Station-Id"
# Contoh output:
# (0) Received Access-Request Id 123 from 192.168.1.1:12345 to 192.168.1.100:1812
# (0)   Called-Station-Id = "hotspot-server-a"
# (0)   User-Name = "user-a"
```

### 3. Konfigurasi FreeRADIUS (Opsional)

Jika perlu, Anda bisa menambahkan konfigurasi khusus di FreeRADIUS untuk logging atau debugging:

**File: `/etc/freeradius/3.0/sites-available/default`**
```conf
# Pastikan attribute Called-Station-Id diproses
authorize {
    # ... existing modules ...
    # Called-Station-Id akan otomatis diproses oleh sql module
}
```

---

## Verifikasi

### 1. Cek Binding di Database RADIUS

```sql
-- Cek user yang dibinding ke server tertentu
SELECT username, attribute, op, value 
FROM radcheck 
WHERE attribute = 'Called-Station-Id';

-- Output contoh:
-- username    | attribute          | op | value
-- user-a      | Called-Station-Id   | == | hotspot-server-a
-- user-b      | Called-Station-Id   | == | hotspot-server-b
```

### 2. Test Login

**Test Case 1: User A di SERVER A (Harus Berhasil)**
```bash
# Login dengan user-a di hotspot-server-a
# Expected: ✅ Login berhasil
```

**Test Case 2: User A di SERVER B (Harus Gagal)**
```bash
# Login dengan user-a di hotspot-server-b
# Expected: ❌ Login ditolak (Access-Reject)
```

**Test Case 3: User Global di SERVER A (Harus Berhasil)**
```bash
# Login dengan user-global di hotspot-server-a
# Expected: ✅ Login berhasil (karena tidak ada binding)
```

### 3. Cek Log RADIUS

```bash
# Monitor log RADIUS saat test login
tail -f /var/log/freeradius/radius.log

# Cari baris yang berisi:
# - "Access-Accept" (login berhasil)
# - "Access-Reject" (login ditolak)
# - "Called-Station-Id" (server yang digunakan)
```

**Contoh Log (Login Berhasil):**
```
(0) Received Access-Request Id 123 from 192.168.1.1:12345
(0)   Called-Station-Id = "hotspot-server-a"
(0)   User-Name = "user-a"
(0) sql: Executing query: SELECT ...
(0) sql: User found in radcheck table
(0) sql: Checking Called-Station-Id: "hotspot-server-a" == "hotspot-server-a"
(0) sql: Called-Station-Id match!
(0) sql: User authenticated successfully
(0) Sending Access-Accept Id 123
```

**Contoh Log (Login Ditolak):**
```
(0) Received Access-Request Id 124 from 192.168.1.1:12345
(0)   Called-Station-Id = "hotspot-server-b"
(0)   User-Name = "user-a"
(0) sql: Executing query: SELECT ...
(0) sql: User found in radcheck table
(0) sql: Checking Called-Station-Id: "hotspot-server-b" == "hotspot-server-a"
(0) sql: Called-Station-Id mismatch!
(0) sql: Authentication failed
(0) Sending Access-Reject Id 124
```

---

## Troubleshooting

### Problem 1: User bisa login di semua server (tidak terbatas)

**Kemungkinan Penyebab:**
1. User tidak memiliki `Called-Station-Id` di `radcheck`
2. Nama server di Mikrotik tidak sama dengan yang di database
3. Operator di `radcheck` bukan `==` (equals)

**Solusi:**
```sql
-- 1. Cek apakah user memiliki Called-Station-Id
SELECT * FROM radcheck 
WHERE username = 'user-a' AND attribute = 'Called-Station-Id';

-- 2. Jika tidak ada, tambahkan:
INSERT INTO radcheck (username, attribute, op, value) 
VALUES ('user-a', 'Called-Station-Id', '==', 'hotspot-server-a');

-- 3. Pastikan operator adalah '==' (bukan '=' atau ':=')

-- 4. Cek nama server di Mikrotik
/ip hotspot print
```

### Problem 2: User tidak bisa login di server yang benar

**Kemungkinan Penyebab:**
1. Nama server di database berbeda dengan nama server di Mikrotik
2. Case-sensitive mismatch (huruf besar/kecil berbeda)
3. Ada spasi atau karakter khusus yang tidak terlihat

**Solusi:**
```sql
-- 1. Cek nama server yang tersimpan
SELECT username, value FROM radcheck 
WHERE username = 'user-a' AND attribute = 'Called-Station-Id';

-- 2. Cek nama server di Mikrotik
/ip hotspot print

-- 3. Pastikan nama SAMA PERSIS (case-sensitive, tanpa spasi)
-- Contoh:
-- Database: "hotspot-server-a"
-- Mikrotik: "hotspot-server-a"  ✅ BENAR
-- Mikrotik: "Hotspot-Server-A"  ❌ SALAH (case berbeda)
-- Mikrotik: "hotspot-server-a " ❌ SALAH (ada spasi)
```

### Problem 3: Called-Station-Id tidak dikirim oleh Mikrotik

**Kemungkinan Penyebab:**
1. Mikrotik tidak dikonfigurasi untuk mengirim Called-Station-Id
2. Versi RouterOS tidak mendukung

**Solusi:**
```bash
# 1. Pastikan menggunakan RouterOS versi terbaru
/system resource print

# 2. Cek konfigurasi RADIUS di Mikrotik
/radius print detail

# 3. Test dengan radtest atau cek log RADIUS
# Called-Station-Id seharusnya otomatis dikirim oleh Mikrotik
```

### Problem 4: User global tidak bisa login

**Kemungkinan Penyebab:**
1. User memiliki `Called-Station-Id` yang tidak seharusnya ada
2. Ada konfigurasi lain yang membatasi

**Solusi:**
```sql
-- Hapus Called-Station-Id untuk user global
DELETE FROM radcheck 
WHERE username = 'user-global' AND attribute = 'Called-Station-Id';
```

---

## Best Practices

### 1. Penamaan Server Hotspot

- Gunakan nama yang **deskriptif** dan **unik**
- Hindari spasi, gunakan `-` atau `_` sebagai separator
- Contoh: `hotspot-server-a`, `hotspot-area-1`, `hotspot-vlan-10`

### 2. Konsistensi Nama

- Pastikan nama server di **Mikrotik** sama persis dengan yang digunakan di **billing**
- Gunakan **lowercase** untuk konsistensi
- Hindari karakter khusus

### 3. User Global vs User Terbatas

- **User Global**: Untuk voucher yang bisa digunakan di semua area
- **User Terbatas**: Untuk voucher yang hanya bisa digunakan di area tertentu

### 4. Monitoring

- Monitor log RADIUS secara rutin
- Cek apakah ada user yang ditolak karena server mismatch
- Track penggunaan per server

---

## Contoh Implementasi Lengkap

### Skenario: 2 Server Hotspot

**Server A:**
- Nama: `hotspot-server-a`
- Interface: `ether1`
- IP Pool: `192.168.10.0/24`

**Server B:**
- Nama: `hotspot-server-b`
- Interface: `ether2`
- IP Pool: `192.168.20.0/24`

**User A:**
- Username: `user-a`
- Password: `pass123`
- Server: `hotspot-server-a` (hanya bisa login di SERVER A)

**User B:**
- Username: `user-b`
- Password: `pass456`
- Server: `hotspot-server-b` (hanya bisa login di SERVER B)

**Konfigurasi di Database RADIUS:**

```sql
-- User A
INSERT INTO radcheck (username, attribute, op, value) 
VALUES ('user-a', 'Cleartext-Password', ':=', 'pass123');

INSERT INTO radcheck (username, attribute, op, value) 
VALUES ('user-a', 'Called-Station-Id', '==', 'hotspot-server-a');

INSERT INTO radusergroup (username, groupname, priority) 
VALUES ('user-a', 'default-hotspot', 1);

-- User B
INSERT INTO radcheck (username, attribute, op, value) 
VALUES ('user-b', 'Cleartext-Password', ':=', 'pass456');

INSERT INTO radcheck (username, attribute, op, value) 
VALUES ('user-b', 'Called-Station-Id', '==', 'hotspot-server-b');

INSERT INTO radusergroup (username, groupname, priority) 
VALUES ('user-b', 'default-hotspot', 1);
```

**Hasil:**
- ✅ User A bisa login di SERVER A
- ❌ User A **TIDAK BISA** login di SERVER B
- ✅ User B bisa login di SERVER B
- ❌ User B **TIDAK BISA** login di SERVER A

---

## Catatan Penting

1. **Case-Sensitive**: Nama server **case-sensitive**. `hotspot-server-a` ≠ `Hotspot-Server-A`
2. **Operator `==`**: Harus menggunakan operator `==` (equals) untuk check yang ketat
3. **Called-Station-Id**: Attribute ini dikirim otomatis oleh Mikrotik, tidak perlu konfigurasi tambahan
4. **User Global**: User tanpa `Called-Station-Id` bisa login di semua server
5. **Multiple Servers**: Satu user **TIDAK BISA** dibinding ke multiple server (hanya satu server per user)

---

**Last Updated:** 2024-12-19
**Version:** 1.0

