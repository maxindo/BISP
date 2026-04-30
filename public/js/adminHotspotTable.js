// Tunggu sampai semua library ter-load
(function() {
  function initDataTable() {
    // Pastikan jQuery dan DataTables sudah ter-load
    if (typeof jQuery === 'undefined' || typeof $.fn.dataTable === 'undefined') {
      console.warn('Menunggu jQuery dan DataTables ter-load...');
      setTimeout(initDataTable, 100);
      return;
    }

    // Pastikan DOM sudah siap
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(initDataTable, 100);
      });
      return;
    }

  const statusPriority = {
    'Online': 4,
    'Stand by': 3,
    'Offline': 2,
    'Expired': 1
  };

  // Definisikan custom order untuk status voucher
  if ($.fn.dataTable && $.fn.dataTable.ext) {
    $.fn.dataTable.ext.order['status-voucher'] = function(settings, col) {
      return this.api().column(col, { order: 'index' }).nodes().map(function(td) {
        const text = $(td).text().trim();
        return statusPriority[text] !== undefined ? statusPriority[text] : 0;
      });
    };
  }

  // Pastikan tabel ada sebelum inisialisasi
  if ($('#hotspotTable').length === 0) {
    console.error('Tabel #hotspotTable tidak ditemukan');
    return;
  }

  console.log('Menginisialisasi DataTables dengan pagination...');
  const hotspotTable = $('#hotspotTable').DataTable({
    pageLength: 10,
    lengthMenu: [[10, 25, 50, 100], [10, 25, 50, 100]],
    paging: true,
    pagingType: 'full_numbers',
    stateSave: false,
    scrollX: true,
    scrollCollapse: true,
    autoWidth: false,
    dom: 'lfrtip',
    order: [[4, 'desc'], [1, 'asc']],
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/id.json',
      paginate: {
        previous: '<i class="bi bi-chevron-left"></i>',
        next: '<i class="bi bi-chevron-right"></i>',
        first: '<<',
        last: '>>'
      },
      info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ user',
      lengthMenu: 'Tampilkan _MENU_ user',
      search: 'Cari:',
      zeroRecords: 'Tidak ada user ditemukan',
      infoEmpty: 'Menampilkan 0 sampai 0 dari 0 user',
      infoFiltered: '(difilter dari _MAX_ total user)'
    },
    columnDefs: [
      { targets: 0, orderable: false, width: '4%', className: 'text-center align-middle' },
      { targets: 1, width: '4%', className: 'text-center text-nowrap' },
      { targets: 2, width: '12%', className: 'text-nowrap' },
      { targets: 3, width: '12%', className: 'text-nowrap' },
      { targets: 4, orderDataType: 'status-voucher', width: '10%', className: 'text-center text-nowrap' },
      { targets: 5, width: '10%', className: 'text-nowrap' },
      { targets: 6, width: '10%', className: 'text-nowrap' },
      { targets: 7, width: '12%', className: 'text-nowrap' },
      { targets: 8, width: '12%', className: 'text-nowrap' },
      { targets: 9, width: '8%', className: 'text-nowrap text-end' },
      { targets: 10, width: '8%', className: 'text-nowrap text-end' },
      { targets: 11, width: '12%', className: 'text-nowrap' },
      { targets: 12, width: '12%', className: 'text-nowrap' },
      { targets: 13, width: '12%', className: 'text-nowrap' },
      { targets: -1, orderable: false, width: '16%', className: 'text-center text-nowrap' }
    ]
  });

  // Verifikasi pagination sudah aktif
  console.log('DataTables diinisialisasi. Pagination aktif:', hotspotTable.page.info());
  console.log('Total records:', hotspotTable.page.info().recordsTotal);
  console.log('Records per page:', hotspotTable.page.info().length);

  const statusColumnIndex = 4;

  function extractStatus(cellHtml) {
    return $('<div>').html(cellHtml).text().trim().toLowerCase();
  }

  function updateOnlineCount() {
    let count = 0;
    hotspotTable.rows({ search: 'applied' }).every(function() {
      const rowData = this.data();
      const statusText = extractStatus(rowData[statusColumnIndex]);
      if (statusText === 'online') count++;
    });
    $('#activeUserCount').text(count);
  }

  function refreshSelectionState() {
    const $checkboxes = $('.voucher-select-checkbox');
    const $selected = $checkboxes.filter(':checked');
    const total = $checkboxes.length;
    const selectedCount = $selected.length;
    $('#selectedCount').text(selectedCount);
    $('#bulkDeleteVoucher').prop('disabled', selectedCount === 0);

    const selectAll = $('#selectAllVouchers').get(0);
    if (!selectAll) return;
    if (selectedCount === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else if (selectedCount === total) {
      selectAll.checked = true;
      selectAll.indeterminate = false;
    } else {
      selectAll.checked = false;
      selectAll.indeterminate = true;
    }
  }

  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    if (settings.nTable !== hotspotTable.table().node()) return true;
    const filterValue = $('#voucherCategoryFilter').val() || 'all';
    if (filterValue === 'all') return true;
    const rowNode = hotspotTable.row(dataIndex).node();
    if (!rowNode) return true;
    const $row = $(rowNode);
    const voucherStatus = ($row.data('voucher-status') || '').toString().toLowerCase();
    const connectionStatus = ($row.data('connection-status') || '').toString().toLowerCase();
    const startTime = ($row.data('start-time') || '').toString().trim();

    if (filterValue === 'stock') {
      return voucherStatus !== 'paid' && !startTime;
    }
    if (filterValue === 'sold') {
      return Boolean(startTime);
    }
    if (filterValue === 'online') {
      return connectionStatus === 'online';
    }
    return true;
  });

  $('#voucherCategoryFilter').on('change', function() {
    hotspotTable.draw();
    refreshSelectionState();
  });

  $('#selectAllVouchers').on('change', function() {
    const isChecked = $(this).is(':checked');
    $('.voucher-select-checkbox').prop('checked', isChecked);
    refreshSelectionState();
  });

  $('#hotspotTable').on('change', '.voucher-select-checkbox', function() {
    refreshSelectionState();
  });

  $('#bulkDeleteVoucher').on('click', function() {
    const selected = [];
    $('.voucher-select-checkbox:checked').each(function() {
      selected.push({
        username: $(this).data('username'),
        router_id: $(this).data('router-id') || ''
      });
    });
    if (selected.length === 0) {
      alert('Pilih minimal satu voucher yang akan dihapus.');
      return;
    }
    if (!confirm('Yakin hapus ' + selected.length + ' voucher?')) {
      return;
    }
    $.ajax({
      url: '/admin/hotspot/delete-selected',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ vouchers: selected }),
      success: function(response) {
        const message = (response && response.message) ? response.message : (selected.length + ' voucher berhasil dihapus.');
        showToast('Berhasil', message, 'success');
        setTimeout(() => window.location.reload(), 1200);
      },
      error: function(xhr) {
        let msg = 'Gagal menghapus voucher.';
        if (xhr.responseJSON && xhr.responseJSON.message) msg = xhr.responseJSON.message;
        showToast('Error', msg, 'danger');
      }
    });
  });

  $('#hotspotTable_filter input').on('input', function() {
    setTimeout(function() {
      hotspotTable.order([[statusColumnIndex, 'desc'], [1, 'asc']]).draw();
    }, 120);
  });

  hotspotTable.on('draw', function() {
    updateOnlineCount();
    refreshSelectionState();
  });

  updateOnlineCount();
  refreshSelectionState();

  $('#hotspotTable').on('click', '.edit-user-btn', function() {
    const username = $(this).data('username');
    const password = $(this).data('password');
    const profile = $(this).data('profile');
    const routerId = $(this).data('router-id');
    const serverHotspot = $(this).data('server-hotspot') || '';
    $('#editUsername').val(username);
    $('#editPassword').val(password);
    $('#editProfile').val(profile);
    $('#editRouterId').val(routerId || '');
    // Set server hotspot jika field ada (mode RADIUS)
    if ($('#editServerHotspot').length) {
      $('#editServerHotspot').val(serverHotspot);
    }
    $('#originalUsername').val(username);
    $('#editUserModal').modal('show');
  });

  $('#hotspotTable').on('click', '.delete-user-btn', function() {
    const username = $(this).data('username');
    const routerId = $(this).data('router-id');
    if (confirm('Yakin hapus user ' + username + '?')) {
      const form = $('<form>', { method: 'POST', action: '/admin/hotspot/delete' });
      form.append($('<input>', { type: 'hidden', name: 'username', value: username }));
      if (routerId) {
        form.append($('<input>', { type: 'hidden', name: 'router_id', value: routerId }));
      }
      $('body').append(form);
      form.submit();
    }
  });

  let disconnectUsername = '';
  $('#hotspotTable').on('click', '.disconnect-session-btn', function() {
    disconnectUsername = $(this).data('username');
    $('#disconnectUsername').text(disconnectUsername);
    $('#disconnectUserModal').modal('show');
  });

  $('#confirmDisconnect').on('click', function() {
    if (!disconnectUsername) return;
    $.ajax({
      url: '/admin/hotspot/disconnect-user',
      method: 'POST',
      data: { username: disconnectUsername },
      success: function() {
        $('#disconnectUserModal').modal('hide');
        showToast('Berhasil', 'User ' + disconnectUsername + ' berhasil diputus.', 'success');
        setTimeout(() => window.location.reload(), 1000);
      },
      error: function(xhr) {
        $('#disconnectUserModal').modal('hide');
        let msg = 'Gagal memutus user.';
        if (xhr.responseJSON && xhr.responseJSON.message) msg = xhr.responseJSON.message;
        showToast('Error', msg, 'danger');
      }
    });
  });

  function showToast(title, message, type) {
    $('#toastTitle').text(title);
    $('#toastMessage').text(message);
    $('#toastHeader').removeClass('bg-success bg-danger bg-warning').addClass('bg-' + type);
    $('#toastIcon').removeClass().addClass('bi me-2 ' + (type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-x-circle-fill' : 'bi-exclamation-triangle-fill'));
    $('#notificationToast').toast('show');
  }
  }

  // Jalankan inisialisasi
  initDataTable();
})();
