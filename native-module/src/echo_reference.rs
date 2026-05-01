//! Echo reference bus.
//!
//! A process-wide shared ring of recent system-audio ("far-end" / "render")
//! samples at 16 kHz mono. The system-audio DSP thread pushes into it after
//! native-rate capture, before any silence suppression. The microphone DSP
//! thread reads slices out of it to drive the cross-correlation gate and the
//! NLMS adaptive filter in `aec.rs`.
//!
//! Why a singleton bus instead of plumbing the producer/consumer halves
//! through both capture structs:
//!
//! - The two captures are constructed independently from JS; there is no
//!   single owner that holds both at once.
//! - Either capture can be torn down and rebuilt mid-session (e.g. when the
//!   user switches device or toggles voice processing). A static bus keeps
//!   working across those rebuilds without any rewiring.
//! - The mic side reads the bus by *snapshot* — copy the last N samples into
//!   a caller-owned buffer — so we don't need a real lock-free SPSC channel
//!   here. Mutex<VecDeque> at 50 frames/sec is fine.
//!
//! The reference signal must be the *unprocessed* system audio, i.e. the
//! signal that was actually emitted by the speakers. Pushing post-suppression
//! audio would leave gaps that the AEC would interpret as silence, breaking
//! delay estimation and tap adaptation.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;

use once_cell::sync::OnceCell;

/// Internal sample rate of the bus. AEC and gate code expect this exactly;
/// producers must decimate before pushing.
pub const REF_SAMPLE_RATE: u32 = 16_000;

/// One second of headroom at 16 kHz. Comfortably covers any plausible
/// speaker→mic acoustic delay (typical: 50–150ms) plus jitter introduced by
/// the two DSP threads polling at independent cadences.
const REF_RING_CAPACITY: usize = 16_000;

pub struct EchoReferenceBus {
    inner: Mutex<EchoReferenceInner>,
}

struct EchoReferenceInner {
    /// Most recent samples at 16 kHz, oldest at the front, newest at the back.
    ring: VecDeque<f32>,
    /// Wall-clock time of the most recent push, or `None` if nothing has been
    /// pushed yet. `is_fresh()` returns false for `None` so the consumer can
    /// distinguish "no system audio yet" from "system audio just paused".
    last_push: Option<Instant>,
    /// Total samples ever pushed (monotonic, wraps after a few years; fine).
    total_pushed: u64,
}

static BUS: OnceCell<Arc<EchoReferenceBus>> = OnceCell::new();

/// Return the shared singleton bus. Cheap — clones an Arc.
pub fn instance() -> Arc<EchoReferenceBus> {
    BUS.get_or_init(|| Arc::new(EchoReferenceBus::new())).clone()
}

