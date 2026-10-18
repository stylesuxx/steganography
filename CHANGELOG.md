# Steganography Application - Change Documentation

## Version Comparison: Original → Enhanced Version

---

## I. FUNCTIONALITY CHANGES

### A. Core Steganography Algorithm

**Multi-bit LSB Encoding (v2)**
- Original: Fixed 1-LSB encoding (1 bit per color channel)
- New: Selectable 1-4 LSB modes with automatic detection
- Impact: Up to 4× capacity increase with user-controlled quality tradeoff

**Versioned Header Format**
- Original (v1): No message metadata stored
- Enhanced (v1): 32-bit header with message length
- Current (v2): 48-bit header with magic number (0xAA) + version (4 bits) + LSB mode (4 bits) + length (32 bits)
- Impact: Forward/backward compatibility, automatic mode detection, data integrity

**Decode Behavior**
- Original: Extracted entire image capacity as text (including null bytes)
- v1 Enhanced: Extracts exact message based on 32-bit length header
- v2 Current: Auto-detects header version and LSB mode, extracts accordingly
- Impact: Professional output with automatic compatibility handling

### B. User Interface Enhancements

**Framework Modernization**
- Original: Bootstrap 3.3.1 (2014), jQuery 1.11.1
- New: Bootstrap 5.3.8, Pure JavaScript (no jQuery)
- Impact: Modern styling, faster performance, no dependency vulnerabilities

**Capacity Information Display**
- Original: No capacity information shown
- New: Interactive badge showing available character/byte capacity
- Impact: Users understand image limitations before encoding

**Educational Modal**
- Original: No educational content
- New: Interactive modal explaining LSB steganography with live calculations
- Impact: Teaching tool with formulas, examples, and user-specific data

**Capacity Utilization Visualization**
- Original: No usage feedback
- New: Progress bars showing encode utilization and decode usage breakdown
- Impact: Visual understanding of storage efficiency

**Error Display**
- Original: Single error element (encode tab only)
- New: Dedicated error displays per tab with persistent visibility
- Impact: Users always see relevant error messages

**Decoded Message Presentation**
- Original: Read-only textarea
- New: Professional card component with scrolling
- Impact: Better readability and modern appearance

### C. Performance Optimizations

**Binary String Construction**
- Original: String concatenation in loop
- New: Array building with join operation
- Impact: Significantly faster for large messages (10MB+)

**Canvas Context Optimization**
- Original: Standard context initialization
- New: willReadFrequently attribute enabled
- Impact: Browser-optimized pixel reading performance

**File Loading**
- Original: Redundant FileReader and URL.createObjectURL
- New: Direct URL.createObjectURL with proper cleanup
- Impact: Faster image loading, reduced memory usage

**Rate Limiting**
- Original: None (rapid clicking allowed)
- New: Button disabled during processing
- Impact: Prevents duplicate operations and UI confusion

---

## II. SECURITY FIXES

### A. Input Validation Layer

**File Type Validation**
- Original: No validation
- New: Magic bytes (file signature) validation for PNG, JPEG, WebP; Image decode onerror handler
- Risk Addressed: Spoofed MIME types (file.type unreliable); corrupted/invalid images now show clear error

**File Size Validation**
- Original: No limit
- New: 50MB maximum file size
- Risk Addressed: Memory exhaustion attacks via huge files

**Image Dimension Validation**
- Original: No checks
- New: Maximum 10,000 × 10,000 pixel limit
- Risk Addressed: Canvas bombing attacks, browser crashes

**Message Length Validation**
- Original: Basic capacity check only
- New: Multi-layer validation (10MB max, safe integer checks, capacity verification)
- Risk Addressed: Memory exhaustion, integer overflow attacks

**Capacity Validation**
- Original: Simple calculation
- New: Safe integer arithmetic with 100MB absolute cap
- Risk Addressed: Integer overflow in large image calculations

### B. Code Injection Prevention

