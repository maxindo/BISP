# 📱 Template Hotspot Mikrotik untuk Menampilkan Reply-Message

## 📋 Tujuan
Menampilkan Reply-Message dari FreeRADIUS (seperti "Durasi Voucher Sudah Habis") di template hotspot Mikrotik, sehingga user voucher tahu alasan login mereka ditolak.

## 🔍 Masalah
- FreeRADIUS sudah mengirim Reply-Message dengan benar
- Tapi Mikrotik tidak menampilkan Reply-Message di template default
- User hanya melihat "RADIUS server is not responding" yang membuat mereka mengira server error

## ✅ Solusi: Custom Hotspot Template

### Step 1: Download Template Default dari Mikrotik

1. **Akses Mikrotik via Winbox**
2. **Buka menu Files**
3. **Masuk ke folder `hotspot`**
4. **Download file `login.html` dan `status.html`**

### Step 2: Edit Template login.html

Edit file `login.html` untuk menampilkan Reply-Message. Tambahkan kode berikut di bagian yang menampilkan error:

```html
<!-- Di bagian error message, tambahkan: -->
<script>
// Cek apakah ada Reply-Message dari RADIUS
var errorMessage = '';
var urlParams = new URLSearchParams(window.location.search);
var error = urlParams.get('error');
var message = urlParams.get('message');

// Jika ada message parameter (dari RADIUS Reply-Message)
if (message) {
    errorMessage = decodeURIComponent(message);
} else if (error) {
    // Fallback ke error code
    var errorMessages = {
        'invalid-user': 'Username atau password salah',
        'invalid-password': 'Username atau password salah',
        'radius-reject': 'Akses ditolak',
        'radius-timeout': 'RADIUS server tidak merespons',
        'radius-failed': 'Autentikasi gagal'
    };
    errorMessage = errorMessages[error] || 'Login gagal';
}

// Tampilkan error message jika ada
if (errorMessage) {
    var errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.style.cssText = 'padding: 15px; margin: 10px 0; background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; border-radius: 4px;';
    errorDiv.innerHTML = '<strong>⚠️ Perhatian:</strong> ' + errorMessage;
    
    // Insert sebelum form login
    var loginForm = document.querySelector('form') || document.body;
    loginForm.insertBefore(errorDiv, loginForm.firstChild);
}
</script>
```

### Step 3: Upload Template ke Mikrotik

1. **Edit file `login.html`** dengan kode di atas
2. **Upload ke Mikrotik:**
   - Via Winbox: Files > Upload > pilih `login.html` > Upload ke folder `hotspot`
   - Via SCP (jika ada akses):
     ```bash
     scp login.html admin@mikrotik-ip:/hotspot/login.html
     ```

### Step 4: Konfigurasi Hotspot Profile

Pastikan hotspot profile menggunakan HTML directory yang benar:

```bash
# Di Mikrotik terminal
/ip hotspot profile
set [find name="default"] html-directory=hotspot
```

## 🔧 Alternatif: Menggunakan Mikrotik API untuk Custom Error

Jika template HTML tidak bisa di-edit, bisa menggunakan pendekatan lain:

### Opsi A: Gunakan Custom Error Page via API

Buat script untuk update error page via Mikrotik API:

```javascript
// Script untuk update hotspot error page
const RouterOS = require('routeros');
const fs = require('fs');

async function updateHotspotTemplate(routerConfig, templatePath) {
    const conn = new RouterOS.RouterOSAPI({
        host: routerConfig.ip,
        user: routerConfig.user,
        password: routerConfig.password,
        port: routerConfig.port || 8728
    });
    
    await conn.connect();
    
    // Read template file
    const template = fs.readFileSync(templatePath, 'utf8');
    
    // Upload ke Mikrotik
    // Note: Mikrotik API tidak langsung support file upload
    // Perlu menggunakan SCP atau Winbox
    
    await conn.close();
}
```

### Opsi B: Gunakan errors.txt Mapping

Edit file `errors.txt` di Mikrotik untuk mapping error code ke pesan:

```
invalid-user:Username atau password salah
invalid-password:Username atau password salah
radius-reject:Durasi Voucher Sudah Habis
radius-timeout:RADIUS server tidak merespons
radius-failed:Autentikasi gagal
```

**Catatan:** File `errors.txt` biasanya read-only di Mikrotik.

## 📝 Template login.html Lengkap (Contoh)

Berikut contoh template `login.html` yang sudah dimodifikasi:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Hotspot Login</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        .login-container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            max-width: 400px;
            width: 100%;
        }
        .error-message {
            padding: 15px;
            margin-bottom: 20px;
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            display: none;
        }
        .error-message.show {
            display: block;
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input[type="text"],
        input[type="password"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 12px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background: #5568d3;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h2 style="text-align: center; margin-bottom: 20px;">Hotspot Login</h2>
        
        <!-- Error Message Container -->
        <div id="errorMessage" class="error-message">
            <strong>⚠️ Perhatian:</strong> <span id="errorText"></span>
        </div>
        
        <form method="post" action="$login">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Login</button>
        </form>
    </div>
    
    <script>
        // Ambil Reply-Message dari URL parameter atau error code
        (function() {
            var urlParams = new URLSearchParams(window.location.search);
            var error = urlParams.get('error');
            var message = urlParams.get('message');
            var errorText = '';
            
            // Prioritas: message (Reply-Message dari RADIUS) > error code
            if (message) {
                errorText = decodeURIComponent(message);
            } else if (error) {
                // Mapping error code ke pesan
                var errorMap = {
                    'invalid-user': 'Username atau password salah',
                    'invalid-password': 'Username atau password salah',
                    'radius-reject': 'Akses ditolak oleh server',
                    'radius-timeout': 'Server tidak merespons',
                    'radius-failed': 'Autentikasi gagal'
                };
                errorText = errorMap[error] || 'Login gagal. Silakan coba lagi.';
            }
            
            // Tampilkan error message jika ada
            if (errorText) {
                document.getElementById('errorText').textContent = errorText;
                document.getElementById('errorMessage').classList.add('show');
            }
        })();
    </script>
</body>
</html>
```

## 🔍 Verifikasi

1. **Test dengan radtest:**
   ```bash
   radtest C5BAT C5BAT 127.0.0.1 0 testing123
   # Harus menunjukkan: Reply-Message = "Durasi Voucher Sudah Habis"
   ```

2. **Test login dari hotspot:**
   - Coba login dengan voucher yang expired
   - Pastikan pesan "Durasi Voucher Sudah Habis" muncul di halaman login

## ⚠️ Catatan Penting

1. **Mikrotik Version:**
   - Beberapa versi RouterOS mungkin tidak support custom template
   - Pastikan menggunakan RouterOS versi terbaru

2. **File Permissions:**
   - File di folder `hotspot` mungkin read-only
   - Perlu akses admin atau gunakan SCP untuk upload

3. **Backup:**
   - Selalu backup template original sebelum mengedit
   - Simpan di lokasi aman untuk restore jika perlu

4. **Testing:**
   - Test template di environment development dulu
   - Pastikan tidak merusak fungsi login normal

## 🎯 Rekomendasi

Untuk implementasi yang lebih mudah:
1. ✅ Gunakan template HTML custom yang sudah disediakan
2. ✅ Upload via Winbox atau SCP
3. ✅ Test dengan voucher expired untuk verifikasi
4. ✅ Monitor log FreeRADIUS untuk debugging

---

**Last Updated**: 2025-12-08

