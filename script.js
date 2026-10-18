// Shared sentinel/LSB constants and bit helpers come from constants.js
// (SENTINEL_BITS, SENTINEL_PIXELS, MAGIC_V3, MIN_LSB_BITS, MAX_LSB_BITS,
//  MAX_MESSAGE_LENGTH, MAX_THEORETICAL_EMBED_CAPACITY_BYTES, getBit, getBits).

const MAX_IMAGE_DIMENSION = 10000;         // 10,000 x 10,000 px max
const MAX_FILE_SIZE = 52428800;            // 50MB file size limit
const ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Binary display: truncate to avoid DoS from huge strings
const BINARY_PREVIEW_BITS = 4096;

// v3 Format - Fixed Sentinel + Variable Message
const FORMAT_VERSION = 3;                  // Current format version

// Performance: Reusable encoder/decoder (stateless)
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

// Performance: DOM element cache
const DOM_CACHE = {
  messageTextarea: null,
  errorElement: null,
  errorDecodeElement: null,
  originalCanvas: null,
  nulledCanvas: null,
  messageCanvas: null,
  decodeCanvas: null,
  
  // Getter with null check
  get(key) {
    if (!this[key]) {
      const selectors = {
        messageTextarea: 'textarea.message',
        errorElement: '.error',
        errorDecodeElement: '.error-decode',
        originalCanvas: '.original canvas',
        nulledCanvas: '.nulled canvas',
        messageCanvas: '.message canvas',
        decodeCanvas: '.decode canvas'
      };
      if (selectors[key]) {
        this[key] = document.querySelector(selectors[key]);
      }
    }
    return this[key];
  },
  
  // Clear cache (call when DOM changes)
  clear() {
    Object.keys(this).forEach(key => {
      if (typeof this[key] !== 'function') {
        this[key] = null;
      }
    });
  }
};

// Download cache (precomputed PNG blobs) - encoded only (original blob unused)
const DOWNLOAD_CACHE = {
  encoded: null,
  building: {
    encoded: false
  }
};

function isDownloadReady(type) {
  if (!type) return false;
  return Boolean(DOWNLOAD_CACHE[type] && !DOWNLOAD_CACHE.building[type]);
}

function updateDownloadAvailability() {
  var downloadEncodedBtn = document.getElementById('downloadEncoded');
  if (downloadEncodedBtn) {
    downloadEncodedBtn.disabled = !isDownloadReady('encoded');
  }
}

function toggleEncodeDropZonePreview(showPreview) {
  var dropZone = document.getElementById('encodeDropZone');
  if (!dropZone) return;
  
  var content = dropZone.querySelector('.drop-zone-content');
  var preview = dropZone.querySelector('.drop-zone-preview');
  
  if (content) {
    content.style.display = showPreview ? 'none' : 'block';
  }
  if (preview) {
    preview.style.display = showPreview ? 'block' : 'none';
  }
}

function renderEncodeDropZonePreview(source) {
  var dropZone = document.getElementById('encodeDropZone');
  if (!dropZone || !source) return;
  
  var previewCanvas = dropZone.querySelector('.drop-zone-preview canvas');
  if (!previewCanvas) return;
  
  var sourceWidth = source.naturalWidth || source.width;
  var sourceHeight = source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  
  previewCanvas.width = sourceWidth;
  previewCanvas.height = sourceHeight;
  
  var ctx = previewCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(source, 0, 0);
  
  toggleEncodeDropZonePreview(true);
}

function setEncodedPreviewVisibility(showPreview) {
  var section = document.getElementById('encodedPreviewSection');
  if (section) {
    section.style.display = showPreview ? 'block' : 'none';
  }
}

function renderPreviewCanvas(sourceCanvas, targetCanvas) {
  if (!sourceCanvas || !targetCanvas) {
    throw new Error('Preview source or target missing.');
  }
  
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  
  var ctx = targetCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
}

function setEncodedPreviewMode(mode) {
  try {
    var previewCanvas = document.getElementById('encodedPreviewCanvas');
    var originalCanvas = DOM_CACHE.get('originalCanvas');
    var encodedCanvas = DOM_CACHE.get('messageCanvas');

    if (mode === 'original') {
      renderPreviewCanvas(originalCanvas, previewCanvas);
    } else {
      renderPreviewCanvas(encodedCanvas, previewCanvas);
    }
  } catch (error) {
    showError('Error updating encoded preview: ' + error.message);
  }
}

function toggleDecodeDropZonePreview(showPreview) {
  var dropZone = document.getElementById('decodeDropZone');
  if (!dropZone) return;
  
  var content = dropZone.querySelector('.drop-zone-content');
  var preview = dropZone.querySelector('.drop-zone-preview');
  
  if (content) {
    content.style.display = showPreview ? 'none' : 'block';
  }
  if (preview) {
    preview.style.display = showPreview ? 'block' : 'none';
  }
}

function renderDecodeDropZonePreview(source) {
  var dropZone = document.getElementById('decodeDropZone');
  if (!dropZone || !source) return;
  
  var previewCanvas = dropZone.querySelector('.drop-zone-preview canvas');
  if (!previewCanvas) return;
  
  var sourceWidth = source.naturalWidth || source.width;
  var sourceHeight = source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  
  previewCanvas.width = sourceWidth;
  previewCanvas.height = sourceHeight;
  
  var ctx = previewCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(source, 0, 0);
  
  toggleDecodeDropZonePreview(true);
}

function clearDownloadCache(type) {
  if (DOWNLOAD_CACHE[type] && DOWNLOAD_CACHE[type].objectUrl) {
    URL.revokeObjectURL(DOWNLOAD_CACHE[type].objectUrl);
  }
  DOWNLOAD_CACHE[type] = null;
  DOWNLOAD_CACHE.building[type] = false;
}

function clearEncodedCaches() {
  clearDownloadCache('encoded');
  updateDownloadAvailability();
  setEncodedPreviewVisibility(false);
}

function setDownloadCache(type, blob, width, height) {
  clearDownloadCache(type);
  DOWNLOAD_CACHE[type] = {
    blob: blob,
    objectUrl: URL.createObjectURL(blob),
    width: width,
    height: height,
    createdAt: Date.now()
  };
  DOWNLOAD_CACHE.building[type] = false;
  updateDownloadAvailability();
}

// Monotonic generation counters guard against stale results after an await.
// Anything that invalidates a pending encode/decode (image upload, tab
// switch, message/password edit, operation start) must bump the counter.
// Every continuation re-checks before touching the UI or cache.
var encodeGeneration = 0;
var decodeGeneration = 0;

// In-flight counters: incremented when encodeMessage/decodeMessage starts,
// decremented on every exit path. The silent-return (gen-mismatch) paths use
// the counter to decide whether to restore the button, so a non-click bump
// (text input, toggle, password edit) doesn't leave the button stuck on
// "Encrypting..." / disabled, while rapid double-clicks still let the newer
// in-flight operation own the UI.
var encodeInFlight = 0;
var decodeInFlight = 0;

function bumpEncodeGeneration() { encodeGeneration++; }
function bumpDecodeGeneration() { decodeGeneration++; }

// Exact decoded text held in memory so the Copy and Download buttons work on
// the original string (no round-trip through textContent, which could
// normalize whitespace or line endings in some edge cases).
var LAST_DECODED_TEXT = '';

// Decoded-file buffer + metadata. Set when the hidden payload turns out to
// be a file container (plaintext or encrypted). Null for text payloads.
// Shape: { bytes: Uint8Array, filename, mimeType, crcValid, storedCrc, previewUrl }
var LAST_DECODED_FILE = null;

// Current secret-file selection for the encode side. Null when the user is
// in text mode or hasn't picked a file. { file: File, bytes: Uint8Array }.
// Bytes are read eagerly on selection so capacity analysis has an exact
// number and encode doesn't need to await an ArrayBuffer during setBusy.
var SECRET_FILE = null;

// Debounce + memo for the live capacity analysis's compression probe, so we
// don't deflate the payload on every keystroke. Keyed by a cheap signature
// of the raw bytes. Compression is purely manual (the user's toggle); the
// probe only runs the live size refinement when the toggle is on.
var compressionAnalysisTimer = null;
var COMPRESSION_CACHE = null;   // { sig, compressedLength }
var COMPRESSION_ANALYSIS_DEBOUNCE_MS = 180;

// The real ceiling on a hidden file is MAX_MESSAGE_LENGTH applied to the
// whole container (the decoder's own limit), not the 50 MB carrier-image
// cap. The absolute max raw-file size therefore depends on the container
// overhead (14 + filename + MIME). We reject against the plaintext budget
// here (the most permissive) so toggling encryption later never clears an
// otherwise-usable file; the encrypted-overflow case is caught at encode
// time with its own message.
function maxSecretFileBytesFor(filename, mimeType) {
  var fnStr = (typeof filename === 'string' && filename.length > 0) ? filename : 'secret.bin';
  var mimeStr = (typeof mimeType === 'string' && mimeType.length > 0) ? mimeType : 'application/octet-stream';
  var overhead = FILE_CONTAINER_FIXED_OVERHEAD +
                 TEXT_ENCODER.encode(fnStr).length +
                 TEXT_ENCODER.encode(mimeStr).length;
  return Math.max(0, MAX_MESSAGE_LENGTH - overhead);
}

function getPayloadType() {
  var fileRadio = document.getElementById('payloadTypeFile');
  return (fileRadio && fileRadio.checked) ? 'file' : 'text';
}

function setPayloadType(type) {
  var textRadio = document.getElementById('payloadTypeText');
  var fileRadio = document.getElementById('payloadTypeFile');
  if (type === 'file') {
    if (fileRadio) fileRadio.checked = true;
  } else {
    if (textRadio) textRadio.checked = true;
  }
  syncPayloadTypeUI();
}

function syncPayloadTypeUI() {
  var textWrap = document.getElementById('payloadTextWrap');
  var fileWrap = document.getElementById('payloadFileWrap');
  var type = getPayloadType();
  if (textWrap) textWrap.style.display = (type === 'file') ? 'none' : 'block';
  if (fileWrap) fileWrap.style.display = (type === 'file') ? 'block' : 'none';
}

function setDecodedActionsEnabled(enabled) {
  var copyBtn = document.getElementById('decoded-copy-btn');
  var dlBtn = document.getElementById('decoded-download-btn');
  if (copyBtn) copyBtn.disabled = !enabled;
  if (dlBtn) dlBtn.disabled = !enabled;
  if (!enabled) resetDecodedCopyLabel();
}

function resetDecodedCopyLabel() {
  var label = document.getElementById('decoded-copy-label');
  var btn = document.getElementById('decoded-copy-btn');
  if (label) label.textContent = 'Copy';
  if (btn) btn.classList.remove('btn-outline-success', 'btn-outline-danger');
}

function clearDecodedDisplay() {
  var text = document.getElementById('decoded-message-text');
  if (text) text.textContent = '';
  var binary = document.querySelector('.binary-decode');
  if (binary) binary.style.display = 'none';
  var fileBlock = document.querySelector('.file-decode');
  if (fileBlock) fileBlock.style.display = 'none';
  var cap = document.querySelector('.decode-capacity-bar');
  if (cap) cap.style.display = 'none';
  LAST_DECODED_TEXT = '';
  // Revoke any object URL held for an image preview so we don't leak blobs.
  if (LAST_DECODED_FILE && LAST_DECODED_FILE.previewUrl) {
    try { URL.revokeObjectURL(LAST_DECODED_FILE.previewUrl); } catch (e) { /* no-op */ }
  }
  LAST_DECODED_FILE = null;
  var previewWrap = document.getElementById('decoded-file-image-preview');
  if (previewWrap) {
    var img = previewWrap.querySelector('img');
    if (img) img.removeAttribute('src');
    previewWrap.style.display = 'none';
  }
  var fileDl = document.getElementById('decoded-file-download-btn');
  if (fileDl) fileDl.disabled = true;
  setDecodedActionsEnabled(false);
}

