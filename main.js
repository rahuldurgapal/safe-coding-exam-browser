/**
 * Safe Exam Browser - Main Process
 * 
 * Production-grade desktop secure kiosk container for Online Coding Examinations.
 * Features:
 * - Full OS-Level Keyboard Lockdown (Blocks Windows Key, Start Menu, Alt+Tab, Task Manager)
 * - Screen-Saver Z-Order Level (Places exam window above OS taskbar & flyouts)
 * - Anti-VM & Virtual Machine Detection (Blocks VirtualBox, VMware, Hyper-V, QEMU)
 * - Zero-Hang Instant Clean Termination (Fixes "Safe exam browser not responding / force quit")
 * - Instant Animated Splash Loader & Fallback Offline Screen
 * - Single Dialog Lock (Prevents multiple popups stacking)
 * - Dual-Monitor Detection & Background Process Guard
 * - Cross-Platform (Windows .exe, macOS .dmg, Linux .AppImage)
 */

const { app, BrowserWindow, globalShortcut, screen, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { detectVirtualMachineSync, detectVirtualMachineAsync } = require('./vm-detector');
const { enableOSLockdown, disableOSLockdown } = require('./os-lockdown');

// Linux sandbox compatibility fix (Ubuntu 22.04 / 24.04 AppArmor & SUID sandbox)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

// 1. Configuration & Constants
const DEFAULT_PORTAL_URL = process.env.EXAM_PORTAL_URL || Buffer.from('aHR0cHM6Ly9jb2RpbmctZmluZ3VyZS1zdHVkZW50LXBvcnRhbC52ZXJjZWwuYXBw', 'base64').toString('utf8');
const SEB_TOKEN = 'SEB-SECURE-EXAM-GUARD-2026';
const INVIGILATOR_EXIT_PASSWORD = process.env.SEB_EXIT_PASSWORD || 'exit2026';

// Command line arguments
const isDev = process.argv.includes('--dev');
const customUrlArg = process.argv.find(arg => arg.startsWith('--url='));
const TARGET_URL = customUrlArg ? customUrlArg.split('=')[1] : DEFAULT_PORTAL_URL;

let mainWindow = null;
let processSweepInterval = null;
let isExitDialogOpen = false;
let isTerminating = false;
let isVmBlocked = false;

// Ensure only a single instance runs
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Clean & Instant Zero-Hang Termination
 */
function forceExitNow() {
  if (isTerminating) return;
  isTerminating = true;

  console.log('[SafeExamBrowser] Instant zero-hang termination initiated...');

  // 1. Restore OS-level keys and policies (Windows key, Task Manager, GNOME overlay key)
  try {
    disableOSLockdown();
  } catch (_) {}

  // 2. Clear background sweep interval
  if (processSweepInterval) {
    clearInterval(processSweepInterval);
    processSweepInterval = null;
  }

  // 3. Unregister all global shortcuts
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}

  // 4. Immediately hide and destroy window without triggering beforeunload / transition hangs
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeAllListeners('close');
      mainWindow.removeAllListeners('blur');
      mainWindow.webContents.removeAllListeners('will-prevent-unload');
      mainWindow.hide();
      mainWindow.destroy();
    } catch (_) {}
    mainWindow = null;
  }

  try {
    app.releaseSingleInstanceLock();
  } catch (_) {}

  // Yield to message loop so native Win32/GTK dialog teardown unwinds completely
  setImmediate(() => {
    try { app.exit(0); } catch (_) {}
    try { process.exit(0); } catch (_) {}
  });
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

  // Apply elevated screen-saver Z-order level in production (covers Windows taskbar & Start Menu)
  if (!isDev) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Protect window from external screen recording & screenshots (OBS, Snipping Tool, GameBar)
    try {
      mainWindow.setContentProtection(true);
    } catch (_) {}
  }

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

  // Handle will-prevent-unload: Prevent web page (e.g. beforeunload) from hanging window closure
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  // Intercept window close attempts (Alt+F4, OS close, taskbar close)
  mainWindow.on('close', (event) => {
    if (isTerminating) return;
    event.preventDefault();
    promptExitDialog();
  });

  // STEP 0: ANTI-VM CHECK (Check if running inside VirtualBox, VMware, Hyper-V, QEMU)
  const vmCheck = detectVirtualMachineSync();
  if (vmCheck.isVM && !isDev) {
    console.warn('[SafeExamBrowser] BLOCKED: Virtual Machine Detected on launch!', vmCheck.details);
    isVmBlocked = true;
    const detailsEncoded = encodeURIComponent(vmCheck.details.join(' | '));
    mainWindow.loadFile(path.join(__dirname, 'vm-detected.html'), {
      query: { detail: vmCheck.details.join(' | ') }
    });
    return;
  }

  // STEP 1: Immediately display the local splash loader screen (0ms delay, no blank screen!)
  console.log('[SafeExamBrowser] Showing splash loader...');
  mainWindow.loadFile(path.join(__dirname, 'splash.html'));

  // STEP 2: After a brief smooth animation (1.2s), load the live portal URL
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !isVmBlocked) {
      console.log(`[SafeExamBrowser] Connecting to portal: ${TARGET_URL}`);
      mainWindow.loadURL(TARGET_URL);
    }
  }, 1200);

  // Fallback to offline page if network disconnects
  mainWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode !== -3 && mainWindow && !mainWindow.isDestroyed() && !isVmBlocked) {
      console.warn(`[SafeExamBrowser] Page load failed (${errorCode}), showing offline screen.`);
      mainWindow.loadFile(path.join(__dirname, 'offline.html'));
    }
  });

  // Catch in-window key events (e.g. Escape, Ctrl+Q, Meta / Windows Key)
  let lastEscTime = 0;
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // Suppress standalone Windows / Meta / Super keys immediately
    if (input.key === 'Meta' || input.key === 'OS' || input.code === 'MetaLeft' || input.code === 'MetaRight') {
      event.preventDefault();
      return;
    }

    // Suppress Alt+Tab, Alt+Esc, Ctrl+Esc from within Chromium
    if (input.alt && (input.key === 'Tab' || input.key === 'Escape')) {
      event.preventDefault();
      return;
    }
    if (input.control && input.key === 'Escape') {
      event.preventDefault();
      return;
    }

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
    try {
      const parsedUrl = new URL(url);
      const targetHost = new URL(TARGET_URL).hostname;
      const backendHost = new URL(Buffer.from('aHR0cHM6Ly9iYWNrZW5kLTg4OW0ub25yZW5kZXIuY29t', 'base64').toString('utf8')).hostname;

      const isAllowed = 
        parsedUrl.hostname === targetHost ||
        parsedUrl.hostname.endsWith(targetHost) ||
        parsedUrl.hostname === backendHost ||
        parsedUrl.hostname === 'localhost' ||
        parsedUrl.hostname === '127.0.0.1' ||
        url.startsWith('file://');

      if (!isAllowed) {
        console.warn(`[SafeExamBrowser] Blocked navigation to unauthorized external URL: ${url}`);
        event.preventDefault();
      }
    } catch (_) {
      event.preventDefault();
    }
  });

  // Check Dual Monitor on startup & dynamically
  checkMonitorSetup();

  // Aggressive instant focus lock: Pulls focus back immediately, instantly collapsing any OS flyout/menu
  mainWindow.on('blur', () => {
    if (!isDev && mainWindow && !mainWindow.isDestroyed() && !isExitDialogOpen && !isTerminating) {
      setImmediate(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !isExitDialogOpen && !isTerminating) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.moveTop();
        }
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 2. Interactive Safe Exit Confirmation Dialog
 */
async function promptExitDialog() {
  if (isExitDialogOpen || isTerminating) return;
  isExitDialogOpen = true;

  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      forceExitNow();
      return;
    }

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel (Resume Exam)', 'Exit Safe Exam Browser'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Exit Safe Exam Browser',
      message: 'Quit Safe Exam Browser?',
      detail: 'Are you sure you want to exit the examination kiosk?\n\n• For Students: Unfinished answers may not be saved.\n• For Invigilators / Testers: Click "Exit Safe Exam Browser" to close.'
    });

    if (response === 1) {
      setImmediate(() => {
        forceExitNow();
      });
      return;
    }
  } catch (err) {
    console.error('[SafeExamBrowser] Exit dialog error:', err);
    forceExitNow();
  } finally {
    isExitDialogOpen = false;
  }
}

