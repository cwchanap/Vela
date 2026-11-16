const WAV_HEADER_BYTES = 44;
const PCM_FORMAT = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Wrap headerless PCM16LE mono audio in a 44-byte RIFF/WAVE container.
 * The byte rate and block alignment are derived from `sampleRate` so the
 * declared sizes always match.
 */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('Invalid PCM16LE audio data');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('Invalid WAV sample rate');
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

/**
 * Structural RIFF/WAVE check for provider-returned files: chunks inside the
 * declared RIFF bounds must fit the buffer, a `fmt ` chunk of at least 16
 * bytes (WAVEFORMATEX) and a nonempty `data` chunk must both be present. The
 * fmt fields must be plausible — nonzero channels, sample rate and block
 * alignment, and for PCM the documented block-align/byte-rate relationships —
 * so a well-formed container carrying a corrupt format is still rejected.
 * Ancillary chunks (e.g. C2PA) and bytes beyond the declared RIFF size are
 * skipped, so files with trailing metadata still pass.
 */
export function isValidWav(audio: Buffer): boolean {
  if (
    audio.length < 20 ||
    audio.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    audio.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    return false;
  }
  const riffEnd = 8 + audio.readUInt32LE(4);
  if (riffEnd > audio.length) return false;

  let sawFmt = false;
  let sawData = false;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const chunkId = audio.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkSize > riffEnd - chunkDataStart) return false;
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) return false;
      const channels = audio.readUInt16LE(chunkDataStart + 2);
      const sampleRate = audio.readUInt32LE(chunkDataStart + 4);
      const byteRate = audio.readUInt32LE(chunkDataStart + 8);
      const blockAlign = audio.readUInt16LE(chunkDataStart + 12);
      if (channels === 0 || sampleRate === 0 || blockAlign === 0) return false;
      if (audio.readUInt16LE(chunkDataStart) === PCM_FORMAT) {
        const expectedAlign = (channels * audio.readUInt16LE(chunkDataStart + 14)) / 8;
        if (blockAlign !== expectedAlign || byteRate !== sampleRate * blockAlign) {
          return false;
        }
      }
      sawFmt = true;
    } else if (chunkId === 'data') {
      if (chunkSize === 0) return false;
      sawData = true;
    }
    const chunkEnd = chunkDataStart + chunkSize;
    // RIFF chunks are word-aligned with a pad byte after odd-sized chunks,
    // though some writers omit the final chunk's pad byte from the RIFF size.
    offset = chunkEnd === riffEnd ? riffEnd : chunkEnd + (chunkSize & 1);
  }
  // Chunks must tile the declared bounds exactly; leftover bytes are a
  // truncated chunk header, not trailing metadata (that lives beyond riffEnd).
  if (offset !== riffEnd) return false;
  return sawFmt && sawData;
}
