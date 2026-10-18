// AES-256-GCM confidentiality mode with PBKDF2-SHA256 key derivation.
// DOM-free so tests.html and the main app can both import it.
//
// Payload layout (version 1, 45-byte overhead):
//   byte 0        version
//   bytes 1-16    salt (16, random per encryption)
//   bytes 17-28   IV (12, random per encryption)
//   bytes 29..    ciphertext + GCM tag (plaintext length + 16)
//
// GCM additional data is 8 bytes: [version, ...canonical 7-byte sentinel].
// This authenticates the LSB mode, flag bits, and payload length - flipping
// any of them in the image makes decryption fail with a tag error.

(function(global) {
  'use strict';

  var ENC_UTF8 = new TextEncoder();

  function isCryptoAvailable() {
    return typeof global.crypto !== 'undefined' &&
           typeof global.crypto.subtle !== 'undefined' &&
           typeof global.crypto.getRandomValues === 'function';
  }

  function requireCrypto() {
    if (!isCryptoAvailable()) {
      throw new Error('Web Crypto API is not available. Encryption requires a secure context (HTTPS or localhost).');
    }
  }

  // Validates framing before any key derivation. Returns the parsed header
  // on success, throws on invalid version or truncated payload.
  function parsePayloadHeader(payloadBytes) {
    if (!(payloadBytes instanceof Uint8Array)) {
      throw new Error('Encrypted payload is not binary data.');
    }
    if (payloadBytes.length < ENCRYPTION_MIN_PAYLOAD_BYTES) {
      throw new Error('Encrypted payload is too short (' + payloadBytes.length +
                      ' bytes; minimum ' + ENCRYPTION_MIN_PAYLOAD_BYTES + ').');
    }
    var version = payloadBytes[0];
    if (version !== ENCRYPTION_PAYLOAD_VERSION) {
      throw new Error('Unsupported encryption version: ' + version +
                      '. This image may have been encrypted by a newer tool version.');
    }
    return {
      version: version,
      saltOffset: 1,
      ivOffset: 1 + SALT_BYTES,
      ciphertextOffset: ENCRYPTION_HEADER_BYTES,
      ciphertextLength: payloadBytes.length - ENCRYPTION_HEADER_BYTES
    };
  }

  function buildAdditionalData(version, sentinelBytes) {
    if (!(sentinelBytes instanceof Uint8Array) || sentinelBytes.length !== SENTINEL_BYTES) {
      throw new Error('Invalid sentinel for additional data.');
    }
    var aad = new Uint8Array(1 + SENTINEL_BYTES);
    aad[0] = version;
    aad.set(sentinelBytes, 1);
    return aad;
  }

  // Derives a non-extractable AES-256 key. The returned CryptoKey cannot be
  // exported back to raw bytes, so the derived key never leaves WebCrypto.
  async function deriveKey(password, salt) {
    if (typeof password !== 'string') {
      throw new Error('Password must be a string.');
    }
    var pwBytes = ENC_UTF8.encode(password);  // No trimming or normalization.
    try {
      var baseKey = await global.crypto.subtle.importKey(
        'raw',
        pwBytes,
        'PBKDF2',
        false,
        ['deriveKey']
      );
      return await global.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,                                 // non-extractable
        ['encrypt', 'decrypt']
      );
    } finally {
      // Overwrite the raw password bytes; the base key is already in
      // WebCrypto, which holds its own copy.
      pwBytes.fill(0);
    }
  }

  // Produces the full on-disk payload bytes (version + salt + iv + ct|tag).
  // Caller must pass the canonical sentinel bytes with messageLength set to
  // plaintext length + ENCRYPTION_OVERHEAD_BYTES so AAD matches at decrypt.
  async function encryptPayload(plaintextBytes, password, sentinelBytes) {
    requireCrypto();
    if (!(plaintextBytes instanceof Uint8Array)) {
      throw new Error('Plaintext must be a Uint8Array.');
    }
    if (plaintextBytes.length === 0) {
      throw new Error('Cannot encrypt an empty message.');
    }
    var version = ENCRYPTION_PAYLOAD_VERSION;
    var aad = buildAdditionalData(version, sentinelBytes);

    var salt = new Uint8Array(SALT_BYTES);
    global.crypto.getRandomValues(salt);
    var iv = new Uint8Array(IV_BYTES);
    global.crypto.getRandomValues(iv);

    var key = await deriveKey(password, salt);
    var ctBuf = await global.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 },
      key,
      plaintextBytes
    );
    var ct = new Uint8Array(ctBuf);

    var expectedCtLen = plaintextBytes.length + GCM_TAG_BYTES;
    if (ct.length !== expectedCtLen) {
      throw new Error('Internal error: unexpected ciphertext length.');
    }

    var payload = new Uint8Array(ENCRYPTION_HEADER_BYTES + ct.length);
    payload[0] = version;
    payload.set(salt, 1);
    payload.set(iv, 1 + SALT_BYTES);
    payload.set(ct, ENCRYPTION_HEADER_BYTES);
    return payload;
  }

  // Returns plaintext bytes. Wrong password, tampered ciphertext, or
  // tampered sentinel all throw the same generic error.
  async function decryptPayload(payloadBytes, password, sentinelBytes) {
    requireCrypto();
    var header = parsePayloadHeader(payloadBytes);   // throws on truncation / bad version
    var aad = buildAdditionalData(header.version, sentinelBytes);

    var salt = payloadBytes.subarray(header.saltOffset, header.saltOffset + SALT_BYTES);
    var iv = payloadBytes.subarray(header.ivOffset, header.ivOffset + IV_BYTES);
    var ct = payloadBytes.subarray(header.ciphertextOffset);

    var key = await deriveKey(password, salt);
    try {
      var ptBuf = await global.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 },
        key,
        ct
      );
      return new Uint8Array(ptBuf);
    } catch (err) {
      // OperationError covers both wrong password and tampered input.
      // Collapse everything into one generic error - never reveal which.
      throw new Error('Wrong password or corrupted image.');
    }
  }

  var api = {
    isCryptoAvailable: isCryptoAvailable,
    parsePayloadHeader: parsePayloadHeader,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.StegCrypto = api;
  }
})(typeof self !== 'undefined' ? self : this);
