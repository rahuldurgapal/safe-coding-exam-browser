/**
 * Safe Exam Browser - Anti-VM & Virtual Environment Detection Engine
 * 
 * Detects whether the Safe Exam Browser is running inside a Virtual Machine
 * (Oracle VM VirtualBox, VMware, QEMU/KVM, Hyper-V, Parallels, Xen, Sandboxie).
 * 
 * Techniques:
 * 1. Network Interface MAC Address OUI check (Instant, cross-platform)
 * 2. BIOS / Motherboard / Hardware Manufacturer query
 * 3. VM Guest Services & Background Processes check
 * 4. Linux hypervisor sysfs & systemd-detect-virt check
 * 5. Registry key detection for VM additions/tools (Windows)
 */

const os = require('os');
const { execSync, exec } = require('child_process');
const fs = require('fs');

// Known VM Network Adapter MAC prefixes (OUI)
const VM_MAC_PREFIXES = {
  '08:00:27': 'Oracle VM VirtualBox',
  '00:05:69': 'VMware Workstation/ESXi',
  '00:0c:29': 'VMware Workstation/ESXi',
  '00:50:56': 'VMware Workstation/ESXi',
  '00:1c:14': 'VMware Workstation/ESXi',
  '00:15:5d': 'Microsoft Hyper-V',
  '00:1c:42': 'Parallels Desktop',
  '52:54:00': 'QEMU / KVM Virtual Machine',
  '00:16:3e': 'Xen Hypervisor'
};

// Known VM Processes
const VM_PROCESS_PATTERNS = [
  'vboxservice',
  'vboxtray',
  'vboxcontrol',
  'vmtoolsd',
  'vmwaretray',
  'vmwareuser',
  'vgauthservice',
  'vmicguestinterface',
  'vmicheartbeat',
  'vmicvss',
  'qemu-ga',
  'prl_tools',
  'prl_cc'
];

// Known VM Strings in Hardware / BIOS / Vendor
const VM_HARDWARE_STRINGS = [
  'virtualbox',
  'innotek',
  'vmware',
  'qemu',
  'kvm',
  'seabios',
  'bochs',
  'parallels',
  'hyper-v',
  'virtual machine',
  'vbox'
];

/**
 * Fast synchronous check for VM indicators
 * Returns { isVM: boolean, details: string[] }
 */
function detectVirtualMachineSync() {
  const detections = [];

  // LAYER 1: Check Network MAC Address OUI (Instant & cross-platform)
  try {
    const ifaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a && a.mac && a.mac !== '00:00:00:00:00:00') {
          const prefix = a.mac.toLowerCase().slice(0, 8);
          if (VM_MAC_PREFIXES[prefix]) {
            detections.push(`Virtual Network Adapter: ${VM_MAC_PREFIXES[prefix]} (MAC: ${a.mac})`);
          }
        }
      }
    }
  } catch (_) {}

  // LAYER 2: Linux DMI / Sysfs / CPUinfo check
  if (process.platform === 'linux') {
    try {
      const dmiPaths = [
        '/sys/class/dmi/id/product_name',
        '/sys/class/dmi/id/sys_vendor',
        '/sys/class/dmi/id/bios_vendor',
        '/sys/class/dmi/id/board_vendor'
      ];
      for (const p of dmiPaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8').toLowerCase();
          for (const str of VM_HARDWARE_STRINGS) {
            if (content.includes(str)) {
              detections.push(`Linux DMI Hardware: ${str.toUpperCase()} found in ${p}`);
            }
          }
        }
      }
    } catch (_) {}

    try {
      if (fs.existsSync('/proc/cpuinfo')) {
        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8').toLowerCase();
        if (cpuinfo.includes('hypervisor') && !cpuinfo.includes('physical id')) {
          detections.push('Hypervisor CPU flag detected in /proc/cpuinfo');
        }
      }
    } catch (_) {}

    try {
      const virt = execSync('systemd-detect-virt', { encoding: 'utf8', timeout: 800 }).trim();
      if (virt && virt !== 'none') {
        detections.push(`Linux Hypervisor detected: ${virt}`);
      }
    } catch (_) {}
  }

  // LAYER 3: Windows Registry Check (Synchronous)
  if (process.platform === 'win32') {
    try {
      // Query System BIOS Info from Windows Registry
      const biosReg = execSync('reg query "HKLM\\HARDWARE\\Description\\System\\BIOS"', { encoding: 'utf8', timeout: 1200 }).toLowerCase();
      for (const str of VM_HARDWARE_STRINGS) {
        if (biosReg.includes(str)) {
          detections.push(`Windows BIOS Registry indicates Virtual Environment (${str.toUpperCase()})`);
          break;
        }
      }
    } catch (_) {}

    try {
      // Check for VirtualBox / VMware Guest Additions Registry Keys
      const guestKeyCmds = [
        'reg query "HKLM\\SOFTWARE\\Oracle\\VirtualBox Guest Additions"',
        'reg query "HKLM\\SOFTWARE\\VMware, Inc.\\VMware Tools"',
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\VBoxGuest"',
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\VBoxMouse"',
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\VBoxService"'
      ];
      for (const cmd of guestKeyCmds) {
        try {
          execSync(cmd, { encoding: 'utf8', timeout: 500, stdio: 'pipe' });
          detections.push('VM Guest Additions / Virtual Drivers detected in Windows Registry');
          break;
        } catch (_) {}
      }
    } catch (_) {}
  }

  return {
    isVM: detections.length > 0,
    details: [...new Set(detections)]
  };
}

/**
 * Asynchronous deep check including running background processes
 */
function detectVirtualMachineAsync(callback) {
  // First do the fast sync checks
  const syncResult = detectVirtualMachineSync();
  if (syncResult.isVM) {
    return callback(syncResult);
  }

  // Check background processes
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tasklist' : 'ps -eo comm';

  exec(cmd, { timeout: 2500 }, (err, stdout) => {
    if (err || !stdout) {
      return callback(syncResult);
    }

    const lowerOutput = stdout.toLowerCase();
    const detectedProcess = VM_PROCESS_PATTERNS.find(proc => lowerOutput.includes(proc));

    if (detectedProcess) {
      syncResult.isVM = true;
      syncResult.details.push(`VM Guest Process Running: ${detectedProcess}`);
    }

    callback(syncResult);
  });
}

module.exports = {
  detectVirtualMachineSync,
  detectVirtualMachineAsync
};
