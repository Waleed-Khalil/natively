// Mocks `require('electron')` for CLI scripts so the compiled DatabaseManager
// + MeetingPersistence modules can be loaded outside an Electron runtime.
//
// The shim provides exactly the surface this script path exercises — `app.getPath('userData')`.
// Any other call into `electron` from a transitively-required module will throw,
// which is the right failure mode (we don't want a script silently using a
// half-functional electron stand-in).
//
// Must be required BEFORE any `require()` that touches a module which imports
// from 'electron' transitively (DatabaseManager, MeetingPersistence, etc).

const path = require('path');
const os = require('os');
const fs = require('fs');

function resolveUserDataPath() {
    // Mirror Electron's app.getPath('userData') resolution. The directory
    // name differs between dev and production: dev-mode Electron uses
    // package.json's `name` field ("natively", lowercase), packaged builds
    // use `build.productName` ("Natively"). On macOS APFS this is usually
    // case-insensitive so both resolve to the same directory, but Linux
    // and case-sensitive APFS do distinguish — so probe both candidates
    // and prefer whichever has an existing natively.db. Fall back to the
    // production-style name when nothing exists yet.
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

const electronMock = {
    app: {
        getPath(name) {
            if (name === 'userData') return resolveUserDataPath();
            throw new Error(`[voice-profile shim] electron.app.getPath('${name}') not implemented in CLI shim`);
        },
        isPackaged: false,
    },
};

// Inject into Node's require cache under the resolved 'electron' id so any
// later `require('electron')` returns our mock without hitting the real package.
// Using Module._cache directly is the standard pattern for this kind of stub.
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

module.exports = { resolveUserDataPath };
