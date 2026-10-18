// Shared constants and helpers. Loaded both by index.html (regular <script>)
// and by workers via importScripts('constants.js'). No DOM or app-specific
// state - safe to import from crypto.js and from tests.

// v3 sentinel layout:
//   bits 0-15  magic (0xAA55)
//   bits 16-19 LSB mode (1-4)
//   bits 20-23 flags (0000 plaintext, 1000 encrypted; others reserved)
//   bits 24-55 payload length (bytes, big-endian)
var SENTINEL_BITS = 56;
var SENTINEL_PIXELS = 19;                // ceil(56 / 3) pixels needed
var SENTINEL_BYTES = 7;                  // 56 bits packed MSB-first

var MAGIC_V3 = '1010101001010101';       // 0xAA55 as bitstring
var MAGIC_BYTES = [0xAA, 0x55];

var MIN_LSB_BITS = 1;
var MAX_LSB_BITS = 4;

// 4-bit flags field (sentinel bits 20-23), MSB-first as a string:
//   bit 20 (index 0) = encrypted
//   bit 21 (index 1) = compressed (deflate-raw, applied before encryption)
//   bits 22-23       = reserved, must be 0
var FLAGS_PLAINTEXT = '0000';
var FLAGS_ENCRYPTED = '1000';            // bit 20 = "encrypted"
var FLAGS_COMPRESSED = '0100';           // bit 21 = "compressed"
var FLAGS_ENCRYPTED_COMPRESSED = '1100'; // both

// Build the 4-char flags string from booleans. Keeps bits 22-23 zero.
function composeFlags(encrypted, compressed) {
  return (encrypted ? '1' : '0') + (compressed ? '1' : '0') + '00';
}

var MAX_MESSAGE_LENGTH = 10000000;       // 10MB plaintext byte limit (UTF-8)
var MAX_THEORETICAL_EMBED_CAPACITY_BYTES = 150000000;  // ~150MB safety cap

// Encryption payload layout (v1):
//   version (1) | salt (16) | iv (12) | ciphertext + GCM tag (n + 16)
var ENCRYPTION_PAYLOAD_VERSION = 1;
var PBKDF2_ITERATIONS = 600000;          // OWASP 2023 recommendation
var SALT_BYTES = 16;
var IV_BYTES = 12;
var GCM_TAG_BYTES = 16;
var ENCRYPTION_HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES;    // 29
var ENCRYPTION_OVERHEAD_BYTES = ENCRYPTION_HEADER_BYTES + GCM_TAG_BYTES;  // 45
var ENCRYPTION_MIN_PAYLOAD_BYTES = ENCRYPTION_OVERHEAD_BYTES + 1;         // 46

// File-container framing (payload-level, below LSB + crypto layers).
//
// A payload that starts with FILE_CONTAINER_MAGIC is a hidden file;
// anything else is treated as a UTF-8 text message. The magic bytes
// 0xF1 0x1E 0x00 0x01 are deliberately invalid as a UTF-8 start sequence
// (0xF1 is a 4-byte start, which requires 3 continuation bytes 10xxxxxx -
// 0x1E and 0x00 are not continuation bytes), so a legitimate UTF-8 text
// payload can never collide with the file magic.
//
// Container layout (version 1):
//   bytes 0-3       magic (0xF1 0x1E 0x00 0x01)
//   byte  4         container version (0x01)
//   byte  5         reserved / flags (must be 0x00 in v1)
//   bytes 6-7       filename length N  (big-endian u16)
//   bytes 8..8+N    filename (UTF-8, no NUL terminator)
//   next 2 bytes    MIME-type length M (big-endian u16)
//   next M bytes    MIME type (UTF-8, no NUL terminator)
//   next 4 bytes    CRC32 of the raw file bytes (big-endian)
//   remainder       raw file bytes
var FILE_CONTAINER_MAGIC = [0xF1, 0x1E, 0x00, 0x01];
var FILE_CONTAINER_VERSION = 1;
var FILE_CONTAINER_FIXED_OVERHEAD = 14;  // 4 magic + 1 ver + 1 flags + 2 fn-len + 2 mime-len + 4 crc
var FILE_CONTAINER_MAX_FILENAME_BYTES = 1024;
var FILE_CONTAINER_MAX_MIME_BYTES = 256;

