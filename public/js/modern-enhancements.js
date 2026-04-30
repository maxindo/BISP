/**
 * MODERN ENHANCEMENTS
 * Additional interactive enhancements for GEMBOK-BILL
 */

(function() {
  'use strict';

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    
    // ============================================
    // CARD HOVER ANIMATIONS
    // ============================================
    const cards = document.querySelectorAll('.modern-card, .stat-card');
    cards.forEach(card => {
      card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-4px)';
      });
      
      card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
      });
    });

    // ============================================
    // BUTTON RIPPLE EFFECT
    // ============================================
    const buttons = document.querySelectorAll('.btn-modern');
    buttons.forEach(button => {
      button.addEventListener('click', function(e) {
        const ripple = document.createElement('span');
        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.classList.add('ripple');
        
        this.appendChild(ripple);
        
        setTimeout(() => {
          ripple.remove();
        }, 600);
      });
    });

    // ============================================
    // SCROLL ANIMATIONS
    // ============================================
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, observerOptions);

    // Observe elements with animation classes
    document.querySelectorAll('.animate-slide-in-up').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      el.style.transition = 'all 0.5s ease-out';
      observer.observe(el);
    });

    // ============================================
    // TOOLTIP ENHANCEMENTS
    // ============================================
    const tooltipElements = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    if (typeof bootstrap !== 'undefined') {
      tooltipElements.forEach(el => {
        new bootstrap.Tooltip(el);
      });
    }

    // ============================================
    // MODAL ENHANCEMENTS
    // ============================================
    const modalElements = document.querySelectorAll('.modal-modern');
    modalElements.forEach(modal => {
      modal.addEventListener('shown.bs.modal', function() {
        const firstInput = this.querySelector('input, textarea, select');
        if (firstInput) {
          firstInput.focus();
        }
      });
    });

    // ============================================
    // FORM VALIDATION ENHANCEMENTS
    // ============================================
    const forms = document.querySelectorAll('form[novalidate]');
    forms.forEach(form => {
      form.addEventListener('submit', function(e) {
        const inputs = form.querySelectorAll('input, textarea, select');
        let isValid = true;
        
        inputs.forEach(input => {
          if (!input.checkValidity()) {
            isValid = false;
            input.classList.add('is-invalid');
            input.addEventListener('input', function() {
              if (this.checkValidity()) {
                this.classList.remove('is-invalid');
                this.classList.add('is-valid');
              }
            }, { once: true });
          }
        });
        
        if (!isValid) {
          e.preventDefault();
          e.stopPropagation();
        }
        
        form.classList.add('was-validated');
      });
    });

    // ============================================
    // TABLE ROW SELECTION
    // ============================================
    const selectableRows = document.querySelectorAll('.table-modern tbody tr[data-selectable]');
    selectableRows.forEach(row => {
      row.addEventListener('click', function() {
        if (!this.querySelector('input[type="checkbox"]')) {
          this.classList.toggle('selected');
        }
      });
    });

    // ============================================
    // COPY TO CLIPBOARD
    // ============================================
    document.querySelectorAll('[data-copy]').forEach(element => {
      element.addEventListener('click', async function(e) {
        e.preventDefault();
        const textToCopy = this.getAttribute('data-copy') || this.textContent.trim();
        
        try {
          await navigator.clipboard.writeText(textToCopy);
          
          // Show feedback
          const originalText = this.innerHTML;
          this.innerHTML = '<i class="bi bi-check-circle-fill"></i> Copied!';
          this.classList.add('text-success');
          
          setTimeout(() => {
            this.innerHTML = originalText;
            this.classList.remove('text-success');
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
          this.classList.add('text-danger');
          this.innerHTML = '<i class="bi bi-x-circle-fill"></i> Failed!';
          
          setTimeout(() => {
            this.classList.remove('text-danger');
            this.innerHTML = originalText;
          }, 2000);
        }
      });
    });

    // ============================================
    // AUTO-DISMISS ALERTS
    // ============================================
    document.querySelectorAll('.alert[data-auto-dismiss]').forEach(alert => {
      const timeout = parseInt(alert.getAttribute('data-auto-dismiss'));
      
      setTimeout(() => {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }, timeout);
    });

    // ============================================
    // SMOOTH SCROLL
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href !== '#' && href.length > 1) {
          const target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        }
      });
    });

    // ============================================
    // COUNTER ANIMATION
    // ============================================
    const animateCounters = () => {
      document.querySelectorAll('[data-count]').forEach(element => {
        const target = parseInt(element.getAttribute('data-count'));
        const duration = parseInt(element.getAttribute('data-duration') || '2000');
        const start = 0;
        const increment = target / (duration / 16);
        let current = 0;
        
        const updateCounter = () => {
          current += increment;
          if (current < target) {
            element.textContent = Math.floor(current).toLocaleString();
            requestAnimationFrame(updateCounter);
          } else {
            element.textContent = target.toLocaleString();
          }
        };
        
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              updateCounter();
              observer.unobserve(entry.target);
            }
          });
        });
        
        observer.observe(element);
      });
    };

    animateCounters();

    // ============================================
    // RESPONSIVE IMAGES
    // ============================================
    document.querySelectorAll('img[data-src]').forEach(img => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const image = entry.target;
            image.src = image.getAttribute('data-src');
            image.removeAttribute('data-src');
            observer.unobserve(image);
          }
        });
      });
      
      observer.observe(img);
    });

    // ============================================
    // CONSOLE LOG (Development)
    // ============================================
    console.log('%c🎨 Modern Enhancements Loaded!', 'color: #667eea; font-size: 16px; font-weight: bold;');
    
  });

  // Export for external use
  window.ModernEnhancements = {
    version: '2.0',
    initialized: true
  };

})();

