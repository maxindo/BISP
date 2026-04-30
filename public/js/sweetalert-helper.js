/**
 * SweetAlert Helper Functions
 * Helper functions untuk menggunakan SweetAlert2 di seluruh aplikasi
 */

// Pastikan SweetAlert2 sudah dimuat
if (typeof Swal === 'undefined') {
    console.warn('SweetAlert2 belum dimuat. Pastikan script SweetAlert2 sudah di-include.');
}

/**
 * Show success alert
 * @param {string} title - Judul alert
 * @param {string} message - Pesan alert
 * @param {function} callback - Callback setelah alert ditutup
 */
function showSuccessAlert(title, message, callback) {
    Swal.fire({
        icon: 'success',
        title: title || 'Berhasil!',
        text: message || 'Operasi berhasil dilakukan',
        confirmButtonText: 'OK',
        confirmButtonColor: '#3085d6',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then((result) => {
        if (callback && typeof callback === 'function') {
            callback(result);
        }
    });
}

/**
 * Show error alert
 * @param {string} title - Judul alert
 * @param {string} message - Pesan error
 * @param {function} callback - Callback setelah alert ditutup
 */
function showErrorAlert(title, message, callback) {
    Swal.fire({
        icon: 'error',
        title: title || 'Error!',
        text: message || 'Terjadi kesalahan saat memproses permintaan',
        confirmButtonText: 'OK',
        confirmButtonColor: '#d33',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then((result) => {
        if (callback && typeof callback === 'function') {
            callback(result);
        }
    });
}

/**
 * Show warning alert
 * @param {string} title - Judul alert
 * @param {string} message - Pesan warning
 * @param {function} callback - Callback setelah alert ditutup
 */
function showWarningAlert(title, message, callback) {
    Swal.fire({
        icon: 'warning',
        title: title || 'Peringatan!',
        text: message || 'Perhatian!',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f0ad4e',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then((result) => {
        if (callback && typeof callback === 'function') {
            callback(result);
        }
    });
}

/**
 * Show info alert
 * @param {string} title - Judul alert
 * @param {string} message - Pesan info
 * @param {function} callback - Callback setelah alert ditutup
 */
function showInfoAlert(title, message, callback) {
    Swal.fire({
        icon: 'info',
        title: title || 'Informasi',
        text: message || '',
        confirmButtonText: 'OK',
        confirmButtonColor: '#3085d6',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then((result) => {
        if (callback && typeof callback === 'function') {
            callback(result);
        }
    });
}

/**
 * Show confirmation dialog
 * @param {string} title - Judul konfirmasi
 * @param {string} message - Pesan konfirmasi
 * @param {string} confirmText - Teks tombol konfirmasi
 * @param {string} cancelText - Teks tombol batal
 * @param {function} onConfirm - Callback jika dikonfirmasi
 * @param {function} onCancel - Callback jika dibatalkan
 */
function showConfirmAlert(title, message, confirmText, cancelText, onConfirm, onCancel) {
    Swal.fire({
        icon: 'question',
        title: title || 'Konfirmasi',
        text: message || 'Apakah Anda yakin?',
        showCancelButton: true,
        confirmButtonText: confirmText || 'Ya',
        cancelButtonText: cancelText || 'Batal',
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        reverseButtons: true,
        allowOutsideClick: false,
        allowEscapeKey: true
    }).then((result) => {
        if (result.isConfirmed) {
            if (onConfirm && typeof onConfirm === 'function') {
                onConfirm(result);
            }
        } else if (result.dismiss === Swal.DismissReason.cancel) {
            if (onCancel && typeof onCancel === 'function') {
                onCancel(result);
            }
        }
    });
}

/**
 * Show success alert with auto reload
 * @param {string} title - Judul alert
 * @param {string} message - Pesan alert
 * @param {number} delay - Delay sebelum reload (ms)
 */
function showSuccessAndReload(title, message, delay) {
    showSuccessAlert(title, message, function() {
        if (delay && delay > 0) {
            setTimeout(function() {
                location.reload();
            }, delay);
        } else {
            location.reload();
        }
    });
}

/**
 * Replace standard alert with SweetAlert
 * @param {string} message - Pesan alert
 * @param {string} type - Tipe alert (success, error, warning, info)
 */
function showAlert(message, type) {
    type = type || 'info';
    const titles = {
        'success': 'Berhasil!',
        'error': 'Error!',
        'warning': 'Peringatan!',
        'info': 'Informasi'
    };
    
    const icons = {
        'success': 'success',
        'error': 'error',
        'warning': 'warning',
        'info': 'info'
    };
    
    Swal.fire({
        icon: icons[type] || 'info',
        title: titles[type] || 'Informasi',
        text: message || '',
        confirmButtonText: 'OK',
        confirmButtonColor: type === 'error' ? '#d33' : '#3085d6',
        allowOutsideClick: false,
        allowEscapeKey: false
    });
}

// Override native alert and confirm (optional, untuk backward compatibility)
if (typeof window !== 'undefined') {
    // Backup original functions
    window._originalAlert = window.alert;
    window._originalConfirm = window.confirm;
    
    // Optional: Override alert (bisa diaktifkan jika diperlukan)
    // window.alert = function(message) {
    //     showAlert(message, 'info');
    // };
    
    // Optional: Override confirm (bisa diaktifkan jika diperlukan)
    // window.confirm = function(message) {
    //     return new Promise(function(resolve) {
    //         showConfirmAlert('Konfirmasi', message, 'Ya', 'Batal', function() {
    //             resolve(true);
    //         }, function() {
    //             resolve(false);
    //         });
    //     });
    // };
}