// Valid flags: encrypted (bit 20) and/or compressed (bit 21) may be set;
// reserved bits 22-23 must be zero. Accepts 0000, 0100, 1000, 1100.
function isValidFlags(flags) {
  return typeof flags === 'string' && /^[01][01]00$/.test(flags);
}

// Classic CRC-32 (IEEE 802.3 / zlib polynomial 0xEDB88320). DOM-free; used
// by the file container for a cheap integrity check that catches LSB
// corruption from re-encodes (resize, re-save, etc.).
var _CRC32_TABLE = null;
function _crc32Table() {
  if (_CRC32_TABLE) return _CRC32_TABLE;
  var table = new Uint32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  _CRC32_TABLE = table;
  return table;
}
function crc32(bytes) {
  var table = _crc32Table();
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) {
    c = (table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Quick sniff - cheap enough to run on every decoded payload.
function hasFileContainerMagic(bytes) {
  if (!bytes || bytes.length < FILE_CONTAINER_FIXED_OVERHEAD) return false;
  for (var i = 0; i < FILE_CONTAINER_MAGIC.length; i++) {
    if (bytes[i] !== FILE_CONTAINER_MAGIC[i]) return false;
  }
  return true;
}

var _CONTAINER_UTF8_ENCODER = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
var _CONTAINER_UTF8_DECODER = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8', { fatal: true }) : null;

// Returns the Uint8Array that becomes the opaque payload fed to the LSB
// engine (and optionally the AES-GCM layer). Caller supplies the raw file
// bytes plus any filename / MIME they want preserved on decode.
function buildFileContainer(fileBytes, filename, mimeType) {
  if (!_CONTAINER_UTF8_ENCODER) {
    throw new Error('TextEncoder is not available in this environment.');
  }
  if (!(fileBytes instanceof Uint8Array)) {
    throw new Error('buildFileContainer: fileBytes must be a Uint8Array.');
  }
  if (fileBytes.length === 0) {
    throw new Error('buildFileContainer: cannot hide an empty file.');
  }
  var fnStr = (typeof filename === 'string' && filename.length > 0) ? filename : 'secret.bin';
  var mimeStr = (typeof mimeType === 'string' && mimeType.length > 0) ? mimeType : 'application/octet-stream';
  var fnBytes = _CONTAINER_UTF8_ENCODER.encode(fnStr);
  var mimeBytes = _CONTAINER_UTF8_ENCODER.encode(mimeStr);
  if (fnBytes.length > FILE_CONTAINER_MAX_FILENAME_BYTES) {
    throw new Error('Filename is too long (' + fnBytes.length + ' bytes; max ' +
                    FILE_CONTAINER_MAX_FILENAME_BYTES + ').');
  }
  if (mimeBytes.length > FILE_CONTAINER_MAX_MIME_BYTES) {
    throw new Error('MIME type is too long (' + mimeBytes.length + ' bytes; max ' +
                    FILE_CONTAINER_MAX_MIME_BYTES + ').');
  }

  var total = FILE_CONTAINER_FIXED_OVERHEAD + fnBytes.length + mimeBytes.length + fileBytes.length;
  var out = new Uint8Array(total);
  var p = 0;
  out[p++] = FILE_CONTAINER_MAGIC[0];
  out[p++] = FILE_CONTAINER_MAGIC[1];
  out[p++] = FILE_CONTAINER_MAGIC[2];
  out[p++] = FILE_CONTAINER_MAGIC[3];
  out[p++] = FILE_CONTAINER_VERSION;
  out[p++] = 0x00;                                   // reserved
  out[p++] = (fnBytes.length >>> 8) & 0xFF;
  out[p++] = fnBytes.length & 0xFF;
  out.set(fnBytes, p); p += fnBytes.length;
  out[p++] = (mimeBytes.length >>> 8) & 0xFF;
  out[p++] = mimeBytes.length & 0xFF;
  out.set(mimeBytes, p); p += mimeBytes.length;
  var crc = crc32(fileBytes);
  out[p++] = (crc >>> 24) & 0xFF;
  out[p++] = (crc >>> 16) & 0xFF;
  out[p++] = (crc >>> 8) & 0xFF;
  out[p++] = crc & 0xFF;
  out.set(fileBytes, p);
  return out;
}

// Returns { version, filename, mimeType, storedCrc, fileBytes, crcValid }.
// Throws for any structural problem - caller treats a throw as "not a valid
// container" (and typically falls back to UTF-8 text decoding).
function parseFileContainer(bytes) {
  if (!_CONTAINER_UTF8_DECODER) {
    throw new Error('TextDecoder is not available in this environment.');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('parseFileContainer: bytes must be a Uint8Array.');
  }
  if (!hasFileContainerMagic(bytes)) {
    throw new Error('Not a file container (magic mismatch).');
  }
  var p = FILE_CONTAINER_MAGIC.length;
  var version = bytes[p++];
  if (version !== FILE_CONTAINER_VERSION) {
    throw new Error('Unsupported file-container version: ' + version + '.');
  }
  // Reserved byte; must be zero in v1.
  var reserved = bytes[p++];
  if (reserved !== 0x00) {
    throw new Error('Reserved file-container flags must be zero in v1.');
  }
  if (bytes.length < p + 2) throw new Error('Truncated file container (filename length).');
  var fnLen = (bytes[p] << 8) | bytes[p + 1]; p += 2;
  if (fnLen > FILE_CONTAINER_MAX_FILENAME_BYTES) {
    throw new Error('Filename length exceeds maximum.');
  }
  if (bytes.length < p + fnLen + 2) throw new Error('Truncated file container (filename).');
  var fnBytes = bytes.subarray(p, p + fnLen); p += fnLen;
  var mimeLen = (bytes[p] << 8) | bytes[p + 1]; p += 2;
  if (mimeLen > FILE_CONTAINER_MAX_MIME_BYTES) {
    throw new Error('MIME length exceeds maximum.');
  }
  if (bytes.length < p + mimeLen + 4) throw new Error('Truncated file container (mime).');
  var mimeBytes = bytes.subarray(p, p + mimeLen); p += mimeLen;
  var storedCrc = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  p += 4;
  var fileBytes = bytes.subarray(p);                 // may legitimately be empty? we reject
  if (fileBytes.length === 0) {
    throw new Error('File container has empty file body.');
  }
  var filename, mimeType;
  try {
    filename = _CONTAINER_UTF8_DECODER.decode(fnBytes);
    mimeType = _CONTAINER_UTF8_DECODER.decode(mimeBytes);
  } catch (utf8Err) {
    throw new Error('File container has invalid UTF-8 metadata.');
  }
  var actualCrc = crc32(fileBytes);
  return {
    version: version,
    filename: sanitizeContainerFilename(filename),
    mimeType: sanitizeContainerMimeType(mimeType),
    storedCrc: storedCrc,
    fileBytes: fileBytes,
    crcValid: actualCrc === storedCrc
  };
}

// Strips path separators, control characters, and bidi overrides so the
// stored filename cannot be used to redirect downloads or spoof visually.
// Keeps spaces and most Unicode intact.
function sanitizeContainerFilename(name) {
  if (typeof name !== 'string' || name.length === 0) return 'secret.bin';
  // Drop path separators and NUL / control bytes; strip bidi overrides.
  var cleaned = name
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
  if (cleaned.length === 0) return 'secret.bin';
  // Reject implicit directory traversals.
  if (cleaned === '.' || cleaned === '..') return 'secret.bin';
  // Cap length so UI stays reasonable.
  if (cleaned.length > 255) cleaned = cleaned.slice(0, 255);
  return cleaned;
}

// Keeps the MIME type to a conservative subset: ASCII, no control chars, no
// quotes. Falls back to octet-stream on anything questionable so Blob() /
// save pickers never choke.
function sanitizeContainerMimeType(mime) {
  if (typeof mime !== 'string' || mime.length === 0) return 'application/octet-stream';
  var trimmed = mime.trim();
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return 'application/octet-stream';
  if (/["\\]/.test(trimmed)) return 'application/octet-stream';
  if (trimmed.length > 128) return 'application/octet-stream';
  return trimmed;
}

function getBit(bytes, bitIndex) {
  return (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
}

function getBits(bytes, bitIndex, n) {
  var result = 0;
  for (var i = 0; i < n; i++) result = (result << 1) | getBit(bytes, bitIndex + i);
  return result;
}

// Reads the 56 1-LSB sentinel bits from the first 19 pixels of RGBA pixel
// data. Returns the parsed fields plus a flagsValid guard - callers must
// reject sentinels where isV3 is true but flagsValid is false.
function parseSentinelFromPixels(pixel) {
  var bitsArr = [];
  for (var i = 0; i < SENTINEL_PIXELS * 4 && bitsArr.length < SENTINEL_BITS; i += 4) {
    for (var offset = 0; offset < 3; offset++) {
      bitsArr.push((pixel[i + offset] & 1).toString());
      if (bitsArr.length >= SENTINEL_BITS) break;
    }
  }
  var bits = bitsArr.join('');
  var magic = bits.substring(0, 16);
  var isV3 = magic === MAGIC_V3;
  var lsbBits = isV3 ? parseInt(bits.substring(16, 20), 2) : 1;
  var flags = isV3 ? bits.substring(20, 24) : FLAGS_PLAINTEXT;
  var messageLength = isV3 ? parseInt(bits.substring(24, 56), 2) : 0;
  return {
    isV3: isV3,
    lsbBits: lsbBits,
    flags: flags,
    flagsValid: isV3 && isValidFlags(flags),
    isEncrypted: isV3 && flags.charAt(0) === '1',
    isCompressed: isV3 && flags.charAt(1) === '1',
    messageLength: messageLength
  };
}

// Produces the canonical 7-byte sentinel for GCM additional data. Encode
// and decode both call this with the same inputs so the AAD matches.
function buildSentinelBytes(lsbBits, flags, messageLength) {
  if (!Number.isInteger(lsbBits) || lsbBits < MIN_LSB_BITS || lsbBits > MAX_LSB_BITS) {
    throw new Error('buildSentinelBytes: invalid lsbBits');
  }
  if (!isValidFlags(flags)) {
    throw new Error('buildSentinelBytes: invalid flags');
  }
  if (!Number.isSafeInteger(messageLength) || messageLength < 0 || messageLength > 0xFFFFFFFF) {
    throw new Error('buildSentinelBytes: invalid messageLength');
  }
  var flagsInt = parseInt(flags, 2);
  var bytes = new Uint8Array(SENTINEL_BYTES);
  bytes[0] = MAGIC_BYTES[0];
  bytes[1] = MAGIC_BYTES[1];
  bytes[2] = ((lsbBits & 0x0F) << 4) | (flagsInt & 0x0F);
  bytes[3] = (messageLength >>> 24) & 0xFF;
  bytes[4] = (messageLength >>> 16) & 0xFF;
  bytes[5] = (messageLength >>> 8) & 0xFF;
  bytes[6] = messageLength & 0xFF;
  return bytes;
}

// Strips Unicode bidi override characters that could visually spoof text.
// Shared because the main thread needs it after decrypting.
function sanitizeDecodedMessage(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}
