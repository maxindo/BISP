# Perbaikan Permission Database untuk hotspot_profiles

## Masalah

Aplikasi mencoba menambahkan kolom secara otomatis ke tabel `radius.hotspot_profiles`, tetapi user database `billing@localhost` tidak memiliki permission `ALTER TABLE`.

Error yang muncul:
```
ALTER command denied to user 'billing'@'localhost' for table `radius`.`hotspot_profiles`
```

## Solusi

### Opsi 1: Berikan Permission ALTER TABLE (Disarankan)

**PENTING: Anda harus login sebagai root MySQL, bukan sebagai user billing!**

1. **Login sebagai root MySQL:**
```bash
sudo mysql -u root -p
# atau
mysql -u root -p
```

2. **Setelah login sebagai root, jalankan perintah berikut:**

```sql
-- Berikan permission ALTER TABLE untuk user billing
GRANT ALTER ON radius.hotspot_profiles TO 'billing'@'localhost';
FLUSH PRIVILEGES;
```

Atau jika ingin memberikan permission untuk semua tabel di database radius:

```sql
-- Berikan permission ALTER TABLE untuk semua tabel di database radius
GRANT ALTER ON radius.* TO 'billing'@'localhost';
FLUSH PRIVILEGES;
```

3. **Verifikasi permission:**
```sql
SHOW GRANTS FOR 'billing'@'localhost';
```

**Catatan:** Jika Anda masih login sebagai user `billing`, Anda akan mendapat error:
- `ERROR 1044 (42000): Access denied` - karena user billing tidak bisa memberikan GRANT
- `ERROR 1227 (42000): Access denied; you need RELOAD privilege` - karena user billing tidak bisa FLUSH PRIVILEGES

**Solusi:** Pastikan Anda logout dari MySQL dan login kembali sebagai root.

### Opsi 2: Tambahkan Kolom Secara Manual

Jika tidak ingin memberikan permission ALTER, tambahkan kolom secara manual sebagai root:

```sql
USE radius;

ALTER TABLE hotspot_profiles 
ADD COLUMN IF NOT EXISTS limit_uptime_value INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS limit_uptime_unit VARCHAR(10) NULL,
ADD COLUMN IF NOT EXISTS validity_value INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS validity_unit VARCHAR(10) NULL;
```

### Opsi 3: Gunakan User dengan Permission Lebih Tinggi

Jika aplikasi menggunakan koneksi database yang berbeda untuk operasi ALTER, pastikan user tersebut memiliki permission yang diperlukan.

## Verifikasi

Setelah memberikan permission, restart aplikasi dan periksa log. Warning seharusnya tidak muncul lagi, atau kolom akan berhasil ditambahkan.

## Catatan

- Aplikasi akan tetap berfungsi meskipun kolom tidak ditambahkan, tetapi beberapa fitur yang memerlukan kolom tersebut mungkin tidak berfungsi optimal.
- Warning di log sekarang hanya muncul sekali untuk menghindari spam log.

