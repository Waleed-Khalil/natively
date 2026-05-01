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

// Always install the shim — under `ELECTRON_RUN_AS_NODE=1`, `require('electron')`
// returns just the binary-path string, not the real app/safeStorage objects.
// (Same constraint that scripts/voice-profile/_electron-shim.js solves.)
//
// safeStorage isn't available outside a full electron runtime, so the simulator
// can't transparently decrypt CredentialsManager. The runner must fall back to
// env-var API keys when this shim is active.
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
        encryptString() { throw new Error('[interview-sim shim] safeStorage unavailable in CLI mode — use env-var keys'); },
        decryptString() { throw new Error('[interview-sim shim] safeStorage unavailable in CLI mode — use env-var keys'); },
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
