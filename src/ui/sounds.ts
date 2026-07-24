import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from '../config/paths.ts';
import { logger } from '../logger.ts';

/**
 * Soft UI sounds. Tiny sine-blip WAVs are synthesized locally (no assets
 * needed) and played through whatever Linux audio player is available
 * (paplay/pw-play/aplay/ffplay). Fully fire-and-forget: when no player is
 * found or anything fails, the app stays silent and never breaks.
 */

export type SoundKind = 'nav' | 'select' | 'prompt';

/** Tone recipe for one sound. */
export interface SoundSpec {
  frequencyHz: number;
  durationMs: number;
  /** 0..1 peak amplitude. */
  volume: number;
}

const SOUND_SPECS: Record<SoundKind, SoundSpec> = {
  nav: { frequencyHz: 660, durationMs: 35, volume: 0.16 },
  select: { frequencyHz: 990, durationMs: 70, volume: 0.2 },
  prompt: { frequencyHz: 440, durationMs: 55, volume: 0.18 },
};

const SAMPLE_RATE = 22050;

/**
 * Build a 16-bit mono PCM WAV of a soft sine blip: quick attack to avoid
 * clicks, exponential decay so it feels like a gentle "tip".
 */
export function buildWavBuffer(spec: SoundSpec, sampleRate = SAMPLE_RATE): Buffer {
  const sampleCount = Math.floor((spec.durationMs / 1000) * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF/WAVE header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const attackSamples = Math.max(1, Math.floor(sampleCount * 0.1));
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const envelope =
      i < attackSamples
        ? i / attackSamples
        : Math.exp(-((i - attackSamples) / (sampleCount - attackSamples)) * 4);
    const sample = Math.sin(2 * Math.PI * spec.frequencyHz * t) * spec.volume * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  return buffer;
}

let enabled = false;
let player: { command: string; args: string[] } | null = null;
let soundsDir: string | null = null;

function detectPlayer(): { command: string; args: string[] } | null {
  for (const command of ['paplay', 'pw-play', 'aplay']) {
    if (Bun.which(command)) return { command, args: [] };
  }
  if (Bun.which('ffplay')) {
    return { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] };
  }
  return null;
}

function ensureWavFiles(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [kind, spec] of Object.entries(SOUND_SPECS)) {
    const path = join(dir, `${kind}.wav`);
    if (!existsSync(path)) writeFileSync(path, buildWavBuffer(spec));
  }
}

/** Initialize the sound system from the user's preference. Never throws. */
export function initSounds(isEnabled: boolean): void {
  enabled = isEnabled;
  if (!enabled) return;

  try {
    player = detectPlayer();
    if (!player) {
      logger.debug('no audio player found (paplay/pw-play/aplay/ffplay); sounds disabled');
      return;
    }
    soundsDir = join(stateDir(), 'sounds');
    ensureWavFiles(soundsDir);
    logger.debug('sounds initialized', { player: player.command });
  } catch (error) {
    logger.warn('sound initialization failed', { error: String(error) });
    player = null;
    soundsDir = null;
  }
}

/** Toggle sounds at runtime (settings). */
export function setSoundsEnabled(isEnabled: boolean): void {
  if (isEnabled && !enabled) {
    initSounds(true);
    return;
  }
  enabled = isEnabled;
}

/** Play a UI sound. Fire-and-forget; silent no-op when unavailable. */
export function playSound(kind: SoundKind): void {
  if (!enabled || !player || !soundsDir) return;

  try {
    const child = spawn(player.command, [...player.args, join(soundsDir, `${kind}.wav`)], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Sounds must never break the UI.
  }
}
