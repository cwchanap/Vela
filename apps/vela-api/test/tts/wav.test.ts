import { describe, test, expect } from 'bun:test';
import { pcm16ToWav } from '../../src/tts/wav';

describe('pcm16ToWav', () => {
  test('writes a 44-byte RIFF/WAVE PCM16 mono header with matching chunk sizes', () => {
    const pcm = Buffer.alloc(4_800);
    const wav = pcm16ToWav(pcm, 24_000);

    expect(wav.length).toBe(pcm.length + 44);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(28)).toBe(48_000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  test('uses the requested sample rate in the fmt and byte-rate fields', () => {
    const wav = pcm16ToWav(Buffer.alloc(2), 16_000);

    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000);
  });

  test('rejects empty or odd-length PCM16LE input', () => {
    expect(() => pcm16ToWav(Buffer.alloc(0), 24_000)).toThrow('Invalid PCM16LE');
    expect(() => pcm16ToWav(Buffer.alloc(3), 24_000)).toThrow('Invalid PCM16LE');
  });
});
