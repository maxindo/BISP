# Analisis: Server Profile Hotspot di RADIUS vs Mikrotik API

## ⚠️ **PENTING: Perbedaan Konsep**

### 1. **User Profile** vs **Server Profile** di Mikrotik

#### **User Profile** (`/ip/hotspot/user/profile`)
- **Fungsi**: Konfigurasi untuk **user individual**
- **Parameter**: `rate-limit`, `session-timeout`, `idle-timeout`, `shared-users`, dll
- **Digunakan saat**: Membuat user hotspot dengan `/ip/hotspot/user/add`
- **Di RADIUS**: Disimpan sebagai `groupname` di `radusergroup` dan atribut di `radgroupreply`
- **Contoh**: User voucher dengan profile `VR10` akan mendapatkan rate limit dan session timeout sesuai profile tersebut

#### **Server Profile** (`/ip/hotspot/server/profile`)
- **Fungsi**: Konfigurasi untuk **hotspot server instance**
- **Parameter**: `rate-limit`, `session-timeout`, `idle-timeout`, `open-status-page`, `http-cookie-lifetime`, dll
- **Digunakan saat**: Membuat atau mengkonfigurasi hotspot server instance dengan `/ip/hotspot/server/add`
- **Di RADIUS**: **TIDAK ADA STANDAR** untuk menyimpan ini
- **Contoh**: Server instance yang menggunakan server profile `default` akan memiliki konfigurasi open-status-page dan http-cookie-lifetime sesuai profile tersebut

### 2. **Server Instance** vs **Server Profile**

#### **Server Instance** (`/ip/hotspot/server`)
- **Fungsi**: Hotspot server yang berjalan di interface tertentu
- **Parameter**: `interface`, `profile` (server profile), `address-pool`, `name`
- **Contoh**: `/ip/hotspot/server/add interface=ether1 profile=default name=hotspot-1`

#### **Server Profile** (`/ip/hotspot/server/profile`)
- **Fungsi**: Template konfigurasi untuk server instance
- **Digunakan oleh**: Server instance saat dibuat

## 🔍 **Analisis Implementasi Saat Ini**

### ✅ **Yang Sudah Benar:**
1. User Profile untuk voucher sudah benar (disimpan di `radgroupreply` sebagai `groupname`)
2. Fungsi `addHotspotUserRadius` sudah benar menggunakan `groupname` untuk profile

### ❌ **Yang Perlu Diperbaiki:**

1. **Server Profile di RADIUS tidak bisa diterapkan langsung ke user**
   - Server Profile adalah konfigurasi untuk **server instance**, bukan untuk **user**
   - Saat membuat user hotspot, kita hanya bisa menentukan:
     - `profile` (user profile) ✅
     - `server` (server instance name) - tapi ini tidak ada di RADIUS standar

2. **Parameter `server` di fungsi `generateHotspotVouchers` tidak digunakan**
   - Parameter `server` ada di fungsi `generateHotspotVouchers` (line 4714)
   - Tapi tidak diteruskan ke `addHotspotUser` (line 4801)
   - Tidak ada implementasi untuk menyimpan `server` ke RADIUS

3. **Server Profile yang dibuat di RADIUS tidak digunakan**
   - Server Profile disimpan di tabel `hotspot_server_profiles`
   - Tapi tidak digunakan saat membuat voucher
   - Tidak ada cara untuk mengikat Server Profile ke user voucher

## 💡 **Solusi yang Benar:**

### **Opsi 1: Gunakan Server Instance (bukan Server Profile) ✅ RECOMMENDED**
- Simpan nama **server instance** di `radreply` sebagai custom attribute
- Contoh: `Mikrotik-Server = hotspot-server-1`
- Saat user login, Mikrotik akan menggunakan server instance yang ditentukan
- **Implementasi**: Tambahkan parameter `server` ke `addHotspotUserRadius` dan simpan sebagai `Mikrotik-Server` di `radreply`

### **Opsi 2: Gunakan Server Profile sebagai Default**
- Server Profile digunakan untuk **konfigurasi default** hotspot server instance
- User tidak perlu menentukan server profile secara langsung
- Server instance akan menggunakan server profile yang sudah dikonfigurasi
- **Implementasi**: Tidak perlu perubahan, Server Profile hanya sebagai reference

### **Opsi 3: Simpan sebagai Metadata (Tidak Digunakan untuk Auth)**
- Server Profile disimpan hanya sebagai **metadata/referensi**
- Tidak mempengaruhi proses autentikasi RADIUS
- Digunakan untuk tracking/reporting saja
- **Implementasi**: Tidak perlu perubahan

