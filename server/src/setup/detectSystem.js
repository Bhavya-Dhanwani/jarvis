// Import Node helpers for CPU architecture fallback and OS release text.
import { arch, release } from 'node:os';

// Map Node platform names to friendly OS names.
const OS_NAMES = {
  // Translate win32 into Windows.
  win32: 'Windows',
  // Translate darwin into macOS.
  darwin: 'macOS',
  // Keep Linux readable.
  linux: 'Linux',
};

// Map supported Node architecture names to CLI labels.
const ARCH_NAMES = {
  // Keep x64 readable.
  x64: 'x64',
  // Keep arm64 readable.
  arm64: 'arm64',
};

// Detect the current operating system and CPU architecture.
export function detectSystem() {
  // Read the OS platform directly from Node.
  const platform = process.platform;
  // Read the CPU architecture from Node and fall back to os.arch().
  const cpuArch = process.arch || arch();

  // Return normalized system information used by the setup wizard.
  return {
    // Store the raw Node platform value.
    platform,
    // Store the friendly OS name if known.
    os: OS_NAMES[platform] ?? platform,
    // Store the OS release version.
    release: release(),
    // Store the friendly architecture name if known.
    arch: ARCH_NAMES[cpuArch] ?? cpuArch,
    // Mark whether this OS is supported by the wizard.
    supportedOs: ['win32', 'darwin', 'linux'].includes(platform),
    // Mark whether this CPU architecture is supported by the wizard.
    supportedArch: ['x64', 'arm64'].includes(cpuArch),
    // Mark Windows for Windows-only setup decisions.
    isWindows: platform === 'win32',
    // Mark macOS for Homebrew-based install decisions.
    isMac: platform === 'darwin',
    // Mark Linux for the curl installer path.
    isLinux: platform === 'linux',
    // Mark macOS/Linux for Unix-style setup decisions.
    isUnix: platform === 'darwin' || platform === 'linux',
  };
}
