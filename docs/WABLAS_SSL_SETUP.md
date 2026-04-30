# Setup SSL Gratis untuk Wablas Webhook

## 📋 Prerequisites

1. Domain `bil.cvlmedia.my.id` sudah pointing ke IP public router (5.181.178.56)
2. Port forwarding di Mikrotik sudah setup (port 80 & 443 → IP lokal server)
2. Port 80 dan 443 sudah dibuka di firewall
3. Aplikasi billing sudah running di port 3003

**Note**: Script akan otomatis install Nginx dan Certbot jika belum terinstall.

## 🚀 Quick Setup

### Method 1: Menggunakan Script Otomatis (Recommended)

```bash
# Berikan permission execute
chmod +x scripts/setup-ssl.sh

# Jalankan script
sudo ./scripts/setup-ssl.sh
```

Script akan:
- ✅ Install Certbot (jika belum ada)
- ✅ Buat konfigurasi Nginx untuk domain
- ✅ Get SSL certificate dari Let's Encrypt
- ✅ Setup auto-renewal
- ✅ Konfigurasi webhook endpoint

### Method 2: Manual Setup

#### Step 1: Install Certbot

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

#### Step 2: Buat Konfigurasi Nginx

Buat file `/etc/nginx/sites-available/bil.cvlmedia.my.id`:

```nginx
# HTTP server - redirect to HTTPS
server {
    listen 80;
    server_name bil.cvlmedia.my.id;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name bil.cvlmedia.my.id;

    # SSL Configuration (akan diupdate oleh Certbot)
    ssl_certificate /etc/letsencrypt/live/bil.cvlmedia.my.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bil.cvlmedia.my.id/privkey.pem;
    
    # SSL Protocols
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy settings
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Webhook Wablas (PENTING!)
    location /webhook/wablas {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeout untuk webhook
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Main application
    location / {
        proxy_pass http://localhost:3003;
    }
}
```

#### Step 3: Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/bil.cvlmedia.my.id /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

#### Step 4: Get SSL Certificate

```bash
# Get SSL certificate (ganti email dengan email Anda)
sudo certbot --nginx -d bil.cvlmedia.my.id --non-interactive --agree-tos --email cvlintasmultimedia@gmail.com --redirect
```

#### Step 5: Test Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run
```

## 🔧 Konfigurasi Wablas Webhook

Setelah SSL setup, update webhook URL di dashboard Wablas:

1. Login ke dashboard Wablas: https://bdg.wablas.com
2. Masuk ke menu **Webhook** atau **Settings > Webhook**
3. Set webhook URL: `https://bil.cvlmedia.my.id/webhook/wablas`
4. Set webhook secret (opsional, untuk keamanan)
5. Save

## ✅ Verifikasi

### 1. Test SSL Certificate

```bash
# Cek certificate
sudo certbot certificates

# Test SSL dengan openssl
openssl s_client -connect bil.cvlmedia.my.id:443 -servername bil.cvlmedia.my.id
```

### 2. Test Webhook Endpoint

```bash
# Test webhook endpoint
curl -X POST https://bil.cvlmedia.my.id/webhook/wablas/health

# Expected response:
# {"status":"ok","provider":"wablas","timestamp":"..."}
```

### 3. Test dari Browser

Buka di browser:
- https://bil.cvlmedia.my.id
- https://bil.cvlmedia.my.id/webhook/wablas/health

## 🔄 Auto-Renewal

Let's Encrypt certificate berlaku selama 90 hari dan akan auto-renew. Untuk memastikan auto-renewal bekerja:

```bash
# Test renewal
sudo certbot renew --dry-run

# Setup cron job (jika belum ada)
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 🐛 Troubleshooting

### Certificate tidak bisa didapat

1. **Cek DNS**: Pastikan domain sudah pointing ke IP server
   ```bash
   dig bil.cvlmedia.my.id
   nslookup bil.cvlmedia.my.id
   ```

2. **Cek Port 80**: Pastikan port 80 bisa diakses dari internet
   ```bash
   sudo netstat -tlnp | grep :80
   sudo ufw status
   ```

3. **Cek Nginx**: Pastikan Nginx running dan konfigurasi valid
   ```bash
   sudo systemctl status nginx
   sudo nginx -t
   ```

### Webhook tidak menerima request

1. **Cek Firewall**: Pastikan port 443 terbuka
   ```bash
   sudo ufw allow 443/tcp
   ```

2. **Cek Log Nginx**: 
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

3. **Cek Log Aplikasi**:
   ```bash
   tail -f logs/app.log
   ```

### Certificate expired

```bash
# Manual renewal
sudo certbot renew

# Reload Nginx
sudo systemctl reload nginx
```

## 📝 Catatan Penting

1. **Domain harus pointing ke IP server** sebelum setup SSL
2. **Port 80 harus terbuka** untuk Let's Encrypt challenge
3. **Certificate auto-renew setiap 90 hari**
4. **Webhook URL harus HTTPS** (Wablas requirement)
5. **Restart aplikasi** setelah setup SSL untuk memastikan semua konfigurasi ter-load

## 🔗 Referensi

- Let's Encrypt: https://letsencrypt.org/
- Certbot Documentation: https://certbot.eff.org/
- Wablas Documentation: https://bdg.wablas.com/documentation

