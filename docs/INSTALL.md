# 🚀 Panduan Instalasi Cepat - Billing-System

## 📋 Prerequisites

- **Node.js** v18+ (direkomendasikan v20+)
- **Git** untuk clone repository
- **GenieACS** API access
- **Mikrotik** API access
- **WhatsApp** number untuk bot

## 🔧 Instalasi Step-by-Step

### 1. Clone Repository

```bash
# Install git jika belum ada
sudo apt update && sudo apt install git curl -y

# Clone repository
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd billing-system
```

### 2. Install Dependencies

```bash
# Install semua dependencies
npm install

# Jika ada masalah dengan sqlite3, coba:
npm rebuild sqlite3

# Atau install dengan build from source
npm install sqlite3 --build-from-source
```

### 3. Konfigurasi Settings

Copy dan edit file settings:

```bash
# Copy template settings
cp settings.server.template.json settings.json

# Edit settings.json sesuai kebutuhan
nano settings.json
```

**Minimal Configuration yang harus diubah:**

```json
{
  "admins.0": "6281368888498",
  "technician_numbers.0": "6283807665111",
  "genieacs_url": "http://192.168.8.89:7557",
  "genieacs_username": "admin",
  "genieacs_password": "admin",
  "mikrotik_host": "192.168.8.1",
  "mikrotik_user": "admin",
  "mikrotik_password": "admin"
}
```

### 4. Setup Database

```bash
# Jalankan script setup database
node scripts/add-payment-gateway-tables.js
```

### 5. Menjalankan Aplikasi

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

**Dengan PM2 (Recommended):**
```bash
# Install PM2
npm install -g pm2

# Start aplikasi
pm2 start app.js --name cvlintasmultimedia

# Auto start on boot
pm2 startup
pm2 save
```

### 6. Setup WhatsApp Bot

1. **Scan QR Code** yang muncul di terminal
2. **Test dengan perintah**: `status` atau `menu`
3. **Tambah nomor admin** di settings.json

## 🌐 Akses Web Portal

- **Portal Pelanggan**: `http://ipserver:3003`
- **Admin Dashboard**: `http://ipserver:3003/admin/login`
- **Default Login**: admin / admin

## 🔧 Troubleshooting

### Masalah SQLite3
```bash
npm rebuild sqlite3
# atau
npm install sqlite3 --build-from-source
```

### Masalah WhatsApp Connection
1. Pastikan nomor WhatsApp aktif
2. Scan QR code dengan benar
3. Cek firewall dan port

### Masalah GenieACS/Mikrotik
1. Pastikan IP dan credentials benar
2. Test koneksi dari server
3. Cek firewall rules

## 📱 WhatsApp Commands

### Admin Commands
- `admin` - Menu admin
- `cekstatus [nomor]` - Cek status pelanggan
- `gantissid [nomor] [ssid]` - Ganti SSID
- `reboot [nomor]` - Reboot perangkat
- `status` - Status sistem

### Technician Commands
- `teknisi` - Menu teknisi
- `trouble` - Lihat trouble reports
- `addpppoe [user] [pass] [profile]` - Tambah PPPoE
- `pppoe` - List PPPoE users

### Customer Commands
- `menu` - Menu umum
- `cekstatus [nomor]` - Cek status
- `version` - Info versi

## 🆘 Support

- **GitHub Issues**: [https://github.com/enosrotua/cvlintasmultimedia/issues](https://github.com/enosroua/cvlintasmultimedia/issues)
- **WhatsApp Support**: 0813-6888-8498


---

**Made with ❤️ by CVLMEDIA Team**
