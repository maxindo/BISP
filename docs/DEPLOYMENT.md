# 🚀 Deployment Guide - Gembok Bill

Panduan lengkap untuk deployment Gembok Bill ke production server.

## 📋 Prerequisites

### Server Requirements
- **OS**: Ubuntu 20.04+ atau CentOS 8+
- **RAM**: Minimum 2GB (Recommended 4GB+)
- **Storage**: Minimum 20GB SSD
- **CPU**: 2 cores minimum
- **Network**: Stable internet connection

### Software Requirements
- **Node.js**: v18+ (Recommended v20+)
- **npm**: v8+
- **PM2**: Untuk process management
- **Nginx**: Untuk reverse proxy (optional)
- **SSL Certificate**: Untuk HTTPS (recommended)

## 🔧 Server Setup

### 1. Update System

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. Install Node.js

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install PM2

```bash
# Install PM2 globally
npm install -g pm2

# Setup PM2 startup
pm2 startup
```

### 4. Install Nginx (Optional)

```bash
# Ubuntu/Debian
sudo apt install nginx -y

# CentOS/RHEL
sudo yum install nginx -y

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

## 📦 Application Deployment

### 1. Clone Repository

```bash
# Create application directory
sudo mkdir -p /opt/gembok-bill
sudo chown $USER:$USER /opt/gembok-bill
cd /opt/gembok-bill

# Clone repository
git clone https://github.com/alijayanet/gembok-bill.git .

# Install dependencies
npm install
```

### 2. Configuration

```bash
# Copy settings template
cp settings.server.template.json settings.json

# Edit settings.json
nano settings.json
```

**Minimal Production Configuration:**

```json
{
  "app_version": "2.1.0",
  "app_name": "GEMBOK",
  "company_header": "GEMBOK",
  "footer_info": "Info Hubungi : 0813-6888-8498",
  
  "admins.0": "6281368888498",
  "admin_enabled": "true",
  "admin_username": "admin",
  "admin_password": "your_secure_password",
  
  "technician_numbers.0": "6283807665111",
  "technician_numbers.1": "6282218094111",
  
  "genieacs_url": "http://192.168.8.89:7557",
  "genieacs_username": "admin",
  "genieacs_password": "your_genieacs_password",
  
  "mikrotik_host": "192.168.8.1",
  "mikrotik_port": "8728",
  "mikrotik_user": "admin",
  "mikrotik_password": "your_mikrotik_password",
  "main_interface": "ether1-ISP",
  
  "whatsapp_session_path": "./whatsapp-session",
  "whatsapp_keep_alive": "true",
  "whatsapp_restart_on_error": "true",
  
  "server_port": "3003",
  "server_host": "0.0.0.0",
  "secret_key": "your_secret_key_here",
  "log_level": "info"
}
```

### 3. Setup Database

```bash
# Run database setup
node scripts/add-payment-gateway-tables.js
```

### 4. Create Directories

```bash
# Create necessary directories
mkdir -p logs
mkdir -p whatsapp-session
mkdir -p data/backups

# Set proper permissions
chmod 755 logs
chmod 700 whatsapp-session
chmod 755 data
chmod 755 data/backups
```

## 🚀 Running the Application

### 1. Development Mode

```bash
# Start in development mode
npm run dev
```

### 2. Production Mode with PM2

```bash
# Start with PM2
pm2 start app.js --name gembok-bill

# Save PM2 configuration
pm2 save

# Monitor application
pm2 monit
```

### 3. PM2 Management Commands

```bash
# View status
pm2 status

# View logs
pm2 logs gembok-bill

# Restart application
pm2 restart gembok-bill

# Stop application
pm2 stop gembok-bill

# Delete application
pm2 delete gembok-bill
```

## 🌐 Nginx Configuration

### 1. Create Nginx Configuration

```bash
# Create Nginx configuration
sudo nano /etc/nginx/sites-available/gembok-bill
```

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /path/to/your/cert.pem;
    ssl_certificate_key /path/to/your/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # Proxy Configuration
    location / {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Static Files Caching
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass http://localhost:3003;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 2. Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/gembok-bill /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## 🔒 SSL Certificate Setup

### 1. Let's Encrypt (Free SSL)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### 2. Self-Signed Certificate (Development)

```bash
# Create SSL directory
sudo mkdir -p /etc/nginx/ssl