impl EchoReferenceBus {
    /// Construct an isolated bus. Production code uses `instance()` for the
    /// singleton; tests use this to avoid racing on shared state.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(EchoReferenceInner {
                ring: VecDeque::with_capacity(REF_RING_CAPACITY),
                last_push: None,
                total_pushed: 0,
            }),
        }
    }

    /// Push a block of native-rate f32 samples after decimating to 16 kHz.
    ///
    /// Decimation is naive index-stepping — the same pattern already used in
    /// `silence_suppression::is_voice` for VAD input. It's not anti-aliased,
    /// but for AEC reference signals the energy above 8 kHz is negligible
    /// (laptop speakers roll off well before that) so aliasing is harmless.
    pub fn push_native(&self, native_samples: &[f32], native_sample_rate: u32) {
        if native_samples.is_empty() || native_sample_rate == 0 {
            return;
        }
        let mut inner = match self.inner.lock() {
            Ok(g) => g,
            // Poisoned mutex means another thread panicked while holding the
            // lock — bus state is no longer trustworthy. Drop the push rather
            // than spread the panic.
            Err(_) => return,
        };

        let factor = native_sample_rate as f64 / REF_SAMPLE_RATE as f64;
        if factor <= 1.0 {
            // Source already ≤16 kHz — pass through.
            for &s in native_samples {
                inner.push_one(s);
            }
        } else {
            // Step at the decimation rate. f64 stepping handles non-integer
            // ratios (44100 / 16000 = 2.75625) without drift.
            let mut pos = 0.0_f64;
            while (pos as usize) < native_samples.len() {
                inner.push_one(native_samples[pos as usize]);
                pos += factor;
            }
        }

        inner.last_push = Some(Instant::now());
    }

    /// Copy the most recent samples into `out`, ending `lag_samples` ago
    /// (lag measured at 16 kHz). Returns false if the bus doesn't yet hold
    /// `out.len() + lag_samples` samples.
    ///
    /// Used by the mic-side gate to slide a window over a range of candidate
    /// speaker→mic delays.
    pub fn snapshot(&self, out: &mut [f32], lag_samples: usize) -> bool {
        let inner = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };

        let needed = out.len() + lag_samples;
        if inner.ring.len() < needed {
            return false;
        }

        // VecDeque iteration is contiguous-ish but not guaranteed; iterate
        // explicitly. At 320-sample windows this is trivial.
        let end = inner.ring.len() - lag_samples;
        let start = end - out.len();
        for (i, sample) in inner.ring.iter().skip(start).take(out.len()).enumerate() {
            out[i] = *sample;
        }
        true
    }

    /// True if the bus has been pushed-to within `max_age_ms`. The mic side
    /// gates AEC on freshness — when the system audio capture is paused
    /// (between meetings, while the user is on a settings screen) any echo
    /// in the mic is by definition not coming from us, so the reference is
    /// useless and we should skip both the gate and the engine.
    pub fn is_fresh(&self, max_age_ms: u128) -> bool {
        match self.inner.lock() {
            Ok(g) => match g.last_push {
                Some(t) => t.elapsed().as_millis() <= max_age_ms,
                None => false,
            },
            Err(_) => false,
        }
    }

    pub fn total_pushed(&self) -> u64 {
        self.inner.lock().map(|g| g.total_pushed).unwrap_or(0)
    }

    pub fn reset(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.ring.clear();
            g.last_push = None;
            g.total_pushed = 0;
        }
    }
}

impl EchoReferenceInner {
    fn push_one(&mut self, s: f32) {
        if self.ring.len() == REF_RING_CAPACITY {
            self.ring.pop_front();
        }
        self.ring.push_back(s);
        self.total_pushed = self.total_pushed.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot_roundtrip_at_16k() {
        let bus = EchoReferenceBus::new();
        let in_samples: Vec<f32> = (0..1000).map(|i| i as f32 * 0.001).collect();
        bus.push_native(&in_samples, 16_000);
        let mut out = vec![0.0f32; 100];
        assert!(bus.snapshot(&mut out, 0));
        // Last 100 samples of the input should match the snapshot.
        for i in 0..100 {
            assert!((out[i] - in_samples[900 + i]).abs() < 1e-6);
        }
    }

    #[test]
    fn snapshot_returns_false_before_warmup() {
        let bus = EchoReferenceBus::new();
        let mut out = vec![0.0f32; 320];
        assert!(!bus.snapshot(&mut out, 0));
        bus.push_native(&[0.5; 100], 16_000);
        assert!(!bus.snapshot(&mut out, 0));
    }

    #[test]
    fn decimation_from_48k_yields_third_of_samples() {
        let bus = EchoReferenceBus::new();
        let in_samples: Vec<f32> = (0..3000).map(|i| i as f32).collect();
        bus.push_native(&in_samples, 48_000);
        // 3000 / 3 = 1000 samples should land in the bus.
        assert_eq!(bus.total_pushed(), 1000);
    }

    #[test]
    fn freshness_starts_false_then_flips_after_push() {
        let bus = EchoReferenceBus::new();
        assert!(!bus.is_fresh(1000));
        bus.push_native(&[0.1; 16], 16_000);
        assert!(bus.is_fresh(1000));
    }
}
