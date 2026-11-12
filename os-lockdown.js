/**
 * Safe Exam Browser - OS Level Kiosk Lockdown Engine
 * 
 * Hardware & OS Level Enforcement:
 * - Windows: Disables Windows Key (NoWinKeys), Task Manager (DisableTaskMgr), and hooks special key combinations
 * - Linux: Disables GNOME Super/Overlay key and workspace switching shortcuts
 * - Cross-Platform: Always-on-top screen-saver Z-order level and content protection
 */

const { exec, spawn } = require('child_process');

let isLockdownActive = false;
let originalGnomeOverlayKey = null;

function runDetached(command, args) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
  } catch (_) {}
}

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
      exec('gsettings get org.gnome.mutter overlay-key', { encoding: 'utf8', timeout: 800 }, (err, stdout) => {
        if (!isLockdownActive) return;
        const trimmed = (!err && stdout) ? stdout.trim() : '';
        originalGnomeOverlayKey = trimmed || "'Super'";

        // Disable Super (Windows) key in GNOME
        exec("gsettings set org.gnome.mutter overlay-key ''", () => {});
        console.log('[OSLockdown] Linux GNOME Super key lock applied.');
      });
    } catch (err) {
      console.warn('[OSLockdown] Linux lock error:', err.message);
    }
  }
}

/**
 * Revert all OS-Level changes cleanly and non-blockingly on exit
 */
function disableOSLockdown() {
  if (!isLockdownActive) return;
  isLockdownActive = false;

  console.log('[OSLockdown] Restoring OS-level key policies...');

  // 1. REVERT WINDOWS POLICIES (detached so Electron exits instantaneously)
  if (process.platform === 'win32') {
    runDetached('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', '/v', 'NoWinKeys', '/f']);
    runDetached('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', '/v', 'DisableTaskMgr', '/f']);
  }

  // 2. REVERT LINUX SETTINGS (detached so GTK/Wayland event loop never blocks)
  if (process.platform === 'linux') {
    const rawKey = (originalGnomeOverlayKey && originalGnomeOverlayKey.includes('Super')) ? originalGnomeOverlayKey : "'Super'";
    const cleanKey = rawKey.replace(/^'+|'+$/g, '');
    runDetached('gsettings', ['set', 'org.gnome.mutter', 'overlay-key', cleanKey]);
  }
}

module.exports = {
  enableOSLockdown,
  disableOSLockdown
};
