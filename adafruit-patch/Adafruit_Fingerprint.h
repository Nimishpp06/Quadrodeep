#ifndef ADAFRUIT_FINGERPRINT_H
#define ADAFRUIT_FINGERPRINT_H

#include "Arduino.h"
#if defined(__AVR__) || defined(ESP8266)
#include <SoftwareSerial.h>
#elif defined(FREEDOM_E300_HIFIVE1)
#include <SoftwareSerial32.h>
#define SoftwareSerial SoftwareSerial32
#endif

#define FINGERPRINT_OK 0x00
#define FINGERPRINT_PACKETRECIEVEERR 0x01
#define FINGERPRINT_NOFINGER 0x02
#define FINGERPRINT_IMAGEFAIL 0x03
#define FINGERPRINT_IMAGEMESS 0x06
#define FINGERPRINT_FEATUREFAIL 0x07
#define FINGERPRINT_NOMATCH 0x08
#define FINGERPRINT_NOTFOUND 0x09
#define FINGERPRINT_ENROLLMISMATCH 0x0A
#define FINGERPRINT_BADLOCATION 0x0B
#define FINGERPRINT_DBRANGEFAIL 0x0C
#define FINGERPRINT_UPLOADFEATUREFAIL 0x0D
#define FINGERPRINT_PACKETRESPONSEFAIL 0x0E
#define FINGERPRINT_UPLOADFAIL 0x0F
#define FINGERPRINT_DELETEFAIL 0x10
#define FINGERPRINT_DBCLEARFAIL 0x11
#define FINGERPRINT_PASSFAIL 0x13
#define FINGERPRINT_INVALIDIMAGE 0x15
#define FINGERPRINT_FLASHERR 0x18
#define FINGERPRINT_INVALIDREG 0x1A
#define FINGERPRINT_ADDRCODE 0x20
#define FINGERPRINT_PASSVERIFY 0x21
#define FINGERPRINT_STARTCODE 0xEF01

#define FINGERPRINT_COMMANDPACKET 0x1
#define FINGERPRINT_DATAPACKET 0x2
#define FINGERPRINT_ACKPACKET 0x7
#define FINGERPRINT_ENDDATAPACKET 0x8

#define FINGERPRINT_TIMEOUT 0xFF
#define FINGERPRINT_BADPACKET 0xFE

#define FINGERPRINT_GETIMAGE 0x01
#define FINGERPRINT_IMAGE2TZ 0x02
#define FINGERPRINT_SEARCH 0x04
#define FINGERPRINT_REGMODEL 0x05
#define FINGERPRINT_STORE 0x06
#define FINGERPRINT_LOAD 0x07
#define FINGERPRINT_UPLOAD 0x08
#define FINGERPRINT_UPCHAR 0x08
#define FINGERPRINT_DELETE 0x0C
#define FINGERPRINT_EMPTY 0x0D
#define FINGERPRINT_READSYSPARAM 0x0F
#define FINGERPRINT_SETPASSWORD 0x12
#define FINGERPRINT_VERIFYPASSWORD 0x13
#define FINGERPRINT_HISPEEDSEARCH 0x1B
#define FINGERPRINT_TEMPLATECOUNT 0x1D
#define FINGERPRINT_AURALEDCONFIG 0x35
#define FINGERPRINT_LEDON 0x50
#define FINGERPRINT_LEDOFF 0x51

#define FINGERPRINT_LED_BREATHING 0x01
#define FINGERPRINT_LED_FLASHING 0x02
#define FINGERPRINT_LED_ON 0x03
#define FINGERPRINT_LED_OFF 0x04
#define FINGERPRINT_LED_GRADUAL_ON 0x05
#define FINGERPRINT_LED_GRADUAL_OFF 0x06
#define FINGERPRINT_LED_RED 0x01
#define FINGERPRINT_LED_BLUE 0x02
#define FINGERPRINT_LED_PURPLE 0x03

#define FINGERPRINT_REG_ADDR_ERROR 0x1A
#define FINGERPRINT_WRITE_REG 0x0E

#define FINGERPRINT_BAUD_REG_ADDR 0x4
#define FINGERPRINT_BAUDRATE_9600 0x1
#define FINGERPRINT_BAUDRATE_19200 0x2
#define FINGERPRINT_BAUDRATE_28800 0x3
#define FINGERPRINT_BAUDRATE_38400 0x4
#define FINGERPRINT_BAUDRATE_48000 0x5
#define FINGERPRINT_BAUDRATE_57600 0x6
#define FINGERPRINT_BAUDRATE_67200 0x7
#define FINGERPRINT_BAUDRATE_76800 0x8
#define FINGERPRINT_BAUDRATE_86400 0x9
#define FINGERPRINT_BAUDRATE_96000 0xA
#define FINGERPRINT_BAUDRATE_105600 0xB
#define FINGERPRINT_BAUDRATE_115200 0xC