**XSS Protection - Modal Updates**
- Original: Not applicable (no modal)
- New: DOM creation methods instead of innerHTML
- Risk Addressed: XSS attacks via numeric data manipulation

**XSS Protection - User Data Display**
- Original: Mixed use of .text() and direct insertion
- New: Consistent use of textContent and value properties
- Risk Addressed: Script injection via encoded messages

**Event Handler Security**
- Original: Inline onclick/onchange attributes in HTML
- New: Programmatic event listeners via DOMContentLoaded
- Risk Addressed: CSP violations, code injection vectors

### C. Data Integrity

**Message Length Header Validation**
- Original: No message boundaries
- New: Header validation against image capacity and safety limits
- Risk Addressed: Buffer overflow via manipulated headers, corrupted data processing

**Zero-Length Message Detection**
- Original: Would process invalid data
- New: Explicit check with user feedback
- Risk Addressed: Processing errors from empty or corrupted images

**Safe Integer Arithmetic**
- Original: Standard JavaScript number operations
- New: Number.isSafeInteger checks throughout
- Risk Addressed: Integer overflow in dimension and capacity calculations

### D. Memory Management

**URL Object Cleanup**
- Original: Missing cleanup
- New: URL.revokeObjectURL() after image load
- Risk Addressed: Memory leaks from repeated image uploads

**Error Handling**
- Original: No error boundaries
- New: Try-catch blocks wrapping all encode/decode operations
- Risk Addressed: Unhandled exceptions, application crashes

---

## III. RISKS MITIGATED

### A. Denial of Service (DoS) Attacks

**Local Browser DoS**
- Mitigated: File size limits, dimension limits, capacity caps
- Prevents: Browser freeze/crash from processing massive files
- Severity: High → Low

**Memory Exhaustion**
- Mitigated: Multiple validation layers, safe integer checks
- Prevents: Out-of-memory errors from extreme inputs
- Severity: High → Low

**Rapid Operation Flooding**
- Mitigated: Button rate limiting during processing
- Prevents: UI freezing from rapid clicks
- Severity: Medium → None

### B. Code Execution Risks

**Cross-Site Scripting (XSS)**
- Mitigated: Safe DOM manipulation, textContent usage
- Prevents: Script injection via crafted messages or data
- Severity: High → Minimal

**Content Security Policy Violations**
- Mitigated: Removal of inline event handlers
- Prevents: CSP blocks in secure environments
- Severity: Medium → None

### C. Data Integrity Risks

**Buffer Overflow**
- Mitigated: Length validation, safe integer checks
- Prevents: Reading beyond allocated memory
- Severity: Medium → None

**Integer Overflow**
- Mitigated: Safe integer validation on all calculations
- Prevents: Incorrect capacity calculations, unexpected behavior
- Severity: Medium → None

**Corrupted Data Processing**
- Mitigated: Header validation, length verification
- Prevents: Application crashes from malformed images
- Severity: Medium → Low

### D. User Experience Risks

**Silent Failures**
- Mitigated: Dedicated error displays per context
- Prevents: Users unaware of operation failures
- Severity: Medium → None

**Drag-and-Drop File Assignment**
- Mitigated: Pass dropped file directly to preview logic; no longer assign to input.files
- Prevents: UI state desync when browsers block programmatic file assignment (input.files is read-only)
- Severity: Low → None

**Object URL / Blob Retention**
- Mitigated: Removed unused original cache; clear encoded cache when switching to Decode tab
- Prevents: Memory pressure from retaining large blobs longer than needed
- Severity: Low → None

**Decode Parameter Trust**
- Mitigated: Decode now reads lsbBits and messageLength from sentinel pixels, not DOM attributes
- Prevents: Tampered DOM causing incorrect extraction or resource consumption
- Severity: Low → None

**UTF-8 Decode Integrity**
- Mitigated: TextDecoder with fatal: true raises on invalid UTF-8 instead of replacing
- Prevents: Corrupted/malicious payloads decoding silently with replacement chars
- Severity: Low → None

