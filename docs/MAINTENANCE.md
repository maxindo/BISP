# 🔧 Maintenance Guide - Gembok Bill

Panduan lengkap untuk maintenance dan troubleshooting aplikasi Gembok Bill.

## 📋 Daily Maintenance

### 1. Check Application Status

```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs gembok-bill --lines 50

# Check system resources
htop
```

### 2. Monitor Logs

```bash
# Real-time log monitoring
pm2 logs gembok-bill --lines 100

# Check error logs
pm2 logs gembok-bill | grep -i "error"

# Check warning logs
pm2 logs gembok-bill | grep -i "warn"
```

### 3. Database Health Check

```bash
# Check database file
ls -la data/billing.db

# Check database size
du -h data/billing.db

# Check database integrity
sqlite3 data/billing.db "PRAGMA integrity_check;"
```

## 📊 Weekly Maintenance

### 1. Performance Monitoring

```bash
# Check memory usage
free -h

# Check disk usage
df -h

# Check CPU usage
top

# Check network connections
netstat -tulpn | grep :3003
```

### 2. Log Rotation

```bash
# Check log files size
du -h logs/*.log

# Rotate logs if needed
pm2 reload gembok-bill

# Check logrotate status
sudo logrotate -d /etc/logrotate.d/gembok-bill
```

### 3. Backup Verification

```bash
# Check backup files
ls -la data/backups/

# Verify backup integrity
gunzip -t data/backups/billing_backup_*.db.gz

# Test restore (optional)
gunzip -c data/backups/billing_backup_*.db.gz | sqlite3 test_restore.db
```

## 🔄 Monthly Maintenance

### 1. System Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Node.js if needed
sudo npm install -g npm@latest

# Update PM2
sudo npm install -g pm2@latest
```

### 2. Application Updates

```bash
# Check for updates
git fetch origin
git status

# Update application
git pull origin main
npm install
pm2 restart gembok-bill
```

### 3. Security Audit

```bash
# Check for security vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# Check outdated packages
npm outdated
```

## 🚨 Troubleshooting

### 1. Application Won't Start

**Symptoms:**
- PM2 shows "errored" status
- Application logs show startup errors
- Port 3003 not listening

**Diagnosis:**
```bash
# Check PM2 status
pm2 status

# Check detailed logs
pm2 logs gembok-bill --lines 100

# Check if port is in use
netstat -tulpn | grep :3003

# Check Node.js version
node --version
```

**Solutions:**
```bash
# Restart application
pm2 restart gembok-bill

# If still failing, check dependencies
npm install

# Check settings.json syntax
node -e "console.log(JSON.parse(require('fs').readFileSync('settings.json', 'utf8')))"

# Check database permissions
ls -la data/billing.db
```

### 2. WhatsApp Connection Issues

**Symptoms:**
- WhatsApp bot not responding
- QR code not appearing
- Session expired errors

**Diagnosis:**
```bash
# Check WhatsApp session
ls -la whatsapp-session/

# Check WhatsApp logs
pm2 logs gembok-bill | grep -i "whatsapp"

# Check network connectivity
ping 8.8.8.8
```

**Solutions:**
```bash
# Restart WhatsApp service
pm2 restart gembok-bill

