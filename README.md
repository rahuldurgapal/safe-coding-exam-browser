# 🛡️ Coding Exam Safe Browser (Cross-Platform Kiosk Client)

An official, secure desktop kiosk client for the **Online Examination & Evaluation Portal**.

Designed for high-stakes laboratory and university assessments across **Windows, macOS, and Linux**.

---

## 🌟 Key Architecture & Capabilities

### 1. 🔄 Instant Cloud Auto-Updates (Zero Re-Downloads)
- The Safe Browser operates as an ultra-secure **Cloud Web Shell** pointing to your live production portal (`https://coding-fingure-student-portal.vercel.app`).
- **How Updates Work:** Whenever you push changes to GitHub and Vercel deploys, the next time a student opens the Safe Browser, **it automatically loads the latest version in real-time.**
- Students only need to install or download the desktop app **once per academic session**.

---

### 2. 🔒 Military-Grade Proctoring & OS Lockdown
- **Full OS Kiosk Lockdown:** Runs full-screen with no OS taskbar, dock, URL bar, or window controls (No minimize/close buttons).
- **Global Shortcut Shield:** Blocks `Alt + Tab`, `Windows Key`, `Command Key`, `Ctrl + W`, `Ctrl + R`, `F5`, `F11`, `F12`, and DevTools (`Ctrl + Shift + I/J/C`).
- **Zero Browser Extensions:** Completely isolates the runtime from the user's personal Chrome profile. Extensions like **ChatGPT, Blackbox AI, Monica, Sider, or Tampermonkey cannot run or exist**.
- **Dual-Monitor / Projector Blocker:** Detects multi-monitor setups and HDMI connections. Prompts the candidate to disconnect secondary screens before the assessment can continue.
- **Background Remote Tool Guard:** Periodically inspects background processes for unauthorized screen-sharing tools (`AnyDesk`, `TeamViewer`, `Discord`, `OBS`, `Zoom`, `VNC`).
- **Right-Click & Inspect Disabled:** Context menus are strictly blocked.
- **Domain Sandbox:** Students cannot navigate away or open external popups.

---

### 3. 🔑 Emergency Exit (Bich Me Kaise Exit Karein)
Agar aapko testing ke dauran ya Invigilator ko exam ke beech me exit karna ho:
- **Option 1 (Keyboard):** Press **`Ctrl + Q`** (Mac: `Cmd + Q`), **`Esc`**, ya **`Alt + F4`**.
  - Screen par confirmation dialog aayega: `[ Cancel ]` aur `[ Exit Safe Exam Browser ]`.
- **Option 2 (Click):** Launch loader screen ke bottom me **`[ ✕ Quit Safe Browser ]`** button par click karein.
- **Option 3 (Terminal):** Agar terminal se `npm start` kiya tha, to terminal me **`Ctrl + C`** daba dein.

---

## 🚀 Quick Start Guide

### Step 1: Install Dependencies
Open your terminal in this directory:
```bash
cd safe-exam-browser
npm install
```

---

### Step 2: Run in Development / Test Mode
To test the Safe Browser locally on your computer:
```bash
# Production Kiosk Mode (Full screen locked)
npm start

# OR Developer Mode (Windowed with DevTools enabled for testing)
npm run start:dev

# Test against a local development server
node main.js --url=http://localhost:5173
```

---

## 📦 Building Installers for Windows, macOS & Linux

You can generate cross-platform binaries using `electron-builder`:

### 🪟 Windows Build (.exe)
```bash
npm run build:win
```
**Output (`dist/` folder):**
- `CodingExamSafeBrowser Setup 1.0.0.exe` (One-click installer)
- `CodingExamSafeBrowser 1.0.0.exe` (Portable executable — runs without installation from a USB drive)

---

### 🐧 Linux Build (.AppImage & .deb)
```bash
npm run build:linux
```
**Output (`dist/` folder):**
- `CodingExamSafeBrowser-1.0.0.AppImage` (Universal portable Linux binary — double click to run on Ubuntu, Debian, Fedora, Mint)
- `CodingExamSafeBrowser_1.0.0_amd64.deb` (Debian/Ubuntu package)

---

### 🍎 macOS Build (.dmg)
*(Note: macOS binaries are typically compiled on a Mac or CI/CD machine)*
```bash
npm run build:mac
```
**Output (`dist/` folder):**
- `CodingExamSafeBrowser-1.0.0.dmg` (Universal binary for Intel & Apple Silicon M1/M2/M3)

---

### 🌍 Build All Platforms at Once:
```bash
npm run build:all
```

---

## 🔐 Secret Handshake Token Verification

The Safe Browser sends a custom cryptographic header with every network request:
```http
X-Safe-Exam-Browser: SEB-SECURE-EXAM-GUARD-2026
X-Safe-Browser-Platform: win32 | darwin | linux
User-Agent: ... SafeExamBrowser/1.0.0 (KioskMode; Token=SEB-SECURE-EXAM-GUARD-2026)
```

In your Vercel frontend or Render backend, you can restrict access so that standard browsers (regular Chrome, Safari, Edge) are blocked:
```javascript
// Example check inside Student Portal or backend middleware:
const isSafeBrowser = req.headers['x-safe-exam-browser'] === 'SEB-SECURE-EXAM-GUARD-2026' ||
                      navigator.userAgent.includes('SafeExamBrowser');

if (!isSafeBrowser && process.env.NODE_ENV === 'production') {
  // Show "Please launch using Safe Exam Browser" screen
}
```

---

## 📄 License
ISC License • Secure Examination Assessment Authority