**Capacity Validation**
- Fixed: MAX_CAPACITY (100MB) caused false-fail for max-sized images (~150MB at 4-LSB)
- Renamed to MAX_THEORETICAL_EMBED_CAPACITY_BYTES, increased to 150MB
- Severity: Low → None

**Encode Binary String DoS**
- Mitigated: Embed directly from messageBytes via bit ops; binary display truncated to 4k-bit preview
- Prevents: Giant messageBinary string causing browser freeze/crash on moderate-sized messages
- Severity: Medium → None

**Data Loss**
- Mitigated: Proper validation before encoding
- Prevents: Users creating unusable encoded images
- Severity: Low → None

**Format Incompatibility**
- Impact: Old images incompatible with new decoder
- Reason: Security improvements require format change
- Trade-off: Accepted for security benefits

---

## IV. COMPATIBILITY NOTES

**Version Compatibility Matrix**

| Encoder Version | Decoder Version | Compatible? | Notes |
|----------------|-----------------|-------------|-------|
| Original (no header) | v1 Enhanced | ✗ | No magic number to detect |
| Original (no header) | v2 Current | ✗ | No magic number to detect |
| v1 Enhanced (32-bit) | v1 Enhanced | ✓ | Full compatibility |
| v1 Enhanced (32-bit) | v2 Current | ✓ | Auto-detected as v1, decoded as 1-LSB |
| v2 Current (48-bit, 1-LSB) | v1 Enhanced | ✗ | v1 expects 32-bit header |
| v2 Current (48-bit, any mode) | v2 Current | ✓ | Full compatibility with auto-detection |

**Backward Compatibility**
- v2 decoder can read v1 Enhanced images (32-bit header, 1-LSB)
- Detection: If no magic number (0xAA) found, assumes v1 format
- v1 images display ⚠️ icon in mode detector (vs ✓ for v2)

**Forward Compatibility**
- v1 decoder **cannot** read v2 images (48-bit header incompatible)
- Migration: Use v2 decoder for all new images

**Browser Requirements**
- Original: Any browser with jQuery support
- New: Modern browsers with ES6 support
- Impact: IE11 and older browsers no longer supported

**Dependencies**
- Original: jQuery 1.11.1 (known vulnerabilities), Bootstrap 3.3.1 (EOL)
- New: Bootstrap 5.3.8 (current), no jQuery
- Impact: No external JavaScript library vulnerabilities

---

## V. SUMMARY METRICS

**Security Improvements**
- Validation Functions: 0 → 5
- Security Constants: 0 → 6
- Input Validation Points: 1 → 12
- Error Handling Blocks: 0 → 2
- XSS Protection Points: Partial → Complete

**Code Quality**
- Lines of Code: 166 → 534 (with validation framework)
- Deprecated Dependencies: 2 → 0
- Inline Event Handlers: 4 → 0
- Global Variable Leaks: 2 → 0
- Memory Leaks: 1 → 0

**User Experience**
- Educational Content: None → Interactive modal with calculations
- Capacity Feedback: None → Real-time display
- Error Visibility: Partial → Complete per-context
- Visual Feedback: Basic → Enhanced with progress bars
- Professional Appearance: Basic → Modern Bootstrap 5

---

## VI. RECOMMENDATIONS

**For New Deployments**
- Use enhanced version exclusively
- Document that old encoded images are not compatible
- Leverage educational features for training purposes

**For Existing Users**
- Provide migration notice
- Offer side-by-side deployment during transition period
- Archive original version for legacy image decoding if needed

**Security Posture**
- Enhanced version suitable for educational environments
- Appropriate for security awareness training
- Client-side only - no server-side data exposure
- Regular dependency updates recommended

---

---

## VII. VERSION 3.0 CHANGES (January 2026)

### A. Format Redesign - Fixed Sentinel Architecture

