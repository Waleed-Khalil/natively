//! Acoustic echo handling for the dual-source pipeline.
//!
//! When the user is on built-in laptop speakers + built-in mic (no headset),
//! the third party's voice plays through the speakers and bleeds straight
//! back into the mic at a 50–150ms acoustic delay. Without intervention this
//! ends up double-transcribed: once correctly on the system-audio channel
//! and once incorrectly on the mic channel, where the existing
//! `shouldRouteMicrophoneAsInterviewer` heuristic in main.ts has to guess
//! after the fact whether to relabel or drop. RMS-based heuristics can't
//! solve this — they only see two energies, not the relationship between
//! them.
//!
//! This module replaces that guess with a deterministic check at the source.
//! Two stages run inside the mic DSP loop (`lib.rs`), both consuming the
//! shared `echo_reference::EchoReferenceBus`:
//!
//! 1. **Cross-correlation gate** (always on when reference is fresh):
//!    Normalized cross-correlation between the mic frame and the reference
//!    over a 0–250ms lag window. Echo is the *same* waveform shifted in
//!    time — so the peak correlation between mic and reference at the right
//!    lag is ~1.0 minus a small distortion penalty. Real user speech is
//!    uncorrelated with the reference and stays well under 0.2.
//!
//! 2. **NLMS adaptive filter** (opt-in, default on for laptop mic):
//!    A 1024-tap normalized LMS filter learns the speaker→mic transfer
//!    function continuously. We compute echo return loss enhancement (ERLE)
//!    per frame; combined with the gate's correlation peak, it gives a
//!    reliable kill-switch that handles double-talk (where both speak at
//!    once and stage 1 alone would fail).
//!
//! Both stages run at 16 kHz on a decimated copy of the mic frame; the
//! original native-rate frame is unchanged. AEC's only effect on the audio
//! path is the binary decision to drop a frame before silence suppression.
//! We don't try to substitute a "cleaned" signal back into the path because
//! that would require an upsampler in the hot loop and create a quality cliff
//! whenever the AEC misbehaves.
//!
//! Concurrency model: the `AudioCoordinator` is a process-wide singleton
//! (Arc behind OnceCell). The system-audio DSP thread calls `push_render` at
//! ~50 Hz; the mic DSP thread calls `process_capture` at ~50 Hz. Each method
//! takes its own short-lived Mutex; the two threads never contend on the
//! same lock so there's no real serialization beyond the bus itself.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use once_cell::sync::OnceCell;