function clearPasswords() {
  var p1 = document.getElementById('encrypt-password');
  var p2 = document.getElementById('encrypt-password-confirm');
  var p3 = document.getElementById('decrypt-password');
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  if (p3) p3.value = '';
  var fb = document.getElementById('encrypt-password-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'text-muted d-block'; }
}

function isEncryptionEnabled() {
  var toggle = document.getElementById('encrypt-toggle');
  return !!(toggle && toggle.checked && !toggle.disabled);
}

function cryptoAvailable() {
  return typeof StegCrypto !== 'undefined' && StegCrypto.isCryptoAvailable();
}

function isCompressionEnabled() {
  var toggle = document.getElementById('compress-toggle');
  return !!(toggle && toggle.checked && !toggle.disabled);
}

function compressionAvailable() {
  return typeof StegCompress !== 'undefined' && StegCompress.isCompressionAvailable();
}

// Capacity error that explains whether compression was already applied or
// attempted, so the user understands why a payload still doesn't fit.
function showCompressionAwareCapacityError(payloadType, encrypted, compressed, wantedCompress, payloadLength, maxCapacity) {
  var kind;
  if (payloadType === 'file') {
    kind = encrypted ? 'encrypted file container' : 'file container';
  } else {
    kind = encrypted ? 'encrypted payload' : 'message';
  }
  if (compressed) kind = 'compressed ' + kind;

  var hint = payloadType === 'file'
    ? 'Please use a larger carrier image or a smaller secret file.'
    : 'Please use a larger image or shorter message.';
  if (wantedCompress && !compressed && compressionAvailable()) {
    hint = 'Compression did not shrink this payload (it may already be compressed). ' + hint;
  }

  showError('Payload too large! Your ' + kind + ' is ' + payloadLength.toLocaleString() +
            ' bytes but this image can only hide ' + maxCapacity.toLocaleString() +
            ' bytes. ' + hint);
}

// Returns true if passwords match and are non-empty. Updates inline
// feedback. Preserves whitespace - "pw" and "pw " are different.
function validateEncryptPasswords(reportError) {
  var p1El = document.getElementById('encrypt-password');
  var p2El = document.getElementById('encrypt-password-confirm');
  var fb = document.getElementById('encrypt-password-feedback');
  var p1 = p1El ? p1El.value : '';
  var p2 = p2El ? p2El.value : '';
  if (p1.length === 0) {
    if (fb) { fb.textContent = 'Enter a password.'; fb.className = 'text-danger d-block'; }
    if (reportError) showError('Please enter an encryption password.');
    return false;
  }
  if (p1 !== p2) {
    if (fb) { fb.textContent = 'Passwords do not match.'; fb.className = 'text-danger d-block'; }
    if (reportError) showError('Passwords do not match.');
    return false;
  }
  if (fb) { fb.textContent = 'Passwords match.'; fb.className = 'text-success d-block'; }
  return true;
}

// Single-flight worker registry: starting a new worker in a given slot
// terminates any in-flight predecessor. Prevents stale results from rapid
// re-clicks (encode/upload churn).
var CURRENT_WORKERS = { encode: null, decode: null };

function startWorker(slot, scriptUrl) {
  var existing = CURRENT_WORKERS[slot];
  if (existing) {
    existing.terminate();
  }
  var worker = new Worker(scriptUrl);
  CURRENT_WORKERS[slot] = worker;
  return worker;
}

function finishWorker(slot, worker) {
  if (CURRENT_WORKERS[slot] === worker) {
    CURRENT_WORKERS[slot] = null;
  }
  worker.terminate();
}

// Magic bytes and header parsing (decompression bomb + MIME spoofing mitigation)
var MAGIC_PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
var MAGIC_JPEG = new Uint8Array([0xFF, 0xD8, 0xFF]);
var MAGIC_WEBP_RIFF = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
var MAGIC_WEBP_WEBP = new Uint8Array([0x57, 0x45, 0x42, 0x50]);
var JPEG_SOF_MARKERS = [0xC0, 0xC1, 0xC2];
var JPEG_HEADER_SCAN_BYTES = 65536;

function arraysEqual(a, b, len) {
  for (var i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readImageDimensionsFromHeader(file) {
  return new Promise(function(resolve, reject) {
    if (!file || !file.slice) {
      reject(new Error('Invalid file.'));
      return;
    }
    if (file.size < 24) {
      reject(new Error('File too small to be a valid image.'));
      return;
    }

    // Phase 1: 32-byte sniff. Enough for PNG (24B) and WebP (30B);
    // JPEG triggers a separate 64KB reslice to find the SOF marker.
    file.slice(0, 32).arrayBuffer().then(function(buf) {
      var arr = new Uint8Array(buf);

      if (arr.length >= 24 && arraysEqual(arr, MAGIC_PNG, 8)) {
        var view = new DataView(buf);
        resolve({
          width: view.getUint32(16, false),
          height: view.getUint32(20, false),
          detectedType: 'image/png'
        });
        return;
      }

      if (arr.length >= 12 && arraysEqual(arr, MAGIC_WEBP_RIFF, 4) && arraysEqual(arr.subarray(8), MAGIC_WEBP_WEBP, 4)) {
        parseWebpDimensions(arr, resolve, reject);
        return;
      }

      if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
        // Phase 2 (JPEG only): SOF marker can be anywhere in the first
        // ~64KB of metadata. Reslice and scan.
        file.slice(0, JPEG_HEADER_SCAN_BYTES).arrayBuffer().then(function(jbuf) {
          parseJpegDimensions(new Uint8Array(jbuf), resolve, reject);
        }).catch(reject);
        return;
      }

      reject(new Error('Invalid file: not a valid PNG, JPEG, or WebP image.'));
    }).catch(reject);
  });
}

function parseJpegDimensions(arr, resolve, reject) {
  for (var i = 2; i < arr.length - 8; i++) {
    if (arr[i] === 0xFF && JPEG_SOF_MARKERS.indexOf(arr[i + 1]) !== -1) {
      var h = (arr[i + 5] << 8) | arr[i + 6];
      var w = (arr[i + 7] << 8) | arr[i + 8];
      resolve({ width: w, height: h, detectedType: 'image/jpeg' });
      return;
    }
  }
  reject(new Error('Invalid JPEG: no SOF marker found.'));
}

function parseWebpDimensions(arr, resolve, reject) {
  if (arr.length < 30) {
    reject(new Error('Invalid WebP: header truncated.'));
    return;
  }
  var vp8 = arr[12] === 0x56 && arr[13] === 0x50 && arr[14] === 0x38;
  var vp8l = vp8 && arr[15] === 0x4C;
  var vp8x = vp8 && arr[15] === 0x58;
  var w, h;
  if (vp8x) {
    // VP8X: width/height are 24-bit "Minus One" at 24-26 and 27-29.
    w = (arr[24] | (arr[25] << 8) | (arr[26] << 16)) + 1;
    h = (arr[27] | (arr[28] << 8) | (arr[29] << 16)) + 1;
  } else if (vp8l) {
    var val = arr[21] | (arr[22] << 8) | (arr[23] << 16) | ((arr[24] & 0x3F) << 24);
    w = (val & 0x3FFF) + 1;
    h = ((val >> 14) & 0x3FFF) + 1;
  } else if (vp8 && arr[15] === 0x20) {
    // VP8 lossy: 3-byte frame tag (20-22), start code 9D 01 2A (23-25),
    // then 14-bit width/height at 26-27 and 28-29, little-endian.
    w = (arr[26] | (arr[27] << 8)) & 0x3FFF;
    h = (arr[28] | (arr[29] << 8)) & 0x3FFF;
  } else {
    reject(new Error('Invalid WebP: unsupported chunk type.'));
    return;
  }
  resolve({ width: w, height: h, detectedType: 'image/webp' });
}

function validateMagicBytesAndDimensions(file, context) {
  return readImageDimensionsFromHeader(file).then(function(result) {
    if (!ALLOWED_FILE_TYPES.includes(result.detectedType)) {
      showError('Invalid file: not a valid PNG, JPEG, or WebP image.', context);
      return null;
    }
    if (file.type && file.type !== result.detectedType) {
      showError('File type mismatch: declared ' + file.type + ' but file signature indicates ' + result.detectedType + '.', context);
      return null;
    }
    if (!validateImageDimensions(result.width, result.height)) {
      return null;
    }
    return result;
  }).catch(function(err) {
    showError(err.message || 'Invalid file: not a valid PNG, JPEG, or WebP image.', context);
    return null;
  });
}

// Synchronous pre-flight: just null + size checks. The deeper magic-byte
// and dimension validation happens in validateMagicBytesAndDimensions,
// which reads the file header once and is strictly stronger than a
// 16-byte signature sniff.
function validateFileBasics(file, context) {
  if (!file) {
    showError('No file selected. Please choose an image file.', context);
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('File too large! Maximum file size: ' + (MAX_FILE_SIZE / 1048576).toFixed(0) + 'MB. Your file: ' + (file.size / 1048576).toFixed(1) + 'MB.', context);
    return false;
  }
  return true;
}

function validateImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    showError('Invalid image dimensions.');
    return false;
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    showError('Image too large. Maximum dimension: ' + MAX_IMAGE_DIMENSION.toLocaleString() + ' pixels.');
    return false;
  }
  if (width <= 0 || height <= 0) {
    showError('Invalid image dimensions.');
    return false;
  }
  return true;
}

function validateMessageLength(length, kind) {
  var label = kind === 'file' ? 'file (with its metadata)' : 'message';
  if (!Number.isSafeInteger(length)) {
    showError('Invalid ' + (kind === 'file' ? 'file' : 'message') + ' length.');
    return false;
  }
  if (length > MAX_MESSAGE_LENGTH) {
    showError('The ' + label + ' is too long! Maximum packaged size: ' +
              MAX_MESSAGE_LENGTH.toLocaleString() + ' bytes.');
    return false;
  }
  return true;
}

// sanitizeDecodedMessage and parseSentinelFromPixels live in constants.js so
// workers and the main thread share identical implementations.

function validateCapacity(capacity) {
  if (!Number.isSafeInteger(capacity)) {
    showError('Image capacity calculation error.');
    return false;
  }
  if (capacity > MAX_THEORETICAL_EMBED_CAPACITY_BYTES) {
    showError('Image capacity exceeds safety limits.');
    return false;
  }
  return true;
}

function showError(message, context) {
  var errorElement;
  if (context === 'decode') {
    errorElement = DOM_CACHE.get('errorDecodeElement');
  } else {
    errorElement = DOM_CACHE.get('errorElement');
  }
  
  if (errorElement) {
    errorElement.textContent = '⚠️ ' + message;
    errorElement.style.display = 'block';
  }
  // Errors persist until next operation (no auto-hide)
  // Users can manually scroll past or will be cleared on next encode/decode
}

