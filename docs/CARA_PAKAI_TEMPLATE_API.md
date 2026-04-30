# 📱 Cara Menggunakan Template dengan API untuk Reply-Message

## 📋 Masalah
Template dengan variabel `$(error-orig)` tidak bekerja karena Mikrotik tidak mengisi variabel tersebut dengan Reply-Message dari RADIUS.

## ✅ Solusi: Template dengan API Call

Template baru menggunakan JavaScript untuk fetch error message dari API server.

### Step 1: Pastikan Route Sudah Terdaftar

Route sudah dibuat di `routes/hotspotError.js` dan sudah ditambahkan ke `app.js`.

**Verifikasi:**
```bash
# Cek apakah route sudah terdaftar
grep "hotspotError" app.js
```

### Step 2: Restart Aplikasi

```bash
# Restart aplikasi Node.js
pm2 restart all
# atau
systemctl restart your-app-service
```

### Step 3: Test API Endpoint

Test endpoint API untuk memastikan bekerja:

```bash
# Test dengan username C5BAT
curl "http://localhost:3000/api/hotspot-error-message?username=C5BAT"

# Harus return JSON:
# {
#   "error": false,
#   "message": "Durasi Voucher Sudah Habis",
#   "username": "C5BAT"
# }
```

### Step 4: Upload Template ke Mikrotik

**File template:** `docs/templates/hotspot-login-template-api.html`

1. **Buka Winbox** dan connect ke Mikrotik
2. **Buka menu Files** > **hotspot**
3. **Upload file:** `hotspot-login-template-api.html`
4. **Rename** menjadi `login.html` (replace yang lama)

**Atau via SCP:**
```bash
scp docs/templates/hotspot-login-template-api.html admin@mikrotik-ip:/hotspot/login.html
```

### Step 5: Update API URL di Template (Jika Perlu)

Jika server aplikasi tidak bisa diakses dari client hotspot, edit template dan ganti URL:

```javascript
// Di template, cari baris ini:
var serverUrl = window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : '');

// Jika perlu, ganti dengan IP/domain server aplikasi:
var serverUrl = 'http://10.201.39.66'; // Ganti dengan IP server aplikasi
```

### Step 6: Test Template

1. **Coba login dengan voucher expired** (misal: C5BAT)
2. **Pastikan pesan muncul:**
   - "Durasi Voucher Sudah Habis" (jika durasi habis)
   - "Voucher expired: masa berlaku telah habis" (jika validity habis)

## 🔍 Cara Kerja

1. **User mencoba login** dengan voucher expired
2. **Mikrotik reject** dan redirect ke login page dengan parameter `?error=radius-reject` atau `?username=USERNAME`
3. **Template JavaScript** membaca parameter URL
4. **Jika ada username**, JavaScript fetch error message dari API: `/api/hotspot-error-message?username=USERNAME`
5. **API query database** untuk cek:
   - Apakah user punya `Max-All-Session` dan sudah habis?
   - Apakah user punya `Expire-After` dan sudah expired?
6. **API return** error message yang sesuai
7. **Template menampilkan** error message di halaman login

## 🐛 Troubleshooting

### API tidak merespons

**Cek:**
1. Apakah aplikasi Node.js berjalan?
2. Apakah route sudah terdaftar di `app.js`?
3. Apakah port aplikasi bisa diakses dari Mikrotik?

**Test:**
```bash
# Dari Mikrotik, test koneksi ke server
/ping 10.201.39.66

# Test API endpoint
/tool fetch url="http://10.201.39.66/api/hotspot-error-message?username=C5BAT"
```

### Template tidak menampilkan error

**Cek:**
1. Buka browser developer tools (F12)
2. Cek Console untuk error JavaScript
3. Cek Network tab untuk melihat apakah API call berhasil

**Debug:**
Edit template dan tambahkan console.log:
```javascript
console.log('Username:', username);
console.log('API URL:', apiUrl);
console.log('Response:', data);
```

### CORS Error

Jika ada CORS error, tambahkan CORS header di route:

```javascript
// Di routes/hotspotError.js, tambahkan:
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Methods', 'GET');
```

## 🎯 Alternatif: Menggunakan Mikrotik-Advertise-URL

Jika API tidak bisa diakses dari client, gunakan solusi `Mikrotik-Advertise-URL`:

1. Konfigurasi FreeRADIUS untuk mengirim `Mikrotik-Advertise-URL`
2. User akan di-redirect ke `/hotspot-error?username=USERNAME`
3. Halaman error akan menampilkan pesan yang sesuai

**Detail:** Lihat `docs/SOLUSI_REPLY_MESSAGE_MIKROTIK.md`

---

**Last Updated**: 2025-12-08