# Clear WhatsApp session (if needed)
rm -rf whatsapp-session/*
pm2 restart gembok-bill

# Check WhatsApp configuration
grep -i "whatsapp" settings.json
```

### 3. Database Issues

**Symptoms:**
- Database errors in logs
- Application crashes
- Data corruption

**Diagnosis:**
```bash
# Check database file
ls -la data/billing.db

# Check database integrity
sqlite3 data/billing.db "PRAGMA integrity_check;"

# Check database size
du -h data/billing.db
```

**Solutions:**
```bash
# Restore from backup
gunzip -c data/backups/billing_backup_*.db.gz > data/billing.db

# Recreate database
rm data/billing.db
node scripts/add-payment-gateway-tables.js

# Check database permissions
chmod 644 data/billing.db
```

### 4. Performance Issues

**Symptoms:**
- High memory usage
- High CPU usage
- Slow response times
- Application crashes

**Diagnosis:**
```bash
# Check memory usage
free -h
pm2 monit

# Check CPU usage
top
htop

# Check disk usage
df -h
du -h logs/

# Check network connections
netstat -tulpn | grep :3003
```

**Solutions:**
```bash
# Restart application
pm2 restart gembok-bill

# Clear logs
pm2 flush gembok-bill

# Check for memory leaks
pm2 logs gembok-bill | grep -i "memory\|leak"

# Optimize database
sqlite3 data/billing.db "VACUUM;"
sqlite3 data/billing.db "ANALYZE;"
```

### 5. GenieACS Connection Issues

**Symptoms:**
- GenieACS commands not working
- Device monitoring errors
- API connection failures

**Diagnosis:**
```bash
# Test GenieACS connection
curl -u admin:admin http://192.168.8.89:7557/api/v1/devices

# Check GenieACS configuration
grep -i "genieacs" settings.json

# Check network connectivity
ping 192.168.8.89
```

**Solutions:**
```bash
# Update GenieACS credentials
nano settings.json

# Test connection
node -e "
const axios = require('axios');
axios.get('http://192.168.8.89:7557/api/v1/devices', {
  auth: { username: 'admin', password: 'admin' }
}).then(r => console.log('OK')).catch(e => console.log('Error:', e.message));
"

# Restart application
pm2 restart gembok-bill
```

### 6. Mikrotik Connection Issues

**Symptoms:**
- Mikrotik commands not working
- PPPoE management errors
- Router connection failures

**Diagnosis:**
```bash
# Test Mikrotik connection
telnet 192.168.8.1 8728

# Check Mikrotik configuration
grep -i "mikrotik" settings.json

# Check network connectivity
ping 192.168.8.1
```

**Solutions:**
```bash
# Update Mikrotik credentials
nano settings.json

# Test connection
node -e "
const { RouterOSAPI } = require('node-routeros');
const conn = new RouterOSAPI('192.168.8.1', 'admin', 'admin', 8728);
conn.connect().then(() => {
  console.log('Connected');
  conn.close();
}).catch(e => console.log('Error:', e.message));
"

# Restart application
pm2 restart gembok-bill
```

## 🔧 Performance Optimization

### 1. Memory Optimization

```bash
# Check memory usage
pm2 monit

# Set memory limit
pm2 start app.js --name gembok-bill --max-memory-restart 1G

# Monitor memory leaks
pm2 logs gembok-bill | grep -i "memory\|leak"
```

### 2. Database Optimization

```bash
# Optimize database
sqlite3 data/billing.db "VACUUM;"
sqlite3 data/billing.db "ANALYZE;"

# Check database size
du -h data/billing.db

# Clean old data
sqlite3 data/billing.db "DELETE FROM logs WHERE created_at < datetime('now', '-30 days');"
```

### 3. Log Optimization

```bash
# Check log files size
du -h logs/*.log

# Rotate logs
pm2 reload gembok-bill

# Clean old logs
find logs/ -name "*.log" -mtime +30 -delete
```

### 4. Network Optimization

```bash
# Check network connections
netstat -tulpn | grep :3003

# Check network usage
nethogs

# Optimize network settings
echo 'net.core.rmem_max = 16777216' >> /etc/sysctl.conf
echo 'net.core.wmem_max = 16777216' >> /etc/sysctl.conf
sysctl -p
```

## 📊 Monitoring Scripts

### 1. Health Check Script

```bash
#!/bin/bash
# health-check.sh

echo "=== Gembok Bill Health Check ==="
echo "Date: $(date)"
echo

# Check PM2 status
echo "PM2 Status:"
pm2 status
echo

# Check application logs
echo "Recent Logs:"
pm2 logs gembok-bill --lines 10
echo

# Check system resources
echo "System Resources:"
free -h
echo
df -h
echo

# Check network
echo "Network Status:"
netstat -tulpn | grep :3003
echo

# Check database
echo "Database Status:"
ls -la data/billing.db
echo
sqlite3 data/billing.db "SELECT COUNT(*) as total_customers FROM customers;"
echo

echo "=== Health Check Complete ==="
```

### 2. Performance Monitor Script

```bash
#!/bin/bash
# performance-monitor.sh

echo "=== Performance Monitor ==="
echo "Date: $(date)"
echo

# Memory usage
echo "Memory Usage:"
free -h
echo

# CPU usage
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)"
echo

# Disk usage
echo "Disk Usage:"
df -h
echo

# Network connections
echo "Network Connections:"
netstat -tulpn | grep :3003
echo

# PM2 status
echo "PM2 Status:"
pm2 status
echo

# Application logs
echo "Recent Errors:"
pm2 logs gembok-bill --lines 50 | grep -i "error"
echo

echo "=== Performance Monitor Complete ==="
```

### 3. Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/opt/gembok-bill/data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="billing_backup_$DATE.db"

echo "Starting backup..."

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp /opt/gembok-bill/data/billing.db $BACKUP_DIR/$BACKUP_FILE

# Compress backup
gzip $BACKUP_DIR/$BACKUP_FILE

# Keep only last 30 backups
cd $BACKUP_DIR
ls -t billing_backup_*.db.gz | tail -n +31 | xargs -r rm

echo "Backup completed: $BACKUP_FILE.gz"
echo "Backup size: $(du -h $BACKUP_DIR/$BACKUP_FILE.gz | cut -f1)"
```

## 🔄 Update Procedures

### 1. Minor Updates

```bash
# Backup current version
./scripts/backup.sh

# Pull updates
git pull origin main

# Install dependencies
npm install

# Restart application
pm2 restart gembok-bill

# Verify update
pm2 status
```

### 2. Major Updates

```bash
# Backup everything
./scripts/backup.sh
cp -r /opt/gembok-bill /opt/gembok-bill-backup-$(date +%Y%m%d)

# Pull updates
git pull origin main

# Install dependencies
npm install

# Run migrations if any
node scripts/migrate-database.js

# Restart application
pm2 restart gembok-bill

# Verify update
pm2 status
pm2 logs gembok-bill --lines 50
```

### 3. Rollback Procedure

```bash
# Stop application
pm2 stop gembok-bill

# Restore previous version
cd /opt/gembok-bill
git checkout HEAD~1

# Restore database
gunzip -c data/backups/billing_backup_*.db.gz > data/billing.db

# Restart application
pm2 start gembok-bill

# Verify rollback
pm2 status
```

## 📞 Emergency Contacts

- **Technical Support**: 0813-6888-8498
- **GitHub Issues**: [https://github.com/alijayanet/gembok-bill/issues](https://github.com/alijayanet/gembok-bill/issues)
- **Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)

## 📚 Additional Resources

- [README.md](README.md) - Dokumentasi utama
- [INSTALL.md](INSTALL.md) - Panduan instalasi
- [DEPLOYMENT.md](DEPLOYMENT.md) - Panduan deployment
- [SECURITY.md](SECURITY.md) - Panduan keamanan

---

**Happy Maintaining!** 🔧