async function downloadCachedImage(type) {
  if (!isDownloadReady(type)) {
    showError('Download is not ready yet. Please wait for encoding to finish.');
    return;
  }

  var entry = DOWNLOAD_CACHE[type];
  var timestamp = new Date().getTime();
  var filename = 'steganography-' + type + '-' + timestamp + '.png';

  // Preferred path: File System Access API (Chrome/Edge). Writes directly to
  // the user-chosen file, skipping Chrome's download manager (no .crdownload
  // round-trip, no download-shelf scanning delay).
  //
  // Must call showSaveFilePicker synchronously (no awaits before it) so the
  // user activation from the click is preserved.
  if (window.showSaveFilePicker) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'PNG image',
          accept: { 'image/png': ['.png'] }
        }]
      });
      try {
        var writable = await handle.createWritable();
        await writable.write(entry.blob);
        await writable.close();
        return;
      } catch (writeErr) {
        showError('Error saving file: ' + (writeErr && writeErr.message ? writeErr.message : writeErr));
        return;
      }
    } catch (pickerErr) {
      // User cancelled the save dialog - silently abort.
      if (pickerErr && pickerErr.name === 'AbortError') return;
      // Any other picker-time error (e.g. SecurityError in sandboxed
      // contexts): fall through to the anchor download.
    }
  }

  // Fallback: anchor-click download for browsers without the File System
  // Access API (Firefox, Safari) or when the picker is unavailable.
  var link = document.createElement('a');
  link.download = filename;
  link.href = entry.objectUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Make downloadCachedImage globally accessible
window.downloadCanvasImage = downloadCachedImage;

// Copies LAST_DECODED_TEXT to the system clipboard. Prefers the async
// Clipboard API; falls back to a hidden textarea + execCommand('copy') for
// older browsers (older Safari/Firefox over http://).
async function copyDecodedToClipboard() {
  var text = LAST_DECODED_TEXT;
  if (!text) return;
  var btn = document.getElementById('decoded-copy-btn');
  var label = document.getElementById('decoded-copy-label');
  var ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand && document.execCommand('copy'); }
      finally { document.body.removeChild(ta); }
    }
  } catch (err) {
    ok = false;
  }
  if (btn && label) {
    label.textContent = ok ? 'Copied!' : 'Copy failed';
    btn.classList.remove('btn-outline-success', 'btn-outline-danger');
    btn.classList.add(ok ? 'btn-outline-success' : 'btn-outline-danger');
    setTimeout(resetDecodedCopyLabel, 1500);
  }
}

// Saves LAST_DECODED_TEXT as a .txt file. Mirrors downloadCachedImage:
// File System Access API (direct write, no download-manager delay) with an
// anchor-click fallback for Firefox/Safari.
async function downloadDecodedMessage() {
  var text = LAST_DECODED_TEXT;
  if (!text) return;
  var filename = 'decoded-message-' + new Date().getTime() + '.txt';
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

  if (window.showSaveFilePicker) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }]
      });
      try {
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (writeErr) {
        showError('Error saving file: ' + (writeErr && writeErr.message ? writeErr.message : writeErr), 'decode');
        return;
      }
    } catch (pickerErr) {
      if (pickerErr && pickerErr.name === 'AbortError') return;
      // Fall through to the anchor fallback on any other picker error.
    }
  }

  var url = URL.createObjectURL(blob);
  try {
    var link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick so the download has started in all browsers.
    setTimeout(function() { URL.revokeObjectURL(url); }, 0);
  }
}

// Event listeners setup
document.addEventListener('DOMContentLoaded', function() {
  // File input listeners
  var encodeFileInput = document.querySelector('input[name=baseFile]');
  if (encodeFileInput) {
    encodeFileInput.addEventListener('change', function() { previewEncodeImage(); });
  }

  var decodeFileInput = document.querySelector('input[name=decodeFile]');
  if (decodeFileInput) {
    decodeFileInput.addEventListener('change', function() { previewDecodeImage(); });
  }
  
  // Button listeners
  var encodeButton = document.querySelector('button.encode-btn');
  if (encodeButton) {
    encodeButton.addEventListener('click', function(event) {
      event.preventDefault();
      encodeMessage();
    });
  }
  
  var decodeButton = document.querySelector('button.decode-btn');
  if (decodeButton) {
    decodeButton.addEventListener('click', function(event) {
      event.preventDefault();
      decodeMessage();
    });
  }

  // Tab-switch housekeeping. Switching tabs invalidates any pending async
  // work on the other tab and wipes typed passwords.
  document.querySelectorAll('a[data-bs-toggle="tab"]').forEach(function(tab) {
    tab.addEventListener('shown.bs.tab', function(e) {
      var target = e.target.getAttribute('href');
      if (target === '#decode') {
        clearEncodedCaches();
        bumpEncodeGeneration();
      } else if (target === '#encode') {
        bumpDecodeGeneration();
        clearDecodedDisplay();
      }
      clearPasswords();
    });
  });

  // Message textarea - real-time character counter and auto LSB selection.
  // Also bumps encodeGeneration so a mid-flight encode discards its result.
  var messageTextarea = DOM_CACHE.get('messageTextarea');
  if (messageTextarea) {
    messageTextarea.addEventListener('input', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      recomputePayloadAnalysis();
    });
  }

  // Encrypt toggle + password handlers.
  var encryptToggle = document.getElementById('encrypt-toggle');
  var encryptPwGroup = document.getElementById('encrypt-password-group');
  var encryptUnavailable = document.getElementById('encrypt-unavailable');
  var encryptPw = document.getElementById('encrypt-password');
  var encryptPwConfirm = document.getElementById('encrypt-password-confirm');

  if (encryptToggle) {
    if (!cryptoAvailable()) {
      encryptToggle.disabled = true;
      encryptToggle.checked = false;
      if (encryptUnavailable) encryptUnavailable.style.display = 'block';
    }
    encryptToggle.addEventListener('change', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      if (encryptPwGroup) {
        encryptPwGroup.style.display = this.checked ? 'block' : 'none';
      }
      if (!this.checked) {
        // Hide feedback and clear passwords when turning off.
        if (encryptPw) encryptPw.value = '';
        if (encryptPwConfirm) encryptPwConfirm.value = '';
        var fb = document.getElementById('encrypt-password-feedback');
        if (fb) { fb.textContent = ''; fb.className = 'text-muted d-block'; }
      }
      recomputePayloadAnalysis();
    });
  }

  // Compression toggle. Auto-enables at encode time when the payload won't
  // fit; this manual switch forces it on for smaller payloads too.
  var compressToggle = document.getElementById('compress-toggle');
  var compressUnavailable = document.getElementById('compress-unavailable');
  if (compressToggle) {
    if (!compressionAvailable()) {
      compressToggle.disabled = true;
      compressToggle.checked = false;
      if (compressUnavailable) compressUnavailable.style.display = 'block';
    }
    compressToggle.addEventListener('change', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      recomputePayloadAnalysis();
    });
  }

  function onEncryptPwInput() {
    clearEncodedCaches();
    bumpEncodeGeneration();
    // Non-blocking feedback (no error popup).
    validateEncryptPasswords(false);
  }
  if (encryptPw) encryptPw.addEventListener('input', onEncryptPwInput);
  if (encryptPwConfirm) encryptPwConfirm.addEventListener('input', onEncryptPwInput);

  var decryptPw = document.getElementById('decrypt-password');
  if (decryptPw) {
    decryptPw.addEventListener('input', function() { bumpDecodeGeneration(); });
  }
  
  var capacityBadge = document.getElementById('capacity-badge');
  var lsbCollapse = document.getElementById('lsbCollapse');
  if (capacityBadge && lsbCollapse) {
    capacityBadge.addEventListener('click', function() {
      bootstrap.Collapse.getOrCreateInstance(lsbCollapse, { toggle: false }).show();
      document.getElementById('lsbCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Manual override button handlers
  var overrideBtn = document.getElementById('mode-override-btn');
  var autoBtn = document.getElementById('mode-auto-btn');
  var manualSelect = document.getElementById('manual-lsb-mode');
  
  if (overrideBtn) {
    overrideBtn.addEventListener('click', function() {
      document.getElementById('capacity-analysis').style.display = 'none';
      document.getElementById('manual-mode-override').style.display = 'block';
      clearEncodedCaches();
      bumpEncodeGeneration();
      recomputePayloadAnalysis();
    });
  }

  if (autoBtn) {
    autoBtn.addEventListener('click', function() {
      document.getElementById('manual-mode-override').style.display = 'none';
      document.getElementById('capacity-analysis').style.display = 'block';
      clearEncodedCaches();
      bumpEncodeGeneration();
      recomputePayloadAnalysis();
    });
  }

  if (manualSelect) {
    manualSelect.addEventListener('change', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      recomputePayloadAnalysis();
    });
  }
  
  // Drag and Drop File Upload
  // Pass file directly to onDrop - input.files assignment is read-only in most browsers
  function setupDragAndDrop(dropZone, fileInput, onDrop) {
    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function() {
        dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function() {
        dropZone.classList.remove('drag-active');
      });
    });

    dropZone.addEventListener('drop', function(e) {
      var files = e.dataTransfer.files;
      if (files && files.length > 0 && onDrop) {
        onDrop(files[0]);
      }
    });

    dropZone.addEventListener('click', function() {
      fileInput.click();
    });
  }

  var encodeDropZone = document.getElementById('encodeDropZone');
  var decodeDropZone = document.getElementById('decodeDropZone');

  if (encodeDropZone && encodeFileInput) {
    setupDragAndDrop(encodeDropZone, encodeFileInput, function(file) {
      previewEncodeImage(file);
    });
  }

  if (decodeDropZone && decodeFileInput) {
    setupDragAndDrop(decodeDropZone, decodeFileInput, function(file) {
      previewDecodeImage(file);
    });
  }

  // Payload-type toggle (text vs file).
  var payloadTypeText = document.getElementById('payloadTypeText');
  var payloadTypeFile = document.getElementById('payloadTypeFile');
  function onPayloadTypeChange() {
    syncPayloadTypeUI();
    clearEncodedCaches();
    bumpEncodeGeneration();
    recomputePayloadAnalysis();
  }
  if (payloadTypeText) payloadTypeText.addEventListener('change', onPayloadTypeChange);
  if (payloadTypeFile) payloadTypeFile.addEventListener('change', onPayloadTypeChange);
  syncPayloadTypeUI();

  // Secret-file picker and drop zone.
  var secretFileInput = document.getElementById('secretFileInput');
  var secretFileDropZone = document.getElementById('secretFileDropZone');
  if (secretFileInput) {
    secretFileInput.addEventListener('change', function() {
      var f = this.files && this.files[0];
      if (f) setSecretFile(f);
    });
  }
  if (secretFileDropZone && secretFileInput) {
    // Mirror the carrier-image drag/drop UX; file-type is unrestricted.
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(evt) {
      secretFileDropZone.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(function(evt) {
      secretFileDropZone.addEventListener(evt, function() { secretFileDropZone.classList.add('drag-active'); });
    });
    ['dragleave', 'drop'].forEach(function(evt) {
      secretFileDropZone.addEventListener(evt, function() { secretFileDropZone.classList.remove('drag-active'); });
    });
    secretFileDropZone.addEventListener('drop', function(e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) setSecretFile(files[0]);
    });
    // Click opens the picker, but only when no file is loaded or when the
    // click lands on the content prompt (not the Clear button inside the
    // preview area).
    secretFileDropZone.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'secretFileClear') return;
      if (e.target && e.target.closest && e.target.closest('#secretFileClear')) return;
      secretFileInput.click();
    });
  }
  var secretFileClear = document.getElementById('secretFileClear');
  if (secretFileClear) {
    secretFileClear.addEventListener('click', function(e) {
      e.stopPropagation();
      clearSecretFileSelection();
      bumpEncodeGeneration();
      clearEncodedCaches();
      recomputePayloadAnalysis();
    });
  }
  
  var downloadEncodedBtn = document.getElementById('downloadEncoded');
  if (downloadEncodedBtn) {
    downloadEncodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.downloadCanvasImage('encoded');
    });
  }

  // Decoded-message action buttons (shown in the Decoded Message card header).
  var copyDecodedBtn = document.getElementById('decoded-copy-btn');
  if (copyDecodedBtn) {
    copyDecodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyDecodedToClipboard();
    });
  }
  var dlDecodedBtn = document.getElementById('decoded-download-btn');
  if (dlDecodedBtn) {
    dlDecodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      downloadDecodedMessage();
    });
  }
  var dlDecodedFileBtn = document.getElementById('decoded-file-download-btn');
  if (dlDecodedFileBtn) {
    dlDecodedFileBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      downloadDecodedFile();
    });
  }

  var toggleEncoded = document.getElementById('previewToggleEncoded');
  var toggleOriginal = document.getElementById('previewToggleOriginal');
  if (toggleEncoded) {
    toggleEncoded.addEventListener('change', function() {
      if (this.checked) {
        setEncodedPreviewMode('encoded');
      }
    });
  }
  if (toggleOriginal) {
    toggleOriginal.addEventListener('change', function() {
      if (this.checked) {
        setEncodedPreviewMode('original');
      }
    });
  }
  
  // Manual LSB mode override for decode
  var manualOverrideBtn = document.getElementById('manual-override-btn');
  if (manualOverrideBtn) {
    manualOverrideBtn.addEventListener('click', function() {
      var autoDetected = document.getElementById('auto-detected');
      var manualSelect = document.getElementById('manual-mode-select');
      var detector = document.getElementById('decode-mode-detector');
      
      if (autoDetected && manualSelect) {
        autoDetected.style.display = 'none';
        manualSelect.style.display = 'block';
        
        // Pre-fill with detected value
        var detectedMode = detector?.getAttribute('data-detected-mode') || '1';
        document.getElementById('decode-lsb-mode').value = detectedMode;
      }
    });
  }
  
  updateDownloadAvailability();
});

