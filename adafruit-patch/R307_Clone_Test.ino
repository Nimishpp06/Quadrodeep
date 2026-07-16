/**
 * R307 Template Upload / Download (Clone) Test
 *
 * Demonstrates the full clone cycle:
 *   1. Enroll a finger to slot 1
 *   2. Upload (UPCHAR) the raw template to the MCU
 *   3. Erase the entire sensor database
 *   4. Download (DOWNCHAR) the template back to buffer 1
 *   5. Store it back to slot 1
 *   6. Verify the restored template matches the same finger
 *
 * Hardware: R307 / AS608 fingerprint sensor on ESP32 UART2 (RX=16, TX=17)
 * 
 * This sketch requires the patched Adafruit_Fingerprint library
 * with readCharBuffer() / writeCharBuffer() support.
 */

#include <Adafruit_Fingerprint.h>

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger(&mySerial);

uint8_t templateBuf[1024];
uint16_t templateLen = 0;

void waitFinger() {
  while (finger.getImage() != FINGERPRINT_OK) {
    delay(20);
  }
}

void setup() {
  Serial.begin(115200);

  mySerial.begin(57600, SERIAL_8N1, 16, 17);
  finger.begin(57600);

  finger.getParameters();
  Serial.printf("Packet Length = %d\n", finger.packet_len);
  Serial.printf("Capacity = %d\n", finger.capacity);

  Serial.println("\n=== R307 Upload/Download Test ===");

  if (!finger.verifyPassword()) {
    Serial.println("Sensor not found!");
    while (1);
  }
  Serial.println("Sensor OK");

  // ---------- ENROLL ----------
  Serial.println("\nPlace finger (1st scan)");
  waitFinger();

  if (finger.image2Tz(1) != FINGERPRINT_OK) {
    Serial.println("image2Tz(1) failed");
    while (1);
  }

  Serial.println("Remove finger...");
  delay(3000);
  while (finger.getImage() != FINGERPRINT_NOFINGER) delay(50);

  Serial.println("Place same finger again");
  waitFinger();

  if (finger.image2Tz(2) != FINGERPRINT_OK) {
    Serial.println("image2Tz(2) failed");
    while (1);
  }

  if (finger.createModel() != FINGERPRINT_OK) {
    Serial.println("createModel failed");
    while (1);
  }
  Serial.println("Model created");

  // ---------- UPCHAR (upload template to MCU) ----------
  uint8_t ret = finger.readCharBuffer(1, templateBuf, &templateLen);
  Serial.printf("readCharBuffer() ret=%d len=%d\n", ret, templateLen);

  if (ret != FINGERPRINT_OK || templateLen == 0) {
    Serial.println("UPCHAR FAILED");
    while (1);
  }
  Serial.println("UPCHAR SUCCESS");

  // ---------- ERASE DATABASE ----------
  Serial.println("\nErasing database...");
  ret = finger.emptyDatabase();
  Serial.printf("emptyDatabase ret=%d\n", ret);
  finger.getTemplateCount();
  Serial.printf("Templates after erase: %d\n", finger.templateCount);

  // ---------- DOWNCHAR (download template back to sensor) ----------
  Serial.println("\nWriting template back...");
  ret = finger.writeCharBuffer(1, templateBuf, templateLen);
  Serial.printf("writeCharBuffer() ret=%d\n", ret);

  if (ret != FINGERPRINT_OK) {
    Serial.println("DOWNCHAR FAILED");
    while (1);
  }
  Serial.println("DOWNCHAR SUCCESS");

  // ---------- STORE ----------
  ret = finger.storeModel(1);
  Serial.printf("storeModel(1) ret=%d\n", ret);

  if (ret != FINGERPRINT_OK) {
    Serial.println("storeModel failed");
    while (1);
  }
  Serial.println("Template restored into slot 1");

  // ---------- VERIFY ----------
  Serial.println("\nPlace finger again for verification");
  while (finger.getImage() != FINGERPRINT_OK) delay(20);

  if (finger.image2Tz(1) != FINGERPRINT_OK) {
    Serial.println("image2Tz failed");
    while (1);
  }

  ret = finger.fingerFastSearch();
  Serial.printf("fingerFastSearch ret=%d\n", ret);

  if (ret == FINGERPRINT_OK) {
    Serial.println("\n====================");
    Serial.println("CLONING TEST PASSED");
    Serial.println("====================");
    Serial.printf("Slot=%d Confidence=%d\n", finger.fingerID, finger.confidence);
  } else {
    Serial.println("\n====================");
    Serial.println("CLONING TEST FAILED");
    Serial.println("====================");
  }
}

void loop() {}
