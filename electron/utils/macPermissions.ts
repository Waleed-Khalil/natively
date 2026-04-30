import { app, systemPreferences } from "electron";

export async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

/**
 * Check macOS Screen Recording (kTCCServiceScreenCapture) permission status.
 *
 * Electron has no askForMediaAccess('screen') API — macOS only shows the TCC
 * dialog when the app actually calls a protected API (SCK / CoreAudio tap).
 * If the permission is 'denied', we cannot re-prompt; the user must re-enable
 * manually in System Settings → Privacy & Security → Screen Recording.
 *
 * Returns false only when the permission is explicitly 'denied'. All other
 * statuses ('granted', 'not-determined', 'restricted') return true because:
 *   - 'granted':         already allowed — nothing to do.
 *   - 'not-determined':  macOS will show the dialog when SCK/CoreAudio tap runs.
 *   - 'restricted':      managed device policy — nothing we can do programmatically.
 */
export function getMacScreenCaptureStatus(): 'granted' | 'denied' | 'not-determined' | 'restricted' {
  if (process.platform !== 'darwin') return 'granted';

  // In development mode, macOS TCC often falsely reports 'denied' for the electron binary
  // even if the user has granted permission to their Terminal app.
  if (!app.isPackaged) {
    console.log('[Main] Ignoring screen capture permission check in development mode');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as
      'granted' | 'denied' | 'not-determined' | 'restricted';
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
  }
}
