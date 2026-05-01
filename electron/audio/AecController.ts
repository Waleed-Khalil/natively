import { loadNativeModule, type AecMetricsSnapshot } from './nativeModuleLoader';

/**
 * Acoustic Echo Cancellation controls.
 *
 * Wraps the optional native functions `setAecEnabled`, `getAecMetrics`, and
 * `resetAecState` exposed by the Rust audio module. The "?" on each function
 * in NativeModule is intentional: existing shipped binaries don't have these
 * yet, and the app must keep working until the next binary release rolls
 * out. Every method here checks for presence and degrades to a soft no-op +
 * a single warn log if the native side is older.
 *
 * AEC has two stages, both wired in `native-module/src/aec.rs`:
 *  - Stage 1 (cross-correlation gate) is always on when the system-audio
 *    reference bus is fresh. It costs essentially nothing.
 *  - Stage 2 (NLMS adaptive filter) is opt-in via `setEnabled(true)` and
 *    handles double-talk where stage 1 alone misses.
 *
 * `setEnabled` controls stage 2 only.
 */
export class AecController {
    private static module: any = loadNativeModule();
    private static warnedMissing = false;

    private static warnOnce(method: string): void {
        if (this.warnedMissing) return;
        console.warn(
            `[AEC] Native ${method} not found in current binary — ` +
            `rebuild native-module to enable acoustic echo cancellation.`
        );
        this.warnedMissing = true;
    }

    /** Returns true if the loaded native binary exposes the AEC API. */
    public static isSupported(): boolean {
        return !!(
            this.module &&
            typeof this.module.setAecEnabled === 'function' &&
            typeof this.module.getAecMetrics === 'function'
        );
    }

    /**
     * Enable / disable the stage-2 NLMS engine. Idempotent — repeated calls
     * with the same value are no-ops on the native side.
     */
    public static setEnabled(enabled: boolean): void {
        if (!this.module || typeof this.module.setAecEnabled !== 'function') {
            this.warnOnce('setAecEnabled');
            return;
        }
        try {
            this.module.setAecEnabled(enabled);
        } catch (e) {
            console.error('[AEC] setAecEnabled threw:', e);
        }
    }

    /**
     * Fetch a snapshot of pipeline state and last-frame metrics. Returns
     * `null` if the native binary is older. Callers should check the return
     * before reading fields.
     */
    public static getMetrics(): AecMetricsSnapshot | null {
        if (!this.module || typeof this.module.getAecMetrics !== 'function') {
            return null;
        }
        try {
            return this.module.getAecMetrics();
        } catch (e) {
            console.error('[AEC] getAecMetrics threw:', e);
            return null;
        }
    }

    /**
     * Reset the AEC pipeline (clears reference bus, recreates the gate and
     * — if enabled — the NLMS engine). Call between meetings; the previous
     * session's filter taps modeled a specific room/volume.
     */
    public static reset(): void {
        if (!this.module || typeof this.module.resetAecState !== 'function') {
            return;
        }
        try {
            this.module.resetAecState();
        } catch (e) {
            console.error('[AEC] resetAecState threw:', e);
        }
    }
}
