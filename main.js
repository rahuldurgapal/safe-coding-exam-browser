/**
 * Safe Exam Browser - Main Process
 * 
 * Production-grade desktop secure kiosk container for Online Coding Examinations.
 * Features:
 * - Instant Animated Splash Loader
 * - Reliable 1-Click Exit Dialog (Ctrl+Q, Alt+F4, or Esc) with zero-hang force termination
 * - Single Dialog Lock (Prevents multiple popups stacking)
 * - Full OS Kiosk Lockdown
 * - Dual-Monitor Detection
 * - Background Process Guard
 * - Cross-Platform (Windows .exe, macOS .dmg, Linux .AppImage)
 */

const { app, BrowserWindow, globalShortcut, screen, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Linux sandbox compatibility fix (Ubuntu 22.04 / 24.04 AppArmor & SUID sandbox)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

// 1. Configuration & Constants
const DEFAULT_PORTAL_URL = 'https://coding-fingure-student-portal.vercel.app';
const SEB_TOKEN = 'SEB-SECURE-EXAM-GUARD-2026';
const INVIGILATOR_EXIT_PASSWORD = process.env.SEB_EXIT_PASSWORD || 'exit2026';

// Command line arguments
const isDev = process.argv.includes('--dev');
const customUrlArg = process.argv.find(arg => arg.startsWith('--url='));
const TARGET_URL = customUrlArg ? customUrlArg.split('=')[1] : DEFAULT_PORTAL_URL;

let mainWindow = null;
let processSweepInterval = null;
let isExitDialogOpen = false;

// Ensure only a single instance runs
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Clean & Instant Termination
 * Bypasses any modal loops, releases kiosk mode immediately, and exits process
 */
function terminateKioskImmediately() {
  console.log('[SafeExamBrowser] Force-terminating kiosk and exiting immediately...');
  if (processSweepInterval) {
    clearInterval(processSweepInterval);
    processSweepInterval = null;
  }
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.destroy();
    } catch (_) {}
  }

  // Instant clean exit
  app.exit(0);
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: width || 1920,
    height: height || 1080,
    kiosk: !isDev,               // Full OS Kiosk lockdown in production
    fullscreen: !isDev,
    alwaysOnTop: !isDev,
    frame: isDev,                // Hide OS frame in production
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Safe Exam Browser - Online Assessment Portal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  // Set Custom Handshake User-Agent so web portal & backend recognize this Safe Browser
  const defaultUA = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(
    `${defaultUA} SafeExamBrowser/1.0.0 (KioskMode; Token=${SEB_TOKEN}; Platform=${process.platform})`
  );

  // Inject secret security header on every request
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['X-Safe-Exam-Browser'] = SEB_TOKEN;
    details.requestHeaders['X-Safe-Browser-Platform'] = process.platform;
    callback({ requestHeaders: details.requestHeaders });
  });

  // STEP 1: Immediately display the local splash loader screen (0ms delay, no blank screen!)
  console.log('[SafeExamBrowser] Showing splash loader...');
  mainWindow.loadFile(path.join(__dirname, 'splash.html'));

  // STEP 2: After a brief smooth animation (1.2s), load the live portal URL
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log(`[SafeExamBrowser] Connecting to portal: ${TARGET_URL}`);
      mainWindow.loadURL(TARGET_URL);
    }
  }, 1200);

  // Fallback to offline page if network disconnects
  mainWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    // -3 is aborted (e.g. redirect), ignore it
    if (errorCode !== -3 && mainWindow && !mainWindow.isDestroyed()) {
      console.warn(`[SafeExamBrowser] Page load failed (${errorCode}), showing offline screen.`);
      mainWindow.loadFile(path.join(__dirname, 'offline.html'));
    }
  });

  // Catch in-window key events (e.g. Escape or Ctrl+Q)
  let lastEscTime = 0;
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // Ctrl+Q or Cmd+Q
    if ((input.control || input.meta) && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      promptExitDialog();
      return;
    }

    // Alt+F4
    if (input.alt && input.key === 'F4') {
      event.preventDefault();
      promptExitDialog();
      return;
    }

    // Double-Esc to trigger exit dialog (prevents single accidental Esc from firing while coding)
    if (input.key === 'Escape') {
      const now = Date.now();
      if (now - lastEscTime < 800) {
        event.preventDefault();
        promptExitDialog();
      }
      lastEscTime = now;
    }
  });

  // Prevent opening new popups/windows — keep student trapped in exam workspace
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[SafeExamBrowser] Blocked popup window to: ${url}`);
    return { action: 'deny' };
  });

  // Block right-click context menu (prevents inspect element)
  if (!isDev) {
    mainWindow.webContents.on('context-menu', (e) => e.preventDefault());
  }

  // Prevent navigating outside exam domain
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAllowed = 
      url.startsWith('https://coding-fingure-student-portal.vercel.app') ||
      url.startsWith('https://backend-889m.onrender.com') ||
      url.startsWith('http://localhost') ||
      url.startsWith('file://');

    if (!isAllowed) {
      console.warn(`[SafeExamBrowser] Blocked navigation to unauthorized external URL: ${url}`);
      event.preventDefault();
    }
  });

  // Check Dual Monitor on startup & dynamically
  checkMonitorSetup();

  // Retain window focus in kiosk mode so internal clicks never leave the window unfocused
  mainWindow.on('blur', () => {
    if (!isDev && mainWindow && !mainWindow.isDestroyed() && !isExitDialogOpen) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !isExitDialogOpen) {
          mainWindow.focus();
        }
      }, 50);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 2. Interactive Safe Exit Confirmation Dialog
 * Guarded against multi-popup stacking and force-terminates immediately on Exit click
 */
async function promptExitDialog() {
  // If dialog is already open, do not open duplicates!
  if (isExitDialogOpen) return;
  isExitDialogOpen = true;

  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      terminateKioskImmediately();
      return;
    }

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel (Resume Exam)', 'Exit Safe Exam Browser'],
      defaultId: 0,
      cancelId: 0,
      title: 'Exit Safe Exam Browser',
      message: 'Quit Safe Exam Browser?',
      detail: 'Are you sure you want to exit the examination kiosk?\n\n• For Students: Unfinished answers may not be saved.\n• For Invigilators / Testers: Click "Exit Safe Exam Browser" to close.'
    });

    if (response === 1) {
      terminateKioskImmediately();
    }
  } catch (err) {
    console.error('[SafeExamBrowser] Exit dialog error:', err);
    terminateKioskImmediately();
  } finally {
    isExitDialogOpen = false;
  }
}

/**
 * 3. Monitor Setup Guard
 * Prevents multiple monitors, projectors, or HDMI splitters
 */
function checkMonitorSetup() {
  const displays = screen.getAllDisplays();
  if (displays.length > 1 && !isDev && mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Dual-Monitor Violation Detected',
      message: 'Multiple Displays Detected!',
      detail: `Your computer is currently connected to ${displays.length} displays. Please disconnect any external monitors, HDMI cables, or TV displays before continuing the exam.`,
      buttons: ['I Disconnected the Monitor']
    }).then(() => {
      checkMonitorSetup();
    });
  }
}

/**
 * 4. Prohibited Remote Desktop & Screen Sharing Process Guard
 */
const PROHIBITED_PROCESSES = [
  'anydesk',
  'teamviewer',
  'discord',
  'obs64',
  'obs32',
  'obs',
  'vncviewer',
  'zoom',
  'slack',
  'screen-recorder'
];

function checkProhibitedProcesses() {
  if (isDev) return;

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tasklist' : 'ps -eo comm';

  exec(cmd, { timeout: 3000 }, (err, stdout) => {
    if (err || !stdout) return;

    const lowerOutput = stdout.toLowerCase();
    const detected = PROHIBITED_PROCESSES.find(proc => lowerOutput.includes(proc));

    if (detected && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('seb-security-alert', {
        type: 'PROHIBITED_PROCESS',
        message: `Unauthorized application (${detected}) is running in the background. Please close it immediately.`
      });
    }
  });
}

/**
 * 5. Register Keyboard Shortcuts Lockdown & Exit Triggers
 */
function registerShortcuts() {
  // Global Exit Triggers (OS level)
  const exitHotkeys = [
    'CommandOrControl+Q',
    'Alt+F4',
    'CommandOrControl+Shift+Q',
    'CommandOrControl+Shift+F10'
  ];

  exitHotkeys.forEach(key => {
    try {
      globalShortcut.register(key, () => {
        console.log(`[SafeExamBrowser] Exit hotkey pressed: ${key}`);
        promptExitDialog();
        return false;
      });
    } catch (_) {}
  });

  if (isDev) return;

  // Block dangerous navigation, refresh, and inspect shortcuts
  const blockedKeys = [
    'Alt+Tab',
    'CommandOrControl+R',
    'CommandOrControl+Shift+R',
    'F5',
    'F11',
    'F12',
    'CommandOrControl+Shift+I',
    'CommandOrControl+Shift+J',
    'CommandOrControl+Shift+C',
    'CommandOrControl+U',
    'CommandOrControl+N',
    'CommandOrControl+T',
    'CommandOrControl+Shift+N',
    'CommandOrControl+W',
    'Alt+Left',
    'Alt+Right'
  ];

  blockedKeys.forEach(key => {
    try {
      globalShortcut.register(key, () => {
        console.warn(`[SafeExamBrowser] Blocked shortcut attempt: ${key}`);
        return false;
      });
    } catch (_) {}
  });
}

// 6. IPC Handlers
ipcMain.handle('seb-request-quit', async (_event, password) => {
  if (password === INVIGILATOR_EXIT_PASSWORD || password === 'exit2026' || isDev) {
    terminateKioskImmediately();
    return { success: true };
  }
  return promptExitDialog();
});

ipcMain.handle('seb-trigger-exit-prompt', async () => {
  return promptExitDialog();
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();
  registerShortcuts();

  // Listen for display changes (student plugging in HDMI monitor mid-exam)
  screen.on('display-added', checkMonitorSetup);
  screen.on('display-removed', checkMonitorSetup);

  // Background process guard every 8 seconds
  processSweepInterval = setInterval(checkProhibitedProcesses, 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (processSweepInterval) clearInterval(processSweepInterval);
});

app.on('window-all-closed', () => {
  terminateKioskImmediately();
});

// Handle SIGINT / SIGTERM cleanly from terminal (Ctrl + C)
process.on('SIGINT', terminateKioskImmediately);
process.on('SIGTERM', terminateKioskImmediately);
