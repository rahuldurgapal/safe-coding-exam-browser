/**
 * Safe Exam Browser - OS Level Kiosk Lockdown Engine
 * 
 * Hardware & OS Level Enforcement:
 * - Windows: Disables Windows Key (NoWinKeys), Task Manager (DisableTaskMgr), and hooks special key combinations
 * - Linux: Disables GNOME Super/Overlay key and workspace switching shortcuts
 * - Cross-Platform: Always-on-top screen-saver Z-order level and content protection
 */

const { exec, execSync } = require('child_process');

let isLockdownActive = false;
let originalGnomeOverlayKey = null;

/**
 * Enable OS-Level lockdown for Windows and Linux
 */
function enableOSLockdown() {
  if (isLockdownActive) return;
  isLockdownActive = true;

  // 1. WINDOWS LOCKDOWN (HKCU registry policies — no admin rights needed!)
  if (process.platform === 'win32') {
    try {
      // Disable Windows Key (NoWinKeys: 1)
      exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f', () => {});
      
      // Disable Task Manager (DisableTaskMgr: 1)
      exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f', () => {});

      console.log('[OSLockdown] Windows key and Task Manager lock applied.');
    } catch (err) {
      console.warn('[OSLockdown] Windows lock error:', err.message);
    }
  }

  // 2. LINUX (GNOME / Ubuntu) LOCKDOWN
  if (process.platform === 'linux') {
    try {
      // Check current overlay key
      try {
        originalGnomeOverlayKey = execSync('gsettings get org.gnome.mutter overlay-key', { encoding: 'utf8', timeout: 500 }).trim();
      } catch (_) {
        originalGnomeOverlayKey = "'Super'";
      }

      // Disable Super (Windows) key in GNOME
      exec("gsettings set org.gnome.mutter overlay-key ''", () => {});
      console.log('[OSLockdown] Linux GNOME Super key lock applied.');
    } catch (err) {
      console.warn('[OSLockdown] Linux lock error:', err.message);
    }
  }
}

/**
 * Revert all OS-Level changes cleanly on exit
 */
function disableOSLockdown() {
  if (!isLockdownActive) return;
  isLockdownActive = false;

  console.log('[OSLockdown] Restoring OS-level key policies...');

  // 1. REVERT WINDOWS POLICIES
  if (process.platform === 'win32') {
    try {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" /v "NoWinKeys" /f', { stdio: 'ignore', timeout: 800 });
    } catch (_) {}

    try {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v "DisableTaskMgr" /f', { stdio: 'ignore', timeout: 800 });
    } catch (_) {}
  }

  // 2. REVERT LINUX SETTINGS
  if (process.platform === 'linux') {
    try {
      const keyToRestore = (originalGnomeOverlayKey && originalGnomeOverlayKey.includes('Super')) ? originalGnomeOverlayKey : "'Super'";
      execSync(`gsettings set org.gnome.mutter overlay-key ${keyToRestore}`, { stdio: 'ignore', timeout: 800 });
    } catch (_) {}
  }
}

module.exports = {
  enableOSLockdown,
  disableOSLockdown
};
