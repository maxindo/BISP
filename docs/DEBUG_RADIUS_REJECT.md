# 🔍 Debug Access-Reject di FreeRADIUS

## Masalah
Access-Request dari Mikrotik (192.168.1.29) di-reject oleh FreeRADIUS (192.168.1.50).

## Langkah Debugging

### 1. Cek User di Database
```bash
sudo mariadb -u radius -p'PASSWORD' -e "USE radius; SELECT username, attribute, value FROM radcheck WHERE username = 'USERNAME';"
sudo mariadb -u radius -p'PASSWORD' -e "USE radius; SELECT username, groupname FROM radusergroup WHERE username = 'USERNAME';"
```

### 2. Cek Client Configuration
```bash
sudo grep -A 5 "192.168.1.29" /etc/freeradius/3.0/clients.conf
```

### 3. Enable Debug Mode
```bash
# Stop service
sudo systemctl stop freeradius

# Run in debug mode
sudo freeradius -X -d /etc/freeradius/3.0

# Di terminal lain, test:
sudo radtest USERNAME PASSWORD 127.0.0.1 0 testing123
```

### 4. Cek Log
```bash
sudo tail -f /var/log/freeradius/radius.log
```

## Kemungkinan Penyebab Access-Reject

### 1. User tidak ditemukan di database
- **Cek**: Apakah username ada di tabel `radcheck`?
- **Solusi**: Pastikan user sudah di-sync ke RADIUS database

### 2. Password tidak cocok
- **Cek**: Apakah password di `radcheck` sesuai dengan yang dikirim dari Mikrotik?
- **Solusi**: Pastikan password di database benar

### 3. Auth-Type tidak di-set
- **Cek**: Apakah SQL module mengembalikan `Auth-Type`?
- **Solusi**: Pastikan `authorize_check_query` mengembalikan `Auth-Type := Accept` atau password yang benar

### 4. Client secret tidak cocok
- **Cek**: Apakah secret di `clients.conf` sama dengan yang dikonfigurasi di Mikrotik?
- **Solusi**: Pastikan secret sama di kedua sisi

### 5. SQL query gagal
- **Cek**: Apakah ada error SQL di log?
- **Solusi**: Cek koneksi database dan query syntax

## Query SQL yang Digunakan

### Authorization Check Query
```sql
SELECT id, username, attribute, value, op 
FROM radcheck 
WHERE username = 'USERNAME' 
ORDER BY id
```

### Authorization Reply Query
```sql
SELECT id, username, attribute, value, op 
FROM radreply 
WHERE username = 'USERNAME' 
ORDER BY id
```

### Group Membership Query
```sql
SELECT groupname 
FROM radusergroup 
WHERE username = 'USERNAME' 
ORDER BY priority
```

## Test Manual

### Test dari localhost
```bash
sudo radtest enos 220208 127.0.0.1 0 testing123
```

### Test dari Mikrotik (via tcpdump)
```bash
sudo tcpdump -i ens33 -n port 1812
```

## Troubleshooting Checklist

- [ ] User ada di `radcheck` dengan attribute `Cleartext-Password`
- [ ] User ada di `radusergroup` dengan groupname yang valid
- [ ] Groupname ada di `radgroupreply` dengan attribute yang valid
- [ ] Client IP (192.168.1.29) ada di `clients.conf` dengan secret yang benar
- [ ] SQL module enabled dan terhubung ke database
- [ ] Password di database sesuai dengan yang dikirim dari Mikrotik
- [ ] FreeRADIUS service running dan tidak ada error di log