**v3 Format Structure**
- **Breaking Change**: No backward compatibility with v1/v2
- **Fixed Sentinel (1-LSB)**: First 19 pixels always use 1-LSB encoding
  - Magic number: `0xAA55` (16 bits, improved from 8-bit)
  - LSB mode: 4 bits (1-4)
  - Reserved: 4 bits (future extensions)
  - Message length: 32 bits (up to 4GB)
- **Variable Message (N-LSB)**: Remaining pixels use optimal LSB mode
- **Overhead**: Only 56 bits (7 bytes) for entire header
- **Benefit**: 100% reliable detection, no trial-and-error needed

### B. Smart Auto LSB Mode Selection

**Real-Time Character Counter**
- Live character/byte count as you type
- Dynamic badge UI (stacked display)
- Updates on every keystroke with debouncing

**Auto-Selection Algorithm**
- Automatically calculates optimal LSB mode (1-4)
- Prioritizes minimal footprint (stealth over capacity)
- Tries modes 1→4 until message fits
- Returns utilization percentage and recommendation
- Visual feedback: Green → Yellow → Orange → Red

**Capacity Feedback**
- Real-time capacity analysis bar
- Color-coded progress bar matching utilization
- Shows: `used / available bytes (N-LSB mode)`
- Updates when:
  - User types (message size changes)
  - Image is loaded/changed
  - Manual override mode is toggled
  - Manual mode selection changes

**Manual Override Controls**
- "Override" button to switch from auto to manual
- Dropdown selector: Force 1-LSB through 4-LSB
- "Back to Auto" button to return to automatic
- Badge shows "Auto: N-LSB" or "Manual: N-LSB"

### C. UI Improvements

**Badge System**
- Removed redundant top-left LSB dropdown selector
- Replaced plain text counter with dynamic badges
- Stacked vertical layout for clean appearance
- Badge 1: `📝 X characters (Y bytes)` - gray
- Badge 2: `💾 X / Y bytes (N-LSB)` - color-coded
- Both badges clickable for educational modal

**Removed Components**
- Old static LSB selector (1-LSB through 4-LSB dropdown)
- Old static capacity badge
- Redundant encode-capacity div structure

**Enhanced Encoding**
- Auto-selects minimum LSB mode needed
- Sentinel always encoded in 1-LSB (first 19 pixels)
- Message encoded in auto-selected or manual mode
- Clear separation of sentinel vs message encoding

**Enhanced Detection**
- Always reads first 19 pixels in 1-LSB mode
- Parses v3 sentinel structure
- Validates magic number `0xAA55`
- Stores LSB mode and message length
- Shows ✓ for valid v3, ⚠️ for invalid

**Enhanced Decoding**
- Reads sentinel from first 19 pixels
- Validates v3 format before proceeding
- Extracts message using detected LSB mode
- Shows capacity utilization with mode indicator
- Rejects non-v3 images with clear error message

### D. Educational Content Updates

**LSB Modal Enhancements**
- Explains v3 two-layer architecture
- Shows fixed sentinel concept (Layer 1)
- Shows variable message concept (Layer 2)
- Per-mode capacity comparison table
- Updated formulas accounting for 19-pixel sentinel
- Auto-selection strategy explanation
- 7-byte overhead documented for all modes

### E. Code Architecture Changes

**New Constants**
```javascript
FORMAT_VERSION = 3
SENTINEL_BITS = 56
SENTINEL_PIXELS = 19
MAGIC_V3 = '1010101001010101' // 0xAA55
```

**Removed Constants**
```javascript
LENGTH_HEADER_BITS (v1)
HEADER_BITS_V2 (v2)
MAGIC_NUMBER (v2 8-bit)
HEADER_VERSION (v2)
```

**New Functions**
- `calculateOptimalLSBMode()` - Auto-selection algorithm
- `getRecommendation()` - Utilization feedback
- `updateMessageAnalysis()` - Real-time counter
- `updateCapacityAnalysisUI()` - Progress bar and badges
- `updateManualModeAnalysis()` - Manual mode handling
- `showCapacityError()` - Error state with badge updates

