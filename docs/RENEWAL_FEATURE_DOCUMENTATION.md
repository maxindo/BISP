# 🔄 Fitur Renewal dan Fix Date

## 📋 Deskripsi

Sistem billing sekarang mendukung dua jenis metode pembaruan tagihan untuk pelanggan:

### 1. **Renewal (Default)**
Tanggal jatuh tempo mengikuti tanggal pembayaran:
- **Jika bayar sebelum jatuh tempo:** Tanggal jatuh tempo bulan berikutnya tetap sesuai tanggal jatuh tempo saat ini
- **Jika bayar setelah jatuh tempo:** Tanggal jatuh tempo bulan berikutnya berubah sesuai tanggal pembayaran

### 2. **Fix Date**
Tanggal jatuh tempo tetap setiap bulan:
- **Tanggal jatuh tempo selalu sama** setiap bulan, tidak peduli kapan pelanggan membayar
- Cocok untuk pelanggan yang ingin konsistensi tanggal penagihan

## 🗄️ Perubahan Database

### Kolom Baru di Tabel `customers`:

```sql
-- renewal_type: Tipe pembaruan ('renewal' atau 'fix_date')
renewal_type TEXT DEFAULT 'renewal' CHECK (renewal_type IN ('renewal', 'fix_date'))

-- fix_date: Tanggal tetap untuk jatuh tempo (1-28), hanya digunakan jika renewal_type = 'fix_date'
fix_date INTEGER DEFAULT NULL
```

## 🎨 Perubahan UI

### Form Tambah Pelanggan (`/admin/billing/customers`)
Menambahkan field baru:

1. **Tipe Pembaruan** (Dropdown)
   - Renewal - Tanggal jatuh tempo mengikuti tanggal pembayaran
   - Fix Date - Tanggal jatuh tempo tetap sesuai tanggal yang ditentukan

2. **Tanggal Tetap** (Input Number, 1-28)
   - Hanya muncul jika memilih "Fix Date"
   - Menentukan tanggal tetap untuk jatuh tempo setiap bulan

### Form Edit Pelanggan
Sama dengan form tambah pelanggan, dengan nilai yang sudah terisi sesuai data pelanggan.

## 💻 Implementasi Backend

### 1. Routes (`routes/adminBilling.js`)

#### POST `/admin/billing/customers`
Menambahkan field `renewal_type` dan `fix_date` ke customerData:

```javascript
renewal_type: renewal_type || 'renewal',
fix_date: renewal_type === 'fix_date' ? (function() {
    const v = parseInt(fix_date, 10);
    if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
    return 15;
})() : null,
```

#### PUT `/admin/billing/customers/:phone`
Menambahkan field `renewal_type` dan `fix_date` ke customerData dengan fallback ke nilai lama.

### 2. Billing Manager (`config/billing.js`)

#### Fungsi Baru: `calculateNextDueDate(customer, currentDueDate, paymentDate)`
Menghitung tanggal jatuh tempo berikutnya berdasarkan tipe renewal:

```javascript
// Fix Date: Tanggal tetap
if (renewalType === 'fix_date') {
    const nextDue = new Date(currentDue);
    nextDue.setMonth(nextDue.getMonth() + 1);
    nextDue.setDate(Math.min(fixDate, new Date(...).getDate()));
    return nextDue.toISOString().split('T')[0];
}

// Renewal: Mengikuti pembayaran
if (payment <= currentDue) {
    // Bayar sebelum jatuh tempo: tanggal tetap
    const nextDue = new Date(currentDue);
    nextDue.setMonth(nextDue.getMonth() + 1);
    return nextDue.toISOString().split('T')[0];
} else {
    // Bayar setelah jatuh tempo: tanggal berubah
    const nextDue = new Date(payment);
    nextDue.setMonth(nextDue.getMonth() + 1);
    return nextDue.toISOString().split('T')[0];
}
```

#### Update Fungsi: `recordPayment(paymentData)`
Menambahkan logika auto-generate invoice berikutnya setelah pembayaran berhasil:

1. Ambil data invoice yang dibayar
2. Ambil data customer dan package
3. Hitung tanggal jatuh tempo berikutnya dengan `calculateNextDueDate()`
4. Buat invoice baru untuk bulan berikutnya
5. Log hasil generate invoice

## 📊 Contoh Skenario

### Skenario 1: Fix Date - Pelanggan bayar kapan saja
```
Customer: Ali (Fix Date = 15)
Current Due Date: 2025-01-15
Payment Date: 2025-01-20 (telat 5 hari)
Next Due Date: 2025-02-15 (tetap tanggal 15)
```

### Skenario 2: Renewal - Pelanggan bayar sebelum jatuh tempo
```
Customer: Budi (Renewal, Billing Day = 15)
Current Due Date: 2025-01-15
Payment Date: 2025-01-10 (5 hari sebelum jatuh tempo)
Next Due Date: 2025-02-15 (tetap sesuai current due date)
```

### Skenario 3: Renewal - Pelanggan bayar setelah jatuh tempo
```
Customer: Citra (Renewal, Billing Day = 15)
Current Due Date: 2025-01-15
Payment Date: 2025-01-25 (telat 10 hari)
Next Due Date: 2025-02-25 (berubah sesuai payment date)
```

## 🧪 Testing

### Test Script: `scripts/test-renewal-feature.js`

Test mencakup:
1. ✅ Verifikasi kolom `renewal_type` dan `fix_date` ada di database
2. ✅ Cek sample data customers dengan renewal settings
3. ✅ Test logika `calculateNextDueDate()` dengan 4 skenario:
   - Fix Date - Payment sebelum jatuh tempo
   - Fix Date - Payment setelah jatuh tempo
   - Renewal - Payment sebelum jatuh tempo
   - Renewal - Payment setelah jatuh tempo
4. ✅ Cek sample invoices dengan renewal type

### Hasil Test:
```
✅ All 4 scenarios PASSED
✅ Database columns exist
✅ Sample data loaded correctly
```

## 🚀 Cara Penggunaan

### 1. Tambah Pelanggan Baru
1. Buka `/admin/billing/customers`
2. Klik "Tambah Pelanggan"
3. Isi data pelanggan
4. Pilih **Tipe Pembaruan**:
   - **Renewal**: Jika ingin tanggal jatuh tempo fleksibel mengikuti pembayaran
   - **Fix Date**: Jika ingin tanggal jatuh tempo tetap setiap bulan
5. Jika pilih Fix Date, isi **Tanggal Tetap** (1-28)
6. Simpan

### 2. Edit Pelanggan
1. Buka `/admin/billing/customers`
2. Klik "Edit" pada pelanggan yang ingin diubah
3. Ubah **Tipe Pembaruan** atau **Tanggal Tetap**
4. Simpan

### 3. Pembayaran Otomatis
Setelah pelanggan membayar invoice:
1. System otomatis generate invoice berikutnya
2. Tanggal jatuh tempo dihitung berdasarkan `renewal_type`
3. Invoice baru akan muncul di daftar invoice pelanggan

## 📝 Catatan Penting

1. **Default Value**: Semua pelanggan yang sudah ada otomatis diset ke `renewal_type = 'renewal'`
2. **Validasi Tanggal**: Tanggal fix_date dibatasi 1-28 untuk menghindari masalah di bulan Februari
3. **Auto Generate**: Invoice berikutnya otomatis dibuat saat pembayaran berhasil
4. **Error Handling**: Jika generate invoice gagal, pembayaran tetap berhasil (tidak di-rollback)

## ✅ Status Implementasi

- ✅ Database migration (kolom `renewal_type` dan `fix_date`)
- ✅ Form tambah pelanggan (UI dan JavaScript)
- ✅ Form edit pelanggan (UI dan JavaScript)
- ✅ Backend API (POST dan PUT customers)
- ✅ Fungsi `calculateNextDueDate()`
- ✅ Auto-generate invoice di `recordPayment()`
- ✅ Testing script
- ✅ Dokumentasi

---

**Status: ✅ COMPLETE**

Fitur Renewal dan Fix Date sudah sepenuhnya terimplementasi dan siap digunakan!
