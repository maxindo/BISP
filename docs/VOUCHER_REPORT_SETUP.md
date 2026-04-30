# Setup Cron Job untuk Auto-Update Invoice Voucher

## Cara Setup Cron Job

### 1. Edit Crontab
```bash
crontab -e
```

### 2. Tambahkan Baris Berikut (Update setiap 5 menit)
```bash
# Auto-update invoice voucher menjadi 'paid' saat voucher digunakan
*/5 * * * * /home/enos/cvlmedia/scripts/cron_update_voucher_invoices.sh
```

### 3. Verifikasi Cron Job
```bash
crontab -l
```

### 4. Cek Log Cron Job
```bash
tail -f /home/enos/cvlmedia/logs/voucher_update_cron.log
```

## Penjelasan

Cron job ini akan:
- Menjalankan script `update_voucher_invoices_on_use.js` setiap 5 menit
- Mengecek voucher yang sudah digunakan di RADIUS (radacct)
- Mengupdate invoice voucher menjadi 'paid' jika voucher sudah digunakan
- Mencatat log ke `/home/enos/cvlmedia/logs/voucher_update_cron.log`

## Alternatif: Manual Update

Jika tidak ingin menggunakan cron job, Anda bisa:
1. Klik tombol "Update Status" di halaman laporan voucher (`/admin/billing/reports/voucher`)
2. Atau jalankan manual dari terminal:
   ```bash
   cd /home/enos/cvlmedia
   node scripts/update_voucher_invoices_on_use.js
   ```

## Troubleshooting

Jika cron job tidak berjalan:
1. Cek permission script: `chmod +x /home/enos/cvlmedia/scripts/cron_update_voucher_invoices.sh`
2. Cek log: `tail -f /home/enos/cvlmedia/logs/voucher_update_cron.log`
3. Test manual: `bash /home/enos/cvlmedia/scripts/cron_update_voucher_invoices.sh`
4. Cek cron service: `sudo systemctl status cron` (atau `crond` di beberapa distro)

