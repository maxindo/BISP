# 🆘 Support Guide - Gembok Bill

Panduan lengkap untuk mendapatkan bantuan dan support untuk aplikasi Gembok Bill.

## 📞 Contact Information

### 🚨 Emergency Support
- **WhatsApp**: 0813-6888-8498
- **Telegram**: [@alijayaNetAcs](https://t.me/alijayaNetAcs)
- **Email**: support@gembok.net

### 📱 Community Support
- **Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)
- **Telegram Channel**: [https://t.me/alijayaNetwork](https://t.me/alijayaNetwork)
- **YouTube**: [https://www.youtube.com/shorts/qYJFQY7egFw](https://www.youtube.com/shorts/qYJFQY7egFw)

### 🐛 Bug Reports & Feature Requests
- **GitHub Issues**: [https://github.com/alijayanet/gembok-bill/issues](https://github.com/alijayanet/gembok-bill/issues)
- **GitHub Discussions**: [https://github.com/alijayanet/gembok-bill/discussions](https://github.com/alijayanet/gembok-bill/discussions)

## 🕒 Support Hours

### 📅 Regular Support
- **Monday - Friday**: 08:00 - 17:00 WIB
- **Saturday**: 09:00 - 15:00 WIB
- **Sunday**: Emergency only

### 🚨 Emergency Support
- **24/7**: Critical issues only
- **Response Time**: Within 2 hours
- **Contact**: WhatsApp 0813-6888-8498

## 📋 Support Tiers

### 🆓 Community Support (Free)
- **GitHub Issues**: Bug reports and feature requests
- **Telegram Group**: Community discussions and help
- **Documentation**: Self-service documentation
- **Response Time**: 24-48 hours

### 💼 Standard Support (Paid)
- **WhatsApp Support**: Direct technical support
- **Email Support**: Detailed technical assistance
- **Response Time**: 4-8 hours
- **Includes**: Installation help, configuration assistance, basic troubleshooting

### 🏆 Premium Support (Paid)
- **Priority Support**: Faster response times
- **Remote Assistance**: Screen sharing and remote help
- **Custom Development**: Feature development and customization
- **Response Time**: 1-2 hours
- **Includes**: Advanced troubleshooting, performance optimization, custom features

## 🔧 Common Issues & Solutions

### 1. Installation Issues

**Problem**: Application won't start
**Solutions**:
```bash
# Check Node.js version
node --version

# Install dependencies
npm install

# Check settings.json
node -e "console.log(JSON.parse(require('fs').readFileSync('settings.json', 'utf8')))"

# Run setup script
./setup.sh
```

**Still having issues?** Contact support with:
- OS version
- Node.js version
- Error logs
- Steps taken

### 2. WhatsApp Connection Issues

**Problem**: WhatsApp bot not responding
**Solutions**:
```bash
# Check WhatsApp session
ls -la whatsapp-session/

# Restart application
pm2 restart gembok-bill

# Check WhatsApp logs
pm2 logs gembok-bill | grep -i "whatsapp"
```

**Still having issues?** Contact support with:
- WhatsApp number
- Error messages
- Session files status

### 3. Database Issues

**Problem**: Database errors or corruption
**Solutions**:
```bash
# Check database file
ls -la data/billing.db

# Check database integrity
sqlite3 data/billing.db "PRAGMA integrity_check;"

# Restore from backup
gunzip -c data/backups/billing_backup_*.db.gz > data/billing.db
```

**Still having issues?** Contact support with:
- Database file size
- Error messages
- Backup availability

### 4. GenieACS Connection Issues

**Problem**: GenieACS commands not working
**Solutions**:
```bash
# Test connection
curl -u admin:admin http://192.168.8.89:7557/api/v1/devices

# Check configuration
grep -i "genieacs" settings.json

# Test network
ping 192.168.8.89
```

**Still having issues?** Contact support with:
- GenieACS version
- Network configuration
- Error messages

### 5. Mikrotik Connection Issues

**Problem**: Mikrotik commands not working
**Solutions**:
```bash
# Test connection
telnet 192.168.8.1 8728

# Check configuration
grep -i "mikrotik" settings.json

# Test network
ping 192.168.8.1
```

**Still having issues?** Contact support with:
- Mikrotik version
- RouterOS version
- Network configuration

## 📝 How to Report Issues

### 🐛 Bug Reports

When reporting bugs, please include:

1. **Description**: Clear description of the problem
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**:
   - OS version
   - Node.js version
   - App version
   - Browser (if applicable)
6. **Error Logs**: Relevant error messages
7. **Screenshots**: If applicable

### 🚀 Feature Requests

When requesting features, please include:

1. **Feature Description**: Clear description of the feature
2. **Problem Statement**: What problem this solves
3. **Proposed Solution**: How you envision it working
4. **Use Cases**: Specific scenarios where this would be helpful
5. **Priority**: How important this is to you
6. **Contribution**: Whether you can help implement

### 💬 General Questions

For general questions:

1. **Check Documentation**: First check README.md, INSTALL.md, etc.
2. **Search Issues**: Check if your question has been asked before
3. **Ask in Telegram Group**: For quick community help
4. **Create GitHub Discussion**: For detailed questions

## 🔍 Troubleshooting Checklist

Before contacting support, please check:

### ✅ Basic Checks
- [ ] Node.js version is 18+ (preferably 20+)
- [ ] All dependencies are installed (`npm install`)
- [ ] settings.json is properly configured
- [ ] Application is running (`pm2 status`)
- [ ] No error messages in logs (`pm2 logs gembok-bill`)

### ✅ Network Checks
- [ ] GenieACS is accessible from server
- [ ] Mikrotik is accessible from server
- [ ] WhatsApp number is active
- [ ] Firewall allows necessary ports

### ✅ Configuration Checks
- [ ] Admin numbers are correct format (628xxxxxxxxxx)
- [ ] Technician numbers are correct format
- [ ] GenieACS credentials are correct
- [ ] Mikrotik credentials are correct
- [ ] WhatsApp session path is writable

### ✅ Database Checks
- [ ] Database file exists and is readable
- [ ] Database integrity is good
- [ ] Sufficient disk space available
- [ ] Backup is available

## 📚 Self-Service Resources

### 📖 Documentation
- **README.md**: Main documentation
- **INSTALL.md**: Installation guide
- **DEPLOYMENT.md**: Deployment guide
- **MAINTENANCE.md**: Maintenance guide
- **SECURITY.md**: Security guide
- **CONTRIBUTING.md**: Contribution guide

### 🎥 Video Tutorials
- **YouTube Channel**: [https://www.youtube.com/shorts/qYJFQY7egFw](https://www.youtube.com/shorts/qYJFQY7egFw)
- **Installation Guide**: Step-by-step installation
- **Configuration Guide**: Settings configuration
- **Troubleshooting Guide**: Common issues and solutions

### 💬 Community Resources
- **Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)
- **GitHub Discussions**: [https://github.com/alijayanet/gembok-bill/discussions](https://github.com/alijayanet/gembok-bill/discussions)
- **FAQ**: Frequently asked questions
- **Wiki**: Community-maintained documentation

## 💰 Support Pricing

### 🆓 Community Support
- **Cost**: Free
- **Response Time**: 24-48 hours
- **Channels**: GitHub Issues, Telegram Group
- **Scope**: Bug reports, feature requests, general questions

### 💼 Standard Support
- **Cost**: $50/month
- **Response Time**: 4-8 hours
- **Channels**: WhatsApp, Email
- **Scope**: Technical support, configuration help, basic troubleshooting

### 🏆 Premium Support
- **Cost**: $150/month
- **Response Time**: 1-2 hours
- **Channels**: WhatsApp, Email, Remote Assistance
- **Scope**: Priority support, custom development, advanced troubleshooting

### 🚨 Emergency Support
- **Cost**: $200/incident
- **Response Time**: 1-2 hours
- **Channels**: WhatsApp, Phone
- **Scope**: Critical issues, production outages

## 🤝 Contributing to Support

### 👥 Community Helpers
We welcome community members who want to help others:

1. **Join Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)
2. **Answer Questions**: Help others with their issues
3. **Share Knowledge**: Share tips and tricks
4. **Report Bugs**: Help identify and report issues
5. **Suggest Improvements**: Provide feedback on documentation

### 🏆 Recognition
Community helpers are recognized through:
- **GitHub Contributors**: Listed in README.md
- **Telegram Group**: Special recognition
- **Release Notes**: Mentioned in updates
- **Special Access**: Early access to new features

## 📞 Emergency Procedures

### 🚨 Critical Issues
For critical issues affecting production:

1. **Contact**: WhatsApp 0813-6888-8498
2. **Include**: 
   - Description of the issue
   - Impact on users
   - Steps to reproduce
   - Error logs
   - System information
3. **Response**: Within 1-2 hours
4. **Resolution**: Priority handling

### 🔒 Security Issues
For security vulnerabilities:

1. **Contact**: security@gembok.net
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. **Response**: Within 24 hours
4. **Resolution**: Coordinated disclosure

## 📊 Support Metrics

### 📈 Response Times
- **Community Support**: 24-48 hours
- **Standard Support**: 4-8 hours
- **Premium Support**: 1-2 hours
- **Emergency Support**: 1-2 hours

### 🎯 Resolution Rates
- **Installation Issues**: 95% resolved within 24 hours
- **Configuration Issues**: 90% resolved within 48 hours
- **Bug Reports**: 80% resolved within 1 week
- **Feature Requests**: 60% implemented within 1 month

## 🙏 Thank You

Thank you for using Gembok Bill! We appreciate your feedback and are committed to providing the best possible support experience.

---

**Need Help?** Contact us at 0813-6888-8498 or join our Telegram group! 🚀

