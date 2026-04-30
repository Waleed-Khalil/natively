export const KNOWN_AUDIO_APP_BUNDLES = [
    { prefix: 'com.google.Chrome', label: 'Google Chrome' },
    { prefix: 'com.brave.Browser', label: 'Brave' },
    { prefix: 'com.microsoft.edgemac', label: 'Microsoft Edge' },
    { prefix: 'org.mozilla.firefox', label: 'Firefox' },
    { prefix: 'com.apple.Safari', label: 'Safari' },
    { prefix: 'company.thebrowser.Browser', label: 'Arc' },
    { prefix: 'com.vivaldi.Vivaldi', label: 'Vivaldi' },
    { prefix: 'com.operasoftware.Opera', label: 'Opera' },
    { prefix: 'com.openai.atlas', label: 'Atlas' },
    { prefix: 'com.microsoft.teams', label: 'Microsoft Teams' },
    { prefix: 'com.microsoft.teams2', label: 'Microsoft Teams' },
    { prefix: 'us.zoom.xos', label: 'Zoom' },
    { prefix: 'com.tinyspeck.slackmacgap', label: 'Slack' },
    { prefix: 'com.cisco.webexmeetingsapp', label: 'Webex' },
    { prefix: 'com.hnc.Discord', label: 'Discord' },
    { prefix: 'com.apple.FaceTime', label: 'FaceTime' },
].sort((a, b) => b.prefix.length - a.prefix.length);

export function normalizeAudioBundle(bundleId: string): { prefix: string; label: string } {
    const known = KNOWN_AUDIO_APP_BUNDLES.find((app) => bundleId.startsWith(app.prefix));
    if (known) return known;
    return { prefix: bundleId, label: bundleId };
}