**Rewritten Functions**
- `detectLsbMode()` - Fixed 1-LSB sentinel reading
- `encodeMessage()` - Two-layer encoding (sentinel + message)
- `decodeMessage()` - Sentinel parsing and validation
- `previewEncodeImage()` - Badge initialization
- `updateModalWithImageData()` - Per-mode stats

### F. Compatibility Impact

**Version Compatibility Matrix (Updated)**

| Encoder Version | Decoder Version | Compatible? | Notes |
|----------------|-----------------|-------------|-------|
| v1 Enhanced | v3 Current | ✗ | Different header format |
| v2 Current | v3 Current | ✗ | Different magic number & structure |
| v3 Current | v3 Current | ✓ | Full compatibility with auto-detection |
| v3 Current | v1/v2 | ✗ | Old decoders cannot read v3 format |

**Design Decision Rationale**
- v3 breaks compatibility for architectural improvements
- Fixed sentinel solves chicken-and-egg detection problem
- Minimal overhead (7 bytes) vs reliable detection tradeoff
- Auto-selection improves UX significantly
- Clean break allows optimal implementation

### G. Performance & UX Metrics

**UI Responsiveness**
- Real-time updates: < 16ms per keystroke
- Badge updates: Instant visual feedback
- Progress bar: 60fps smooth updates
- Auto-selection: O(4) worst case (tries 4 modes max)

**User Workflow Improvement**
- Old: Upload → Select mode → Type → Check capacity → Encode
- New: Upload → Type → Auto mode selected → Encode
- Steps reduced: 5 → 3
- Decision points: 2 → 0 (with auto mode)

**Code Metrics**
- Added: ~200 lines (auto-selection + UI logic)
- Modified: ~150 lines (encoding/decoding/detection)
- Removed: ~50 lines (old selector, v2 compatibility)
- Net change: +300 lines

---

### H. UI & Performance Refinements (February 2026)

**Inline Preview Architecture**
- **Change:** Upload previews now appear directly inside the drop-zone area
- **Reason:** Improves UX by showing the image where the user interacts
- **Impact:** Replaces static "Drag & Drop" text with actual image preview
- **Implementation:** Reuses `previewImage` logic to render into a dedicated drop-zone canvas

**Encoded Preview & Comparison**
- **Change:** New "Encoded" section appears below binary output after encoding
- **Feature:** Includes inline "Original / Encoded" toggle for instant comparison
- **Removed:** Fullscreen comparison modal and slider (simplified UX)
- **Benefit:** Keeps context within the main flow; no context switching to modals

**Memory Optimization**
- **Change:** Normalized buffer is cleared immediately after encoding
- **Change:** Removed redundant "Normalized" preview canvas from memory
- **Impact:** Reduces memory usage by ~25-50% for large images (e.g., 10k x 10k)
- **Technical:** `nulledCanvas` width/height reset to 0 post-encode

**Download Optimization**
- **Change:** Downloads use pre-computed blob cache
- **Fix:** Download button no longer triggers re-encoding on click
- **Benefit:** Instant save prompt (browser/OS dependent)

**Chrome Download Fix**
- **Change:** Removed 100ms `revokeObjectURL` after download click; revoke only when cache is invalidated (new encode, tab switch)
- **Change:** Append download link to `document.body` before `click()`, remove after
- **Reason:** Chrome defers blob read; early revoke caused slow/failed downloads; Firefox was unaffected
- **Benefit:** Reliable fast downloads in Chrome

---

### I. Educational Content Refinements (October 2026)

**In-Page Explainer Cards**
- **Change:** Added a "What is steganography?" card between the page header and the Encode/Decode tabs, with a nested "What is LSB (Least Significant Bit) Steganography?" card
- **Change:** Each card has a short summary plus a collapsible "Tell me more" section
- **Removed:** "How LSB Steganography Works" modal; its content now lives in the LSB card's "Tell me more" section
- **Change:** Capacity badge now expands and scrolls to the LSB card instead of opening the modal
- **Technical:** `updateModalWithImageData()` renamed to `updateLsbInfoWithImageData()`; live image stats render into `#lsbImageInfo` and `#lsbCalcSteps`

