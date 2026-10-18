# Steganography Online — Enhanced Edition

A browser-based LSB steganography tool with an optional AES-256-GCM
confidentiality mode. Fork of the original
[stylesuxx/steganography](https://github.com/stylesuxx/steganography) (2014),
with modern security, UTF-8 support, Web Worker performance, and an
interactive capacity/preview UI.

## Live demo

- Enhanced version: [st4rkillax.github.io/steganography](https://st4rkillax.github.io/steganography/)
- Original: [stylesuxx.github.io/steganography](http://stylesuxx.github.io/steganography/)

> **Note:** This enhanced edition was built with [Cursor](https://cursor.com)
> and Claude (Anthropic). The baseline is the original hand-written project
> by [stylesuxx](https://github.com/stylesuxx); the enhancements, UI rework,
> and confidentiality mode in this fork were generated through AI-assisted
> development.

## About

Steganography is the practice of hiding a message inside something ordinary
— here, a text message inside the pixels of an image. See the
[Wikipedia article](http://en.wikipedia.org/wiki/Steganography) for the long
version.

LSB steganography on its own only hides *that* a message exists, not its
contents. Flip on the **Encrypt with password** switch when you also need
confidentiality — the message is run through AES-256-GCM before it is hidden,
so it can't be read even if the image is inspected.

## Features

**Encoding**
- Smart auto LSB mode selection (1–4 bits) based on message size
- Manual mode override
- Live character counter and capacity-utilization badges
- Drag-and-drop file upload with inline preview
- Original / Encoded toggle in a dedicated preview area

**Confidentiality (optional)**
- AES-256-GCM with a password-derived key (PBKDF2-SHA256, 600,000 iterations)
- Sentinel is included in GCM additional data, so tampering with the LSB mode,
  flag bits, or length makes decryption fail
- See [Confidentiality mode](#confidentiality-mode) for details

**Decoding**
- Automatic LSB mode detection from the fixed sentinel
- Automatic encrypted-image detection with a password prompt
- Manual mode override and capacity utilization readout
- Copy and Download (`.txt`) buttons on the decoded message, with direct
  save via `showSaveFilePicker` and anchor fallback

**UX**
- Dark / light theme toggle with `localStorage` persistence
- Bootstrap 5.3 card layout, mobile-responsive
- In-page educational cards explaining steganography and the v3 format
- Direct download buttons (no right-click-and-save)

**Performance**
- LSB encode/decode and PNG conversion run in Web Workers (main thread
  stays responsive on large images)
- OffscreenCanvas + `convertToBlob` for Worker-side PNG encoding
- Pre-computed blob cache so Save is instant
- File System Access API (`showSaveFilePicker`) in Chrome/Edge bypasses
  the download manager and its `.crdownload` / scanning delays; falls
  back to anchor download in Firefox/Safari
- Blob URLs revoked on cache invalidation (new encode, tab switch)

**Security & validation**
- Comprehensive input validation (file type, magic bytes, dimensions, size)
- UTF-8 encoding via `TextEncoder` / `TextDecoder` (removes the legacy
  `charCodeAt` ceiling)
- XSS protection via safe DOM manipulation (no `innerHTML` for user data)
- Memory-leak prevention and rate limiting on file operations
- GIF upload removed (incompatible with LSB)

**Accessibility**
- Keyboard navigation
- ARIA labels for screen readers
- High-contrast-mode compatible

## How it works

### v3 format — fixed sentinel architecture

A two-layer encoding system for reliable detection and optimal capacity.

**Layer 1 — fixed sentinel (always 1-LSB)**

The first 19 pixels store metadata in stealth 1-LSB mode:

- Magic number: `0xAA55` (16 bits) for format detection
- LSB mode: 4 bits (values 1–4) used for the message
- Flags / reserved: 4 bits (`1000` marks the payload as encrypted)
- Message length: 32 bits (up to 4 GB)
- Total overhead: 56 bits (7 bytes)

**Layer 2 — variable message (auto-selected N-LSB)**

The remaining pixels encode the payload at the detected N-LSB mode.

### LSB mode comparison

| Mode  | Capacity | Visual impact        | Overhead | Use case          |
|-------|----------|----------------------|----------|-------------------|
| 1-LSB | Baseline | Invisible (±1)       | 7 bytes  | Maximum stealth   |
| 2-LSB | 2× more  | Barely visible (±3)  | 7 bytes  | Balanced          |
| 3-LSB | 3× more  | Slight noise (±7)    | 7 bytes  | Large messages    |
| 4-LSB | 4× more  | Visible (±15)        | 7 bytes  | Maximum capacity  |

### Encode / decode flow

1. **Auto-selection:** the UI calculates the minimum LSB mode needed for
   your message (plus 45 bytes if encryption is on).
2. **Normalization:** the image is cleared — 1-LSB for sentinel pixels,
   N-LSB for message pixels.
3. **Sentinel encoding:** the first 19 pixels encode metadata using 1-LSB
   (so detection is 100% reliable regardless of the message's LSB mode).
4. **Message encoding:** the remaining pixels encode the payload at the
   auto-selected N-LSB mode.
5. **Detection:** the decoder always reads the first 19 pixels in 1-LSB
   mode and validates the `0xAA55` magic number.
6. **Decoding:** the message is extracted using the LSB mode the sentinel
   advertised; if the encrypted flag is set, the payload is handed to
   the AES-GCM decryption step.

### Capacity formula

```
Available Pixels = (Width × Height) - 19
Capacity         = (Available Pixels × N × 3) ÷ 8  bytes
```

(Subtract 45 bytes from capacity when encryption is enabled, for the
version byte, salt, IV, and GCM tag.)

## Confidentiality mode

The optional **Encrypt with password** switch runs the message through
AES-256-GCM before it is hidden in the image. The key is derived from the
password with PBKDF2-SHA256 (600,000 iterations), both from the browser's
built-in Web Crypto API, so there is no third-party crypto dependency.

### Payload layout (version 1, 45-byte overhead)

```
byte 0        version (0x01)
bytes 1-16    salt (16 random bytes)
bytes 17-28   IV (12 random bytes)
bytes 29..    ciphertext + GCM authentication tag (plaintext + 16 bytes)
```

The GCM additional data is 8 bytes: `[version, ...canonical 7-byte sentinel]`.
The sentinel encodes the LSB mode, a 4-bit flags field (`1000` for
encrypted), and the 32-bit payload length, so flipping any of these in the
image makes decryption fail with a generic
"Wrong password or corrupted image" error.

### What this gives you

- Hides *what the message says* and detects tampering of the ciphertext,
  sentinel, salt, IV, or version.
- Separates cleanly from the LSB layer — encryption can be audited in
  isolation (`crypto.js` has no DOM or steganography dependencies).

### What it does not give you

- **Steganographic concealment:** the `0xAA55` magic number and the
  encryption flag still reveal that a message exists and is encrypted.
- **Password recovery:** there is none. Pick a strong password.
- **Resilience to re-encoding:** cropping, resizing, or re-saving the PNG
  (which many social-media sites do automatically) destroys the hidden
  message.

### Legacy decoder behavior

Older builds of this app (before the confidentiality mode) don't recognize
the encryption flag. Opening a new encrypted image in an older build hits
the strict UTF-8 decode in the decode worker and fails cleanly rather than
displaying garbage.

## Browser requirements

- Web Workers and OffscreenCanvas (modern browsers; Safari 16.4+)
- Encryption requires a secure context (HTTPS or `localhost`) for the
  Web Crypto API

## Tech stack

- Pure vanilla JavaScript (no jQuery)
- Bootstrap 5.3.8
- HTML5 Canvas API
- Web Workers + OffscreenCanvas for encode/decode
- Web Crypto API (PBKDF2-SHA256 + AES-256-GCM) for the optional
  confidentiality mode
- CSS variables for theming
- No external dependencies for core functionality

## Credits

- Original project: © 2014 [stylesuxx](https://github.com/stylesuxx) —
  [Steganography Online](http://stylesuxx.github.io/steganography/)
- Enhanced edition: © 2026 [ST4RKiLLaX](https://github.com/ST4RKiLLaX)

## License

Original work © 2014 stylesuxx. Enhanced version © 2026 ST4RKiLLaX. See the
original project for its license terms; the enhancements in this fork are
provided under the same terms.