function previewDecodeImage(file) {
  if (!file) {
    file = document.querySelector('input[name=decodeFile]').files[0];
  }

  // New image invalidates any in-flight decode and wipes previous output.
  bumpDecodeGeneration();
  clearDecodedDisplay();
  var decryptPw = document.getElementById('decrypt-password');
  if (decryptPw) decryptPw.value = '';
  var pwGroup = document.getElementById('decrypt-password-group');
  if (pwGroup) pwGroup.style.display = 'none';
  var encBadge = document.getElementById('detected-encrypted-badge');
  if (encBadge) encBadge.style.display = 'none';

  toggleDecodeDropZonePreview(false);

  if (!validateFileBasics(file, 'decode')) return;

  validateMagicBytesAndDimensions(file, 'decode').then(function(headerResult) {
    if (!headerResult) return;
    previewImage(file, '.decode canvas', function(image) {
      try {
        renderDecodeDropZonePreview(image);
      } catch (error) {
        showError('Error processing decode image: ' + error.message, 'decode');
      }
      detectLsbMode();
    }, 'decode');
  });
}

// Auto LSB Mode Selection Functions. payloadBytes is the on-disk size
// (plaintext length, or plaintext + 45 when encrypting).
function calculateOptimalLSBMode(payloadBytes, imageWidth, imageHeight) {
  var requiredBits = SENTINEL_BITS + (payloadBytes * 8);
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;

  // Try each mode from 1→4 (prefer lowest for minimal footprint)
  for (var lsbMode = 1; lsbMode <= MAX_LSB_BITS; lsbMode++) {
    var capacity = availablePixels * 3 * lsbMode;
    if (requiredBits <= capacity) {
      var utilization = (requiredBits / capacity * 100);
      return {
        mode: lsbMode,
        required: requiredBits,
        available: capacity,
        utilization: utilization.toFixed(1),
        recommendation: getRecommendation(lsbMode, utilization)
      };
    }
  }

  return null; // Message too large
}

function getRecommendation(lsbMode, utilization) {
  if (utilization < 60) return 'Excellent';
  if (utilization < 85) return 'Good';
  if (utilization < 95) return 'Tight';
  return 'Full';
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 bytes';
  if (n < 1024) return n.toLocaleString() + ' bytes';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB (' + n.toLocaleString() + ' bytes)';
  return (n / 1048576).toFixed(2) + ' MB (' + n.toLocaleString() + ' bytes)';
}

// Validates the file against the real packaged-size budget, then reads the
// whole thing into a Uint8Array so capacity math and the container builder
// don't have to await an ArrayBuffer at encode time.
async function setSecretFile(file) {
  bumpEncodeGeneration();
  // Snapshot the generation so a slower arrayBuffer() read for an older
  // selection can't clobber a newer one if the user picks files rapidly.
  var myGen = encodeGeneration;
  clearEncodedCaches();
  if (!file) {
    clearSecretFileSelection();
    recomputePayloadAnalysis();
    return;
  }
  if (file.size === 0) {
    showError('Cannot hide an empty file.');
    clearSecretFileSelection();
    recomputePayloadAnalysis();
    return;
  }
  var budget = maxSecretFileBytesFor(file.name, file.type);
  if (file.size > budget) {
    showError('File too large to hide! With its name and type, the maximum file size is ' +
              budget.toLocaleString() + ' bytes (' + (budget / 1048576).toFixed(1) + ' MB). Your file: ' +
              file.size.toLocaleString() + ' bytes (' + (file.size / 1048576).toFixed(1) + ' MB). ' +
              'Enabling encryption lowers this by ' + ENCRYPTION_OVERHEAD_BYTES + ' bytes.');
    clearSecretFileSelection();
    recomputePayloadAnalysis();
    return;
  }
  try {
    var buf = await file.arrayBuffer();
    // A newer selection (or any encode-invalidating action) superseded this
    // read; drop it so SECRET_FILE always reflects the latest choice.
    if (encodeGeneration !== myGen) return;
    SECRET_FILE = { file: file, bytes: new Uint8Array(buf) };
    renderSecretFileSelection();
    recomputePayloadAnalysis();
  } catch (err) {
    if (encodeGeneration !== myGen) return;
    showError('Could not read file: ' + (err && err.message ? err.message : err));
    clearSecretFileSelection();
    recomputePayloadAnalysis();
  }
}

function clearSecretFileSelection() {
  SECRET_FILE = null;
  var input = document.getElementById('secretFileInput');
  if (input) input.value = '';
  renderSecretFileSelection();
}

function renderSecretFileSelection() {
  var dropZone = document.getElementById('secretFileDropZone');
  if (!dropZone) return;
  var content = dropZone.querySelector('.drop-zone-content');
  var preview = dropZone.querySelector('.drop-zone-preview');
  var nameEl = document.getElementById('secretFileName');
  var metaEl = document.getElementById('secretFileMeta');
  if (!SECRET_FILE) {
    if (content) content.style.display = 'block';
    if (preview) preview.style.display = 'none';
    if (nameEl) nameEl.textContent = '(no file)';
    if (metaEl) metaEl.textContent = '';
    return;
  }
  if (content) content.style.display = 'none';
  if (preview) preview.style.display = 'block';
  if (nameEl) nameEl.textContent = SECRET_FILE.file.name || 'secret.bin';
  if (metaEl) {
    var mime = SECRET_FILE.file.type || 'application/octet-stream';
    metaEl.textContent = mime + ' - ' + formatBytes(SECRET_FILE.bytes.length);
  }
}

// Returns the on-disk payload size (what fills the sentinel's length field).
// Depends on payload type, current message / file, and the encrypt toggle.
// Does not read image dimensions - that's the caller's job.
function computePayloadLengthForAnalysis() {
  var encrypted = isEncryptionEnabled();
  var type = getPayloadType();
  if (type === 'file') {
    if (!SECRET_FILE) return { payloadBytes: 0, hasPayload: false, type: type, encrypted: encrypted, rawBytes: null };
    var fnStr = SECRET_FILE.file.name || 'secret.bin';
    var mimeStr = SECRET_FILE.file.type || 'application/octet-stream';
    var fnLen = TEXT_ENCODER.encode(fnStr).length;
    var mimeLen = TEXT_ENCODER.encode(mimeStr).length;
    // Raw (uncompressed) container bytes - also what the live compression
    // probe deflates. Building it copies the file, but file-mode analysis
    // only reruns on select / toggle, not per keystroke.
    var containerBytes = buildFileContainer(SECRET_FILE.bytes, fnStr, mimeStr);
    var containerLen = containerBytes.length;
    var payload = encrypted ? containerLen + ENCRYPTION_OVERHEAD_BYTES : containerLen;
    return {
      payloadBytes: payload,
      rawPayloadBytes: payload,
      rawBytes: containerBytes,
      hasPayload: true,
      type: type,
      encrypted: encrypted,
      rawFileSize: SECRET_FILE.bytes.length,
      containerOverhead: FILE_CONTAINER_FIXED_OVERHEAD + fnLen + mimeLen,
      filename: fnStr,
      mimeType: mimeStr
    };
  }
  var text = DOM_CACHE.get('messageTextarea')?.value || '';
  if (!text) return { payloadBytes: 0, hasPayload: false, type: type, encrypted: encrypted, rawBytes: null };
  var textBytes = TEXT_ENCODER.encode(text);
  var byteCount = textBytes.length;
  var payloadText = encrypted ? byteCount + ENCRYPTION_OVERHEAD_BYTES : byteCount;
  return {
    rawPayloadBytes: payloadText,
    rawBytes: textBytes,
    payloadBytes: payloadText,
    hasPayload: true,
    type: type,
    encrypted: encrypted,
    charCount: text.length,
    byteCount: byteCount
  };
}

// Shared entry point - rerun whenever anything that affects capacity math
// changes (message input, file selection, encrypt toggle, payload-type
// toggle, manual LSB override). Keeps the UI consistent across both modes.
// Shows the uncompressed figures immediately, then refines with the real
// compressed size (debounced, async) when compression is relevant.
function recomputePayloadAnalysis() {
  var info = computePayloadLengthForAnalysis();
  updatePayloadCounterBadge(info);
  updateMessageAnalysis(info);
  scheduleCompressionRefine(info);
}

function setCompressionNote(text, cls) {
  var el = document.getElementById('compression-note');
  if (!el) return;
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = text;
  el.className = 'small mt-1 ' + (cls || 'text-muted');
}

// When the user has turned compression on, deflate the payload (debounced) to
// refine the capacity UI with the real compressed size. Compression is manual
// only - this never enables it on its own.
function scheduleCompressionRefine(info) {
  if (compressionAnalysisTimer) {
    clearTimeout(compressionAnalysisTimer);
    compressionAnalysisTimer = null;
  }
  if (!info.hasPayload || !info.rawBytes) { setCompressionNote(''); return; }
  if (!isCompressionEnabled()) { setCompressionNote(''); return; }
  if (!compressionAvailable()) {
    setCompressionNote('Compression unavailable in this browser; the payload will be stored uncompressed.', 'text-warning');
    return;
  }
  var canvas = DOM_CACHE.get('originalCanvas');
  if (!canvas || canvas.width === 0) { setCompressionNote(''); return; }

  var myGen = encodeGeneration;
  compressionAnalysisTimer = setTimeout(function() {
    runCompressionRefine(info, myGen);
  }, COMPRESSION_ANALYSIS_DEBOUNCE_MS);
}