#define FINGERPRINT_SECURITY_REG_ADDR 0x5
#define FINGERPRINT_SECURITY_LEVEL_1 0X1
#define FINGERPRINT_SECURITY_LEVEL_2 0X2
#define FINGERPRINT_SECURITY_LEVEL_3 0X3
#define FINGERPRINT_SECURITY_LEVEL_4 0X4
#define FINGERPRINT_SECURITY_LEVEL_5 0X5

#define FINGERPRINT_PACKET_REG_ADDR 0x6
#define FINGERPRINT_PACKET_SIZE_32 0X0
#define FINGERPRINT_PACKET_SIZE_64 0X1
#define FINGERPRINT_PACKET_SIZE_128 0X2
#define FINGERPRINT_PACKET_SIZE_256 0X3

#define DEFAULTTIMEOUT 1000

struct Adafruit_Fingerprint_Packet {
  Adafruit_Fingerprint_Packet(uint8_t type, uint16_t length, uint8_t *data) {
    this->start_code = FINGERPRINT_STARTCODE;
    this->type = type;
    this->length = length;
    address[0] = 0xFF;
    address[1] = 0xFF;
    address[2] = 0xFF;
    address[3] = 0xFF;
    if (length < 600)
      memcpy(this->data, data, length);
    else
      memcpy(this->data, data, 600);
  }
  uint16_t start_code;
  uint8_t address[4];
  uint8_t type;
  uint16_t length;
  uint8_t data[600];
};

class Adafruit_Fingerprint {
public:
#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
  Adafruit_Fingerprint(SoftwareSerial *ss, uint32_t password = 0x0);
#endif
  Adafruit_Fingerprint(HardwareSerial *hs, uint32_t password = 0x0);
  Adafruit_Fingerprint(Stream *serial, uint32_t password = 0x0);

  void begin(uint32_t baud);

  boolean verifyPassword(void);
  uint8_t getParameters(void);

  uint8_t getImage(void);
  uint8_t image2Tz(uint8_t slot = 1);
  uint8_t createModel(void);

  uint8_t emptyDatabase(void);
  uint8_t storeModel(uint16_t id);
  uint8_t loadModel(uint16_t id);
  uint8_t getModel(void);
  uint8_t deleteModel(uint16_t id);
  uint8_t fingerFastSearch(void);
  uint8_t fingerSearch(uint8_t slot = 1);
  uint8_t getTemplateCount(void);
  uint8_t setPassword(uint32_t password);
  uint8_t LEDcontrol(bool on);
  uint8_t LEDcontrol(uint8_t control, uint8_t speed, uint8_t coloridx,
                     uint8_t count = 0);

  uint8_t setBaudRate(uint8_t baudrate);
  uint8_t setSecurityLevel(uint8_t level);
  uint8_t setPacketSize(uint8_t size);

  void writeStructuredPacket(const Adafruit_Fingerprint_Packet &p);
  uint8_t getStructuredPacket(Adafruit_Fingerprint_Packet *p,
                              uint16_t timeout = DEFAULTTIMEOUT);

  // --- PATCH: Template upload / download support ---
  uint8_t readCharBuffer(uint8_t bufferID, uint8_t* outBuf, uint16_t* outLen);
  uint8_t writeCharBuffer(uint8_t bufferID, uint8_t* data, uint16_t len);
  uint8_t match(uint16_t* score);

  uint16_t fingerID;
  uint16_t confidence;
  uint16_t templateCount;

  uint16_t status_reg = 0x0;
  uint16_t system_id = 0x0;
  uint16_t capacity = 64;
  uint16_t security_level = 0;
  uint32_t device_addr = 0xFFFFFFFF;
  uint16_t packet_len = 64;
  uint16_t baud_rate = 57600;

private:
  uint8_t checkPassword(void);
  uint8_t writeRegister(uint8_t regAdd, uint8_t value);
  uint32_t thePassword;
  uint32_t theAddress;
  uint8_t recvPacket[20];

  Stream *mySerial;
#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
  SoftwareSerial *swSerial;
#endif
  HardwareSerial *hwSerial;
};

#endif
