// Low-level Web Audio synthesis primitives shared by every sound in
// client/src/audio/soundManager.ts (EPIC 14 "Procedural Sound System" Story
// 14.1). Two building blocks — a short tone player (oscillator + gain
// envelope, optionally frequency-ramped) and a noise-burst player (a REUSED
// noise AudioBuffer + filter + gain envelope) — both self-cleaning: every
// node is disconnected once its envelope finishes (`onended`), so a long
// play session never accumulates unbounded AudioNode garbage. No new
// dependency: everything here is native Web Audio API only (OscillatorNode,
// AudioBufferSourceNode, BiquadFilterNode, GainNode).
//
// The "generate expensive things once, not per-play/per-frame" discipline
// mirrors EPIC 10's buildWallTextures()/buildSkyDome() (client/src/
// textures.ts) — here, that's the noise AudioBuffer (buildNoiseBuffer()
// below), built exactly once by SoundManager's constructor and passed into
// every playNoiseBurst() call, never rebuilt per play.

/** Options for playTone() — a single oscillator through a gain envelope. */
export interface ToneOptions {
  type: OscillatorType;
  /** Starting frequency, Hz. */
  frequency: number;
  /**
   * Ending frequency, Hz — if present and different from `frequency`, the
   * oscillator's frequency is exponentially ramped across the sound's
   * duration (used for the jump grunt's downward "ух" pitch drop and the
   * hit-taken sound's descending tone). Omit for a flat, unramped tone.
   */
  endFrequency?: number;
  durationSeconds: number;
  /**
   * Peak linear gain at the envelope's attack, before decay. Kept well
   * under 1.0 for every sound in this project's table (see SoundManager's
   * per-sound constants) — the master chain's own DynamicsCompressorNode
   * (Design Decision 6) is a safety net against overlap, not the sole
   * anti-clipping mechanism, so individual sounds still shouldn't be
   * authored at full gain.
   */
  peakGain: number;
  /** Attack time, seconds. Defaults to a short, near-percussive attack. */
  attackSeconds?: number;
}

/** Options for playNoiseBurst() — the shared noise buffer through a filter + gain envelope. */
export interface NoiseOptions {
  durationSeconds: number;
  peakGain: number;
  /** Shapes the raw white noise into the desired character — e.g. a high-pass filter for a sharp pistol crack, a low-pass filter for a dull footstep thud. */
  filterType: BiquadFilterType;
  filterFrequency: number;
  filterQ?: number;
  attackSeconds?: number;
  /**
   * Playback rate applied to the shared noise buffer — used by the
   * footstep system's per-step pitch randomization (Story 14.3) to vary a
   * noise-based sound's perceived pitch without needing a second buffer.
   * Defaults to 1 (unmodified).
   */
  playbackRate?: number;
}

/**
 * Build ONE reusable white-noise AudioBuffer, `seconds` long at the
 * context's own sample rate. Called exactly once, from SoundManager's
 * constructor — every noise-based sound (jump grunt, footstep, all three
 * gunshots, hit-taken) plays FROM this same buffer via playNoiseBurst()
 * below, never regenerating it. `seconds` only needs to comfortably exceed
 * the longest noise-burst duration in the sound-design table (the grenade
 * launcher's ~300ms) even after playbackRate down-pitching (a slower
 * playback rate "consumes" buffer time faster than wall-clock time) — 1
 * full second leaves generous headroom for every current and
 * plausible-future use.
 */
export function buildNoiseBuffer(context: AudioContext, seconds = 1): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const buffer = context.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Play a short oscillator tone through a linear-attack /
 * exponential-decay gain envelope into `destination`. Self-cleaning: the
 * oscillator and gain node disconnect themselves once playback ends.
 */
export function playTone(context: AudioContext, destination: AudioNode, options: ToneOptions): void {
  const now = context.currentTime;
  const attack = options.attackSeconds ?? 0.005;
  const duration = options.durationSeconds;

  const oscillator = context.createOscillator();
  oscillator.type = options.type;
  oscillator.frequency.setValueAtTime(Math.max(1, options.frequency), now);
  if (options.endFrequency !== undefined && options.endFrequency !== options.frequency) {
    // exponentialRampToValueAtTime requires a strictly-positive target.
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFrequency), now + duration);
  }

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(options.peakGain, now + attack);
  // exponentialRampToValueAtTime can't target exactly 0 — ramp to a tiny
  // near-zero value, which is inaudible and avoids a click at cutoff.
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

/**
 * Play a filtered burst from the shared noise buffer through a
 * linear-attack / exponential-decay gain envelope into `destination`.
 * Self-cleaning, same discipline as playTone() above.
 */
export function playNoiseBurst(
  context: AudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  options: NoiseOptions,
): void {
  const now = context.currentTime;
  const attack = options.attackSeconds ?? 0.004;
  const duration = options.durationSeconds;

  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.playbackRate.value = options.playbackRate ?? 1;
  source.loop = false;

  const filter = context.createBiquadFilter();
  filter.type = options.filterType;
  filter.frequency.value = options.filterFrequency;
  if (options.filterQ !== undefined) filter.Q.value = options.filterQ;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(options.peakGain, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  source.start(now);
  source.stop(now + duration + 0.02);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}