async function runCompressionRefine(info, myGen) {
  if (encodeGeneration !== myGen) return;

  var sig = info.type + ':' + info.encrypted + ':' + info.rawBytes.length + ':' + crc32(info.rawBytes);
  var compressedLength;
  if (COMPRESSION_CACHE && COMPRESSION_CACHE.sig === sig) {
    compressedLength = COMPRESSION_CACHE.compressedLength;
  } else {
    var deflated;
    try {
      deflated = await StegCompress.compress(info.rawBytes);
    } catch (e) {
      return;  // leave the uncompressed view in place
    }
    if (encodeGeneration !== myGen) return;
    compressedLength = deflated.length;
    COMPRESSION_CACHE = { sig: sig, compressedLength: compressedLength };
  }

  var rawLen = info.rawBytes.length;
  var helps = compressedLength < rawLen;

  if (!helps) {
    // Compression wouldn't shrink the payload, so it won't actually be used.
    setCompressionNote(
      'Compression would not shrink this payload (it looks already-compressed); it will be stored as-is.',
      'text-muted');
    return;
  }

  // Re-render capacity with the effective compressed size and mark it.
  var compressedOnDisk = compressedLength + (info.encrypted ? ENCRYPTION_OVERHEAD_BYTES : 0);
  var compressedInfo = {
    payloadBytes: compressedOnDisk,
    hasPayload: true,
    type: info.type,
    encrypted: info.encrypted
  };
  updateMessageAnalysis(compressedInfo);
  updateCompressedCounterBadge(info, rawLen, compressedLength);

  var ratio = Math.max(0, Math.round((1 - (compressedLength / rawLen)) * 100));
  setCompressionNote(
    'Compression on: ' +
    rawLen.toLocaleString() + ' to ' + compressedLength.toLocaleString() +
    ' bytes (' + ratio + '% smaller) before ' + (info.encrypted ? 'encryption and ' : '') + 'embedding.',
    'text-success');
}

function updateCompressedCounterBadge(info, rawLen, compressedLength) {
  var counterBadge = document.getElementById('message-counter-badge');
  if (!counterBadge) return;
  var encSuffix = info.encrypted ? ' + ' + ENCRYPTION_OVERHEAD_BYTES + ' enc' : '';
  if (info.type === 'file') {
    counterBadge.textContent = '📎 ' + info.filename + ' (' + rawLen.toLocaleString() +
      ' to ' + compressedLength.toLocaleString() + ' bytes compressed' + encSuffix + ')';
  } else {
    counterBadge.textContent = '📝 ' + (info.charCount || 0).toLocaleString() + ' chars (' +
      rawLen.toLocaleString() + ' to ' + compressedLength.toLocaleString() + ' bytes compressed' + encSuffix + ')';
  }
}

function updatePayloadCounterBadge(info) {
  var counterBadge = document.getElementById('message-counter-badge');
  if (!counterBadge) return;
  if (info.type === 'file') {
    if (!info.hasPayload) {
      counterBadge.textContent = '📎 No file selected';
      return;
    }
    var suffix = info.encrypted ? ' + ' + ENCRYPTION_OVERHEAD_BYTES + ' bytes encryption overhead' : '';
    counterBadge.textContent = '📎 ' + info.filename + ' (' +
      info.rawFileSize.toLocaleString() + ' bytes + ' +
      info.containerOverhead.toLocaleString() + ' bytes container' + suffix + ')';
  } else {
    var textSuffix = info.encrypted ? ' + ' + ENCRYPTION_OVERHEAD_BYTES + ' bytes encryption overhead' : '';
    counterBadge.textContent = '📝 ' + (info.charCount || 0).toLocaleString() + ' characters (' +
      (info.byteCount || 0).toLocaleString() + ' bytes' + textSuffix + ')';
  }
}

// Legacy signature kept so inline callers (file input listeners, etc.) can
// pass a text string if they still want to - delegates to recompute when
// called with no argument.
function updateMessageAnalysis(infoOrText) {
  var info;
  if (typeof infoOrText === 'string' || typeof infoOrText === 'undefined') {
    info = computePayloadLengthForAnalysis();
    // Caller may have passed a text that hasn't been written to the DOM yet
    // (unlikely, but keep the behavior). All current callers pass the DOM
    // value directly, so we just use the fresh snapshot.
  } else {
    info = infoOrText;
  }

  var payloadBytes = info.payloadBytes;
  var encrypted = info.encrypted;

  // Hide capacity UI if there's nothing to analyze.
  if (!info.hasPayload) {
    document.getElementById('capacity-analysis').style.display = 'none';
    var cb0 = document.getElementById('capacity-badge');
    if (cb0) cb0.style.display = 'none';
    return;
  }

  // Get image dimensions
  var canvas = DOM_CACHE.get('originalCanvas');
  if (!canvas || canvas.width === 0) {
    document.getElementById('capacity-analysis').style.display = 'none';
    var capacityBadge = document.getElementById('capacity-badge');
    if (capacityBadge) {
      capacityBadge.style.display = 'none';
    }
    return;
  }

  // Check if manual override is active
  var manualOverride = document.getElementById('manual-mode-override');
  var isManual = manualOverride && manualOverride.style.display !== 'none';

  if (isManual) {
    var manualMode = parseInt(document.getElementById('manual-lsb-mode').value, 10);
    updateManualModeAnalysis(payloadBytes, canvas.width, canvas.height, manualMode, encrypted);
  } else {
    var analysis = calculateOptimalLSBMode(payloadBytes, canvas.width, canvas.height);
    if (!analysis) {
      showCapacityError(payloadBytes, canvas.width, canvas.height, encrypted, { isManual: false, mode: null });
      return;
    }
    updateCapacityAnalysisUI(analysis, payloadBytes, encrypted);
  }
}

