importScripts('constants.js?v=5');

var TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

self.onmessage = function(e) {
  if (e.data.type !== 'decode') return;
  var width = e.data.imageData.width;
  var height = e.data.imageData.height;
  var pixel = new Uint8ClampedArray(e.data.imageData.data);

  try {
    var parsed = parseSentinelFromPixels(pixel);
    var lsbBits = parsed.lsbBits;
    var messageLength = parsed.messageLength;
    var isV3 = parsed.isV3;
    var flags = parsed.flags;
    var isEncrypted = parsed.isEncrypted;
    var isCompressed = parsed.isCompressed;

    if (!isV3) {
      self.postMessage({ type: 'error', message: 'This image does not contain a valid v3 steganographic message. Please ensure the image was encoded with this tool.' });
      return;
    }
    if (!parsed.flagsValid) {
      self.postMessage({ type: 'error', message: 'Unsupported format flags. This image may have been encoded by a newer tool version.' });
      return;
    }
    if (!Number.isInteger(lsbBits) || lsbBits < MIN_LSB_BITS || lsbBits > MAX_LSB_BITS) {
      self.postMessage({ type: 'error', message: 'Invalid or corrupted steganographic image.' });
      return;
    }
    if (!Number.isSafeInteger(messageLength) || messageLength < 0 || messageLength > MAX_MESSAGE_LENGTH) {
      self.postMessage({ type: 'error', message: 'Invalid or corrupted steganographic image.' });
      return;
    }
    if (messageLength === 0) {
      self.postMessage({ type: 'error', message: 'Image contains an empty message (0 bytes).' });
      return;
    }
    if (isEncrypted && messageLength < ENCRYPTION_MIN_PAYLOAD_BYTES) {
      self.postMessage({ type: 'error', message: 'Encrypted payload is too short (' + messageLength + ' bytes).' });
      return;
    }

    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var maxCapacity = Math.floor((availablePixels * lsbBits * 3) / 8);

    if (!Number.isSafeInteger(maxCapacity) || maxCapacity > MAX_THEORETICAL_EMBED_CAPACITY_BYTES) {
      self.postMessage({ type: 'error', message: 'Image capacity exceeds safety limits.' });
      return;
    }
    if (messageLength > maxCapacity) {
      self.postMessage({ type: 'error', message: 'Corrupted image: Declared message length exceeds image capacity.' });
      return;
    }

    var byteArray = new Uint8Array(messageLength);
    var mask = (1 << lsbBits) - 1;
    var totalBits = messageLength * 8;
    var bitBuf = 0;
    var bitCount = 0;
    var byteIdx = 0;
    var producedBits = 0;

    outer: for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        var chunk = pixel[i + offset] & mask;
        var take = lsbBits;
        var remaining = totalBits - producedBits;
        if (remaining < lsbBits) {
          // Partial tail chunk: encoder left-shifted message bits into the
          // high positions of the slot, so drop the low (lsbBits - remaining)
          // garbage bits.
          take = remaining;
          chunk = chunk >>> (lsbBits - take);
        }
        bitBuf = (bitBuf << take) | chunk;
        bitCount += take;
        producedBits += take;
        while (bitCount >= 8) {
          bitCount -= 8;
          byteArray[byteIdx++] = (bitBuf >>> bitCount) & 0xFF;
          if (byteIdx === messageLength) break outer;
        }
        if (producedBits >= totalBits) break outer;
      }
    }

    if (byteIdx < messageLength) {
      self.postMessage({ type: 'error', message: 'Incomplete message data in image.' });
      return;
    }

    if (isEncrypted) {
      // Validate payload framing (version, length) before passing to the
      // main thread so a bad payload never reaches PBKDF2. The container
      // sniff (and any inflate) happen on the main thread after decryption,
      // since the worker cannot see plaintext here.
      if (byteArray[0] !== ENCRYPTION_PAYLOAD_VERSION) {
        self.postMessage({ type: 'error', message: 'Unsupported encryption version: ' + byteArray[0] + '.' });
        return;
      }
      self.postMessage({
        type: 'result',
        encrypted: true,
        compressed: isCompressed,
        payloadBytes: byteArray.buffer,
        messageLength: messageLength,
        lsbBits: lsbBits,
        flags: flags,
        maxCapacity: maxCapacity
      }, [byteArray.buffer]);
      return;
    }

    // Plaintext-but-compressed: the raw bytes are deflate-raw, so the worker
    // can neither sniff the container magic nor UTF-8 decode them. Hand the
    // compressed bytes to the main thread, which inflates (with a size cap)
    // and then does the file/text disambiguation.
    if (isCompressed) {
      self.postMessage({
        type: 'result',
        encrypted: false,
        compressed: true,
        payloadBytes: byteArray.buffer,
        messageLength: messageLength,
        lsbBits: lsbBits,
        flags: flags,
        maxCapacity: maxCapacity
      }, [byteArray.buffer]);
      return;
    }

    // Plaintext path: sniff the file-container magic before UTF-8 decode.
    // A payload that starts with FILE_CONTAINER_MAGIC is a hidden file and
    // must not go through TextDecoder - most binary files aren't valid
    // UTF-8 and would throw. Legacy text payloads can't collide with the
    // magic because 0xF1 0x1E 0x00 0x01 is an invalid UTF-8 start.
    if (hasFileContainerMagic(byteArray)) {
      var container;
      try {
        container = parseFileContainer(byteArray);
      } catch (containerErr) {
        self.postMessage({
          type: 'error',
          message: 'Hidden file container is corrupted: ' + containerErr.message
        });
        return;
      }
      // Copy the file bytes into a fresh ArrayBuffer so we can transfer
      // ownership to the main thread (subarray would share the parent).
      var fileCopy = new Uint8Array(container.fileBytes.length);
      fileCopy.set(container.fileBytes);
      self.postMessage({
        type: 'result',
        encrypted: false,
        compressed: false,
        kind: 'file',
        fileBytes: fileCopy.buffer,
        filename: container.filename,
        mimeType: container.mimeType,
        crcValid: container.crcValid,
        storedCrc: container.storedCrc,
        containerVersion: container.version,
        messageLength: messageLength,
        lsbBits: lsbBits,
        flags: flags,
        maxCapacity: maxCapacity
      }, [fileCopy.buffer]);
      return;
    }

    var output = sanitizeDecodedMessage(TEXT_DECODER.decode(byteArray));

    self.postMessage({
      type: 'result',
      encrypted: false,
      compressed: false,
      kind: 'text',
      output: output,
      messageLength: messageLength,
      lsbBits: lsbBits,
      flags: flags,
      maxCapacity: maxCapacity
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Decode failed' });
  }
};