use crate::echo_reference::{instance as ref_bus, EchoReferenceBus, REF_SAMPLE_RATE};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// Per-frame metrics. All fields describe the most recent processed frame.
/// Cumulative counters live on the coordinator itself.
#[derive(Debug, Clone, Copy, Default)]
pub struct AecFrameMetrics {
    /// EMA-smoothed normalized cross-correlation (0–1) between the mic frame
    /// and the best-aligned slice of the reference signal. Single-frame peaks
    /// are jittery; smoothing avoids dropping good frames on transient dips.
    pub correlation_peak: f32,
    /// Lag (in milliseconds) at which the peak correlation was found.
    /// Doubles as a delay estimate for the speaker→mic acoustic path.
    pub delay_estimate_ms: f32,
    /// Echo return loss enhancement of the NLMS filter, in dB. Larger = more
    /// of the input frame's energy was modelled as echo and cancelled. Only
    /// meaningful when stage 2 is enabled.
    pub echo_return_loss_db: f32,
    /// Residual energy as a fraction of input energy (0–1). Lower = more of
    /// the frame was echo. Only meaningful when stage 2 is enabled.
    pub residual_ratio: f32,
    /// Final decision: this frame is dominated by echo and the DSP loop must
    /// drop it before silence suppression / STT.
    pub suppress_as_echo: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct CoordinatorMetricsSnapshot {
    pub enabled: bool,
    pub frames_processed: u64,
    pub frames_suppressed_as_echo: u64,
    pub last_correlation_peak: f32,
    pub last_delay_estimate_ms: f32,
    pub last_echo_return_loss_db: f32,
    pub last_residual_ratio: f32,
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioCoordinator (singleton)
// ─────────────────────────────────────────────────────────────────────────────

pub struct AudioCoordinator {
    aec_enabled: AtomicBool,
    /// Stage 1 — cross-correlation gate. Lives behind a Mutex because
    /// `process_capture` is the only writer and it's called from the mic
    /// DSP thread, but we hold the coordinator behind an Arc so the field
    /// needs interior mutability anyway. Contention is none in practice.
    gate: Mutex<EchoGate>,
    /// Stage 2 — adaptive AEC engine. `None` until `set_aec_enabled(true)`.
    /// Boxed-trait so a future WebRTC AEC3 FFI implementation can swap in
    /// without touching call sites.
    engine: Mutex<Option<Box<dyn AecEngine + Send>>>,
    ref_bus: Arc<EchoReferenceBus>,
    frames_processed: AtomicU64,
    frames_suppressed_as_echo: AtomicU64,
    /// Snapshot of the last-processed frame's metrics. Mutex (not separate
    /// atomics) so JS readers see a coherent view — same frame's correlation,
    /// delay, ERLE, residual together.
    last: Mutex<AecFrameMetrics>,
}

static COORDINATOR: OnceCell<Arc<AudioCoordinator>> = OnceCell::new();

pub fn coordinator() -> Arc<AudioCoordinator> {
    COORDINATOR
        .get_or_init(|| {
            Arc::new(AudioCoordinator {
                aec_enabled: AtomicBool::new(false),
                gate: Mutex::new(EchoGate::new()),
                engine: Mutex::new(None),
                ref_bus: ref_bus(),
                frames_processed: AtomicU64::new(0),
                frames_suppressed_as_echo: AtomicU64::new(0),
                last: Mutex::new(AecFrameMetrics::default()),
            })
        })
        .clone()
}

impl AudioCoordinator {
    /// Toggle the stage-2 NLMS engine. Lazy: the engine is created only when
    /// transitioning false→true, dropped on true→false (so its filter taps
    /// don't drift while inactive and re-converge from scratch on next use).
    pub fn set_aec_enabled(&self, enabled: bool) {
        let was = self.aec_enabled.swap(enabled, Ordering::AcqRel);
        if was == enabled {
            return;
        }
        let mut slot = match self.engine.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if enabled {
            *slot = Some(Box::new(NlmsAecEngine::new()));
            println!("[AEC] NLMS engine enabled (1024-tap, 64ms tail @ 16kHz).");
        } else {
            *slot = None;
            println!("[AEC] NLMS engine disabled.");
        }
    }

    pub fn is_aec_enabled(&self) -> bool {
        self.aec_enabled.load(Ordering::Acquire)
    }

    /// Called from the SystemAudioCapture DSP loop with raw native-rate f32
    /// samples (post f32 conversion, *pre* silence suppression). The
    /// reference must be the unprocessed system audio: pushing post-suppressor
    /// audio leaves silent gaps that wreck delay estimation and tap training.
    pub fn push_render(&self, samples_native: &[f32], native_sample_rate: u32) {
        if samples_native.is_empty() {
            return;
        }
        self.ref_bus.push_native(samples_native, native_sample_rate);

        // Feed the NLMS engine in lockstep so its delay-line tracks the bus.
        // The decimation cost is small and only occurs while AEC is enabled.
        if self.aec_enabled.load(Ordering::Acquire) {
            if let Ok(mut slot) = self.engine.lock() {
                if let Some(engine) = slot.as_mut() {
                    let mut buf16: Vec<f32> = Vec::with_capacity(samples_native.len());
                    decimate_to_16k(samples_native, native_sample_rate, &mut buf16);
                    engine.push_render(&buf16);
                }
            }
        }
    }

    /// Called from the MicrophoneCapture DSP loop with the mic frame at
    /// native rate. If `metrics.suppress_as_echo` is true, the caller MUST
    /// drop the frame (skip silence suppression and the STT callback).
    pub fn process_capture(
        &self,
        samples_native: &[f32],
        native_sample_rate: u32,
    ) -> AecFrameMetrics {
        let mut metrics = AecFrameMetrics::default();

        // Decimate mic to 16 kHz once; both stages reuse the same buffer.
        let mut mic16: Vec<f32> = Vec::with_capacity(samples_native.len());
        decimate_to_16k(samples_native, native_sample_rate, &mut mic16);

        // Reference must be fresh; if the system-audio capture is paused or
        // hasn't warmed up, neither stage produces meaningful output.
        let ref_fresh = self.ref_bus.is_fresh(500);

        if ref_fresh {
            // Stage 1: cross-correlation gate.
            if let Ok(mut gate) = self.gate.lock() {
                let (corr, lag_ms, gate_says_echo) = gate.process(&mic16, &self.ref_bus);
                metrics.correlation_peak = corr;
                metrics.delay_estimate_ms = lag_ms;
                if gate_says_echo {
                    metrics.suppress_as_echo = true;
                }
            }

            // Stage 2: NLMS engine.
            if self.aec_enabled.load(Ordering::Acquire) {
                if let Ok(mut slot) = self.engine.lock() {
                    if let Some(engine) = slot.as_mut() {
                        let stage2 = engine.process_capture(&mic16);
                        metrics.echo_return_loss_db = stage2.echo_return_loss_db;
                        metrics.residual_ratio = stage2.residual_ratio;

                        // Suppress when the filter has cancelled most of the
                        // input AND the gate agrees there's correlated
                        // reference content. Requiring both keeps us safe
                        // during double-talk: if the user is talking, the
                        // residual stays high (the user's voice can't be
                        // cancelled — it isn't in the reference) and the
                        // condition can't fire even if correlation is also
                        // present from a quieter background echo.
                        if stage2.echo_return_loss_db > 6.0
                            && stage2.residual_ratio < 0.4
                            && metrics.correlation_peak > 0.25
                        {
                            metrics.suppress_as_echo = true;
                        }
                    }
                }
            }
        }

        self.frames_processed.fetch_add(1, Ordering::Relaxed);
        if metrics.suppress_as_echo {
            self.frames_suppressed_as_echo.fetch_add(1, Ordering::Relaxed);
        }
        if let Ok(mut g) = self.last.lock() {
            *g = metrics;
        }
        metrics
    }

    pub fn snapshot_metrics(&self) -> CoordinatorMetricsSnapshot {
        let last = self.last.lock().map(|g| *g).unwrap_or_default();
        CoordinatorMetricsSnapshot {
            enabled: self.is_aec_enabled(),
            frames_processed: self.frames_processed.load(Ordering::Relaxed),
            frames_suppressed_as_echo: self.frames_suppressed_as_echo.load(Ordering::Relaxed),
            last_correlation_peak: last.correlation_peak,
            last_delay_estimate_ms: last.delay_estimate_ms,
            last_echo_return_loss_db: last.echo_return_loss_db,
            last_residual_ratio: last.residual_ratio,
        }
    }

    /// Reset all state. Called when a meeting ends so the next session
    /// starts with fresh filter taps and no stale reference.
    pub fn reset(&self) {
        self.ref_bus.reset();
        if let Ok(mut g) = self.gate.lock() {
            *g = EchoGate::new();
        }
        if let Ok(mut g) = self.engine.lock() {
            // Preserve enabled-state but recreate the engine so its taps
            // start at zero. The previous taps modeled the previous session's
            // acoustic path — different room, different volume.
            if g.is_some() {
                *g = Some(Box::new(NlmsAecEngine::new()));
            }
        }
        self.frames_processed.store(0, Ordering::Relaxed);
        self.frames_suppressed_as_echo.store(0, Ordering::Relaxed);
        if let Ok(mut g) = self.last.lock() {
            *g = AecFrameMetrics::default();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — cross-correlation gate
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum lag to search for the speaker→mic delay, in samples at 16 kHz.
/// 250ms covers Bluetooth speaker latency comfortably; built-in laptop
/// speakers are typically under 80ms.
const MAX_LAG_SAMPLES: usize = (REF_SAMPLE_RATE as usize / 1000) * 250;

/// Step in samples between candidate lags. Searching every sample is
/// wasteful — speech autocorrelation is broad enough that a 4-sample step
/// (0.25ms) finds the peak just as reliably and cuts the inner loop by 4x.
const LAG_STEP: usize = 4;

/// Smoothed-correlation threshold above which we treat the mic frame as
/// echo-dominated. 0.45 is conservative: real echo frequently sits north of
/// 0.7 even on built-in laptop speakers; user speech essentially never
/// crosses 0.3 against unrelated reference content.
const CORR_THRESHOLD: f32 = 0.45;

/// EMA smoothing constant for the correlation metric.
const CORR_EMA_ALPHA: f32 = 0.5;

/// Below this absolute energy (sum of squares of the slice), the slice is
/// effectively silent — correlation against silence is ill-defined and we
/// must not suppress the mic on it.
const REF_ENERGY_FLOOR: f32 = 1e-4;
const MIC_ENERGY_FLOOR: f32 = 1e-6;

struct EchoGate {
    corr_ema: f32,
    /// Reusable buffer for the snapshot of reference samples.
    ref_window: Vec<f32>,
}

impl EchoGate {
    fn new() -> Self {
        Self {
            corr_ema: 0.0,
            ref_window: Vec::new(),
        }
    }

    /// Returns (smoothed_correlation_peak, lag_ms, suppress_decision).
    fn process(&mut self, mic16: &[f32], bus: &EchoReferenceBus) -> (f32, f32, bool) {
        if mic16.is_empty() {
            return (self.corr_ema, 0.0, false);
        }

        let window_len = mic16.len() + MAX_LAG_SAMPLES;
        if self.ref_window.len() != window_len {
            self.ref_window = vec![0.0; window_len];
        }

        // Snapshot the most recent `window_len` reference samples ending now.
        // If the bus hasn't filled yet, decay the EMA toward zero so a brief
        // warmup gap doesn't latch suppression on.
        if !bus.snapshot(&mut self.ref_window, 0) {
            self.corr_ema *= 1.0 - CORR_EMA_ALPHA;
            return (self.corr_ema, 0.0, false);
        }

        let mic_energy: f32 = mic16.iter().map(|&s| s * s).sum();
        if mic_energy < MIC_ENERGY_FLOOR {
            // Near-silent mic frame. No echo to detect; let the energy-based
            // silence suppressor handle the frame and decay the EMA.
            self.corr_ema *= 1.0 - CORR_EMA_ALPHA;
            return (self.corr_ema, 0.0, false);
        }

        // Sweep candidate lags. At lag=k, the mic frame is being compared to
        // the reference samples that were emitted k samples earlier:
        //   ref_window[window_len - mic.len() - k .. window_len - k]
        //
        // ref_window is laid out oldest-first, newest-last; so the highest
        // index in the window is "now" and decreasing index is "further in
        // the past".
        let mut best_corr: f32 = 0.0;
        let mut best_lag: usize = 0;
        let mut lag = 0usize;
        while lag <= MAX_LAG_SAMPLES {
            let start = window_len - mic16.len() - lag;
            let slice = &self.ref_window[start..start + mic16.len()];

            let mut dot: f32 = 0.0;
            let mut ref_energy: f32 = 0.0;
            for i in 0..mic16.len() {
                dot += slice[i] * mic16[i];
                ref_energy += slice[i] * slice[i];
            }
            if ref_energy < REF_ENERGY_FLOOR {
                lag += LAG_STEP;
                continue;
            }
            let denom = (mic_energy * ref_energy).sqrt();
            // |cov| / sqrt(var_a * var_b). We take the absolute value because
            // a phase-inverted echo (e.g. from a stereo-to-mono downmix) is
            // still echo, just with a sign flip.
            let corr = (dot / denom).abs();
            if corr > best_corr {
                best_corr = corr;
                best_lag = lag;
            }
            lag += LAG_STEP;
        }

        self.corr_ema = self.corr_ema * (1.0 - CORR_EMA_ALPHA) + best_corr * CORR_EMA_ALPHA;
        let lag_ms = (best_lag as f32 / REF_SAMPLE_RATE as f32) * 1000.0;

        // Suppress when the smoothed correlation is solidly above threshold
        // AND the reference at the best lag had real energy (i.e. system
        // audio was actually playing something at the moment that maps onto
        // this mic frame).
        let ref_at_lag_energy: f32 = {
            let start = window_len - mic16.len() - best_lag;
            self.ref_window[start..start + mic16.len()]
                .iter()
                .map(|&s| s * s)
                .sum()
        };
        let suppress = self.corr_ema >= CORR_THRESHOLD && ref_at_lag_energy > REF_ENERGY_FLOOR;

        (self.corr_ema, lag_ms, suppress)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — adaptive AEC engine trait + NLMS implementation
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Default)]
pub struct EngineFrameMetrics {
    pub echo_return_loss_db: f32,
    pub residual_ratio: f32,
}

/// Trait for swappable AEC engines.
///
/// The current production impl is `NlmsAecEngine` (pure-Rust normalized LMS).
/// The trait exists so a future WebRTC AEC3 FFI implementation can drop in
/// without touching the coordinator. AEC3 handles long delays, non-linear
/// speaker distortion, and double-talk substantially better than NLMS — but
/// it requires the `webrtc-audio-processing` C++ library at link time, which
/// is a non-trivial build-system change. NLMS gets us most of the way today
/// with no new dependencies.
pub trait AecEngine: Send {
    /// Push a render (far-end / reference) block at 16 kHz mono.
    fn push_render(&mut self, samples_16k: &[f32]);
    /// Process a mic (near-end) block at 16 kHz mono and return metrics.
    /// The cleaned signal is computed internally for the metrics but is not
    /// returned — the coordinator's policy is to drop or keep the original
    /// frame, not substitute a reconstructed one.
    fn process_capture(&mut self, samples_16k: &[f32]) -> EngineFrameMetrics;
}

/// Filter length (taps). 1024 taps at 16 kHz = 64ms acoustic tail. Covers
/// the speaker→mic delay on every laptop we care about (typical: 50-80ms).
/// Bluetooth speakers exceed this; the cross-correlation gate handles those
/// because it searches up to 250ms.
const N_TAPS: usize = 1024;

/// Cap for the pending-render FIFO. If the mic side ever stops pulling we
/// don't want unbounded growth; 16k samples = 1 second @ 16 kHz which is far
/// more drift than we'll ever see between two threads polling at 50 Hz.
const RENDER_QUEUE_CAP: usize = 16_000;

/// Normalized LMS adaptive filter.
///
/// Models the speaker→mic acoustic path as a 1024-tap FIR. Updates the taps
/// each sample using the NLMS rule:
///
///   ŷ[n]  = Σ w[k] · x[n−k]      (estimated echo)
///   e[n]  = d[n] − ŷ[n]            (residual after cancellation)
///   w[k] += μ · e[n] · x[n−k] / ‖x‖²
///
/// Where d is the mic, x is the render delay line, w is the filter, e is
/// the residual.
///
/// **Sample alignment**: the system-audio (`push_render`) and microphone
/// (`process_capture`) DSP threads are independent and call us at slightly
/// different cadences. We can't assume that "the most recent sample pushed"
/// corresponds to "the current mic sample" — the threads aren't synchronised
/// at sample granularity. Instead, the engine queues every pushed render
/// sample in a FIFO. Each call to `process_capture` pulls one render sample
/// per mic sample and pushes it into the filter delay line *before*
/// computing the output, so each mic sample's `y_hat` aligns with the
/// concurrently-emitted render sample. If the FIFO underruns (mic outran
/// push), we substitute zeros — the filter then briefly under-models echo
/// for that frame, which is harmless: the residual stays high so the
/// suppression heuristic correctly does not fire.
///
/// **Double-talk handling**: when the user speaks over the far-end, the
/// residual energy gets dominated by the user's voice (which the filter
/// can't cancel because it isn't in x). Without intervention NLMS would
/// push the taps in a direction that destroys the echo model. We freeze
/// adaptation per-frame using a Geigel-style detector: if mic energy
/// per-sample exceeds render energy per-sample by 4x, freeze the taps for
/// the entire frame. The filter still produces an output (using whatever
/// taps it currently has) so the residual stays meaningful for metrics.
pub struct NlmsAecEngine {
    /// Filter taps. w[k] is the gain applied to x[n−k].
    w: Vec<f32>,
    /// Render delay line (length N_TAPS, circular). The most recent sample
    /// is at index `(x_write + N_TAPS - 1) % N_TAPS`.
    x: Vec<f32>,
    x_write: usize,
    /// Running sum of x[k]² for normalization. Maintained incrementally to
    /// avoid an O(N) recomputation each sample.
    x_energy: f32,
    /// Pending render samples that haven't been consumed by a `process_capture`
    /// yet. A small FIFO smooths over thread-cadence jitter between the two
    /// DSP threads (system audio vs microphone). Capped at `RENDER_QUEUE_CAP`
    /// so that a stalled mic side can't drive unbounded memory growth.
    render_queue: std::collections::VecDeque<f32>,
    /// Step size. 0.1 is a textbook value for speech NLMS — small enough to
    /// stay stable on transient pulses, large enough to converge in seconds.
    mu: f32,
    /// Regularization to prevent division-by-zero when render is silent.
    epsilon: f32,
}

impl NlmsAecEngine {
    pub fn new() -> Self {
        Self {
            w: vec![0.0; N_TAPS],
            x: vec![0.0; N_TAPS],
            x_write: 0,
            x_energy: 0.0,
            render_queue: std::collections::VecDeque::with_capacity(RENDER_QUEUE_CAP),
            mu: 0.1,
            epsilon: 1e-6,
        }
    }

    #[inline]
    fn push_render_one(&mut self, s: f32) {
        // Maintain x_energy incrementally: subtract the sample being
        // overwritten, add the new one. Clamp to >=0 to absorb float drift.
        let old = self.x[self.x_write];
        self.x_energy = (self.x_energy - old * old + s * s).max(0.0);
        self.x[self.x_write] = s;
        self.x_write = (self.x_write + 1) % N_TAPS;
    }

    /// y_hat[n] = Σ w[k] · x[n-k] for k=0..N_TAPS.
    /// Walks backwards from the most recently pushed x sample, so the k=0
    /// tap aligns with the just-pushed render sample.
    #[inline]
    fn filter_output(&self) -> f32 {
        let mut acc = 0.0f32;
        let mut idx = if self.x_write == 0 {
            N_TAPS - 1
        } else {
            self.x_write - 1
        };
        for k in 0..N_TAPS {
            acc += self.w[k] * self.x[idx];
            idx = if idx == 0 { N_TAPS - 1 } else { idx - 1 };
        }
        acc
    }

    #[inline]
    fn update_taps(&mut self, e: f32) {
        let norm = self.x_energy + self.epsilon;
        let scale = self.mu * e / norm;
        let mut idx = if self.x_write == 0 {
            N_TAPS - 1
        } else {
            self.x_write - 1
        };
        for k in 0..N_TAPS {
            self.w[k] += scale * self.x[idx];
            idx = if idx == 0 { N_TAPS - 1 } else { idx - 1 };
        }
    }
}

impl AecEngine for NlmsAecEngine {
    fn push_render(&mut self, samples_16k: &[f32]) {
        for &s in samples_16k {
            if self.render_queue.len() >= RENDER_QUEUE_CAP {
                // Drop oldest — keeps memory bounded while always preserving
                // the most recent (and thus most relevant) reference data.
                self.render_queue.pop_front();
            }
            self.render_queue.push_back(s);
        }
    }

    fn process_capture(&mut self, samples_16k: &[f32]) -> EngineFrameMetrics {
        if samples_16k.is_empty() {
            return EngineFrameMetrics::default();
        }

        // Frame-level double-talk detector. Compare per-sample mic energy
        // against per-sample render energy in the delay line. When mic
        // energy materially exceeds render, near-end speech is dominating —
        // freeze adaptation for this frame. Use the pre-loop x_energy snapshot
        // so the freeze decision is consistent across all samples in the frame.
        let frame_input_energy: f32 = samples_16k.iter().map(|&s| s * s).sum();
        let mic_per_sample = frame_input_energy / samples_16k.len() as f32;
        let render_per_sample = self.x_energy / N_TAPS as f32;
        let freeze = mic_per_sample > render_per_sample * 4.0;

        let mut input_energy = 0.0f32;
        let mut residual_energy = 0.0f32;
        for &d in samples_16k {
            // Pair each mic sample with the next render sample from the FIFO.
            // Push it into the filter delay line *first* so `filter_output`'s
            // k=0 tap aligns with this mic sample's concurrent render.
            let render_sample = self.render_queue.pop_front().unwrap_or(0.0);
            self.push_render_one(render_sample);

            let y_hat = self.filter_output();
            let e = d - y_hat;
            input_energy += d * d;
            residual_energy += e * e;
            if !freeze {
                self.update_taps(e);
            }
        }

        let residual_ratio = if input_energy > 1e-6 {
            (residual_energy / input_energy).clamp(0.0, 1.0)
        } else {
            // No input energy → no echo possible, no cancellation possible.
            // Report 1.0 (fully "uncancelled") so downstream policy treats
            // this as not-suppressible.
            1.0
        };
        let echo_return_loss_db = if residual_ratio > 1e-6 {
            -10.0 * residual_ratio.log10()
        } else {
            // Residual essentially zero — cap the dB to avoid +inf.
            60.0
        };

        EngineFrameMetrics {
            echo_return_loss_db,
            residual_ratio,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn decimate_to_16k(native_samples: &[f32], native_sample_rate: u32, out: &mut Vec<f32>) {
    out.clear();
    if native_samples.is_empty() || native_sample_rate == 0 {
        return;
    }
    let factor = native_sample_rate as f64 / REF_SAMPLE_RATE as f64;
    if factor <= 1.0 {
        out.extend_from_slice(native_samples);
        return;
    }
    let mut pos = 0.0f64;
    while (pos as usize) < native_samples.len() {
        out.push(native_samples[pos as usize]);
        pos += factor;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::echo_reference::EchoReferenceBus;

    /// SplitMix64 — produces high-quality, well-decorrelated output even
    /// from neighbouring seeds. Used by the tests as a stateful generator so
    /// each frame yields *fresh* uncorrelated samples (no repetition that
    /// would make the gate's lag-search spuriously match against earlier
    /// pre-fill data). The LCG I tried first only mixes well after several
    /// thousand iterations and gave a 0.5 cross-correlation between seeds
    /// that differed by one bit — exactly the case the gate-negative test
    /// has to handle.
    fn next_u64(state: &mut u64) -> u64 {
        *state = state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = *state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }

    /// Stateful broadband noise frame. Each call advances `state`, so two
    /// distinct states give two independent streams.
    ///
    /// Uses the high 32 bits of the SplitMix64 output (`>> 32`, not `>> 33`)
    /// so the value spans the full u32 range and the resulting noise is
    /// zero-mean. An earlier version used `>> 33`, which only covers
    /// 0..2^31, biasing the output toward -0.5 — that DC offset made any
    /// two "independent" streams strongly cross-correlate (dominated by the
    /// shared mean) and broke the gate-negative test.
    fn noise_frame_stateful(amp: f32, state: &mut u64) -> Vec<f32> {
        (0..320)
            .map(|_| {
                let bits = (next_u64(state) >> 32) as u32;
                let f = (bits as f32 / u32::MAX as f32) * 2.0 - 1.0;
                f * amp
            })
            .collect()
    }

    #[test]
    fn gate_flags_delayed_copy_as_echo() {
        let bus = EchoReferenceBus::new();
        let mut gate = EchoGate::new();

        // Pre-fill: independent noise stream so the bus has > MAX_LAG +
        // frame_len samples (the gate returns early until it does).
        let mut prefill_state: u64 = 1;
        for _ in 0..14 {
            bus.push_native(&noise_frame_stateful(0.3, &mut prefill_state), 16_000);
        }

        // For each test frame, generate noise once then push the same data
        // both into the bus AND through the gate as the mic — i.e. perfect
        // echo, lag 0. After EMA warmup the gate must flag suppression.
        let mut state: u64 = 0xdeadbeef;
        let mut suppressed_at_least_once = false;
        for _ in 0..8 {
            let frame = noise_frame_stateful(0.3, &mut state);
            bus.push_native(&frame, 16_000);
            let (_corr, _lag, suppress) = gate.process(&frame, &bus);
            if suppress {
                suppressed_at_least_once = true;
            }
        }
        assert!(
            suppressed_at_least_once,
            "gate should flag perfect echo as suppressible after EMA warmup"
        );
    }

    #[test]
    fn gate_does_not_flag_uncorrelated_speech() {
        let bus = EchoReferenceBus::new();
        let mut gate = EchoGate::new();

        // Two independent SplitMix64 streams. Pre-fill the bus with one
        // stream's samples; feed the gate the other stream's. Cross-
        // correlation at any lag should stay well below the gate's 0.45
        // suppression threshold, even after EMA smoothing.
        let mut ref_state: u64 = 42;
        let mut mic_state: u64 = 999_999_999;

        for _ in 0..14 {
            bus.push_native(&noise_frame_stateful(0.3, &mut ref_state), 16_000);
        }

        for i in 0..15 {
            let r = noise_frame_stateful(0.3, &mut ref_state);
            bus.push_native(&r, 16_000);
            let m = noise_frame_stateful(0.3, &mut mic_state);
            let (_corr, _lag, suppress) = gate.process(&m, &bus);
            assert!(
                !suppress,
                "uncorrelated content must not be suppressed (iter {})",
                i
            );
        }
    }

    #[test]
    fn nlms_reduces_residual_on_pure_echo() {
        let mut engine = NlmsAecEngine::new();
        // Train on a continuous broadband stream. Each frame the engine
        // pairs the just-pushed render with the just-supplied mic sample-
        // by-sample (via its internal render FIFO), which is the alignment
        // the production pipeline produces too.
        let mut state: u64 = 0xdeadbeef;
        for _ in 0..400 {
            let frame = noise_frame_stateful(0.4, &mut state);
            engine.push_render(&frame);
            let metrics = engine.process_capture(&frame);
            assert!(metrics.residual_ratio >= 0.0 && metrics.residual_ratio <= 1.0);
        }
        // After training, ERLE on a fresh identical block must be solidly
        // positive — the filter has learned the identity transfer.
        let frame = noise_frame_stateful(0.4, &mut state);
        engine.push_render(&frame);
        let metrics = engine.process_capture(&frame);
        assert!(
            metrics.echo_return_loss_db > 6.0,
            "expected at least 6dB ERLE after training, got {}dB",
            metrics.echo_return_loss_db
        );
    }

    #[test]
    fn nlms_freezes_during_double_talk() {
        // When mic energy dramatically exceeds render energy (user talking
        // over silence on the far-end), the engine must NOT update its taps —
        // adapting on near-end speech destroys the echo model.
        let mut engine = NlmsAecEngine::new();
        let mut train_state: u64 = 0xaaaa;
        for _ in 0..50 {
            let frame = noise_frame_stateful(0.3, &mut train_state);
            engine.push_render(&frame);
            engine.process_capture(&frame);
        }
        let trained_w: Vec<f32> = engine.w.clone();

        // Now: render is silent, mic is loud near-end speech. Engine must
        // detect double-talk and freeze.
        let silent_render = vec![0.0f32; 320];
        let mut mic_state: u64 = 0xbbbb;
        let loud_mic = noise_frame_stateful(0.9, &mut mic_state);
        engine.push_render(&silent_render);
        engine.process_capture(&loud_mic);

        let max_drift = engine
            .w
            .iter()
            .zip(trained_w.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            max_drift < 1e-3,
            "freeze failed: max tap drift was {} (expected < 1e-3)",
            max_drift
        );
    }
}