function updateCapacityAnalysisUI(analysis, payloadBytes, encrypted) {
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var autoModeBadge = document.getElementById('auto-mode-badge');
  var capacityBadge = document.getElementById('capacity-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats || !autoModeBadge) return;
  
  capacityAnalysis.style.display = 'block';
  
  // Update progress bar
  var utilization = parseFloat(analysis.utilization);
  usageBar.style.width = utilization + '%';
  usageBar.setAttribute('aria-valuenow', utilization);
  
  // Set color based on utilization
  usageBar.className = 'progress-bar';
  var badgeColor = 'bg-success';
  if (utilization < 60) {
    usageBar.classList.add('bg-success');
    badgeColor = 'bg-success';
  } else if (utilization < 85) {
    usageBar.classList.add('bg-warning');
    badgeColor = 'bg-warning';
  } else if (utilization < 95) {
    usageBar.classList.add('bg-orange');
    badgeColor = 'bg-warning';
  } else {
    usageBar.classList.add('bg-danger');
    badgeColor = 'bg-danger';
  }
  
  // Update stats text
  var capacityBytes = Math.floor(analysis.available / 8);
  var encSuffix = encrypted ? ', encrypted' : '';
  capacityStats.textContent = payloadBytes.toLocaleString() + ' / ' +
                              capacityBytes.toLocaleString() + ' bytes (' +
                              analysis.utilization + '% - ' + analysis.recommendation + encSuffix + ')';

  // Update auto mode badge
  autoModeBadge.textContent = 'Auto: ' + analysis.mode + '-LSB';
  autoModeBadge.className = 'badge';
  if (analysis.mode === 1) {
    autoModeBadge.classList.add('bg-primary');
  } else if (analysis.mode === 2) {
    autoModeBadge.classList.add('bg-info');
  } else if (analysis.mode === 3) {
    autoModeBadge.classList.add('bg-warning');
  } else {
    autoModeBadge.classList.add('bg-danger');
  }
  
  // Store selected mode for encoding
  autoModeBadge.setAttribute('data-auto-mode', analysis.mode);
  
  // Update capacity badge
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                capacityBytes.toLocaleString() + ' bytes (' + analysis.mode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function updateManualModeAnalysis(payloadBytes, imageWidth, imageHeight, manualMode, encrypted) {
  var requiredBits = SENTINEL_BITS + (payloadBytes * 8);
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;
  var capacity = availablePixels * 3 * manualMode;
  
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var autoModeBadge = document.getElementById('auto-mode-badge');
  var capacityBadge = document.getElementById('capacity-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats || !autoModeBadge) return;
  
  if (requiredBits > capacity) {
    // Message too large for manual mode
    showCapacityError(payloadBytes, imageWidth, imageHeight, encrypted, { isManual: true, mode: manualMode });
    return;
  }
  
  capacityAnalysis.style.display = 'block';
  
  var utilization = (requiredBits / capacity * 100);
  usageBar.style.width = utilization.toFixed(1) + '%';
  usageBar.setAttribute('aria-valuenow', utilization.toFixed(1));
  
  // Set color
  usageBar.className = 'progress-bar';
  var badgeColor = 'bg-success';
  if (utilization < 60) {
    usageBar.classList.add('bg-success');
    badgeColor = 'bg-success';
  } else if (utilization < 85) {
    usageBar.classList.add('bg-warning');
    badgeColor = 'bg-warning';
  } else if (utilization < 95) {
    usageBar.classList.add('bg-orange');
    badgeColor = 'bg-warning';
  } else {
    usageBar.classList.add('bg-danger');
    badgeColor = 'bg-danger';
  }
  
  var capacityBytes = Math.floor(capacity / 8);
  var recommendation = getRecommendation(manualMode, utilization);
  var encSuffix = encrypted ? ', encrypted' : '';
  capacityStats.textContent = payloadBytes.toLocaleString() + ' / ' +
                              capacityBytes.toLocaleString() + ' bytes (' +
                              utilization.toFixed(1) + '% - ' + recommendation + encSuffix + ')';

  autoModeBadge.textContent = 'Manual: ' + manualMode + '-LSB';
  autoModeBadge.className = 'badge bg-secondary';
  autoModeBadge.setAttribute('data-auto-mode', manualMode);

  // Update capacity badge
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                capacityBytes.toLocaleString() + ' bytes (' + manualMode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function showCapacityError(payloadBytes, imageWidth, imageHeight, encrypted, modeInfo) {
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var capacityBadge = document.getElementById('capacity-badge');
  var autoModeBadge = document.getElementById('auto-mode-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats) return;
  
  capacityAnalysis.style.display = 'block';
  
  usageBar.style.width = '100%';
  usageBar.className = 'progress-bar bg-danger';
  
  // Calculate max capacity with 4-LSB
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;
  var maxCapacity = Math.floor((availablePixels * 3 * MAX_LSB_BITS) / 8);

  var kind = encrypted ? 'encrypted payload' : 'message';
  capacityStats.textContent = (encrypted ? 'Encrypted ' : '') + 'Message too large! ' +
                              payloadBytes.toLocaleString() + ' ' + kind + ' bytes exceed maximum capacity of ' +
                              maxCapacity.toLocaleString() + ' bytes';
  capacityStats.classList.add('text-danger');

  // Refresh the mode badge so it never shows a stale "Auto: N-LSB" from a
  // smaller previous payload. In manual mode it reflects the forced mode (so
  // changing the dropdown is visibly honored); in auto mode no mode fits, so
  // we show that explicitly rather than a misleading number.
  if (autoModeBadge) {
    if (modeInfo && modeInfo.isManual) {
      autoModeBadge.textContent = 'Manual: ' + modeInfo.mode + '-LSB';
      autoModeBadge.setAttribute('data-auto-mode', modeInfo.mode);
    } else {
      autoModeBadge.textContent = 'Auto: none fits';
      autoModeBadge.removeAttribute('data-auto-mode');
    }
    autoModeBadge.className = 'badge bg-danger';
  }

  // Update capacity badge to show error
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                maxCapacity.toLocaleString() + ' bytes (Too Large!)';
    capacityBadge.className = 'badge bg-danger';
  }
}

function detectLsbMode() {
  try {
    var canvas = DOM_CACHE.get('decodeCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var parsed = parseSentinelFromPixels(imageData.data);
    var detectedMode = parsed.lsbBits;
    var messageLength = parsed.messageLength;
    var isV3 = parsed.isV3;
    var isEncrypted = parsed.isEncrypted;
    var isCompressed = parsed.isCompressed;

    // Update UI (display only - decode does not trust DOM)
    var detector = document.getElementById('decode-mode-detector');
    var modeText = document.getElementById('detected-mode-text');
    var modeIcon = document.getElementById('detected-mode-icon');
    var encBadge = document.getElementById('detected-encrypted-badge');
    var compBadge = document.getElementById('detected-compressed-badge');
    var pwGroup = document.getElementById('decrypt-password-group');

    if (detector && modeText && modeIcon) {
      modeText.textContent = detectedMode + '-LSB';
      modeIcon.textContent = isV3 ? (isEncrypted ? '🔒' : '✓') : '⚠️';
      detector.style.display = 'block';

      // Store detected mode and message length for decode
      detector.setAttribute('data-detected-mode', detectedMode);
      detector.setAttribute('data-is-v3', isV3);
      detector.setAttribute('data-is-encrypted', isEncrypted);
      detector.setAttribute('data-is-compressed', isCompressed);
      detector.setAttribute('data-message-length', messageLength);

      // Reset manual override to hidden
      var autoDetected = document.getElementById('auto-detected');
      var manualSelect = document.getElementById('manual-mode-select');
      if (autoDetected) autoDetected.style.display = 'block';
      if (manualSelect) manualSelect.style.display = 'none';
    }
    if (encBadge) encBadge.style.display = isV3 && isEncrypted ? 'inline-block' : 'none';
    if (compBadge) compBadge.style.display = isV3 && isCompressed ? 'inline-block' : 'none';
    if (pwGroup) pwGroup.style.display = isV3 && isEncrypted ? 'block' : 'none';
  } catch (error) {
    console.error('Mode detection failed:', error);
  }
}

function previewEncodeImage(file) {
  if (!file) {
    file = document.querySelector("input[name=baseFile]").files[0];
  }

  clearEncodedCaches();
  bumpEncodeGeneration();     // New image invalidates any in-flight encode.
  toggleEncodeDropZonePreview(false);
  var toggleEncoded = document.getElementById('previewToggleEncoded');
  if (toggleEncoded) {
    toggleEncoded.checked = true;
  }

  if (!validateFileBasics(file)) return;

  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';

  validateMagicBytesAndDimensions(file).then(function(headerResult) {
    if (!headerResult) return;
    previewImage(file, '.original canvas', function(image, canvas) {
      try {
        var domCanvas = DOM_CACHE.get('originalCanvas');
        renderEncodeDropZonePreview(image);
        var lsbBits = 1;
        var availablePixels = (domCanvas.width * domCanvas.height) - SENTINEL_PIXELS;
        var totalBits = availablePixels * lsbBits * 3;
        var capacity = Math.floor(totalBits / 8);
        if (!validateCapacity(capacity)) return;
        var capacityBadge = document.getElementById('capacity-badge');
        if (capacityBadge) {
          capacityBadge.style.display = 'inline-block';
          capacityBadge.textContent = '💾 0 / ' + capacity.toLocaleString() + ' bytes (' + lsbBits + '-LSB)';
        }
        updateLsbInfoWithImageData(domCanvas.width, domCanvas.height, capacity, lsbBits);
        recomputePayloadAnalysis();
      } catch (error) {
        toggleEncodeDropZonePreview(false);
        showError('Error processing image: ' + error.message);
      }
    });
  });
}

function updateLsbInfoWithImageData(width, height, capacity, lsbBitsPerChannel) {
  lsbBitsPerChannel = lsbBitsPerChannel || 1;  // Default to 1-LSB if not provided
  
  var totalPixels = width * height;
  var availablePixels = totalPixels - SENTINEL_PIXELS;  // Subtract sentinel pixels
  var totalBitsInImage = totalPixels * 3 * 8;  // Total bits (all 8 bits per channel)
  var lsbBitsAvailable = availablePixels * 3 * lsbBitsPerChannel;  // Use selected LSB mode
  
  // Update image info using safe DOM creation
  var lsbImageInfo = document.getElementById('lsbImageInfo');
  lsbImageInfo.textContent = ''; // Clear existing content
  
  var createLine = function(text) {
    var line = document.createElement('div');
    line.textContent = text;
    return line;
  };
  
  var createCodeLine = function(label, value, suffix) {
    var line = document.createElement('div');
    line.textContent = label;
    var code = document.createElement('code');
    code.textContent = value;
    line.appendChild(code);
    if (suffix) {
      line.appendChild(document.createTextNode(' ' + suffix));
    }
    return line;
  };
  
  var strong = document.createElement('strong');
  strong.textContent = 'Your Image:';
  lsbImageInfo.appendChild(strong);
  lsbImageInfo.appendChild(document.createElement('br'));
  lsbImageInfo.appendChild(createCodeLine('Size: ', width + ' × ' + height, 'pixels'));
  lsbImageInfo.appendChild(createCodeLine('Total pixels: ', totalPixels.toLocaleString(), ''));
  lsbImageInfo.appendChild(createCodeLine('Sentinel overhead: ', '19 pixels (7 bytes)', ''));
  lsbImageInfo.appendChild(createCodeLine('Available pixels: ', availablePixels.toLocaleString(), ''));
  lsbImageInfo.appendChild(createCodeLine('Current mode: ', lsbBitsPerChannel + '-LSB', ''));
  lsbImageInfo.appendChild(createCodeLine('Capacity: ', capacity.toLocaleString(), 'bytes'));
  
  // Add per-mode capacity comparison
  lsbImageInfo.appendChild(document.createElement('br'));
  var strongModes = document.createElement('strong');
  strongModes.textContent = 'Capacity by LSB Mode:';
  lsbImageInfo.appendChild(strongModes);
  lsbImageInfo.appendChild(document.createElement('br'));
  
  for (var mode = 1; mode <= MAX_LSB_BITS; mode++) {
    var modeCapacity = Math.floor((availablePixels * 3 * mode) / 8);
    var indicator = mode === lsbBitsPerChannel ? ' ← Current' : '';
    lsbImageInfo.appendChild(createCodeLine(mode + '-LSB: ', modeCapacity.toLocaleString(), 'bytes' + indicator));
  }
  
  // Update calculation steps using safe DOM creation
  var lsbCalcSteps = document.getElementById('lsbCalcSteps');
  lsbCalcSteps.textContent = ''; // Clear existing content
  
  var strongCalc = document.createElement('strong');
  strongCalc.textContent = 'Step-by-step (v3 format):';
  lsbCalcSteps.appendChild(strongCalc);
  lsbCalcSteps.appendChild(document.createElement('br'));
  lsbCalcSteps.appendChild(createCodeLine('1. ', width.toLocaleString() + ' × ' + height.toLocaleString() + ' = ' + totalPixels.toLocaleString(), 'total pixels'));
  lsbCalcSteps.appendChild(createCodeLine('2. ', totalPixels.toLocaleString() + ' - 19 = ' + availablePixels.toLocaleString(), 'pixels (minus sentinel)'));
  lsbCalcSteps.appendChild(createCodeLine('3. ', availablePixels.toLocaleString() + ' × 3 × ' + lsbBitsPerChannel + ' = ' + lsbBitsAvailable.toLocaleString(), 'LSB bits'));
  lsbCalcSteps.appendChild(createCodeLine('4. ', lsbBitsAvailable.toLocaleString() + ' ÷ 8 = ' + capacity.toLocaleString(), 'bytes capacity'));
}

function previewImage(file, canvasSelector, callback, errorContext) {
  var image = new Image();
  var canvas = document.querySelector(canvasSelector);

  if (!file) return;

  image.onload = function() {
    canvas.width = image.width;
    canvas.height = image.height;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);
    callback(image, canvas);
  };

  image.onerror = function() {
    URL.revokeObjectURL(image.src);
    showError('Could not decode image. File may be corrupted or not a valid PNG, JPEG, or WebP.', errorContext);
  };

  image.src = URL.createObjectURL(file);
}

async function encodeMessage() {
  var encodeButton = document.querySelector('button.encode-btn');
  // Hard-coded original label: capturing textContent at entry would record a
  // stale "Encrypting..." if the user clicks twice in quick succession.
  var ORIGINAL_LABEL = 'Encode';

  var setBusy = function(txt) {
    if (encodeButton) encodeButton.textContent = txt;
  };
  // Guards double-exit: every exit path (success, error, silent-return,
  // top-level catch) is idempotent, so decrementing encodeInFlight twice
  // is impossible.
  var exitHandled = false;
  var _restoreButtonRaw = function() {
    if (encodeButton) {
      encodeButton.disabled = false;
      encodeButton.textContent = ORIGINAL_LABEL;
    }
  };
  // Normal exit: decrement in-flight and always restore the button.
  var restoreButton = function() {
    if (exitHandled) return;
    exitHandled = true;
    encodeInFlight--;
    _restoreButtonRaw();
  };
  // Silent-return (gen-mismatch) exit: decrement in-flight and only restore
  // the button if we were the last operation holding it busy. A newer
  // encodeMessage in flight owns the UI and will restore it later.
  var exitStale = function() {
    if (exitHandled) return;
    exitHandled = true;
    encodeInFlight--;
    if (encodeInFlight === 0) _restoreButtonRaw();
  };

  if (encodeButton) {
    encodeButton.disabled = true;
  }
  encodeInFlight++;

  // Start a new generation. Anything we await below must verify this is
  // still the current operation before touching the UI or cache.
  var myGen = ++encodeGeneration;

  clearEncodedCaches();

  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';
  document.querySelector('.binary').style.display = 'none';

  var workerPending = false;
  try {
    var payloadType = getPayloadType();
    var messageBytes;              // bytes handed to the LSB engine (before optional AES wrap)
    var payloadDescription;        // for error messages: 'message' vs 'file'

    if (payloadType === 'file') {
      payloadDescription = 'file';
      if (!SECRET_FILE || !SECRET_FILE.bytes || SECRET_FILE.bytes.length === 0) {
        showError('Please choose a file to hide.');
        restoreButton();
        return;
      }
      try {
        messageBytes = buildFileContainer(
          SECRET_FILE.bytes,
          SECRET_FILE.file.name || 'secret.bin',
          SECRET_FILE.file.type || 'application/octet-stream'
        );
      } catch (err) {
        showError('Could not package file: ' + (err && err.message ? err.message : err));
        restoreButton();
        return;
      }
      if (!validateMessageLength(messageBytes.length, 'file')) {
        restoreButton();
        return;
      }
    } else {
      payloadDescription = 'message';
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (!text || text.length === 0) {
        showError('Please enter a message to encode.');
        restoreButton();
        return;
      }
      messageBytes = TEXT_ENCODER.encode(text);
      if (!validateMessageLength(messageBytes.length)) {
        restoreButton();
        return;
      }
    }

    var encrypted = isEncryptionEnabled();
    if (encrypted) {
      if (!cryptoAvailable()) {
        showError('Encryption requires a secure context (HTTPS or localhost).');
        restoreButton();
        return;
      }
      // Encrypted payload also must fit within MAX_MESSAGE_LENGTH, so the
      // decoder's own limit never rejects it. Overhead is 45 bytes.
      // messageBytes here is already the file container when in file mode.
      if (messageBytes.length > MAX_MESSAGE_LENGTH - ENCRYPTION_OVERHEAD_BYTES) {
        showError((payloadType === 'file' ? 'File' : 'Message') +
                  ' too long for encryption. Maximum ' + payloadDescription +
                  ' size: ' +
                  (MAX_MESSAGE_LENGTH - ENCRYPTION_OVERHEAD_BYTES).toLocaleString() + ' bytes.');
        restoreButton();
        return;
      }
      if (!validateEncryptPasswords(true)) {
        restoreButton();
        return;
      }
    }

    var originalCanvas = DOM_CACHE.get('originalCanvas');
    var nulledCanvas = DOM_CACHE.get('nulledCanvas');
    var messageCanvas = DOM_CACHE.get('messageCanvas');

    if (!originalCanvas || !nulledCanvas || !messageCanvas || originalCanvas.width === 0) {
      showError('Please upload an image first.');
      restoreButton();
      return;
    }

    var width = originalCanvas.width;
    var height = originalCanvas.height;
    if (!validateImageDimensions(width, height)) {
      restoreButton();
      return;
    }

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      restoreButton();
      return;
    }

    var manualOverride = document.getElementById('manual-mode-override');
    var isManual = manualOverride && manualOverride.style.display !== 'none';
    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var maxCapacity4 = Math.floor((availablePixels * MAX_LSB_BITS * 3) / 8);

    // Compression stage (before encryption; ciphertext does not compress).
    // Compression is manual only - it runs when the user turns the toggle on.
    // We keep the compressed version only when it actually shrinks the
    // payload, so already-compressed data never grows.
    var wantCompress = isCompressionEnabled();
    var embedBytes = messageBytes;
    var compressed = false;

    if (wantCompress) {
      if (!compressionAvailable()) {
        showError('Compression requires a browser with CompressionStream support (Chrome 80+, Firefox 113+, Safari 16.4+).');
        restoreButton();
        return;
      }
      setBusy('Compressing...');
      var deflated;
      try {
        deflated = await StegCompress.compress(messageBytes);
      } catch (err) {
        if (encodeGeneration !== myGen) { exitStale(); return; }
        showError('Compression failed: ' + (err && err.message ? err.message : err));
        restoreButton();
        return;
      }
      if (encodeGeneration !== myGen) { exitStale(); return; }
      if (deflated.length < messageBytes.length) {
        embedBytes = deflated;
        compressed = true;
      }
      // else: compression didn't reduce size - store raw (even though the
      // toggle is on) so we never waste capacity on incompressible data.
    }

    // On-disk payload length (what gets hidden). Encrypted payload is
    // embed-bytes + 45; the sentinel's length field holds this value.
    var payloadLength = embedBytes.length + (encrypted ? ENCRYPTION_OVERHEAD_BYTES : 0);

    // Resolve LSB mode from the final payload size (self-contained; does not
    // trust the capacity badge) or from the manual override.
    var lsbBits;
    if (isManual) {
      lsbBits = parseInt(document.getElementById('manual-lsb-mode').value, 10);
    } else {
      var opt = calculateOptimalLSBMode(payloadLength, width, height);
      if (!opt) {
        showCompressionAwareCapacityError(payloadType, encrypted, compressed, wantCompress,
                                          payloadLength, maxCapacity4);
        restoreButton();
        return;
      }
      lsbBits = opt.mode;
    }

    var maxCapacity = Math.floor((availablePixels * lsbBits * 3) / 8);
    if (!validateCapacity(maxCapacity)) {
      restoreButton();
      return;
    }
    if (payloadLength > maxCapacity) {
      showCompressionAwareCapacityError(payloadType, encrypted, compressed, wantCompress,
                                        payloadLength, maxCapacity);
      restoreButton();
      return;
    }

    // Snapshot pixels and canvas contexts. The generation guard above already
    // discards results if the image was swapped during the compress await.
    var originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
    var messageContext = messageCanvas.getContext('2d', { willReadFrequently: true });
    messageCanvas.width = width;
    messageCanvas.height = height;
    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;

    var flags = composeFlags(encrypted, compressed);
    var payloadBytes;

    if (encrypted) {
      setBusy('Encrypting...');
      var sentinelAad = buildSentinelBytes(lsbBits, flags, payloadLength);
      var password = document.getElementById('encrypt-password').value;
      try {
        payloadBytes = await StegCrypto.encryptPayload(embedBytes, password, sentinelAad);
      } catch (err) {
        if (encodeGeneration !== myGen) { exitStale(); return; }
        showError(err.message || 'Encryption failed.');
        restoreButton();
        return;
      }
      if (encodeGeneration !== myGen) { exitStale(); return; }
      setBusy('Encoding...');
    } else {
      payloadBytes = embedBytes;
    }

    // Binary preview reflects the on-disk payload bits.
    var totalPayloadBits = payloadBytes.length * 8;
    var previewBits = Math.min(BINARY_PREVIEW_BITS, totalPayloadBits);
    var sentinelBinary = MAGIC_V3 +
      lsbBits.toString(2).padStart(4, '0') +
      flags +
      payloadBytes.length.toString(2).padStart(32, '0');
    var previewParts = [];
    for (var p = 0; p < previewBits; p++) previewParts.push(getBit(payloadBytes, p) ? '1' : '0');
    var binaryPreview = sentinelBinary + previewParts.join('');
    if (totalPayloadBits > BINARY_PREVIEW_BITS) {
      binaryPreview += ' ... truncated (' + totalPayloadBits.toLocaleString() + ' bits total)';
    }

    DOWNLOAD_CACHE.building['encoded'] = true;
    updateDownloadAvailability();

    var worker = startWorker('encode', 'lsb-encode-worker.js?v=3');
    worker.onmessage = function(ev) {
      finishWorker('encode', worker);
      if (encodeGeneration !== myGen) {
        DOWNLOAD_CACHE.building['encoded'] = false;
        updateDownloadAvailability();
        exitStale();
        return;
      }
      if (ev.data.type === 'error') {
        DOWNLOAD_CACHE.building['encoded'] = false;
        updateDownloadAvailability();
        showError(ev.data.message);
        restoreButton();
        return;
      }
      var resultImageData = new ImageData(new Uint8ClampedArray(ev.data.data), ev.data.width, ev.data.height);
      messageContext.putImageData(resultImageData, 0, 0);
      setDownloadCache('encoded', ev.data.blob, ev.data.width, ev.data.height);
      try {
        setEncodedPreviewVisibility(true);
        var toggleEncoded = document.getElementById('previewToggleEncoded');
        if (toggleEncoded) toggleEncoded.checked = true;
        setEncodedPreviewMode('encoded');
      } catch (previewError) {
        showError('Error rendering encoded preview: ' + previewError.message);
      }
      nulledCanvas.width = 0;
      nulledCanvas.height = 0;
      document.querySelector('.binary .card-body').textContent = binaryPreview;
      document.querySelector('.binary').style.display = 'block';
      restoreButton();
    };
    worker.onerror = function(err) {
      finishWorker('encode', worker);
      if (encodeGeneration !== myGen) { exitStale(); return; }
      DOWNLOAD_CACHE.building['encoded'] = false;
      updateDownloadAvailability();
      showError(err.message || 'Worker error');
      restoreButton();
    };
    workerPending = true;
    // Transfer the payload's ArrayBuffer instead of copying it into a plain
    // JS array (Array.from on a multi-MB file is slow and memory-heavy). All
    // payload producers above return exact-fit Uint8Arrays, but guard the
    // sliced-view case defensively so we never transfer extra bytes. The
    // worker's `new Uint8Array(e.data.messageBytes)` accepts an ArrayBuffer.
    var payloadBuffer = (payloadBytes.byteOffset === 0 &&
                         payloadBytes.byteLength === payloadBytes.buffer.byteLength)
      ? payloadBytes.buffer
      : payloadBytes.slice().buffer;
    worker.postMessage({
      type: 'encode',
      imageData: { width: width, height: height, data: buffer },
      messageBytes: payloadBuffer,
      lsbBits: lsbBits,
      flags: flags
    }, [buffer, payloadBuffer]);
    return;

  } catch (error) {
    showError('Error encoding message: ' + error.message);
    console.error('Encoding error:', error);
    // Idempotent: safe to call even if worker.onmessage/onerror already fired.
    restoreButton();
  }
}

var DECODE_TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

function decodeMessage() {
  var decodeButton = document.querySelector('button.decode-btn');
  // Hard-coded label (see encodeMessage for why we don't capture textContent).
  var ORIGINAL_LABEL = 'Decode';
  var setBusy = function(txt) { if (decodeButton) decodeButton.textContent = txt; };
  var exitHandled = false;
  var _restoreButtonRaw = function() {
    if (decodeButton) {
      decodeButton.disabled = false;
      decodeButton.textContent = ORIGINAL_LABEL;
    }
  };
  var restoreButton = function() {
    if (exitHandled) return;
    exitHandled = true;
    decodeInFlight--;
    _restoreButtonRaw();
  };
  var exitStale = function() {
    if (exitHandled) return;
    exitHandled = true;
    decodeInFlight--;
    if (decodeInFlight === 0) _restoreButtonRaw();
  };

  if (decodeButton) decodeButton.disabled = true;
  decodeInFlight++;

  // Start a new generation; invalidates any in-flight predecessor.
  var myGen = ++decodeGeneration;

  var errorDecode = DOM_CACHE.get('errorDecodeElement');
  if (errorDecode) errorDecode.style.display = 'none';

  var decodeWorkerPending = false;
  try {
    var originalCanvas = DOM_CACHE.get('decodeCanvas');
    if (!originalCanvas) {
      showError('Please upload an image first.', 'decode');
      restoreButton();
      return;
    }

    var width = originalCanvas.width;
    var height = originalCanvas.height;
    if (!validateImageDimensions(width, height)) {
      restoreButton();
      return;
    }
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      restoreButton();
      return;
    }

    var originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;

    decodeWorkerPending = true;
    var worker = startWorker('decode', 'lsb-decode-worker.js?v=4');
    worker.onmessage = function(ev) {
      finishWorker('decode', worker);
      if (decodeGeneration !== myGen) { exitStale(); return; }
      if (ev.data.type === 'error') {
        showError(ev.data.message, 'decode');
        restoreButton();
        return;
      }

      var messageLength = ev.data.messageLength;
      var lsbBits = ev.data.lsbBits;
      var maxCapacity = ev.data.maxCapacity;
      var flags = ev.data.flags;
      var wasCompressed = !!ev.data.compressed;

      if (ev.data.encrypted) {
        if (!cryptoAvailable()) {
          showError('This image is encrypted but the Web Crypto API is unavailable. Load the page over HTTPS or localhost.', 'decode');
          restoreButton();
          return;
        }
        if (wasCompressed && !compressionAvailable()) {
          showError('This image is compressed but CompressionStream is unavailable in this browser.', 'decode');
          restoreButton();
          return;
        }
        var pwEl = document.getElementById('decrypt-password');
        var password = pwEl ? pwEl.value : '';
        if (password.length === 0) {
          showError('This image is encrypted. Please enter the password.', 'decode');
          restoreButton();
          return;
        }
        setBusy('Decrypting...');
        var payloadBytes = new Uint8Array(ev.data.payloadBytes);
        var sentinelAad = buildSentinelBytes(lsbBits, flags, messageLength);
        StegCrypto.decryptPayload(payloadBytes, password, sentinelAad).then(function(plaintext) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          // Decrypted bytes are the embed payload: either the logical content
          // directly, or (if compressed) deflate-raw bytes to inflate first.
          if (!wasCompressed) {
            renderDecodedPayloadBytes(plaintext, messageLength, lsbBits, maxCapacity, true, false);
            restoreButton();
            return;
          }
          setBusy('Decompressing...');
          StegCompress.decompress(plaintext, MAX_MESSAGE_LENGTH).then(function(inflated) {
            if (decodeGeneration !== myGen) { exitStale(); return; }
            renderDecodedPayloadBytes(inflated, messageLength, lsbBits, maxCapacity, true, true);
            restoreButton();
          }).catch(function(derr) {
            if (decodeGeneration !== myGen) { exitStale(); return; }
            showError('Failed to decompress the hidden payload: ' + (derr && derr.message ? derr.message : derr), 'decode');
            restoreButton();
          });
        }).catch(function(err) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          showError(err.message || 'Wrong password or corrupted image.', 'decode');
          restoreButton();
        });
        return;
      }

      // Plaintext-but-compressed: inflate the raw bytes on the main thread,
      // then disambiguate file vs text.
      if (wasCompressed) {
        if (!compressionAvailable()) {
          showError('This image is compressed but CompressionStream is unavailable in this browser.', 'decode');
          restoreButton();
          return;
        }
        setBusy('Decompressing...');
        var rawCompressed = new Uint8Array(ev.data.payloadBytes);
        StegCompress.decompress(rawCompressed, MAX_MESSAGE_LENGTH).then(function(inflated) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          renderDecodedPayloadBytes(inflated, messageLength, lsbBits, maxCapacity, false, true);
          restoreButton();
        }).catch(function(derr) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          showError('Failed to decompress the hidden payload: ' + (derr && derr.message ? derr.message : derr), 'decode');
          restoreButton();
        });
        return;
      }

      // Plaintext, uncompressed: the worker already disambiguated file/text.
      if (ev.data.kind === 'file') {
        var fileContainer = {
          filename: ev.data.filename,
          mimeType: ev.data.mimeType,
          fileBytes: new Uint8Array(ev.data.fileBytes),
          crcValid: ev.data.crcValid,
          storedCrc: ev.data.storedCrc,
          version: ev.data.containerVersion
        };
        renderDecodedFile(fileContainer, messageLength, messageLength, lsbBits, maxCapacity, false, false);
        restoreButton();
        return;
      }
      renderDecodeOutput(ev.data.output, messageLength, messageLength, lsbBits, maxCapacity, false, false);
      restoreButton();
    };
    worker.onerror = function(err) {
      finishWorker('decode', worker);
      if (decodeGeneration !== myGen) { exitStale(); return; }
      showError(err.message || 'Worker error', 'decode');
      restoreButton();
    };
    worker.postMessage({
      type: 'decode',
      imageData: { width: width, height: height, data: buffer }
    }, [buffer]);
    return;

  } catch (error) {
    showError('Error decoding message: ' + error.message, 'decode');
    console.error('Decoding error:', error);
    // Idempotent: safe even if a worker/decrypt callback already restored.
    restoreButton();
  }
}

