# 📝 Cara Menampilkan Reply-Message di Log Mikrotik

## 📋 Masalah
Reply-Message dari FreeRADIUS (seperti "Durasi Voucher Sudah Habis") tidak muncul di log Mikrotik. Log hanya menampilkan pesan default seperti "login failed: RADIUS server is not responding".

## 🔍 Penjelasan
FreeRADIUS sudah mengirim Reply-Message dengan benar, tapi Mikrotik tidak menampilkannya di log secara default. Reply-Message biasanya hanya ditampilkan di halaman login hotspot, bukan di log.

## ✅ Solusi

### Opsi 1: Edit File errors.txt di Mikrotik (Recommended)

Mikrotik menggunakan file `errors.txt` untuk menampilkan pesan error ke user. File ini bisa diedit untuk menampilkan Reply-Message.

#### Langkah-langkah:

1. **Akses Mikrotik via Winbox atau Terminal**

2. **Download file errors.txt dari Mikrotik:**
   ```bash
   # Via Winbox: Files > hotspot > errors.txt > Download
   # Via Terminal:
   /file print where name="hotspot/errors.txt"
   ```

3. **Edit file errors.txt:**
   - Tambahkan mapping untuk Reply-Message yang dikirim FreeRADIUS
   - Format: `code:message`
   
   Contoh isi errors.txt:
   ```
   invalid-user:Invalid username or password
   invalid-password:Invalid username or password
   radius-reject:Access denied
   radius-timeout:RADIUS server is not responding
   ```

4. **Upload kembali ke Mikrotik:**
   ```bash
   # Via Winbox: Files > Upload > errors.txt
   # Via Terminal (jika ada akses SCP):
   scp errors.txt admin@mikrotik-ip:/hotspot/errors.txt
   ```

**Catatan:** File errors.txt di Mikrotik biasanya read-only dan tidak bisa diedit langsung. Perlu menggunakan cara lain.

### Opsi 2: Gunakan Custom Error Page (Hotspot HTML)

Cara yang lebih fleksibel adalah menggunakan custom error page di hotspot yang menampilkan Reply-Message.

1. **Buat custom error page:**
   - Edit file HTML error page di Mikrotik
   - Tambahkan script untuk menampilkan Reply-Message dari RADIUS

2. **Konfigurasi di Mikrotik:**
   ```bash
   /ip hotspot profile
   set [find name="default"] html-directory=hotspot
   ```

### Opsi 3: Monitor via RADIUS Log (Alternative)

Karena Mikrotik tidak menampilkan Reply-Message di log, alternatifnya adalah memantau log di FreeRADIUS server:

```bash
# Monitor log FreeRADIUS real-time
tail -f /var/log/freeradius/radius.log | grep -i "Reply-Message\|C5BAT"

# Atau cek di database
mysql -u radius -p radius -e "SELECT * FROM radpostauth WHERE username='C5BAT' ORDER BY id DESC LIMIT 5;"
```

### Opsi 4: Gunakan Script untuk Log Custom Message

Buat script di Mikrotik untuk mencatat Reply-Message ke log:

```bash
# Di Mikrotik, buat script untuk log custom
/system script
add name="log-radius-message" source={
    :local username [/ip hotspot active get [find where user=$username] user]
    :local message "Durasi Voucher Sudah Habis"
    :log info "Hotspot user $username: $message"
}
```

## 🔧 Verifikasi Reply-Message Dikirim

Untuk memastikan Reply-Message dikirim oleh FreeRADIUS:

```bash
# Test dengan radtest
radtest C5BAT C5BAT 127.0.0.1 0 testing123

# Output harus menunjukkan:
# Reply-Message = "Durasi Voucher Sudah Habis"
```

## 📝 Catatan Penting

1. **Reply-Message di Log Mikrotik:**
   - Mikrotik **TIDAK** menampilkan Reply-Message di log secara default
   - Reply-Message biasanya hanya ditampilkan di halaman login hotspot
   - Untuk menampilkan di log, perlu konfigurasi khusus atau custom script

2. **Reply-Message di Hotspot Login Page:**
   - Reply-Message **BISA** ditampilkan di halaman login hotspot
   - Perlu konfigurasi custom HTML page atau edit errors.txt

3. **Alternatif:**
   - Monitor log di FreeRADIUS server untuk melihat Reply-Message
   - Gunakan database radpostauth untuk tracking

## 🎯 Rekomendasi

Untuk menampilkan pesan error yang user-friendly:
1. ✅ FreeRADIUS sudah mengirim Reply-Message dengan benar
2. ✅ Konfigurasi custom error page di Mikrotik hotspot
3. ✅ Atau monitor log di FreeRADIUS server

---

**Last Updated**: 2025-12-08

