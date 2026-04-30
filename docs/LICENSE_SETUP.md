# Instruksi Setup untuk Server Baru (Git Clone)

## 📋 **Setup License System**

Sistem licensing sudah terintegrasi dan akan otomatis bekerja saat aplikasi pertama kali dijalankan setelah git clone.

### **Automatic Trial Initialization**

Saat aplikasi pertama kali dijalankan setelah git clone:

1. **Tabel `license` akan otomatis dibuat** di database `billing.db`
2. **Record trial akan otomatis dibuat** dengan:
   - Status: `trial`
   - Trial Start: Tanggal saat aplikasi pertama kali dijalankan
   - Trial End: 10 hari setelah trial start
   - License Key: `NULL` (belum diaktivasi)

### **Tidak Perlu Setup Manual**

✅ **Tidak perlu menjalankan script apapun**  
✅ **Tidak perlu membuat tabel manual**  
✅ **Tidak perlu setup trial manual**  

Semua akan otomatis saat aplikasi start pertama kali!

### **Cara Kerja:**

1. **Setelah git clone:**
   ```bash
   git clone https://github.com/enosrotua/BillCVLmedia.git
   cd BillCVLmedia
   npm install
   ```

2. **Setup database (jika belum ada):**
   ```bash
   bash setup.sh
   # atau
   node scripts/create-voucher-revenue-table.js
   ```

3. **Start aplikasi:**
   ```bash
   pm2 start app.js --name cvlmedia
   # atau
   node app.js
   ```

4. **Saat aplikasi pertama kali start:**
   - Sistem akan otomatis membuat tabel `license`
   - Sistem akan otomatis membuat record trial (10 hari)
   - Log akan menampilkan: `License system initialized`

5. **Verifikasi trial:**
   ```bash
   sqlite3 data/billing.db "SELECT status, trial_start_date, trial_end_date FROM license LIMIT 1;"
   ```

### **File yang Tidak Di-Push ke GitHub:**

- ✅ `scripts/generate-license.js` - Script untuk generate license key (internal tool)
- ✅ `data/billing.db` - Database file (sudah di .gitignore)
- ✅ `settings.json` - Konfigurasi aplikasi (sudah di .gitignore)

### **Setiap Server Clone = Trial Baru**

Setiap server yang melakukan git clone akan mendapatkan:
- ✅ Trial period 10 hari dimulai dari tanggal aplikasi pertama kali dijalankan
- ✅ Status `trial` di database
- ✅ Tidak ada license key (NULL)

### **Setelah Trial Habis:**

- Login akan diblokir
- User harus aktivasi license key melalui `/admin/license`
- Setelah aktivasi, aplikasi dapat digunakan selamanya

### **Verifikasi:**

Cek log saat aplikasi start:
```
[INFO] License table initialized
[INFO] License system initialized
[INFO] Trial license initialized. Trial ends: <tanggal>
```

Cek database:
```sql
sqlite3 data/billing.db "SELECT * FROM license;"
```

Seharusnya menunjukkan:
- Status: `trial`
- Trial start: Tanggal saat aplikasi pertama kali start
- Trial end: 10 hari setelah trial start
- License key: `NULL`

