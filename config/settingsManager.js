const fs = require('fs');
const path = require('path');
const performanceMonitor = require('./performanceMonitor');

const settingsPath = path.join(process.cwd(), 'settings.json');

// In-memory cache untuk performa
let settingsCache = null;
let lastModified = null;
let cacheExpiry = null;
const CACHE_TTL = 5000; // 5 detik cache

function loadSettingsFromFile() {
  const startTime = Date.now();
  let wasCacheHit = false;
  
  try {
    const stats = fs.statSync(settingsPath);
    const fileModified = stats.mtime.getTime();
    
    // Jika file tidak berubah dan cache masih valid, gunakan cache
    if (settingsCache && 
        lastModified === fileModified && 
        cacheExpiry && 
        Date.now() < cacheExpiry) {
      wasCacheHit = true;
      performanceMonitor.recordCall(startTime, wasCacheHit);
      return settingsCache;
    }
    
    // Baca file dan update cache
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settingsCache = JSON.parse(raw);
    lastModified = fileModified;
    cacheExpiry = Date.now() + CACHE_TTL;
    
    performanceMonitor.recordCall(startTime, wasCacheHit);
    return settingsCache;
  } catch (e) {
    performanceMonitor.recordCall(startTime, wasCacheHit);
    // Jika ada error, return cache lama atau empty object
    return settingsCache || {};
  }
}

function getSettingsWithCache() {
  return loadSettingsFromFile();
}

function getSetting(key, defaultValue) {
  const settings = getSettingsWithCache();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

function setSetting(key, value) {
  try {
    const settings = getSettingsWithCache();
    settings[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    
    // Invalidate cache setelah write
    settingsCache = settings;
    lastModified = fs.statSync(settingsPath).mtime.getTime();
    cacheExpiry = Date.now() + CACHE_TTL;
    
    return true;
  } catch (e) {
    return false;
  }
}

function deleteSetting(key) {
    try {
        const settings = getSettingsWithCache();
        if (!(key in settings)) {
            return false;
        }

        delete settings[key];
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

        // Invalidate cache setelah write
        settingsCache = settings;
        lastModified = fs.statSync(settingsPath).mtime.getTime();
        cacheExpiry = Date.now() + CACHE_TTL;

        return true;
    } catch (e) {
        return false;
    }
}

// Clear cache function untuk debugging/maintenance
function clearSettingsCache() {
  settingsCache = null;
  lastModified = null;
  cacheExpiry = null;
}

// Helper function untuk mendapatkan timezone server
function getServerTimezone() {
    try {
        // Coba ambil dari environment variable TZ jika ada
        if (process.env.TZ) {
            return process.env.TZ;
        }
        
        // Coba baca dari /etc/timezone (Linux)
        try {
            const timezoneFile = fs.readFileSync('/etc/timezone', 'utf8').trim();
            if (timezoneFile) {
                return timezoneFile;
            }
        } catch (e) {
            // File tidak ada, lanjut ke metode lain
        }
        
        // Coba baca dari timedatectl output
        try {
            const { execSync } = require('child_process');
            const output = execSync('timedatectl show -p Timezone --value', { encoding: 'utf8' }).trim();
            if (output) {
                return output;
            }
        } catch (e) {
            // Command tidak tersedia, gunakan default
        }
        
        // Fallback: gunakan UTC (default server biasanya UTC)
        return 'UTC';
    } catch (error) {
        return 'UTC';
    }
}

module.exports = { 
  getSettingsWithCache, 
  getSetting, 
  setSetting, 
  clearSettingsCache,
  deleteSetting,
  getServerTimezone,
  getPerformanceStats: () => performanceMonitor.getStats(),
  getPerformanceReport: () => performanceMonitor.getPerformanceReport(),
  getQuickStats: () => performanceMonitor.getQuickStats()
};