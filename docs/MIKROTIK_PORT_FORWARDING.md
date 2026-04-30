# Setup Port Forwarding Mikrotik untuk SSL

## 📋 Informasi Server

- **Domain**: `bil.cvlmedia.my.id`
- **IP Public Router**: `5.181.178.56`
- **IP Local Server**: `192.168.1.50` (contoh, sesuaikan dengan IP server Anda)
- **Port Aplikasi**: `3003`
- **Port Nginx HTTP**: `80`
- **Port Nginx HTTPS**: `443`

## 🔧 Setup Port Forwarding di Mikrotik

### Step 1: Login ke Mikrotik

```bash
# Via Winbox atau SSH
ssh admin@192.168.1.1  # Ganti dengan IP router Anda
```

### Step 2: Setup Port Forwarding (NAT)

**Via Winbox:**
1. Buka **IP > Firewall > NAT**
2. Klik **+** untuk tambah rule baru

**Rule 1: Port 80 (HTTP)**
```
Chain: dstnat
Protocol: tcp
Dst. Port: 80
Action: dst-nat
To Addresses: 192.168.1.50
To Ports: 80
```

**Rule 2: Port 443 (HTTPS)**
```
Chain: dstnat
Protocol: tcp
Dst. Port: 443
Action: dst-nat
To Addresses: 192.168.1.50
To Ports: 443
```

**Via Terminal/SSH:**
```bash
# Port 80
/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=dst-nat to-addresses=192.168.1.50 to-ports=80 comment="HTTP for bil.cvlmedia.my.id"

# Port 443
/ip firewall nat add chain=dstnat protocol=tcp dst-port=443 action=dst-nat to-addresses=192.168.1.50 to-ports=443 comment="HTTPS for bil.cvlmedia.my.id"
```

### Step 3: Setup Firewall Filter (Allow Connection)

**Via Winbox:**
1. Buka **IP > Firewall > Filter Rules**
2. Tambahkan rule untuk allow port 80 & 443

**Rule untuk Port 80:**
```
Chain: input
Protocol: tcp
Dst. Port: 80
Action: accept
```

**Rule untuk Port 443:**
```
Chain: input
Protocol: tcp
Dst. Port: 443
Action: accept
```

**Via Terminal/SSH:**
```bash
# Allow port 80
/ip firewall filter add chain=input protocol=tcp dst-port=80 action=accept comment="Allow HTTP for bil.cvlmedia.my.id"

# Allow port 443
/ip firewall filter add chain=input protocol=tcp dst-port=443 action=accept comment="Allow HTTPS for bil.cvlmedia.my.id"
```

### Step 4: Verifikasi Port Forwarding

**Dari server lokal:**
```bash
# Cek apakah Nginx listening
sudo netstat -tlnp | grep -E ':80|:443'
```

**Dari luar (jika punya akses):**
```bash
# Test HTTP
curl -I http://5.181.178.56

# Test HTTPS (setelah SSL setup)
curl -I https://5.181.178.56
```

## 📝 Setup DNS

**DNS A Record:**
```
Type: A
Name: bil
Value: 5.181.178.56
TTL: 300
```

**Verifikasi DNS:**
```bash
dig +short bil.cvlmedia.my.id
# Harus return: 5.181.178.56
```

## 🚀 Setup SSL

Setelah port forwarding dan DNS setup, jalankan:

```bash
cd /home/enozrotua/cvlmedia
sudo ./scripts/setup-ssl.sh
```

## 🔍 Troubleshooting

### Port forwarding tidak bekerja

1. **Cek NAT rules:**
   ```bash
   # Dari Mikrotik
   /ip firewall nat print
   ```

2. **Cek Filter rules:**
   ```bash
   # Dari Mikrotik
   /ip firewall filter print
   ```

3. **Test dari router:**
   ```bash
   # Dari Mikrotik, test ke IP lokal server
   /ping 192.168.1.50
   ```

### Let's Encrypt tidak bisa verifikasi

1. **Pastikan port 80 bisa diakses dari internet:**
   ```bash
   # Test dari luar (jika punya akses)
   curl -I http://bil.cvlmedia.my.id
   ```

2. **Cek apakah challenge bisa diakses:**
   ```bash
   # Setelah Nginx running, test:
   curl http://bil.cvlmedia.my.id/.well-known/acme-challenge/test
   ```

3. **Jika masih gagal, gunakan DNS challenge:**
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns -d bil.cvlmedia.my.id
   ```

## ✅ Checklist

- [ ] Port forwarding 80 → IP lokal:80 sudah setup
- [ ] Port forwarding 443 → IP lokal:443 sudah setup
- [ ] Firewall filter allow port 80 & 443
- [ ] DNS A record pointing ke 5.181.178.56
- [ ] DNS sudah propagate (cek dengan `dig`)
- [ ] Nginx running di server lokal
- [ ] Aplikasi running di port 3003
- [ ] SSL certificate berhasil didapat
- [ ] HTTPS bisa diakses: https://bil.cvlmedia.my.id
- [ ] Webhook bisa diakses: https://bil.cvlmedia.my.id/webhook/wablas

## 📚 Referensi

- Mikrotik NAT: https://wiki.mikrotik.com/wiki/Manual:IP/Firewall/NAT
- Mikrotik Firewall: https://wiki.mikrotik.com/wiki/Manual:IP/Firewall

