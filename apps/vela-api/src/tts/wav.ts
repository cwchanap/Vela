const WAV_HEADER_BYTES = 44;
const PCM_FORMAT = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Wrap headerless PCM16LE mono audio in a 44-byte RIFF/WAVE container.
 * `sampleRate` is the only rate we accept from providers (24 kHz); the byte
 * rate and block alignment are derived so the declared sizes always match.
 */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('Invalid PCM16LE audio data');
  }

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(WAV_HEADER_BYTES - 8 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(PCM_FORMAT, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
