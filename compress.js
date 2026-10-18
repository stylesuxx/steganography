// Optional payload compression using the browser's native CompressionStream
// (deflate-raw). DOM-free so tests.html and the main app can both import it.
//
// Compression is applied to the whole opaque payload (UTF-8 text bytes or a
// file container) BEFORE optional AES-GCM encryption, since ciphertext does
// not compress. The "compressed" sentinel flag bit records that this stage
// ran so the decoder knows to inflate.
//
// deflate-raw is chosen over gzip/deflate to avoid the header/footer bytes;
// the sentinel already carries the length, and there is no cross-tool
// interchange requirement.

(function(global) {
  'use strict';

  var FORMAT = 'deflate-raw';

  function isCompressionAvailable() {
    return typeof global.CompressionStream !== 'undefined' &&
           typeof global.DecompressionStream !== 'undefined';
  }

  function requireCompression() {
    if (!isCompressionAvailable()) {
      throw new Error('CompressionStream is not available in this browser.');
    }
  }

  function concatChunks(chunks, total) {
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  // Pumps bytes through a (De)CompressionStream. When maxOutputBytes is a
  // finite number, aborts as soon as the running output exceeds it - this is
  // the decompression-bomb guard (a tiny compressed payload could otherwise
  // inflate to gigabytes).
  async function pump(stream, bytes, maxOutputBytes) {
    var writer = stream.writable.getWriter();
    // Fire-and-forget the write; errors surface on the read side too, but we
    // swallow the writer promise rejection to avoid an unhandled rejection.
    writer.write(bytes).catch(function() {});
    writer.close().catch(function() {});

    var reader = stream.readable.getReader();
    var chunks = [];
    var total = 0;
    var hasCap = typeof maxOutputBytes === 'number' && isFinite(maxOutputBytes);
    try {
      while (true) {
        var res = await reader.read();
        if (res.done) break;
        var chunk = res.value;
        total += chunk.length;
        if (hasCap && total > maxOutputBytes) {
          try { await reader.cancel('output too large'); } catch (e) { /* no-op */ }
          throw new Error('Decompressed data exceeds the maximum allowed size.');
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch (e) { /* no-op */ }
    }
    return concatChunks(chunks, total);
  }

  // Returns deflate-raw-compressed bytes. No size cap on output (compression
  // only shrinks or marginally grows, never explodes).
  async function compress(bytes) {
    requireCompression();
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('compress: input must be a Uint8Array.');
    }
    if (bytes.length === 0) {
      throw new Error('compress: cannot compress empty input.');
    }
    return pump(new global.CompressionStream(FORMAT), bytes, Infinity);
  }

  // Inflates deflate-raw bytes. maxOutputBytes bounds the result to defuse
  // decompression bombs; callers should pass MAX_MESSAGE_LENGTH (the encoder
  // enforces that the pre-compression payload never exceeded it).
  async function decompress(bytes, maxOutputBytes) {
    requireCompression();
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('decompress: input must be a Uint8Array.');
    }
    if (bytes.length === 0) {
      throw new Error('decompress: cannot inflate empty input.');
    }
    return pump(new global.DecompressionStream(FORMAT), bytes, maxOutputBytes);
  }

  var api = {
    isCompressionAvailable: isCompressionAvailable,
    compress: compress,
    decompress: decompress
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.StegCompress = api;
  }
})(typeof self !== 'undefined' ? self : this);