// Disambiguates fully-decrypted + inflated payload bytes as a file container
// or UTF-8 text and renders the matching card. The container magic is invalid
// UTF-8, so the sniff is safe to run before the fatal UTF-8 decode. On a
// structural/UTF-8 error it surfaces a decode error; the caller always calls
// restoreButton afterward regardless.
function renderDecodedPayloadBytes(bytes, storedLength, lsbBits, maxCapacity, encrypted, compressed) {
  if (hasFileContainerMagic(bytes)) {
    var container;
    try {
      container = parseFileContainer(bytes);
    } catch (containerErr) {
      showError('Hidden file container is corrupted: ' + containerErr.message, 'decode');
      return;
    }
    renderDecodedFile(container, bytes.length, storedLength, lsbBits, maxCapacity, encrypted, compressed);
    return;
  }
  var text;
  try {
    text = sanitizeDecodedMessage(DECODE_TEXT_DECODER.decode(bytes));
  } catch (utf8Err) {
    showError(encrypted
      ? 'Decrypted bytes are not valid UTF-8. The image may be corrupted.'
      : 'Decoded bytes are not valid UTF-8. The image may be corrupted.', 'decode');
    return;
  }
  renderDecodeOutput(text, bytes.length, storedLength, lsbBits, maxCapacity, encrypted, compressed);
}

