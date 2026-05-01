// Same shim pattern as scripts/voice-profile/_electron-shim.js — minimal mock
// of `require('electron')` so compiled electron/ modules load when this script
// is run with plain node. When run via `ELECTRON_RUN_AS_NODE=1 electron`, the
// real electron module is used and this shim is bypassed.

const path = require('path');
const os = require('os');
const fs = require('fs');

function resolveUserDataPath() {
    const platform = process.platform;
    const home = os.homedir();

    const baseFor = (name) => {
        if (platform === 'darwin') {
            return path.join(home, 'Library', 'Application Support', name);
        }
        if (platform === 'win32') {
            const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
            return path.join(appData, name);
        }
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        return path.join(xdgConfig, name);
    };

    for (const name of ['natively', 'Natively']) {
        const candidate = baseFor(name);
        try {
            if (fs.existsSync(path.join(candidate, 'natively.db'))) {
                return candidate;
            }
        } catch { /* ignore and try next */ }
    }
    return baseFor('Natively');
}

// Detect whether we're running inside the real electron runtime
// (ELECTRON_RUN_AS_NODE=1 plus the binary). If so, do nothing — let the real
// electron module resolve so safeStorage etc. work.
const insideElectron = !!process.versions.electron;
if (insideElectron) {
    module.exports = { resolveUserDataPath, usingRealElectron: true };
    return;
}

// Otherwise inject a stub. safeStorage.encryptString/decryptString won't work,
// so the simulator will need to fall back to env-var keys when the shim is active.
const electronMock = {
    app: {
        getPath(name) {
            if (name === 'userData') return resolveUserDataPath();
            throw new Error(`[interview-sim shim] electron.app.getPath('${name}') not implemented`);
        },
        isPackaged: false,
    },
    safeStorage: {
        isEncryptionAvailable() { return false; },
        encryptString() { throw new Error('[interview-sim shim] safeStorage unavailable in plain-node mode'); },
        decryptString() { throw new Error('[interview-sim shim] safeStorage unavailable in plain-node mode'); },
    },
};

const Module = require('module');
const electronId = require.resolve('electron');
Module._cache[electronId] = {
    id: electronId,
    filename: electronId,
    loaded: true,
    exports: electronMock,
    children: [],
    paths: [],
};

module.exports = { resolveUserDataPath, usingRealElectron: false };
