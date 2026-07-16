# Adafruit Fingerprint Library — R307 Template Upload/Download Patch

Adds `readCharBuffer()` and `writeCharBuffer()` support to the official `Adafruit_Fingerprint` library, enabling **fingerprint template cloning** on R307 / AS608 sensors.

## What's Added

| Function | Command | Purpose |
|----------|---------|---------|
| `readCharBuffer(bufferID, outBuf, &outLen)` | UPCHAR `0x08` | Upload a raw 512-byte template from sensor buffer to MCU |
| `writeCharBuffer(bufferID, data, len)` | DOWNCHAR `0x09` | Download a raw template from MCU back to sensor buffer |
| `match(&score)` | `0x03` | Compare two buffers already in slots 1 and 2 |

## Why It's Needed

The official library has no support for reading raw templates from or writing them to the sensor. Without these functions, you cannot:
- Backup enrolled fingerprints
- Clone a sensor configuration to another unit
- Store templates in external flash and restore later

## Key Implementation Details

- **DOWNCHAR** (`writeCharBuffer`): streams data in 128-byte chunks with `DATAPACKET`/`ENDDATAPACKET` framing. The R307 **does not send an ACK** after the final data packet — waiting for one causes a timeout. This patch correctly skips the final ACK read.
- **UPCHAR** (`readCharBuffer`): response can exceed the original 256-byte internal buffer; bumped to **1024 bytes**.
- A **15 ms delay** between DOWNCHAR chunks is required for the sensor to process each packet.

## Files

- `Adafruit_Fingerprint.h` — patched header with new method declarations and `#define FINGERPRINT_UPCHAR 0x08`
- `Adafruit_Fingerprint.cpp` — patched implementation of `readCharBuffer`, `writeCharBuffer`, `match`
- `R307_Clone_Test.ino` — test sketch: enroll → upload → erase → download → store → verify

## Usage

Copy `Adafruit_Fingerprint.h` and `Adafruit_Fingerprint.cpp` into your Arduino `libraries/Adafruit_Fingerprint/` directory, replacing the originals. Then upload `R307_Clone_Test.ino` to your ESP32.
