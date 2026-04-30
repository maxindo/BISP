# 🤝 Contributing to Gembok Bill

Terima kasih telah tertarik untuk berkontribusi pada Gembok Bill! Kami sangat menghargai kontribusi dari komunitas.

## 📋 Cara Berkontribusi

### 1. Fork Repository

1. Klik tombol "Fork" di halaman repository GitHub
2. Clone repository yang sudah di-fork ke komputer Anda:
   ```bash
   git clone https://github.com/YOUR_USERNAME/gembok-bill.git
   cd gembok-bill
   ```

### 2. Setup Development Environment

```bash
# Install dependencies
npm install

# Copy settings template
cp settings.server.template.json settings.json

# Edit settings.json sesuai kebutuhan development
nano settings.json
```

### 3. Buat Branch untuk Fitur Baru

```bash
# Buat branch baru
git checkout -b feature/amazing-feature

# Atau untuk bug fix
git checkout -b fix/bug-description
```

### 4. Development Guidelines

#### Code Style
- Gunakan ESLint untuk code formatting
- Ikuti JavaScript best practices
- Tulis kode yang mudah dibaca dan dipahami
- Gunakan comment yang jelas untuk kode kompleks

#### Testing
- Tulis unit tests untuk fitur baru
- Test semua perubahan sebelum commit
- Pastikan tidak ada breaking changes

#### Documentation
- Update README.md jika ada perubahan fitur
- Update dokumentasi API jika ada perubahan endpoint
- Tulis commit message yang jelas

### 5. Commit Changes

```bash
# Add changes
git add .

# Commit dengan message yang jelas
git commit -m "feat: add new WhatsApp command for customer support"

# Push ke branch
git push origin feature/amazing-feature
```

#### Commit Message Format
Gunakan format conventional commits:
- `feat:` untuk fitur baru
- `fix:` untuk bug fix
- `docs:` untuk dokumentasi
- `style:` untuk formatting
- `refactor:` untuk refactoring
- `test:` untuk tests
- `chore:` untuk maintenance

### 6. Create Pull Request

1. Buka halaman repository di GitHub
2. Klik "New Pull Request"
3. Pilih branch yang akan di-merge
4. Tulis deskripsi yang jelas tentang perubahan
5. Link ke issue terkait jika ada
6. Submit Pull Request

## 🐛 Melaporkan Bug

### Sebelum Melaporkan Bug
1. Cek apakah bug sudah dilaporkan di [Issues](https://github.com/alijayanet/gembok-bill/issues)
2. Cek dokumentasi dan troubleshooting guide
3. Pastikan menggunakan versi terbaru

### Format Bug Report
```markdown
**Bug Description**
Deskripsi singkat tentang bug

**Steps to Reproduce**
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected Behavior**
Apa yang seharusnya terjadi

**Actual Behavior**
Apa yang benar-benar terjadi

**Environment**
- OS: [e.g. Ubuntu 20.04]
- Node.js Version: [e.g. 20.0.0]
- App Version: [e.g. 2.1.0]

**Screenshots**
Jika ada, tambahkan screenshot

**Additional Context**
Informasi tambahan yang relevan
```

## ✨ Mengusulkan Fitur Baru

### Sebelum Mengusulkan Fitur
1. Cek apakah fitur sudah ada atau sudah diusulkan
2. Pastikan fitur sesuai dengan tujuan aplikasi
3. Pertimbangkan kompleksitas implementasi

### Format Feature Request
```markdown
**Feature Description**
Deskripsi singkat tentang fitur yang diusulkan

**Problem Statement**
Masalah apa yang akan diselesaikan oleh fitur ini

**Proposed Solution**
Solusi yang diusulkan

**Alternatives Considered**
Alternatif lain yang sudah dipertimbangkan

**Additional Context**
Informasi tambahan yang relevan
```

## 🔧 Development Setup

### Prerequisites
- Node.js 18+ (direkomendasikan 20+)
- npm atau yarn
- Git
- GenieACS API access (untuk testing)
- Mikrotik API access (untuk testing)
- WhatsApp number (untuk testing)

### Project Structure
```
gembok-bill/
├── app.js                 # Main application file
├── package.json           # Dependencies and scripts
├── settings.json          # Application configuration
├── config/               # Configuration modules
├── routes/               # Express routes
├── views/                # EJS templates
├── public/               # Static files
├── data/                 # Database files
├── logs/                 # Log files
├── scripts/              # Utility scripts
└── whatsapp-session/     # WhatsApp session files
```

### Available Scripts
```bash
npm start          # Start production server
npm run dev        # Start development server
npm test           # Run tests
npm run build      # Build application
npm run lint       # Run ESLint
```

## 📚 Resources

- [README.md](README.md) - Dokumentasi utama
- [INSTALL.md](INSTALL.md) - Panduan instalasi
- [GitHub Issues](https://github.com/alijayanet/gembok-bill/issues) - Bug reports dan feature requests
- [Telegram Group](https://t.me/alijayaNetAcs) - Diskusi komunitas

## 🏷️ Labels

Kami menggunakan label untuk mengkategorikan issues dan PRs:

- `bug` - Bug yang perlu diperbaiki
- `enhancement` - Fitur baru atau perbaikan
- `documentation` - Perbaikan dokumentasi
- `good first issue` - Cocok untuk kontributor baru
- `help wanted` - Membutuhkan bantuan komunitas
- `priority: high` - Prioritas tinggi
- `priority: medium` - Prioritas sedang
- `priority: low` - Prioritas rendah

## 🎯 Roadmap

Fitur yang sedang dalam pengembangan:
- [ ] Multi-language support
- [ ] Advanced reporting
- [ ] Mobile app
- [ ] API documentation
- [ ] Performance optimization

## 📞 Support

Jika Anda membutuhkan bantuan:
- **GitHub Issues**: [https://github.com/alijayanet/gembok-bill/issues](https://github.com/alijayanet/gembok-bill/issues)
- **WhatsApp Support**: 0813-6888-8498
- **Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)

## 🙏 Recognition

Kontributor akan diakui di:
- README.md contributors section
- Release notes
- GitHub contributors page

Terima kasih telah berkontribusi pada Gembok Bill! 🚀
