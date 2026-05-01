#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use ringbuf::traits::Consumer;

pub mod aec;
pub mod audio_config;
pub mod echo_reference;
pub mod license;
pub mod microphone;
pub mod silence_suppression;
pub mod speaker;

use crate::aec::coordinator as aec_coordinator;
use crate::audio_config::DSP_POLL_MS;
use crate::silence_suppression::{FrameAction, SilenceSuppressionConfig, SilenceSuppressor};

// ============================================================================
// HELPERS — i16 slice → zero-copy LE bytes
// ============================================================================

/// Convert an i16 slice to little-endian bytes.
/// Returns a Vec<u8> suitable for wrapping in napi::Buffer.
#[inline]
fn i16_slice_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    bytes
}

// ============================================================================
// SYSTEM AUDIO CAPTURE (CoreAudio Tap / ScreenCaptureKit on macOS)
// ============================================================================

#[napi]
pub struct SystemAudioCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic sample rate — updated by the background thread once the
    /// native device is initialized. Callers always get the real hardware rate.
    sample_rate: Arc<AtomicU32>,
    device_id: Option<String>,
    /// Optional list of OS PIDs to capture audio from. When non-empty, the macOS
    /// CoreAudio backend builds a per-process tap (kAudioHardwarePropertyTranslatePID...)
    /// so only audio produced by these processes is captured. Empty = whole system mix.
    target_pids: Vec<i32>,
    /// Optional list of bundle-ID prefixes (e.g. "com.google.Chrome", "com.microsoft.teams2").
    /// CoreAudio enumerates every audio process and unions in the ones whose bundle_id
    /// starts with any of these. Solves the Chromium audio-helper problem where the
    /// audio-producing subprocess isn't easily identifiable from `ps`.
    target_bundle_ids: Vec<String>,
}

