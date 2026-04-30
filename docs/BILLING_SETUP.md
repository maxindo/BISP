# 📦 Setup Billing CVLMEDIA

Panduan untuk menginstall dan mengkonfigurasi aplikasi billing CVLMEDIA setelah FreeRADIUS terinstall.

## 📋 Prerequisites

- ✅ FreeRADIUS sudah terinstall dan running (jalankan `sudo bash setup.sh` terlebih dahulu)
- ✅ Database `radius` sudah dibuat dan user `billing` sudah dikonfigurasi (`sudo bash scripts/setup_billing_user.sh`)
- ✅ Internet connection untuk download Node.js dan npm packages

## 🚀 Quick Setup

### Opsi 1: Auto Setup (Recommended)

```bash
cd /path/to/FreeRADIUSPaket
bash scripts/setup_billing.sh
```

Script akan otomatis:
- ✅ Deteksi OS dan install Node.js LTS (v18+)
- ✅ Install build tools (gcc, g++, make)
- ✅ Install PM2 (process manager)
- ✅ Install npm dependencies dari `package.json`
- ✅ Setup database (create voucher_revenue table, dll)
- ✅ Buat `settings.json` default jika belum ada
- ✅ Setup PM2 startup (optional)

### Opsi 2: Manual Setup

Jika auto setup gagal atau ingin kontrol lebih:

```bash
# 1. Install Node.js LTS (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# 2. Install PM2
sudo npm install -g pm2

# 3. Install dependencies
cd /path/to/cvlmedia
npm install

# 4. Setup database
node scripts/create-voucher-revenue-table.js
node scripts/add-technician-tables.js

# 5. Setup settings.json
# Edit settings.json dengan konfigurasi RADIUS dan admin password
```

## ⚙️ Konfigurasi

### 1. Edit `settings.json`

Setelah setup, edit `settings.json` di directory billing:

```bash
cd /path/to/cvlmedia
nano settings.json
```

**Konfigurasi penting:**

```json
{
  "admin_username": "admin",
  "admin_password": "ubah_password_ini",
  "user_auth_mode": "radius",
  "server_port": "3003",
  "radius_host": "localhost",
  "radius_user": "billing",
  "radius_password": "password_dari_setup_billing_user.sh",
  "radius_database": "radius"
}
```

**Catatan:**
- `radius_password`: Gunakan password yang didapat dari `scripts/setup_billing_user.sh`
- `admin_password`: Ubah password admin default
- `user_auth_mode`: `"radius"` untuk mode RADIUS, `"mikrotik"` untuk mode Mikrotik API

### 2. Konfigurasi Router/NAS

Jika menggunakan mode Mikrotik API, tambahkan router di `/admin/routers`:
- Masuk ke aplikasi billing
- Buka menu **Routers** atau **NAS**
- Tambah router Mikrotik dengan kredensial API

## 🚀 Menjalankan Aplikasi

### Start dengan PM2

```bash
cd /path/to/cvlmedia
pm2 start app.js --name cvlmedia
pm2 save
pm2 startup  # Setup auto-start on boot
```

### Commands PM2

```bash
# Lihat status
pm2 status

# Lihat logs
pm2 logs cvlmedia

# Restart
pm2 restart cvlmedia

# Stop
pm2 stop cvlmedia

# Monitor
pm2 monit
```

## 🌐 Akses Web UI

Setelah aplikasi running:

```
http://localhost:3003/admin
```

Atau jika dari server lain:

```
http://SERVER_IP:3003/admin
```

**Default credentials** (ubah di `settings.json`):
- Username: `admin`
- Password: `admin`

## 🔍 Troubleshooting

### Error: "Cannot find module"

```bash
cd /path/to/cvlmedia
npm install
```

### Error: "Port already in use"

Ubah port di `settings.json`:
```json
{
  "server_port": "3004"  // Atau port lain yang tersedia
}
```

### Error: "Database connection failed"

1. Cek FreeRADIUS database running:
   ```bash
   sudo systemctl status mariadb
   ```

2. Cek credentials di `settings.json`:
   ```bash
   # Test connection
   mysql -u billing -p radius
   ```

3. Pastikan billing user sudah dibuat:
   ```bash
   sudo bash scripts/setup_billing_user.sh
   ```

### Error: "PM2 command not found"

```bash
sudo npm install -g pm2
```

### Log tidak muncul

```bash
# Cek PM2 logs
pm2 logs cvlmedia --lines 100

# Cek system logs
journalctl -u pm2-cvlmedia -n 100
```

## 📝 Next Steps

Setelah billing application running:

1. **Setup Mikrotik Clients** di FreeRADIUS:
   ```bash
   sudo nano /etc/freeradius/3.0/clients.conf
   # Tambahkan IP Mikrotik router
   ```

2. **Konfigurasi Mikrotik** untuk menggunakan RADIUS:
   - Lihat `docs/MIKROTIK_RADIUS_SETUP.md`

3. **Setup Firewall**:
   ```bash
   sudo bash scripts/setup_firewall.sh
   ```

4. **Test Voucher**:
   - Buat voucher test di `/admin/hotspot/voucher`
   - Coba login dengan voucher tersebut

## 📚 Dokumentasi Tambahan

- **Hybrid Mode**: `docs/HYBRID_MODE_FIX.md`
- **RADIUS Troubleshooting**: `docs/RADIUS_NOT_RESPONDING_FIX.md`
- **Billing Integration**: `docs/BILLING_INTEGRATION.md`

---

**Last Updated**: 2025-11-06

