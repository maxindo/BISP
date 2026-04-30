# 🔧 Solusi: Reply-Message Tidak Muncul di Template Hotspot

## 📋 Masalah
- Template sudah tidak 404 ✅
- Tapi Reply-Message dari FreeRADIUS tidak muncul di template
- Log Mikrotik hanya menunjukkan "RADIUS server is not responding" atau "password is not chap encrypted"

## 🔍 Root Cause
**Mikrotik tidak meneruskan Reply-Message ke template HTML secara langsung.** Mikrotik menggunakan variabel built-in `$(error-orig)` untuk menampilkan pesan error dari RADIUS.

## ✅ Solusi 1: Gunakan Variabel Mikrotik $(error-orig)

### Step 1: Update Template

Template sudah diupdate untuk menggunakan variabel Mikrotik `$(error-orig)`:

**File:** `docs/templates/hotspot-login-template-with-error-orig.html`

Template ini menggunakan:
```html
<!-- Variabel Mikrotik untuk error message -->
<div id="mikrotikError" style="display: none;"><!--$error-orig--></div>
```

JavaScript akan membaca dari variabel ini dan menampilkannya.

### Step 2: Konfigurasi errors.txt di Mikrotik

File `errors.txt` di folder `hotspot` perlu dikonfigurasi untuk mapping error:

```
radius-reply=$(error-orig)
radius-reject=$(error-orig)
```

**Cara edit errors.txt:**
1. Download file `errors.txt` dari Mikrotik (Files > hotspot > errors.txt)
2. Tambahkan atau edit baris:
   ```
   radius-reply=$(error-orig)
   radius-reject=$(error-orig)
   ```
3. Upload kembali ke Mikrotik

**Catatan:** File `errors.txt` mungkin read-only. Jika tidak bisa di-edit, gunakan Solusi 2.

## ✅ Solusi 2: Gunakan Mikrotik-Advertise-URL (Recommended)

Karena Mikrotik tidak selalu meneruskan Reply-Message ke template, solusi terbaik adalah menggunakan `Mikrotik-Advertise-URL` untuk redirect ke halaman custom.

### Step 1: Buat Endpoint Error Page

Buat route di aplikasi untuk menampilkan error message:

```javascript
// routes/hotspotError.js
router.get('/hotspot-error', async (req, res) => {
    const username = req.query.username || req.query.user;
    let errorMessage = 'Akses ditolak';
    
    if (username) {
        // Ambil error message terakhir dari database
        const db = require('../config/database');
        try {
            const [rows] = await db.execute(
                `SELECT * FROM radpostauth 
                 WHERE username = ? AND reply = 'Access-Reject' 
                 ORDER BY id DESC LIMIT 1`,
                [username]
            );
            
            if (rows.length > 0) {
                // Cek apakah user punya Max-All-Session (durasi habis)
                const [checkRows] = await db.execute(
                    `SELECT value FROM radcheck 
                     WHERE username = ? AND attribute = 'Max-All-Session'`,
                    [username]
                );
                
                if (checkRows.length > 0) {
                    // Cek total usage time
                    const [timeRows] = await db.execute(
                        `SELECT SUM(acctsessiontime) as total_time 
                         FROM radacct 
                         WHERE username = ? AND acctstoptime IS NOT NULL`,
                        [username]
                    );
                    
                    if (timeRows.length > 0 && timeRows[0].total_time >= checkRows[0].value) {
                        errorMessage = 'Durasi Voucher Sudah Habis';
                    }
                }
                
                // Cek Expire-After
                const [expireRows] = await db.execute(
                    `SELECT value FROM radcheck 
                     WHERE username = ? AND attribute = 'Expire-After'`,
                    [username]
                );
                
                if (expireRows.length > 0 && !errorMessage.includes('Durasi')) {
                    errorMessage = 'Voucher expired: masa berlaku telah habis';
                }
            }
        } catch (err) {
            console.error('Error fetching error message:', err);
        }
    }
    
    res.render('hotspot-error', { 
        errorMessage, 
        username: username || 'Unknown' 
    });
});
```

### Step 2: Buat View hotspot-error.ejs

```html
<!-- views/hotspot-error.ejs -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Error - Hotspot Login</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .error-container {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            max-width: 500px;
            text-align: center;
        }
        .error-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        .error-message {
            font-size: 18px;
            color: #721c24;
            margin-bottom: 30px;
            padding: 20px;
            background: #f8d7da;
            border-left: 4px solid #dc3545;
            border-radius: 4px;
        }
        .btn-retry {
            padding: 12px 30px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            text-decoration: none;
            display: inline-block;
        }
        .btn-retry:hover {
            background: #5568d3;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h1>Akses Ditolak</h1>
        <div class="error-message">
            <strong><%= errorMessage %></strong>
        </div>
        <p>Username: <strong><%= username %></strong></p>
        <a href="javascript:history.back()" class="btn-retry">Kembali ke Login</a>
    </div>
</body>
</html>
```

### Step 3: Konfigurasi FreeRADIUS untuk Mengirim Mikrotik-Advertise-URL

Edit `/etc/freeradius/3.0/sites-enabled/default`:

```unlang
Post-Auth-Type REJECT {
    # ... existing config ...
    
    # Kirim Mikrotik-Advertise-URL untuk redirect ke halaman error custom
    if (&reply:Reply-Message) {
        update reply {
            # Ganti dengan URL server Anda
            Mikrotik-Advertise-URL := "http://10.201.39.66/hotspot-error?username=%{User-Name}&message=%{reply:Reply-Message}"
        }
    }
}
```

**Catatan:** 
- Ganti `10.201.39.66` dengan IP server aplikasi Anda
- URL akan di-encode oleh FreeRADIUS
- Mikrotik akan redirect user ke URL ini saat login gagal

### Step 4: Restart FreeRADIUS

```bash
systemctl restart freeradius
```

## ✅ Solusi 3: Mapping Error di Template (Fallback)

Jika Solusi 1 dan 2 tidak bekerja, gunakan mapping error code di template:

Template sudah memiliki mapping untuk error code:
- `radius-reject` → "Durasi Voucher Sudah Habis"
- `radius-timeout` → "Server tidak merespons"
- dll.

Tapi ini hanya bekerja jika Mikrotik mengirim error code ke URL.

## 🎯 Rekomendasi

**Gunakan Solusi 2 (Mikrotik-Advertise-URL)** karena:
1. ✅ Paling reliable - tidak tergantung pada variabel Mikrotik
2. ✅ Bisa menampilkan pesan custom berdasarkan username
3. ✅ Bisa mengambil data dari database untuk pesan yang lebih akurat
4. ✅ User langsung melihat pesan error yang jelas

## 📝 Testing

Setelah implementasi:

1. **Test dengan voucher expired:**
   ```bash
   # Login dengan C5BAT (yang sudah expired)
   # User harus di-redirect ke /hotspot-error
   # Dan melihat pesan "Durasi Voucher Sudah Habis"
   ```

2. **Verifikasi di FreeRADIUS:**
   ```bash
   radtest C5BAT C5BAT 127.0.0.1 0 testing123
   # Harus menunjukkan: Reply-Message = "Durasi Voucher Sudah Habis"
   # Dan: Mikrotik-Advertise-URL (jika Solusi 2 digunakan)
   ```

---

**Last Updated**: 2025-12-08

