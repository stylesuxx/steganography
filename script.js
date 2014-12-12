window.onload = function() {
  $('button.decode').click(function(event) {
    event.preventDefault();
    var $originalCanvas = $('.decode canvas');
    var originalContext = $originalCanvas[0].getContext("2d");

    var original = originalContext.getImageData(0, 0, $originalCanvas.width(), $originalCanvas.height());
    var binaryMessage = "";
    var pixel = original.data;
    for (var i = 0, n = pixel.length; i < n; i += 4) {
      for (var offset =0; offset < 3; offset ++) {
        var value = 0;
        if(pixel[i + offset] %2 != 0) {
          value = 1;
        }

        binaryMessage += value;
      }
    }

    var output = "";
    for (var i = 0; i < binaryMessage.length; i += 8) {
      var c = 0;
      for (var j = 0; j < 8; j++) {
        c <<= 1;
        c |= parseInt(binaryMessage[i + j]);
      }

      output += String.fromCharCode(c);
    }

    $('.binary-decode textarea').text(output);
    $('.binary-decode').fadeIn();
  });

  $('button.encode').click(function(event) {
    event.preventDefault();
  });

};


function previewDecodeFile(e) {
  var file = document.querySelector('input[name=decodeFile]').files[0];
  var reader = new FileReader();

  reader.onloadend = function () {
    var $canvas = $(".decode canvas");
    var context = $canvas[0].getContext('2d');
    var image = new Image;
    image.src = URL.createObjectURL(file);

    image.onload = function() {
      $canvas.prop({
        'width': image.width,
        'height': image.height
      });

      context.drawImage(image, 0, 0);
      $(".decode").fadeIn();
    }
  }

  if (file) {
    reader.readAsDataURL(file);
  }
}

/**
 * When the user chooses a new image, draw this image to the
 * original canvas.
 */
function previewBaseFile(e) {
  $(".images .nulled").hide();
  $(".images .message").hide();

  var file = document.querySelector('input[name=baseFile]').files[0];
  var reader = new FileReader();
  var image = new Image;
  var $canvas = $(".original canvas");
  var context = $canvas[0].getContext('2d');

  if (file) {
    reader.readAsDataURL(file);
  }

  reader.onloadend = function () {
    image.src = URL.createObjectURL(file);

    image.onload = function() {
      $canvas.prop({
        'width': image.width,
        'height': image.height
      });

      context.drawImage(image, 0, 0);

      $(".images .original").fadeIn();
      $(".images").fadeIn();
    }
  }
}

/**
 * When the user clicks the ecode button, normalize the image,
 * convert the message to a binary representation, add the binary
 * representation to the normalized image.
 */
function encodeMessage() {
  $(".error").hide();
  $(".binary").hide();

  var text = $("textarea.message").val();

  var $originalCanvas = $('.original canvas');
  var $nulledCanvas = $('.nulled canvas');
  var $messageCanvas = $('.message canvas');

  var originalContext = $originalCanvas[0].getContext("2d");
  var nulledContext = $nulledCanvas[0].getContext("2d");
  var messageContext = $messageCanvas[0].getContext("2d");

  var width = $originalCanvas[0].width;
  var height = $originalCanvas[0].height;

  // Check if the image is big enough to hide the message
  if ((text.length * 8) > (width * height * 3)) {
    $(".error")
      .text("Text too long for chosen image....")
      .fadeIn();

    return;
  }

  $nulledCanvas.prop({
    'width': width,
    'height': height
  });

  $messageCanvas.prop({
    'width': width,
    'height': height
  });

  // Normalize the original image and draw it
  var original = originalContext.getImageData(0, 0, width, height);
  var pixel = original.data;
  for (var i = 0, n = pixel.length; i < n; i += 4) {
    for (var offset =0; offset < 3; offset ++) {
      if(pixel[i + offset] %2 != 0) {
        pixel[i + offset]--;
      }
    }
  }
  nulledContext.putImageData(original, 0, 0);

  // Convert the message to a binary string
  var binaryMessage = "";
  for (i = 0; i < text.length; i++) {
    var binaryChar = text[i].charCodeAt(0).toString(2);

    // Pad with 0 until the binaryChar has a lenght of 8 (1 Byte)
    while(binaryChar.length < 8) {
      binaryChar = "0" + binaryChar;
    }

    binaryMessage += binaryChar;
  }
  $('.binary textarea').text(binaryMessage);

  // Apply the binary string to the image and draw it
  var message = nulledContext.getImageData(0, 0, width, height);
  pixel = message.data;
  counter = 0;
  for (var i = 0, n = pixel.length; i < n; i += 4) {
    for (var offset =0; offset < 3; offset ++) {
      if (counter < binaryMessage.length) {
        pixel[i + offset] += parseInt(binaryMessage[counter]);
        counter++;
      }
      else {
        break;
      }
    }
  }
  messageContext.putImageData(message, 0, 0);

  $(".binary").fadeIn();
  $(".images .nulled").fadeIn();
  $(".images .message").fadeIn();
};
