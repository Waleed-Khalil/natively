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

function resolveUserDataPath() {
    // Mirror Electron's app.getPath('userData') resolution. The product name
    // comes from package.json's `build.productName`. If that ever changes,
    // update here too — there's no clean cross-context way to read it.
    const productName = 'Natively';
    const platform = process.platform;
    const home = os.homedir();
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', productName);
    }
    if (platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(appData, productName);
    }
    // Linux / *nix
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    return path.join(xdgConfig, productName);
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