## 🎯 **Rekomendasi:**

Berdasarkan analisis, **Server Profile seharusnya digunakan untuk konfigurasi Hotspot Server Instance**, bukan untuk user voucher. 

**Yang sebenarnya diperlukan untuk voucher:**
1. ✅ **User Profile** (sudah ada dan benar) - untuk rate limit, session timeout user
2. ❓ **Server Instance selection** (opsional) - untuk menentukan hotspot server mana yang digunakan

**Solusi yang disarankan:**
- Simpan Server Profile hanya sebagai **reference/metadata** di database
- Jika ingin menentukan server instance untuk voucher, gunakan custom attribute di `radreply`:
  - `Mikrotik-Server = <server-instance-name>`
- Atau gunakan Server Profile sebagai **default configuration** untuk hotspot server instance yang sudah dikonfigurasi di Mikrotik

## 📝 **Kesimpulan:**

Server Profile yang dibuat di RADIUS **tidak bisa langsung diterapkan ke user voucher** seperti di Mikrotik API, karena:
1. Server Profile adalah konfigurasi untuk server instance, bukan user
2. RADIUS tidak memiliki atribut standar untuk "server-profile" pada user
3. Yang diperlukan untuk voucher adalah User Profile (sudah ada)

**Rekomendasi**: Server Profile yang dibuat di RADIUS bisa digunakan sebagai:
- **Metadata/referensi** untuk tracking
- **Default configuration** yang akan diterapkan saat membuat hotspot server instance baru di Mikrotik
- **Tidak langsung mempengaruhi** proses autentikasi voucher user

**Untuk mengikat voucher ke server instance spesifik**, gunakan custom attribute `Mikrotik-Server` di `radreply`.

## ✅ **Implementasi yang Sudah Diterapkan**

### **Fitur yang Ditambahkan:**

1. **Parameter `server` di `addHotspotUserRadius`**
   - Menerima parameter `server` (nama server profile atau server instance)
   - Menyimpan sebagai `Mikrotik-Server` di tabel `radreply` jika server dipilih
   - Format: `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Server', ':=', ?)`

2. **Parameter `server` di `addHotspotUser`**
   - Menerima parameter `server` dan meneruskannya ke `addHotspotUserRadius` (mode RADIUS)
   - Untuk mode Mikrotik API, menambahkan parameter `=server=<server-name>` saat membuat user

3. **Parameter `server` di `generateHotspotVouchers`**
   - Menerima parameter `server` dari route handler
   - Meneruskannya ke `addHotspotUser` untuk setiap voucher yang dibuat

4. **Route Handler `/admin/hotspot/generate-voucher`**
   - Menerima `serverProfile` dari form
   - Meneruskannya ke `generateHotspotVouchers` sebagai parameter `server`

### **Cara Penggunaan:**

1. **Di Form Voucher (`/admin/hotspot/voucher`)**:
   - Pilih Server Profile dari dropdown "Server Profile"
   - Nama Server Profile yang dipilih akan disimpan sebagai `Mikrotik-Server` di `radreply`

2. **Di RADIUS Database**:
   - Atribut `Mikrotik-Server` akan disimpan di tabel `radreply`
   - Format: `username`, `attribute='Mikrotik-Server'`, `op=':='`, `value=<server-profile-name>`

3. **Di Mikrotik**:
   - Saat user login, Mikrotik akan membaca atribut `Mikrotik-Server` dari RADIUS reply
   - Mikrotik akan menggunakan server instance yang sesuai dengan server profile tersebut

### **Catatan Penting:**

- **Server Profile vs Server Instance**: 
  - Server Profile yang dipilih akan disimpan sebagai nilai `Mikrotik-Server`
  - Mikrotik harus dikonfigurasi untuk membaca atribut ini dan menentukan server instance yang sesuai
  - Jika tidak ada server instance yang sesuai, Mikrotik akan menggunakan server default

- **Jika tidak memilih Server Profile**:
  - Nilai `server` akan menjadi `'all'` atau kosong
  - Tidak ada atribut `Mikrotik-Server` yang disimpan
  - Mikrotik akan menggunakan server instance default

- **Untuk Mode Mikrotik API**:
  - Parameter `server` akan langsung diteruskan ke Mikrotik saat membuat user
  - Format: `/ip/hotspot/user/add name=... password=... profile=... server=<server-name>`