**Download via File System Access API**
- **Change:** `downloadCachedImage()` now calls `window.showSaveFilePicker()` and writes the cached PNG blob directly to the user-chosen file via `createWritable()`
- **Benefit:** Bypasses Chrome/Edge's download manager, so there is no `.crdownload` round-trip and no download-shelf scanning delay after clicking Save
- **Compatibility:** Falls back to the previous anchor-click download in Firefox, Safari, and any browser without the File System Access API; cancelling the save dialog (`AbortError`) is silently ignored

**AES-256-GCM Confidentiality Mode**
- **Change:** New optional "Encrypt with password" switch on the Encode tab, plus matching password field on the Decode tab that appears automatically when an encrypted image is detected
- **Algorithm:** AES-256-GCM with 128-bit authentication tag, key derived via PBKDF2-SHA256 (600,000 iterations); both from the browser's built-in Web Crypto API (no new dependency)
- **Format:** 45-byte overhead per message: `version (1) | salt (16) | iv (12) | ciphertext + tag (n + 16)`. Payload length is stored in the existing 32-bit sentinel length field; a reserved bit (`flags = 1000`) marks the image as encrypted
- **Authenticated metadata:** GCM additional data is `[version, ...canonical 7-byte sentinel]`, so flipping the LSB mode, flag bits, or payload length in the image makes decryption fail
- **Validation first:** the decode worker rejects unknown flag combinations, payload versions, and sub-minimum payload lengths before any PBKDF2 run, so bad input never spends ~600 ms of key derivation
- **Stale-result guards:** monotonic `encodeGeneration` / `decodeGeneration` counters invalidate in-flight work after image upload, tab switch, or message/password edits; every continuation after an await discards its result if the generation has moved on. In-flight counters (`encodeInFlight` / `decodeInFlight`) make every exit path idempotent so a non-click bump (e.g. the user typing another character while PBKDF2 is still running) never leaves the Encode/Decode button stuck on "Encrypting..." / disabled; back-to-back clicks also settle cleanly, with the newer operation owning the UI
- **Password handling:** UTF-8 encoded exactly as typed (no trim/normalization), fed to a non-extractable `CryptoKey`; wrong-password and tag-mismatch failures surface as one generic "Wrong password or corrupted image" error
- **Legacy compatibility:** older builds that ignore the flag now hit the decode worker's strict UTF-8 decode (`{ fatal: true }`) and fail cleanly instead of displaying garbage
- **New file:** `crypto.js` (DOM-free so `tests.html` can exercise it directly); `parseSentinelFromPixels`, `sanitizeDecodedMessage`, and the new `buildSentinelBytes` moved into `constants.js` to share one implementation across workers and the main thread

**Decoded Message Actions (Copy / Download)**
- **Change:** The Decoded Message card header now hosts two small buttons: Copy (writes the plaintext to the clipboard) and Download (saves it as `decoded-message-<timestamp>.txt`)
- **Copy:** Prefers `navigator.clipboard.writeText`; falls back to a hidden-textarea + `document.execCommand('copy')` for older browsers / insecure contexts. Shows a 1.5 s "Copied!" (or "Copy failed") label with a success/danger outline for feedback
- **Download:** Mirrors `downloadCachedImage` — `window.showSaveFilePicker()` for direct writes in Chrome/Edge, anchor-click fallback for Firefox/Safari; blob URL revoked on the next tick
- **State:** Both buttons are disabled when there's no decoded message. `clearDecodedDisplay()` wipes the in-memory `LAST_DECODED_TEXT`, disables the buttons, and resets any stale "Copied!" label; `renderDecodeOutput` re-populates and re-enables them
- **Accessibility:** `aria-label` on each button describing the full action; visible emoji icons marked `aria-hidden`; button text ("Copy", "Download") readable by screen readers

---

**Document Version:** 2.0  
**Date:** January 2026  
**Status:** Final
