import { describe, expect, test } from 'bun:test';
import { buildWavBuffer } from '../src/ui/sounds.ts';

describe('buildWavBuffer', () => {
  const spec = { frequencyHz: 440, durationMs: 50, volume: 0.2 };

  test('produces a valid RIFF/WAVE header', () => {
    const wav = buildWavBuffer(spec);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.toString('ascii', 36, 40)).toBe('data');
  });

  test('sizes the data chunk to the duration', () => {
    const sampleRate = 22050;
    const wav = buildWavBuffer(spec, sampleRate);
    const expectedSamples = Math.floor((spec.durationMs / 1000) * sampleRate);
    expect(wav.readUInt32LE(40)).toBe(expectedSamples * 2);
    expect(wav.length).toBe(44 + expectedSamples * 2);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });

  test('encodes 16-bit mono PCM at the requested sample rate', () => {
    const wav = buildWavBuffer(spec);
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt16LE(34)).toBe(16);
  });

  test('starts near silence (attack ramp avoids clicks)', () => {
    const wav = buildWavBuffer(spec);
    expect(Math.abs(wav.readInt16LE(44))).toBeLessThan(1000);
  });
});
