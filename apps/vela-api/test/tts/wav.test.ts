import { describe, test, expect } from 'bun:test';
import { isValidWav, pcm16ToWav } from '../../src/tts/wav';

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

describe('isValidWav', () => {
  test('accepts a pcm16ToWav file', () => {
    expect(isValidWav(pcm16ToWav(Buffer.from([1, 2, 3, 4]), 24_000))).toBe(true);
  });

  test('accepts an ancillary chunk inside RIFF and trailing bytes beyond it', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    const c2pa = Buffer.alloc(12);
    c2pa.write('c2pa', 0, 'ascii');
    c2pa.writeUInt32LE(4, 4);
    c2pa.writeUInt32LE(0xdeadbeef, 8);
    const inside = Buffer.concat([wav, c2pa]);
    inside.writeUInt32LE(inside.length - 8, 4);
    expect(isValidWav(inside)).toBe(true);

    const trailing = Buffer.concat([wav, Buffer.from('C2PA trailing manifest bytes')]);
    expect(isValidWav(trailing)).toBe(true);
  });

  test('rejects RIFF/WAVE magic with no fmt or data chunks', () => {
    const fake = Buffer.alloc(48);
    fake.write('RIFF', 0, 'ascii');
    fake.writeUInt32LE(40, 4);
    fake.write('WAVE', 8, 'ascii');
    expect(isValidWav(fake)).toBe(false);
  });

  test('rejects a WAV missing either required chunk', () => {
    const noData = Buffer.alloc(36);
    noData.write('RIFF', 0, 'ascii');
    noData.writeUInt32LE(28, 4);
    noData.write('WAVE', 8, 'ascii');
    noData.write('fmt ', 12, 'ascii');
    noData.writeUInt32LE(16, 16);
    expect(isValidWav(noData)).toBe(false);

    const noFmt = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    noFmt.write('JUNK', 12, 'ascii');
    expect(isValidWav(noFmt)).toBe(false);
  });

  test('rejects an undersized fmt chunk or empty data chunk', () => {
    const tinyFmt = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    tinyFmt.writeUInt32LE(8, 16);
    expect(isValidWav(tinyFmt)).toBe(false);

    const emptyData = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    emptyData.writeUInt32LE(0, 40);
    emptyData.writeUInt32LE(emptyData.length - 8 - 2, 4);
    expect(isValidWav(emptyData)).toBe(false);
  });

  test('rejects a fmt chunk whose format fields are corrupt', () => {
    const zeroChannels = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    zeroChannels.writeUInt16LE(0, 22);
    expect(isValidWav(zeroChannels)).toBe(false);

    const zeroRate = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    zeroRate.writeUInt32LE(0, 24);
    expect(isValidWav(zeroRate)).toBe(false);

    const badAlign = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    badAlign.writeUInt16LE(4, 32); // PCM16 mono requires block align 2
    expect(isValidWav(badAlign)).toBe(false);

    const badByteRate = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    badByteRate.writeUInt32LE(96_000, 28); // PCM requires rate x block align
    expect(isValidWav(badByteRate)).toBe(false);
  });

  test('rejects chunks whose declared size exceeds the RIFF bounds', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    wav.writeUInt32LE(wav.length, 40);
    expect(isValidWav(wav)).toBe(false);

    const truncated = pcm16ToWav(Buffer.from([1, 2]), 24_000).subarray(0, 30);
    expect(isValidWav(truncated)).toBe(false);
  });

  test('accepts an odd-sized final chunk when its pad byte is not counted in RIFF size', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    const junk = Buffer.alloc(11);
    junk.write('JUNK', 0, 'ascii');
    junk.writeUInt32LE(3, 4);
    const buf = Buffer.concat([wav, junk]);
    buf.writeUInt32LE(buf.length - 8, 4);
    expect(isValidWav(buf)).toBe(true);
  });

  test('rejects a non-final odd-sized chunk missing its pad byte', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    const junk = Buffer.alloc(11);
    junk.write('JUNK', 0, 'ascii');
    junk.writeUInt32LE(3, 4);
    const tail = Buffer.alloc(12);
    tail.write('LIST', 0, 'ascii');
    tail.writeUInt32LE(4, 4);
    const buf = Buffer.concat([wav, junk, tail]);
    buf.writeUInt32LE(buf.length - 8, 4);
    expect(isValidWav(buf)).toBe(false);
  });

  test('rejects a partial chunk header inside the RIFF bounds', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    const buf = Buffer.concat([wav, Buffer.alloc(4)]);
    buf.writeUInt32LE(buf.length - 8, 4);
    expect(isValidWav(buf)).toBe(false);
  });

  test('accepts an odd-sized ancillary chunk with its pad byte', () => {
    const wav = pcm16ToWav(Buffer.from([1, 2]), 24_000);
    const junk = Buffer.alloc(12);
    junk.write('JUNK', 0, 'ascii');
    junk.writeUInt32LE(3, 4);
    const buf = Buffer.concat([wav, junk]);
    buf.writeUInt32LE(buf.length - 8, 4);
    expect(isValidWav(buf)).toBe(true);
  });

  test('rejects non-RIFF and undersized buffers', () => {
    expect(isValidWav(Buffer.alloc(4))).toBe(false);
    const notWave = Buffer.alloc(48);
    notWave.write('RIFF', 0, 'ascii');
    notWave.write('XXXX', 8, 'ascii');
    expect(isValidWav(notWave)).toBe(false);
  });
});