// Shared capacity-bar renderer for both text and file decode results.
// plaintextLength is the logical content size after decrypt + inflate.
function renderDecodeCapacityBar(storedLength, lsbBits, maxCapacity, encrypted, plaintextLength, kind, compressed) {
  var utilizationPercent = Math.round((storedLength / maxCapacity) * 100);
  var availablePercent = 100 - utilizationPercent;

  document.getElementById('decode-capacity-used-bar').style.width = utilizationPercent + '%';
  document.getElementById('decode-capacity-used-text').textContent = 'Used: ' + utilizationPercent + '%';
  document.getElementById('decode-capacity-available-bar').style.width = availablePercent + '%';
  document.getElementById('decode-capacity-available-text').textContent = 'Available: ' + availablePercent + '%';

  var kindLabel = kind === 'file' ? 'file container' : 'message';
  var detail = 'Decoded ' + storedLength.toLocaleString() + ' bytes of ' +
               maxCapacity.toLocaleString() + ' total capacity (' + lsbBits + '-LSB mode). ' +
               (maxCapacity - storedLength).toLocaleString() + ' bytes unused.';
  if (encrypted) {
    detail += ' Encrypted' + (compressed ? ' + compressed' : '') + ' ' + kindLabel + '.';
  }
  if (compressed) {
    var ratio = plaintextLength > 0
      ? Math.max(0, Math.round((1 - (storedLength / plaintextLength)) * 100))
      : 0;
    detail += ' Compressed: ' + storedLength.toLocaleString() + ' bytes stored, decompressed to ' +
              plaintextLength.toLocaleString() + ' bytes (' + ratio + '% smaller on disk).';
  } else if (encrypted) {
    detail += ' ' + storedLength.toLocaleString() + ' bytes on disk, ' +
              plaintextLength.toLocaleString() + ' bytes plaintext (45 bytes overhead).';
  }
  document.getElementById('decode-capacity-details').textContent = detail;
  document.querySelector('.decode-capacity-bar').style.display = 'block';
}

function renderDecodeOutput(text, plaintextLength, storedLength, lsbBits, maxCapacity, encrypted, compressed) {
  // Hide the file-decode block in case a previous decode populated it.
  var fileBlock = document.querySelector('.file-decode');
  if (fileBlock) fileBlock.style.display = 'none';
  var previewWrap = document.getElementById('decoded-file-image-preview');
  if (previewWrap) previewWrap.style.display = 'none';
  if (LAST_DECODED_FILE && LAST_DECODED_FILE.previewUrl) {
    try { URL.revokeObjectURL(LAST_DECODED_FILE.previewUrl); } catch (e) { /* no-op */ }
  }
  LAST_DECODED_FILE = null;

  renderDecodeCapacityBar(storedLength, lsbBits, maxCapacity, encrypted, plaintextLength, 'text', compressed);

  document.getElementById('decoded-message-text').textContent = text;
  document.querySelector('.binary-decode').style.display = 'block';

  // Hold the exact decoded string for the Copy / Download buttons and enable
  // them. Any stale "Copied!" label from a previous decode is reset.
  LAST_DECODED_TEXT = text;
  resetDecodedCopyLabel();
  setDecodedActionsEnabled(true);
}

// Renders the Decoded File card plus an image preview when the MIME type is
// a browser-decodable image. storedLength is the on-disk payload length
// (container, or encrypted-wrapped container); plaintextLength is the
// container length (ignored when === storedLength for plaintext payloads).
function renderDecodedFile(container, plaintextLength, storedLength, lsbBits, maxCapacity, encrypted, compressed) {
  // Hide the text block in case a previous decode populated it.
  var textBlock = document.querySelector('.binary-decode');
  if (textBlock) textBlock.style.display = 'none';
  setDecodedActionsEnabled(false);
  LAST_DECODED_TEXT = '';

  renderDecodeCapacityBar(storedLength, lsbBits, maxCapacity, encrypted, plaintextLength, 'file', compressed);

  var filename = container.filename || 'secret.bin';
  var mime = container.mimeType || 'application/octet-stream';
  var size = container.fileBytes.length;
  var crcValid = container.crcValid !== false;

  var nameEl = document.getElementById('decoded-file-name');
  var mimeEl = document.getElementById('decoded-file-mime');
  var sizeEl = document.getElementById('decoded-file-size');
  var crcEl = document.getElementById('decoded-file-crc');
  if (nameEl) nameEl.textContent = filename;
  if (mimeEl) mimeEl.textContent = mime;
  if (sizeEl) sizeEl.textContent = formatBytes(size);
  if (crcEl) {
    if (crcValid) {
      crcEl.innerHTML = '';
      var okBadge = document.createElement('span');
      okBadge.className = 'badge bg-success';
      okBadge.textContent = 'CRC32 OK';
      crcEl.appendChild(okBadge);
      crcEl.appendChild(document.createTextNode(' (0x' + container.storedCrc.toString(16).padStart(8, '0') + ')'));
    } else {
      crcEl.innerHTML = '';
      var badBadge = document.createElement('span');
      badBadge.className = 'badge bg-danger';
      badBadge.textContent = 'CRC32 mismatch';
      crcEl.appendChild(badBadge);
      crcEl.appendChild(document.createTextNode(' - the file bytes do not match the stored checksum. The carrier image may have been re-encoded.'));
    }
  }

  // Revoke any older preview URL before replacing it.
  if (LAST_DECODED_FILE && LAST_DECODED_FILE.previewUrl) {
    try { URL.revokeObjectURL(LAST_DECODED_FILE.previewUrl); } catch (e) { /* no-op */ }
  }

  LAST_DECODED_FILE = {
    bytes: container.fileBytes,
    filename: filename,
    mimeType: mime,
    crcValid: crcValid,
    storedCrc: container.storedCrc,
    previewUrl: null
  };

  // Image preview, best-effort. Skip when CRC fails since the bytes are
  // likely garbage and would just show a broken image.
  var previewWrap = document.getElementById('decoded-file-image-preview');
  var img = previewWrap ? previewWrap.querySelector('img') : null;
  if (previewWrap && img) {
    var looksLikeImage = /^image\//i.test(mime) && crcValid;
    if (looksLikeImage) {
      try {
        var blob = new Blob([container.fileBytes], { type: mime });
        var url = URL.createObjectURL(blob);
        LAST_DECODED_FILE.previewUrl = url;
        img.src = url;
        img.alt = filename;
        previewWrap.style.display = 'block';
      } catch (e) {
        previewWrap.style.display = 'none';
      }
    } else {
      img.removeAttribute('src');
      previewWrap.style.display = 'none';
    }
  }

  var fileBlock = document.querySelector('.file-decode');
  if (fileBlock) fileBlock.style.display = 'block';
  var dlBtn = document.getElementById('decoded-file-download-btn');
  if (dlBtn) dlBtn.disabled = false;
}

// Saves LAST_DECODED_FILE through showSaveFilePicker when available, with
// an anchor fallback. Mirrors downloadDecodedMessage so Firefox/Safari
// still work and Chrome avoids the download-manager delay.
async function downloadDecodedFile() {
  var entry = LAST_DECODED_FILE;
  if (!entry) return;
  var filename = entry.filename || 'secret.bin';
  var mime = entry.mimeType || 'application/octet-stream';
  var blob = new Blob([entry.bytes], { type: mime });

  if (window.showSaveFilePicker) {
    try {
      // Build an accept entry so the save dialog defaults to the right ext.
      // The File System Access API rejects empty extension strings, so only
      // pass `types` when we actually have a valid extension; otherwise let
      // the picker default based on the suggested name alone.
      var pickerOpts = { suggestedName: filename };
      var ext = extensionFromFilename(filename);
      if (ext) {
        var accept = {};
        accept[mime] = [ext];
        pickerOpts.types = [{ description: 'Hidden file', accept: accept }];
      }
      var handle = await window.showSaveFilePicker(pickerOpts);
      try {
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (writeErr) {
        showError('Error saving file: ' + (writeErr && writeErr.message ? writeErr.message : writeErr), 'decode');
        return;
      }
    } catch (pickerErr) {
      if (pickerErr && pickerErr.name === 'AbortError') return;
      // Fall through on any other picker error.
    }
  }

  var url = URL.createObjectURL(blob);
  try {
    var link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(function() { URL.revokeObjectURL(url); }, 0);
  }
}

// Returns the extension (including dot) from a filename, or '' when none.
// Used by the save picker's accept map so the suggested extension matches
// the stored filename.
function extensionFromFilename(name) {
  if (typeof name !== 'string') return '';
  var dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  var ext = name.slice(dot);
  if (!/^\.[A-Za-z0-9._-]{1,16}$/.test(ext)) return '';
  return ext;
}
