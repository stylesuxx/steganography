# Steganography Online
Since I wanted to look into steganography for some time, this is a small project dedicated to steganography.

It provides functionality to **encode** a message in an image and to **decode** the message from the image.

Head over to [the github page](http://stylesuxx.github.io/steganography/) and check out the online decoder and encoder.

## About Steganography

Steganography is the art of hiding a message inside another message. In this case we will hide a text message inside an image.
An image will most propably go unnotified, not a bunch of people will suspect a message hidden inside an image.
Steganography is **no means of encryption**, just a way of hiding data inside an image.

If you want to learn about Steganography in detail head over to [the Wikipedia article](http://en.wikipedia.org/wiki/Steganography).

## Implementation Details

The User chooses an image, the image data is then normalized, meaning that each RGB value is decremented by one if it is not even. 
This is done for every pixel in the image.

Next the message is converted to a binary representation, 8 Bits per character of the message. This binary representation 
is then applied to the normalized image, 3 Bit per pixel. This concludes, that the maximal length of a message hidden in 
an image is:

    Image Width * Image Height * 3
    ------------------------------
                  8

Since the image was normalized, we now know that an **even** r, g or b value is **0** and an **uneven** is a **1**. And this is how the
 message is decoded back from the image.

## Additional layers of security

As mentioned before, steganography is no means of encryption, just a way to hide data from plain sight. But one could, for example,
hide a pgp encrypted message inside an image. So even if the image did not go unnoticed, the message would still only 
be readable by the person it was addressed to.
