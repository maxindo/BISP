# 🔧 Troubleshooting: 404 Not Found pada Hotspot Login

## 📋 Masalah
Setelah replace template `login.html`, muncul error **404 Not Found** saat mencoba login.

## 🔍 Penyebab Umum

### 1. HTML Directory tidak sesuai
Hotspot profile tidak mengarah ke folder yang benar.

**Solusi:**
```bash
# Di Mikrotik terminal
/ip hotspot profile
print
# Pastikan html-directory=hotspot (atau folder tempat Anda upload template)

# Jika belum benar, set:
/ip hotspot profile
set [find name="default"] html-directory=hotspot
```

### 2. Form Action tidak benar
Template menggunakan variabel `$login` yang tidak ter-resolve.

**Solusi:**
Ganti form action dari:
```html
<form method="post" action="$login">
```

Menjadi:
```html
<form method="post" action="/login">
```

### 3. File template tidak lengkap
Beberapa file yang diperlukan tidak ada.

**Solusi:**
Pastikan file berikut ada di folder `hotspot`:
- `login.html` ✅
- `status.html` (jika diperlukan)
- File CSS/JS lain yang direferensikan

### 4. File tidak ter-upload dengan benar
File mungkin corrupt atau tidak lengkap.

**Solusi:**
1. Download template original dari Mikrotik (backup)
2. Upload ulang template baru
3. Pastikan file size tidak 0 bytes

## ✅ Langkah Perbaikan

### Step 1: Cek Konfigurasi Hotspot Profile

```bash
# Di Mikrotik terminal
/ip hotspot profile
print detail

# Pastikan:
# - html-directory=hotspot
# - dns-name tidak kosong (jika diperlukan)
```

### Step 2: Cek File di Mikrotik

```bash
# Di Mikrotik terminal
/file print where name~"hotspot"

# Pastikan file login.html ada dan ukurannya tidak 0
```

### Step 3: Restart Hotspot

```bash
# Di Mikrotik terminal
/ip hotspot
disable [find]
enable [find]
```

### Step 4: Gunakan Template yang Diperbaiki

Template sudah diperbaiki dengan:
- ✅ Form action menggunakan `/login` (bukan `$login`)
- ✅ Hidden fields yang diperlukan (`dst`, `popup`)
- ✅ Meta tag yang benar

**File template yang sudah diperbaiki:**
- `docs/templates/hotspot-login-template.html` (sudah diperbaiki)

### Step 5: Upload Ulang Template

```bash
# Via Winbox:
# 1. Files > hotspot
# 2. Delete login.html lama (atau rename sebagai backup)
# 3. Upload login.html baru
# 4. Pastikan nama file: login.html (bukan login.html.html)

# Via SCP:
scp docs/templates/hotspot-login-template.html admin@mikrotik-ip:/hotspot/login.html
```

## 🐛 Debugging

### Cek Log Mikrotik

```bash
# Di Mikrotik terminal
/log print where topics~"hotspot" | tail -20
```

### Test Template di Browser

1. Buka browser
2. Akses: `http://mikrotik-ip/login`
3. Lihat apakah halaman muncul atau error 404

### Cek Web Server Mikrotik

```bash
# Di Mikrotik terminal
/ip service
print where name="www"

# Pastikan www service enabled dan port benar
```

## 📝 Template yang Benar

Template yang sudah diperbaiki menggunakan:

```html
<form method="post" action="/login">
    <input type="hidden" name="dst" value="$dst">
    <input type="hidden" name="popup" value="true">
    <!-- ... form fields ... -->
</form>
```

**Bukan:**
```html
<form method="post" action="$login">  <!-- ❌ Salah -->
```

## 🎯 Checklist

Sebelum upload template, pastikan:

- [ ] Hotspot profile `html-directory` sudah benar
- [ ] Form action menggunakan `/login` (bukan `$login`)
- [ ] Hidden fields `dst` dan `popup` ada
- [ ] File di-upload ke folder yang benar (`hotspot`)
- [ ] Nama file benar (`login.html`, bukan `login.html.html`)
- [ ] File size tidak 0 bytes
- [ ] Hotspot sudah di-restart setelah upload

## 🔄 Restore Template Original

Jika masih error, restore template original:

```bash
# Di Mikrotik terminal
/file print where name~"hotspot/login"

# Download backup original (jika ada)
# Atau download dari Mikrotik default template
```

---

**Last Updated**: 2025-12-08