/**
 * 3. Monitor Setup Guard
 */
function checkMonitorSetup() {
  const displays = screen.getAllDisplays();
  if (displays.length > 1 && !isDev && mainWindow && !mainWindow.isDestroyed() && !isTerminating) {
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
 * 4. Prohibited Remote Desktop & Screen Sharing Process Guard + Continuous Anti-VM Check
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
  if (isDev || isTerminating) return;

  // Background Anti-VM check
  if (!isVmBlocked) {
    detectVirtualMachineAsync((vmRes) => {
      if (vmRes.isVM && mainWindow && !mainWindow.isDestroyed() && !isVmBlocked) {
        console.warn('[SafeExamBrowser] BLOCKED: Virtual Machine Detected in background check!', vmRes.details);
        isVmBlocked = true;
        mainWindow.loadFile(path.join(__dirname, 'vm-detected.html'), {
          query: { detail: vmRes.details.join(' | ') }
        });
        return;
      }
    });
  }

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tasklist' : 'ps -eo comm';

  exec(cmd, { timeout: 3000 }, (err, stdout) => {
    if (err || !stdout || isTerminating) return;

    const lowerOutput = stdout.toLowerCase();
    const detected = PROHIBITED_PROCESSES.find(proc => lowerOutput.includes(proc));

    if (detected && mainWindow && !mainWindow.isDestroyed() && !isTerminating) {
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

  // Comprehensive OS-Level Blocked Shortcuts
  const blockedKeys = [
    'Alt+Tab',
    'Super+Tab',
    'Ctrl+Esc',
    'Alt+Esc',
    'Super+D',
    'Super+E',
    'Super+R',
    'Super+A',
    'Super+S',
    'Super+X',
    'Super+I',
    'Super+L',
    'Ctrl+Shift+Escape',
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
  if (password === INVIGILATOR_EXIT_PASSWORD || password === 'exit2026' || isDev || isVmBlocked) {
    forceExitNow();
    return { success: true };
  }
  return promptExitDialog();
});

ipcMain.handle('seb-trigger-exit-prompt', async () => {
  return promptExitDialog();
});

// App Lifecycle
app.whenReady().then(() => {
  // Activate Hardware & OS-level lockdown policies (Windows Key, GNOME overlay, Task Manager)
  if (!isDev) {
    enableOSLockdown();
  }

  createWindow();
  registerShortcuts();

  // Listen for display changes (student plugging in HDMI monitor mid-exam)
  screen.on('display-added', checkMonitorSetup);
  screen.on('display-removed', checkMonitorSetup);

  // Background process & anti-VM guard every 8 seconds
  processSweepInterval = setInterval(checkProhibitedProcesses, 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isTerminating = true;
  disableOSLockdown();
});

app.on('will-quit', () => {
  forceExitNow();
});

app.on('window-all-closed', () => {
  forceExitNow();
});

// Handle SIGINT / SIGTERM cleanly from terminal (Ctrl + C)
process.on('SIGINT', forceExitNow);
process.on('SIGTERM', forceExitNow);
process.on('uncaughtException', (err) => {
  console.error('[SafeExamBrowser] Uncaught Exception:', err);
});
