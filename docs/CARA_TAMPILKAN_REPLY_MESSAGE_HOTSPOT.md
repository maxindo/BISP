# 📱 Cara Menampilkan Reply-Message di Template Hotspot Mikrotik

## 📋 Tujuan
Menampilkan Reply-Message dari FreeRADIUS (seperti "Durasi Voucher Sudah Habis") di template hotspot Mikrotik, sehingga user voucher tahu alasan login mereka ditolak, bukan hanya "RADIUS server is not responding".

## ✅ Solusi: Upload Custom Template

### Step 1: Siapkan Template

Template sudah disediakan di:
```
/home/enos/cvlmedia/docs/templates/hotspot-login-template.html
```

Template ini sudah dimodifikasi untuk:
- ✅ Menampilkan Reply-Message dari RADIUS
- ✅ Menampilkan pesan error yang user-friendly
- ✅ Design modern dan responsive

### Step 2: Upload Template ke Mikrotik

#### Opsi A: Via Script (Recommended)

```bash
cd /home/enos/cvlmedia
export MIKROTIK_IP="10.201.39.146"  # Ganti dengan IP Mikrotik Anda
export MIKROTIK_USER="admin"         # Ganti dengan username Mikrotik
export MIKROTIK_PASSWORD="password" # Ganti dengan password Mikrotik

./scripts/upload-hotspot-template.sh
```

#### Opsi B: Via Winbox (Manual)

1. **Buka Winbox** dan connect ke Mikrotik
2. **Buka menu Files**
3. **Masuk ke folder `hotspot`**
4. **Download file `login.html`** (backup original)
5. **Upload file baru:**
   - Klik **Upload**
   - Pilih file: `docs/templates/hotspot-login-template.html`
   - Upload ke folder `hotspot`
   - **Rename** menjadi `login.html` (replace yang lama)

#### Opsi C: Via SCP (Jika ada akses)

```bash
scp docs/templates/hotspot-login-template.html admin@mikrotik-ip:/hotspot/login.html
```

### Step 3: Verifikasi Konfigurasi Hotspot Profile

Pastikan hotspot profile menggunakan HTML directory yang benar:

```bash
# Di Mikrotik terminal (via Winbox Terminal atau SSH)
/ip hotspot profile
print
# Pastikan html-directory=hotspot

# Jika belum, set:
/ip hotspot profile
set [find name="default"] html-directory=hotspot
```

### Step 4: Test Template

1. **Coba login dengan voucher yang expired** (misal: C5BAT)
2. **Pastikan pesan muncul:**
   - "Durasi Voucher Sudah Habis" (jika durasi habis)
   - "Voucher expired: masa berlaku telah habis" (jika validity habis)
   - "Akses ditolak" (untuk reject lainnya)

## 🔍 Cara Kerja Template

Template menggunakan JavaScript untuk:
1. **Membaca parameter URL** (`message` atau `error`)
2. **Menampilkan Reply-Message** jika ada parameter `message` (dari RADIUS)
3. **Fallback ke error code** jika tidak ada `message`
4. **Styling berbeda** berdasarkan tipe error (warning/info/danger)

## 📝 Catatan Penting

### 1. Reply-Message dari FreeRADIUS
- ✅ FreeRADIUS sudah mengirim Reply-Message dengan benar
- ✅ Template akan menampilkan Reply-Message jika Mikrotik meneruskannya ke URL

### 2. Mikrotik Version
- Beberapa versi RouterOS mungkin tidak meneruskan Reply-Message ke template
- Pastikan menggunakan RouterOS versi terbaru (v6.40+)

### 3. Backup Template Original
- **SELALU backup template original** sebelum replace
- Simpan di lokasi aman untuk restore jika perlu

### 4. Testing
- Test dengan voucher expired untuk verifikasi
- Test dengan voucher valid untuk memastikan login normal masih bekerja

## 🐛 Troubleshooting

### Template tidak menampilkan Reply-Message

**Kemungkinan penyebab:**
1. Mikrotik tidak meneruskan Reply-Message ke template
2. Parameter URL tidak sesuai

**Solusi:**
1. Cek log FreeRADIUS untuk memastikan Reply-Message dikirim:
   ```bash
   tail -f /var/log/freeradius/radius.log | grep "Reply-Message"
   ```

2. Cek apakah Mikrotik meneruskan Reply-Message:
   - Buka browser developer tools (F12)
   - Cek URL saat login gagal
   - Lihat apakah ada parameter `message` atau `error`

3. Jika tidak ada parameter, mungkin perlu konfigurasi tambahan di Mikrotik

### Template tidak ter-upload

**Solusi:**
1. Pastikan folder `hotspot` ada di Mikrotik
2. Pastikan user memiliki permission write
3. Coba upload via Winbox jika SCP gagal

### Login normal tidak bekerja setelah upload template

**Solusi:**
1. Restore template original dari backup
2. Cek syntax HTML/JavaScript di template
3. Test di browser untuk memastikan tidak ada error

## 🔄 Solusi Alternatif: Menggunakan Mikrotik-Advertise-URL

Jika template HTML tidak bisa menampilkan Reply-Message (karena Mikrotik tidak meneruskannya), gunakan solusi alternatif dengan `Mikrotik-Advertise-URL`:

### Step 1: Buat Halaman Error Custom

Buat halaman web yang menampilkan pesan error berdasarkan username:

```javascript
// routes/hotspotError.js (contoh)
router.get('/hotspot-error', async (req, res) => {
    const username = req.query.username;
    let errorMessage = 'Akses ditolak';
    
    if (username) {
        // Ambil Reply-Message dari database radpostauth
        const db = require('../config/database');
        const [rows] = await db.execute(
            'SELECT * FROM radpostauth WHERE username = ? AND reply = "Access-Reject" ORDER BY id DESC LIMIT 1',
            [username]
        );
        
        if (rows.length > 0) {
            // Parse Reply-Message dari log atau database
            errorMessage = 'Durasi Voucher Sudah Habis'; // atau ambil dari database
        }
    }
    
    res.render('hotspot-error', { errorMessage, username });
});
```

### Step 2: Konfigurasi FreeRADIUS untuk Mengirim Mikrotik-Advertise-URL

Edit `/etc/freeradius/3.0/mods-enabled/sql` atau `/etc/freeradius/3.0/sites-enabled/default`:

```unlang
# Di post-auth section, tambahkan:
Post-Auth-Type REJECT {
    # ... existing config ...
    
    # Redirect ke halaman error custom jika ada Reply-Message
    if (&reply:Reply-Message) {
        update reply {
            Mikrotik-Advertise-URL := "http://your-server.com/hotspot-error?username=%{User-Name}&message=%{reply:Reply-Message}"
        }
    }
}
```

**Catatan:** `Mikrotik-Advertise-URL` akan mengarahkan user ke halaman tersebut saat login gagal.

## 🎯 Rekomendasi

1. ✅ **Coba template HTML dulu** (solusi paling sederhana)
2. ✅ **Jika tidak bekerja, gunakan Mikrotik-Advertise-URL** (solusi alternatif)
3. ✅ **Backup template original** sebelum replace
4. ✅ **Test di environment development** dulu jika memungkinkan
5. ✅ **Monitor log FreeRADIUS** untuk debugging

## 📚 File Terkait

- Template: `docs/templates/hotspot-login-template.html`
- Script Upload: `scripts/upload-hotspot-template.sh`
- Dokumentasi: `docs/MIKROTIK_HOTSPOT_TEMPLATE_REPLY_MESSAGE.md`

---

**Last Updated**: 2025-12-08

