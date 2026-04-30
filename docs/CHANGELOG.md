# 📝 Changelog

Semua perubahan penting pada proyek ini akan didokumentasikan dalam file ini.

Format berdasarkan [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan proyek ini mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

### Changed
- Nothing yet

### Deprecated
- Nothing yet

### Removed
- Nothing yet

### Fixed
- Nothing yet

### Security
- Nothing yet

## [2.1.0] - 2025-01-27

### Added
- **WhatsApp Modular Architecture**: Refactoring WhatsApp module menjadi modul-modul yang lebih kecil dan maintainable
- **Role-Based Access Control (RBAC)**: Sistem role dengan Super Admin, Admin, Technician, dan Customer
- **WhatsApp Trouble Report Management**: Fitur laporan gangguan via WhatsApp dengan perintah `trouble`, `status`, `update`, `selesai`
- **WhatsApp PPPoE Management**: Manajemen PPPoE via WhatsApp dengan perintah `addpppoe`, `editpppoe`, `delpppoe`, `pppoe`
- **Dedicated Help Menus**: Menu bantuan khusus untuk admin (`admin`), teknisi (`teknisi`), dan customer (`menu`, `billing`)
- **Versioning System**: Perintah `version` dan `info` untuk menampilkan informasi versi aplikasi
- **Internet Traffic Graph Separation**: Grafik Download (RX) dan Upload (TX) terpisah dengan support bandwidth >1Gbps
- **Admin Settings Cleanup**: Interface admin yang lebih bersih dengan field visibility yang smart
- **Application Branding Update**: Company name diubah ke "GEMBOK" dengan branding yang konsisten

### Changed
- **WhatsApp Module Structure**: 
  - `whatsapp.js` (5923 baris) dipecah menjadi modul-modul kecil
  - `whatsapp-core.js`: Core utilities dan validation
  - `whatsapp-commands.js`: Command handlers
  - `whatsapp-message-handlers.js`: Message routing
  - `whatsapp-new.js`: Main orchestrator
- **Web Admin Interface**: 
  - Traffic graphs separation untuk download dan upload
  - High bandwidth support hingga >1Gbps dan >500Mbps
  - Version information display di sidebar dan footer
  - Admin settings dengan field visibility yang smart
- **Company Branding**: 
  - App name: "GEMBOK"
  - Company header: "GEMBOK"
  - Consistent branding di semua interface

### Technical Improvements
- **Modular Architecture**: Setiap modul memiliki tanggung jawab spesifik
- **Dependency Injection**: WhatsApp core diinjeksi ke command handlers
- **Error Handling**: Improved error handling dan logging
- **Code Reusability**: Functions yang dapat digunakan ulang
- **Security Enhancements**: Role validation dan input sanitization

### Configuration Updates
- **New settings.json fields**:
  - `app_version`: "2.1.0"
  - `version_name`: "WhatsApp Modular + Role System"
  - `version_date`: "2025-01-27"
  - `version_notes`: "Added technician role, trouble report & PPPoE WhatsApp commands"
  - `build_number`: "20250127.001"
  - `app_name`: "GEMBOK"
  - `company_header`: "GEMBOK"
  - `technician_numbers.0`, `technician_numbers.1`: Nomor teknisi

### Documentation
- **`docs/WHATSAPP_MODULAR_README.md`**: Comprehensive guide untuk arsitektur modular
- **`docs/TROUBLE_REPORT_WHATSAPP.md`**: Dokumentasi fitur trouble report
- **`docs/PPPOE_WHATSAPP.md`**: Dokumentasi fitur PPPoE management
- **`docs/WEB_ADMIN_VERSIONING.md`**: Dokumentasi fitur versioning

## [2.0.0] - 2025-01-20

### Added
- **WhatsApp Bot Gateway**: Interface perintah via WhatsApp dengan role-based access control
- **Web Portal Admin**: Dashboard admin yang lengkap dengan versioning system
- **Sistem Billing Terintegrasi**: Manajemen tagihan dan pembayaran
- **Payment Gateway**: Integrasi Midtrans, Xendit, Tripay
- **GenieACS Management**: Monitoring dan manajemen perangkat ONU/ONT
- **Mikrotik Management**: Manajemen PPPoE dan Hotspot
- **Portal Pelanggan**: Self-service untuk pelanggan
- **Monitoring Real-time**: PPPoE, RX Power, dan sistem dengan grafik terpisah
- **Notifikasi Otomatis**: WhatsApp notifications
- **Trouble Ticket System**: Manajemen gangguan via WhatsApp dan web
- **Role-Based Access Control**: Super Admin, Admin, Technician, Customer
- **WhatsApp Commands**: Trouble report, PPPoE management, version info
- **Enhanced UI**: Traffic graphs separation, high bandwidth support, admin settings cleanup

### WhatsApp Commands Added
- **Admin Commands**: `admin`, `cekstatus`, `gantissid`, `reboot`, `status`, `restart`, `version`, `info`
- **Technician Commands**: `teknisi`, `trouble`, `status`, `update`, `selesai`, `addpppoe`, `editpppoe`, `delpppoe`, `pppoe`, `checkpppoe`, `restartpppoe`
- **Customer Commands**: `menu`, `billing`, `cekstatus`, `version`
- **Help Commands**: `help trouble`, `help pppoe`

### Web Features Added
- **Dashboard**: Real-time monitoring dengan traffic graphs
- **Billing Management**: CRUD pelanggan, paket, invoice, pembayaran
- **Payment Gateway Integration**: Midtrans, Xendit, Tripay
- **GenieACS Management**: Device monitoring dan management
- **Mikrotik Management**: PPPoE dan Hotspot management
- **Customer Portal**: Self-service portal untuk pelanggan
- **Admin Settings**: Konfigurasi aplikasi via web interface

### Technical Features
- **Database**: SQLite dengan migration system
- **API Integration**: GenieACS dan Mikrotik API
- **WhatsApp Integration**: WhatsApp Web API dengan session management
- **Payment Processing**: Multiple payment gateway support
- **Real-time Monitoring**: WebSocket untuk real-time updates
- **Logging System**: Comprehensive logging dengan different levels
- **Error Handling**: Robust error handling dan recovery

## [1.0.0] - 2025-01-15

### Added
- **Initial Release**: Base system dengan fitur dasar
- **WhatsApp Bot**: Basic WhatsApp integration
- **Web Interface**: Basic web interface
- **Database**: SQLite database setup
- **Configuration**: Settings management system

---

## 📋 Legend

- **Added** untuk fitur baru
- **Changed** untuk perubahan pada fitur yang sudah ada
- **Deprecated** untuk fitur yang akan dihapus di versi mendatang
- **Removed** untuk fitur yang sudah dihapus
- **Fixed** untuk bug fixes
- **Security** untuk perbaikan keamanan

## 🔗 Links

- [GitHub Repository](https://github.com/alijayanet/gembok-bill)
- [Documentation](README.md)
- [Installation Guide](INSTALL.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Support](https://t.me/alijayaNetAcs)