#[napi]
impl SystemAudioCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        println!("[SystemAudioCapture] Created (device: {:?})", device_id);

        Ok(SystemAudioCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            // Default to 48000 until the background thread reports the real rate.
            // 48kHz is the standard macOS CoreAudio rate.
            sample_rate: Arc::new(AtomicU32::new(48000)),
            device_id,
            target_pids: Vec::new(),
            target_bundle_ids: Vec::new(),
        })
    }

    /// Restrict capture to only the audio produced by the given OS PIDs.
    /// Pass an empty array to revert to whole-device capture. Must be called BEFORE `start()`;
    /// changing PIDs after the capture thread has spawned has no effect until the capture
    /// is destroyed and re-created.
    #[napi]
    pub fn set_target_pids(&mut self, pids: Vec<i32>) {
        println!("[SystemAudioCapture] target_pids set to {:?}", pids);
        self.target_pids = pids;
    }

    /// Restrict capture to processes whose CoreAudio bundle_id starts with any of these
    /// prefixes (e.g. ["com.google.Chrome", "com.microsoft.teams2"]). Combines additively
    /// with `set_target_pids`. Use this to target Chromium-based browsers reliably —
    /// every Chrome audio helper has a `com.google.Chrome.*` bundle id.
    #[napi]
    pub fn set_target_bundle_ids(&mut self, bundle_ids: Vec<String>) {
        println!("[SystemAudioCapture] target_bundle_ids set to {:?}", bundle_ids);
        self.target_bundle_ids = bundle_ids;
    }

    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        // Guard against double-start — prevents spawning concurrent threads
        if self.capture_thread.is_some() {
            return Err(napi::Error::from_reason("Capture already running"));
        }

        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();
        let sample_rate_shared = self.sample_rate.clone();
        let device_id = self.device_id.clone();
        let target_pids = self.target_pids.clone();
        let target_bundle_ids = self.target_bundle_ids.clone();

        // ALL init + DSP runs in background thread — start() returns INSTANTLY
        self.capture_thread = Some(thread::spawn(move || {
            // 1. SpeakerInput Init (takes 5-7 seconds — runs OFF main thread)
            println!("[SystemAudioCapture] Background init starting...");
            let input = match speaker::SpeakerInput::new_with_filter(
                device_id.clone(),
                target_pids.clone(),
                target_bundle_ids.clone(),
            ) {
                Ok(i) => i,
                Err(e) => {
                    println!("[SystemAudioCapture] Init failed: {}. Trying default...", e);
                    // Fall back to whole-device global tap on failure (the per-process tap
                    // can fail on older macOS or if the PID exited between scan and tap).
                    match speaker::SpeakerInput::new(None) {
                        Ok(i) => i,
                        Err(e2) => {
                            let msg = format!(
                                "[SystemAudioCapture] FATAL: All init attempts failed: {}",
                                e2
                            );
                            eprintln!("{}", msg);
                            // Notify JS so it can emit 'error' and reset isRecording
                            tsfn.call(
                                Err(napi::Error::from_reason(msg)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                            return;
                        }
                    }
                }
            };

            let mut stream = input.stream();
            let mut consumer = match stream.take_consumer() {
                Some(c) => c,
                None => {
                    eprintln!("[SystemAudioCapture] FATAL: Failed to get consumer");
                    return;
                }
            };

            let native_rate = stream.sample_rate();
            // Publish the real native rate so JS can read it via get_sample_rate()
            sample_rate_shared.store(native_rate, Ordering::Release);
            println!(
                "[SystemAudioCapture] Background init complete. Initial Rate: {}Hz. DSP starting.",
                native_rate
            );

            // 2. DSP loop with silence suppression + WebRTC VAD
            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: native_rate,
                ..SilenceSuppressionConfig::for_system_audio()
            });

            // Echo-reference bus: the AEC pipeline on the mic side reads
            // recent system-audio samples to detect speaker bleed. Push the
            // raw f32 batch (pre-suppression) so the reference matches what
            // actually played through the speakers.
            let coordinator = aec_coordinator();

            // 20ms chunks at native rate (e.g. 960 samples at 48kHz)
            let chunk_size = (native_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // Drain ALL available samples from ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // Publish to the echo-reference bus before any processing.
                // The mic-side AEC needs the unprocessed render signal; if we
                // ran silence suppression first, the bus would have gaps the
                // AEC delay estimator and adaptive filter would misread.
                if !raw_batch.is_empty() {
                    coordinator.push_render(&raw_batch, native_rate);
                }

                // Convert f32 -> i16 at native sample rate
                if !raw_batch.is_empty() {
                    for &f in &raw_batch {
                        let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                        frame_buffer.push(scaled as i16);
                    }
                    raw_batch.clear();
                }

                // Process in 20ms chunks through the two-stage gate
                while frame_buffer.len() >= chunk_size {
                    let frame: Vec<i16> = frame_buffer.drain(0..chunk_size).collect();

                    let (action, speech_ended) = suppressor.process(&frame);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            tsfn.call(
                                Ok(Buffer::from(bytes)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                        FrameAction::SendSilence => {
                            // Send zero-filled buffer to keep streaming APIs alive
                            let silence = vec![0u8; chunk_size * 2];
                            tsfn.call(
                                Ok(Buffer::from(silence)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                        FrameAction::Suppress => {
                            // Do nothing — bandwidth saving
                        }
                    }

                    // Fire speech_ended callback on the exact transition frame
                    if speech_ended {
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                // Keep the sleep small so we quickly read the ring buffer
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            println!("[SystemAudioCapture] DSP thread stopped.");
            // stream is dropped here → SpeakerStream::Drop calls stop_with_ch
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[napi(object)]
#[derive(Default)]
pub struct AudioProcessInfo {
    /// CoreAudio AudioObjectID for this process (used internally by macOS taps).
    pub object_id: u32,
    /// OS PID of the process. -1 if unavailable.
    pub pid: i32,
    /// Bundle identifier (e.g. "com.google.Chrome.helper.audio") if available.
    pub bundle_id: Option<String>,
    /// True when the process is actively producing audio output right now.
    pub running_output: bool,
}

/// Enumerate every CoreAudio process object on the system. Each entry corresponds
/// to a process that has registered with CoreAudio (typically because it has at
/// some point opened an audio session). Use this to power a UI picker for
/// per-process audio capture — much more reliable than `ps` because Chromium's
/// audio-producing helper subprocess only shows up here.
///
/// Returns an empty list on non-macOS or if the CoreAudio API call fails.
#[cfg(target_os = "macos")]
#[napi]
pub fn list_audio_processes() -> Vec<AudioProcessInfo> {
    use cidre::core_audio as ca;
    let processes = match ca::hardware::Process::list() {
        Ok(p) => p,
        Err(e) => {
            println!("[list_audio_processes] failed to enumerate: {:?}", e);
            return Vec::new();
        }
    };
    let mut out = Vec::with_capacity(processes.len());
    for proc_obj in processes {
        let object_id = (*proc_obj).0;
        if object_id == 0 {
            continue;
        }
        let pid = proc_obj.pid().unwrap_or(0) as i32;
        let bundle_id = proc_obj.bundle_id().ok().map(|s| s.to_string());
        let running_output = proc_obj.is_running_output().unwrap_or(false);
        out.push(AudioProcessInfo {
            object_id,
            pid,
            bundle_id,
            running_output,
        });
    }
    out
}

#[cfg(not(target_os = "macos"))]
#[napi]
pub fn list_audio_processes() -> Vec<AudioProcessInfo> {
    Vec::new()
}

// ============================================================================
// MICROPHONE CAPTURE (CPAL)
//
// Design: The MicrophoneStream (CPAL handle) is recreated on every start()
// call. This guarantees the ring buffer consumer is always fresh, allowing
// seamless stop→start restart cycles (e.g. between meetings).
// ============================================================================

#[napi]
pub struct MicrophoneCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic sample rate — updated once the CPAL device is opened.
    sample_rate: Arc<AtomicU32>,
    /// Stores the requested device ID for recreation on restart.
    device_id: Option<String>,
    /// Holds the live CPAL stream. Recreated on each start().
    input: Option<microphone::MicrophoneStream>,
    /// When true, the next stream creation routes through Apple's voice
    /// processing AU (AEC + AGC + NS) instead of the cpal path. macOS-only;
    /// no-op fallback elsewhere.
    enable_voice_processing: bool,
}

#[napi]
impl MicrophoneCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        // Eagerly create the stream to detect device errors early and read the
        // native sample rate.
        let input = match microphone::MicrophoneStream::new(device_id.clone()) {
            Ok(i) => i,
            Err(e) => return Err(napi::Error::from_reason(format!("Failed: {}", e))),
        };

        let native_rate = input.sample_rate();
        println!(
            "[MicrophoneCapture] Initialized. Device: {:?}, Rate: {}Hz",
            device_id, native_rate
        );

        Ok(MicrophoneCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            sample_rate: Arc::new(AtomicU32::new(native_rate)),
            device_id,
            input: Some(input),
            enable_voice_processing: false,
        })
    }

    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    /// Toggle Apple voice processing (AEC + AGC + NS) for this capture.
    ///
    /// The flag takes effect on the next `start()` call. If the underlying
    /// stream is already running we tear it down and recreate it on the new
    /// backend so the change is observable immediately — interview overlays
    /// commonly toggle this from the Settings panel mid-session.
    #[napi]
    pub fn set_voice_processing(&mut self, enabled: bool) -> napi::Result<()> {
        if self.enable_voice_processing == enabled {
            return Ok(());
        }
        println!(
            "[MicrophoneCapture] Voice processing {} via napi (was {}).",
            if enabled { "ENABLED" } else { "DISABLED" },
            if self.enable_voice_processing { "on" } else { "off" }
        );
        self.enable_voice_processing = enabled;

        // Drop any existing stream so the next start() rebuilds it on the
        // chosen backend. The DSP thread (if running) is unaffected — its
        // consumer is held independently and will see end-of-stream when the
        // backend changes.
        self.input = None;
        Ok(())
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();

        // If the stream was consumed by a previous start() cycle (or torn
        // down by a voice-processing toggle), recreate it on the currently
        // selected backend.
        if self.input.is_none() {
            println!(
                "[MicrophoneCapture] Recreating stream for restart (AEC={})...",
                self.enable_voice_processing
            );
            match microphone::MicrophoneStream::new_with_options(
                self.device_id.clone(),
                self.enable_voice_processing,
            ) {
                Ok(i) => {
                    let rate = i.sample_rate();
                    self.sample_rate.store(rate, Ordering::Release);
                    self.input = Some(i);
                }
                Err(e) => {
                    return Err(napi::Error::from_reason(format!(
                        "[MicrophoneCapture] Failed to recreate stream: {}",
                        e
                    )));
                }
            }
        }

        let input_ref = self
            .input
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("Input missing"))?;

        input_ref
            .play()
            .map_err(|e| napi::Error::from_reason(format!("{}", e)))?;

        let native_rate = input_ref.sample_rate();
        self.sample_rate.store(native_rate, Ordering::Release);

        let mut consumer = input_ref
            .take_consumer()
            .ok_or_else(|| napi::Error::from_reason("Failed to get consumer"))?;

        // DSP thread with silence suppression + WebRTC VAD
        self.capture_thread = Some(thread::spawn(move || {
            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: native_rate,
                ..SilenceSuppressionConfig::for_microphone()
            });

            // AEC coordinator: every 20ms mic frame is checked for echo
            // against the recent system-audio reference before silence
            // suppression. Frames flagged as echo never reach STT.
            let coordinator = aec_coordinator();

            // 20ms chunks at native rate
            let chunk_size = (native_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);
            // Reusable f32 view of the current i16 frame for the AEC call.
            // Allocated once to keep the hot loop free of per-frame heap churn.
            let mut frame_f32: Vec<f32> = Vec::with_capacity(chunk_size);
            // Pre-allocated zero frame fed to the silence suppressor when AEC
            // flags echo. We can't just `continue` on AEC suppression: that
            // skips the suppressor's keepalive cadence, and 5+ seconds without
            // a frame causes streaming STT WebSockets (Deepgram, OpenAI) to
            // time out. Feeding zeros lets the suppressor keep emitting
            // SendSilence at its normal interval while the actual echo audio
            // never reaches STT.
            let silence_frame: Vec<i16> = vec![0; chunk_size];

            println!("[MicrophoneCapture] DSP thread started (VAD + suppression active, rate={}Hz, chunk={})", native_rate, chunk_size);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // 1. Drain ALL available samples from ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // 2. Convert f32 -> i16 at native sample rate
                if !raw_batch.is_empty() {
                    for &f in &raw_batch {
                        let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                        frame_buffer.push(scaled as i16);
                    }
                    raw_batch.clear();
                }

                // 3. Process in 20ms chunks through the two-stage gate
                while frame_buffer.len() >= chunk_size {
                    let frame: Vec<i16> = frame_buffer.drain(0..chunk_size).collect();

                    // ── AEC stage ────────────────────────────────────────
                    // Convert i16 → f32 once for the AEC call. The
                    // coordinator decimates internally to 16 kHz; we hand it
                    // native-rate samples so the gate's lag math stays in
                    // wall-clock time without us having to track rate
                    // conversions out here.
                    frame_f32.clear();
                    frame_f32.extend(frame.iter().map(|&s| s as f32 / 32768.0));
                    let metrics = coordinator.process_capture(&frame_f32, native_rate);

                    // Feed the suppressor either the real frame or a silent
                    // stand-in. AEC-flagged frames go through as silence so:
                    //  1. The suppressor's state machine ticks correctly
                    //     (timing-continuity for STT keepalives is preserved
                    //     even during multi-second sustained echo).
                    //  2. STT receives only zero-valued audio for the
                    //     suppressed period, never the actual echo waveform.
                    //  3. The adaptive noise-floor EMA may drift toward zero
                    //     during long echo bursts, but the
                    //     `adaptive_min_floor` clamp (20.0) keeps the
                    //     threshold sane for the next real frame.
                    let frame_for_suppressor: &[i16] = if metrics.suppress_as_echo {
                        &silence_frame
                    } else {
                        &frame
                    };

                    let (action, speech_ended) = suppressor.process(frame_for_suppressor);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            tsfn.call(
                                Ok(Buffer::from(bytes)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                        FrameAction::SendSilence => {
                            let silence = vec![0u8; chunk_size * 2];
                            tsfn.call(
                                Ok(Buffer::from(silence)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                        }
                        FrameAction::Suppress => {
                            // Do nothing
                        }
                    }

                    if speech_ended {
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                // 4. Short sleep
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            println!("[MicrophoneCapture] DSP thread stopped.");
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
        // Pause and destroy the stream so start() recreates it fresh on
        // whichever backend is currently selected.
        if let Some(ref mut input) = self.input {
            let _ = input.pause();
        }
        self.input = None;
    }
}

// ============================================================================
// DEVICE ENUMERATION
// ============================================================================

#[napi(object)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[napi]
pub fn get_input_devices() -> Vec<AudioDeviceInfo> {
    match microphone::list_input_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_input_devices] Error: {}", e);
            Vec::new()
        }
    }
}

#[napi]
pub fn get_output_devices() -> Vec<AudioDeviceInfo> {
    match speaker::list_output_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_output_devices] Error: {}", e);
            Vec::new()
        }
    }
}

// ============================================================================
// ACOUSTIC ECHO CANCELLATION (AEC) — controls + metrics
//
// The AEC pipeline (cross-correlation gate + NLMS adaptive filter) is wired
// into the system-audio and microphone DSP loops above. The gate runs
// whenever the echo-reference bus is fresh; the NLMS engine is opt-in via
// `setAecEnabled`. JS reads `getAecMetrics` to surface diagnostics in the UI.
// ============================================================================

/// Snapshot of the AEC pipeline's current state and counters.
/// All numeric fields refer to the most recent processed mic frame; counters
/// are session-wide (reset by `resetAecState`).
#[napi(object)]
pub struct AecMetrics {
    /// Whether the stage-2 NLMS engine is active. Stage 1 (cross-correlation
    /// gate) is always on when reference audio is fresh.
    pub enabled: bool,
    /// Total mic frames processed since last reset.
    pub frames_processed: f64,
    /// Subset of `frames_processed` that were dropped as echo before STT.
    pub frames_suppressed_as_echo: f64,
    /// Smoothed peak normalized cross-correlation (0–1) from the last frame.
    pub last_correlation_peak: f64,
    /// Estimated speaker→mic delay (ms) at the last correlation peak.
    pub last_delay_estimate_ms: f64,
    /// Last-frame echo return loss enhancement (dB). Larger = better
    /// cancellation. Only meaningful when `enabled` is true.
    pub last_echo_return_loss_db: f64,
    /// Last-frame residual energy as a fraction of input energy (0–1).
    /// Only meaningful when `enabled` is true.
    pub last_residual_ratio: f64,
}

/// Toggle the stage-2 NLMS adaptive AEC engine.
///
/// When true, the mic DSP loop runs an adaptive filter against the system
/// audio reference and uses combined (correlation + ERLE) criteria to drop
/// echo frames. When false, only the always-on cross-correlation gate runs.
///
/// Stage 1 (gate) is permanent — there is no setting to disable it because
/// it costs essentially nothing and never hurts. Stage 2 is toggleable
/// because the NLMS filter consumes more CPU and a future user might want
/// to disable it for power reasons or A/B testing.
#[napi]
pub fn set_aec_enabled(enabled: bool) {
    aec::coordinator().set_aec_enabled(enabled);
}

/// Read the AEC pipeline's current state and last-frame metrics.
#[napi]
pub fn get_aec_metrics() -> AecMetrics {
    let snap = aec::coordinator().snapshot_metrics();
    AecMetrics {
        enabled: snap.enabled,
        // f64 cast: NAPI doesn't have a u64 type; counters reset before they
        // could exceed f64's exact-integer range (2^53) so this is lossless.
        frames_processed: snap.frames_processed as f64,
        frames_suppressed_as_echo: snap.frames_suppressed_as_echo as f64,
        last_correlation_peak: snap.last_correlation_peak as f64,
        last_delay_estimate_ms: snap.last_delay_estimate_ms as f64,
        last_echo_return_loss_db: snap.last_echo_return_loss_db as f64,
        last_residual_ratio: snap.last_residual_ratio as f64,
    }
}

/// Reset the AEC pipeline. Clears the reference bus, recreates the gate and
/// (if enabled) the NLMS engine with fresh taps, and zeros all counters.
/// Called between meetings — the previous session's filter taps modeled a
/// specific room/volume configuration and would mistrain on a new one.
#[napi]
pub fn reset_aec_state() {
    aec::coordinator().reset();
}
