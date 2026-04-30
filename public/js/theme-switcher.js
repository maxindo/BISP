/**
 * Theme Switcher
 * Allows users to toggle between light and dark themes
 */

(function() {
  'use strict';

  // Get current theme from localStorage or default to 'light'
  function getTheme() {
    return localStorage.getItem('theme') || 'light';
  }

  // Set theme
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update theme icon if exists
    updateThemeIcon(theme);
    
    // Dispatch custom event for theme change
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }

  // Initialize theme on page load
  function initTheme() {
    const theme = getTheme();
    setTheme(theme);
  }

  // Toggle between light and dark themes
  function toggleTheme() {
    const currentTheme = getTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }

  // Update theme icon based on current theme
  function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    const themeIconMobile = document.getElementById('theme-icon-mobile');
    const themeText = document.getElementById('theme-text');
    
    if (themeIcon) {
      themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
    
    if (themeIconMobile) {
      themeIconMobile.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
    
    if (themeText) {
      themeText.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
    
    // Also update all theme toggle buttons
    const themeToggles = document.querySelectorAll('[data-theme-toggle]');
    themeToggles.forEach(btn => {
      const icon = btn.querySelector('.bi');
      const text = btn.querySelector('span');
      
      if (icon) {
        icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
      }
      
      if (text) {
        text.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
      }
    });
  }

  // Add event listeners to theme toggle buttons
  function attachThemeToggleListeners() {
    const toggleButtons = document.querySelectorAll('[data-theme-toggle]');
    
    toggleButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        toggleTheme();
      });
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initTheme();
      attachThemeToggleListeners();
    });
  } else {
    initTheme();
    attachThemeToggleListeners();
  }

  // Expose toggleTheme function globally for manual triggering
  window.toggleTheme = toggleTheme;
  window.getCurrentTheme = getTheme;

})();