# Generate self-signed certificate
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/key.pem \
    -out /etc/nginx/ssl/cert.pem
```

## 🔥 Firewall Configuration

### 1. UFW (Ubuntu)

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow application port (if not using Nginx)
sudo ufw allow 3003/tcp

# Check status
sudo ufw status
```

### 2. Firewalld (CentOS)

```bash
# Start firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld

# Allow services
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# Reload firewall
sudo firewall-cmd --reload
```

## 📊 Monitoring & Logging

### 1. Application Logs

```bash
# View application logs
pm2 logs gembok-bill

# View logs in real-time
pm2 logs gembok-bill --lines 100

# Log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

### 2. System Monitoring

```bash
# Install monitoring tools
sudo apt install htop iotop nethogs -y

# Monitor system resources
htop

# Monitor network usage
nethogs

# Monitor disk I/O
iotop
```

### 3. Log Rotation

```bash
# Create logrotate configuration
sudo nano /etc/logrotate.d/gembok-bill
```

**Logrotate Configuration:**

```
/opt/gembok-bill/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        pm2 reload gembok-bill
    endscript
}
```

## 🔄 Backup & Recovery

### 1. Database Backup

```bash
# Create backup script
nano /opt/gembok-bill/scripts/backup.sh
```

**Backup Script:**

```bash
#!/bin/bash

BACKUP_DIR="/opt/gembok-bill/data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="billing_backup_$DATE.db"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Backup database
cp /opt/gembok-bill/data/billing.db $BACKUP_DIR/$BACKUP_FILE

# Compress backup
gzip $BACKUP_DIR/$BACKUP_FILE

# Keep only last 30 backups
cd $BACKUP_DIR
ls -t billing_backup_*.db.gz | tail -n +31 | xargs -r rm

echo "Backup completed: $BACKUP_FILE.gz"
```

```bash
# Make script executable
chmod +x /opt/gembok-bill/scripts/backup.sh

# Add to crontab for daily backup
crontab -e
# Add: 0 2 * * * /opt/gembok-bill/scripts/backup.sh
```

### 2. Application Backup

```bash
# Create application backup script
nano /opt/gembok-bill/scripts/app-backup.sh
```

**Application Backup Script:**

```bash
#!/bin/bash

BACKUP_DIR="/opt/backups/gembok-bill"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="gembok-bill-backup-$DATE.tar.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Create backup
tar -czf $BACKUP_DIR/$BACKUP_FILE \
    --exclude=node_modules \
    --exclude=whatsapp-session \
    --exclude=logs \
    /opt/gembok-bill

# Keep only last 7 backups
cd $BACKUP_DIR
ls -t gembok-bill-backup-*.tar.gz | tail -n +8 | xargs -r rm

echo "Application backup completed: $BACKUP_FILE"
```

## 🚨 Troubleshooting

### 1. Common Issues

**Application won't start:**
```bash
# Check logs
pm2 logs gembok-bill

# Check Node.js version
node --version

# Check dependencies
npm list
```

**WhatsApp connection issues:**
```bash
# Check WhatsApp session
ls -la whatsapp-session/

# Restart WhatsApp service
pm2 restart gembok-bill
```

**Database issues:**
```bash
# Check database file
ls -la data/billing.db

# Check database permissions
ls -la data/
```

### 2. Performance Issues

**High memory usage:**
```bash
# Monitor memory usage
pm2 monit

# Restart application
pm2 restart gembok-bill
```

**High CPU usage:**
```bash
# Check CPU usage
top

# Check for memory leaks
pm2 logs gembok-bill --lines 1000 | grep -i "memory\|leak"
```

## 📈 Scaling & Optimization

### 1. Load Balancing

```nginx
# Multiple application instances
upstream gembok_backend {
    server localhost:3003;
    server localhost:3004;
    server localhost:3005;
}
```

### 2. Caching

```nginx
# Enable caching
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. Compression

```nginx
# Enable gzip compression
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
```

## 🆘 Support

- **GitHub Issues**: [https://github.com/alijayanet/gembok-bill/issues](https://github.com/alijayanet/gembok-bill/issues)
- **WhatsApp Support**: 0813-6888-8498
- **Telegram Group**: [https://t.me/alijayaNetAcs](https://t.me/alijayaNetAcs)

---

**Happy Deploying!** 🚀
