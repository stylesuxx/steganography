importScripts('constants.js?v=5');

self.onmessage = function(e) {
  if (e.data.type !== 'encode') return;
  var width = e.data.imageData.width;
  var height = e.data.imageData.height;
  var pixel = new Uint8ClampedArray(e.data.imageData.data);
  var messageBytes = new Uint8Array(e.data.messageBytes);
  var lsbBits = e.data.lsbBits;
  var flags = e.data.flags || FLAGS_PLAINTEXT;
  var totalMessageBits = messageBytes.length * 8;

  try {
    if (!isValidFlags(flags)) {
      self.postMessage({ type: 'error', message: 'Unsupported format flags.' });
      return;
    }

    for (var i = 0; i < SENTINEL_PIXELS * 4; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        pixel[i + offset] = (pixel[i + offset] & 0xFE) & 0xFF;
      }
    }
    var mask = ~((1 << lsbBits) - 1) & 0xFF;
    for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        pixel[i + offset] = (pixel[i + offset] & mask) & 0xFF;
      }
    }

    var magicBinary = MAGIC_V3;
    var modeBinary = lsbBits.toString(2).padStart(4, '0');
    var lengthBinary = messageBytes.length.toString(2).padStart(32, '0');
    var sentinelBinary = magicBinary + modeBinary + flags + lengthBinary;

    var sentinelCounter = 0;
    var messageCounter = 0;

    for (var i = 0; i < SENTINEL_PIXELS * 4 && sentinelCounter < SENTINEL_BITS; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if (sentinelCounter < SENTINEL_BITS) {
          var bit = parseInt(sentinelBinary[sentinelCounter], 2);
          pixel[i + offset] = (pixel[i + offset] | bit) & 0xFF;
          sentinelCounter++;
        }
      }
    }

    for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if (messageCounter >= totalMessageBits) break;
        var remaining = totalMessageBits - messageCounter;
        var chunkBits = remaining >= lsbBits ? lsbBits : remaining;
        // Left-shift partial chunks so they occupy the high positions of the
        // lsbBits-wide slot. The decoder reads the full slot MSB-first and
        // trims to messageLength*8 bits, dropping the trailing garbage.
        var bits = getBits(messageBytes, messageCounter, chunkBits) << (lsbBits - chunkBits);
        pixel[i + offset] = pixel[i + offset] | bits;
        messageCounter += chunkBits;
      }
      if (messageCounter >= totalMessageBits) break;
    }

    var canvas = new OffscreenCanvas(width, height);
    var ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(pixel, width, height), 0, 0);
    var resultBuffer = pixel.buffer;

    canvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
      self.postMessage(
        { type: 'result', blob: blob, width: width, height: height, data: resultBuffer },
        [resultBuffer]
      );
    }).catch(function(err) {
      self.postMessage({ type: 'error', message: err.message || 'Failed to encode PNG.' });
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
