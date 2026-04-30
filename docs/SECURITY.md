# 🔒 Security Policy

## 🛡️ Supported Versions

Kami menyediakan security updates untuk versi berikut:

| Version | Supported          |
| ------- | ------------------ |
| 2.1.x   | ✅                 |
| 2.0.x   | ✅                 |
| < 2.0   | ❌                 |

## 🚨 Reporting a Vulnerability

Jika Anda menemukan kerentanan keamanan dalam Gembok Bill, silakan laporkan dengan cara berikut:

### 📧 Cara Melaporkan

1. **JANGAN** buat issue publik di GitHub
2. Kirim email ke: security@gembok.net
3. Atau hubungi WhatsApp: 0813-6888-8498
4. Atau DM di Telegram: [@alijayaNetAcs](https://t.me/alijayaNetAcs)

### 📋 Informasi yang Diperlukan

Sertakan informasi berikut dalam laporan:

- **Deskripsi kerentanan**: Penjelasan detail tentang kerentanan
- **Steps to reproduce**: Langkah-langkah untuk mereproduksi
- **Impact assessment**: Dampak potensial dari kerentanan
- **Suggested fix**: Jika ada, saran untuk perbaikan
- **Your contact information**: Untuk follow-up

### ⏱️ Response Timeline

- **Initial Response**: Dalam 48 jam
- **Status Update**: Setiap 7 hari
- **Resolution**: Sesegera mungkin setelah konfirmasi

## 🔐 Security Best Practices

### 🏠 Production Deployment

1. **Environment Variables**:
   ```bash
   # Jangan hardcode credentials
   export GENIEACS_PASSWORD="your_secure_password"
   export MIKROTIK_PASSWORD="your_secure_password"
   export WHATSAPP_SESSION_PATH="/secure/path"
   ```

2. **File Permissions**:
   ```bash
   # Secure file permissions
   chmod 600 settings.json
   chmod 700 whatsapp-session/
   chmod 600 data/*.db
   ```

3. **Firewall Configuration**:
   ```bash
   # Only allow necessary ports
   ufw allow 3003/tcp
   ufw deny 22/tcp  # Disable SSH if not needed
   ```

4. **Database Security**:
   - Gunakan SQLite dengan file permissions yang tepat
   - Backup database secara teratur
   - Jangan expose database file ke web

### 🔑 API Security

1. **GenieACS API**:
   - Gunakan HTTPS untuk koneksi
   - Rotate credentials secara teratur
   - Monitor API usage

2. **Mikrotik API**:
   - Gunakan API user dengan permissions terbatas
   - Enable API SSL
   - Monitor API calls

3. **WhatsApp API**:
   - Simpan session files di lokasi yang aman
   - Monitor WhatsApp connection
   - Implement rate limiting

### 🌐 Web Security

1. **HTTPS**: Gunakan SSL/TLS untuk production
2. **Headers**: Implement security headers
3. **CORS**: Configure CORS dengan benar
4. **Rate Limiting**: Implement rate limiting untuk API
5. **Input Validation**: Validate semua input user
6. **SQL Injection**: Gunakan parameterized queries

### 🔐 Authentication & Authorization

1. **Admin Access**:
   - Gunakan password yang kuat
   - Implement 2FA jika memungkinkan
   - Rotate credentials secara teratur

2. **WhatsApp Numbers**:
   - Validasi nomor admin dan teknisi
   - Monitor unauthorized access
   - Implement role-based access control

3. **Session Management**:
   - Secure session storage
   - Implement session timeout
   - Monitor active sessions

## 🔍 Security Monitoring

### 📊 Logging

Monitor log files untuk aktivitas mencurigakan:

```bash
# Monitor application logs
tail -f logs/app.log | grep -i "error\|warn\|security"

# Monitor system logs
journalctl -f | grep -i "gembok\|billing"
```

### 🚨 Alerts

Setup alerts untuk:
- Failed login attempts
- Unauthorized API access
- WhatsApp connection issues
- Database errors
- System resource usage

### 📈 Monitoring Tools

- **PM2 Monitoring**: `pm2 monit`
- **System Monitoring**: `htop`, `iotop`
- **Network Monitoring**: `netstat`, `ss`
- **Log Analysis**: `grep`, `awk`, `sed`

## 🛠️ Security Tools

### 🔍 Vulnerability Scanning

```bash
# NPM audit
npm audit

# Dependency check
npm outdated

# Security scan
npm audit fix
```

### 🔒 File Integrity

```bash
# Check file permissions
find . -type f -perm /o+w

# Check for world-writable files
find . -type f -perm /o+w -ls
```

## 📚 Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [SQLite Security](https://www.sqlite.org/security.html)

## 🆘 Emergency Response

Jika terjadi security incident:

1. **Immediate Response**:
   - Isolate affected systems
   - Preserve evidence
   - Notify stakeholders

2. **Investigation**:
   - Analyze logs
   - Identify attack vector
   - Assess damage

3. **Recovery**:
   - Apply patches
   - Restore from backup
   - Monitor for recurrence

4. **Post-Incident**:
   - Document lessons learned
   - Update security procedures
   - Conduct security review

## 📞 Contact Information

- **Security Email**: security@gembok.net
- **WhatsApp**: 0813-6888-8498
- **Telegram**: [@alijayaNetAcs](https://t.me/alijayaNetAcs)
- **GitHub Issues**: [Security Issues](https://github.com/alijayanet/gembok-bill/issues)

---

**Terima kasih telah membantu menjaga keamanan Gembok Bill!** 🛡️
