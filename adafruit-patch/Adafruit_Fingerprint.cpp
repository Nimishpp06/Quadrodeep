#include "Adafruit_Fingerprint.h"

#define GET_CMD_PACKET(...)                                                    \
  uint8_t data[] = {__VA_ARGS__};                                              \
  Adafruit_Fingerprint_Packet packet(FINGERPRINT_COMMANDPACKET, sizeof(data),  \
                                     data);                                    \
  writeStructuredPacket(packet);                                               \
  if (getStructuredPacket(&packet) != FINGERPRINT_OK)                          \
    return FINGERPRINT_PACKETRECIEVEERR;                                       \
  if (packet.type != FINGERPRINT_ACKPACKET)                                    \
    return FINGERPRINT_PACKETRECIEVEERR;

#define SEND_CMD_PACKET(...)                                                   \
  GET_CMD_PACKET(__VA_ARGS__);                                                 \
  return packet.data[0];

#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
Adafruit_Fingerprint::Adafruit_Fingerprint(SoftwareSerial *ss,
                                           uint32_t password) {
  thePassword = password;
  theAddress = 0xFFFFFFFF;
  hwSerial = NULL;
  swSerial = ss;
  mySerial = swSerial;
}
#endif

Adafruit_Fingerprint::Adafruit_Fingerprint(HardwareSerial *hs,
                                           uint32_t password) {
  thePassword = password;
  theAddress = 0xFFFFFFFF;
#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
  swSerial = NULL;
#endif
  hwSerial = hs;
  mySerial = hwSerial;
}

Adafruit_Fingerprint::Adafruit_Fingerprint(Stream *serial, uint32_t password) {
  thePassword = password;
  theAddress = 0xFFFFFFFF;
  hwSerial = NULL;
#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
  swSerial = NULL;
#endif
  mySerial = serial;
}

void Adafruit_Fingerprint::begin(uint32_t baudrate) {
  delay(1000);
  if (hwSerial)
    hwSerial->begin(baudrate);
#if defined(__AVR__) || defined(ESP8266) || defined(FREEDOM_E300_HIFIVE1)
  if (swSerial)
    swSerial->begin(baudrate);
#endif
}

boolean Adafruit_Fingerprint::verifyPassword(void) {
  return checkPassword() == FINGERPRINT_OK;
}

uint8_t Adafruit_Fingerprint::checkPassword(void) {
  GET_CMD_PACKET(FINGERPRINT_VERIFYPASSWORD, (uint8_t)(thePassword >> 24),
                 (uint8_t)(thePassword >> 16), (uint8_t)(thePassword >> 8),
                 (uint8_t)(thePassword & 0xFF));
  if (packet.data[0] == FINGERPRINT_OK)
    return FINGERPRINT_OK;
  else
    return FINGERPRINT_PACKETRECIEVEERR;
}

uint8_t Adafruit_Fingerprint::getParameters(void) {
  GET_CMD_PACKET(FINGERPRINT_READSYSPARAM);

  status_reg = ((uint16_t)packet.data[1] << 8) | packet.data[2];
  system_id = ((uint16_t)packet.data[3] << 8) | packet.data[4];
  capacity = ((uint16_t)packet.data[5] << 8) | packet.data[6];
  security_level = ((uint16_t)packet.data[7] << 8) | packet.data[8];
  device_addr = ((uint32_t)packet.data[9] << 24) |
                ((uint32_t)packet.data[10] << 16) |
                ((uint32_t)packet.data[11] << 8) | (uint32_t)packet.data[12];
  packet_len = ((uint16_t)packet.data[13] << 8) | packet.data[14];
  if (packet_len == 0) {
    packet_len = 32;
  } else if (packet_len == 1) {
    packet_len = 64;
  } else if (packet_len == 2) {
    packet_len = 128;
  } else if (packet_len == 3) {
    packet_len = 256;
  }
  baud_rate = (((uint16_t)packet.data[15] << 8) | packet.data[16]) * 9600;

  return packet.data[0];
}

uint8_t Adafruit_Fingerprint::getImage(void) {
  SEND_CMD_PACKET(FINGERPRINT_GETIMAGE);
}

uint8_t Adafruit_Fingerprint::image2Tz(uint8_t slot) {
  SEND_CMD_PACKET(FINGERPRINT_IMAGE2TZ, slot);
}

uint8_t Adafruit_Fingerprint::createModel(void) {
  SEND_CMD_PACKET(FINGERPRINT_REGMODEL);
}

uint8_t Adafruit_Fingerprint::storeModel(uint16_t location) {
  SEND_CMD_PACKET(FINGERPRINT_STORE, 0x01, (uint8_t)(location >> 8),
                  (uint8_t)(location & 0xFF));
}

uint8_t Adafruit_Fingerprint::loadModel(uint16_t location) {
  SEND_CMD_PACKET(FINGERPRINT_LOAD, 0x01, (uint8_t)(location >> 8),
                  (uint8_t)(location & 0xFF));
}

uint8_t Adafruit_Fingerprint::getModel(void) {
  SEND_CMD_PACKET(FINGERPRINT_UPLOAD, 0x01);
}

uint8_t Adafruit_Fingerprint::deleteModel(uint16_t location) {
  SEND_CMD_PACKET(FINGERPRINT_DELETE, (uint8_t)(location >> 8),
                  (uint8_t)(location & 0xFF), 0x00, 0x01);
}

uint8_t Adafruit_Fingerprint::emptyDatabase(void) {
  SEND_CMD_PACKET(FINGERPRINT_EMPTY);
}

uint8_t Adafruit_Fingerprint::fingerFastSearch(void) {
  GET_CMD_PACKET(FINGERPRINT_HISPEEDSEARCH, 0x01, 0x00, 0x00, 0x00, 0xA3);
  fingerID = 0xFFFF;
  confidence = 0xFFFF;

  fingerID = packet.data[1];
  fingerID <<= 8;
  fingerID |= packet.data[2];

  confidence = packet.data[3];
  confidence <<= 8;
  confidence |= packet.data[4];

  return packet.data[0];
}

uint8_t Adafruit_Fingerprint::LEDcontrol(bool on) {
  if (on) {
    SEND_CMD_PACKET(FINGERPRINT_LEDON);
  } else {
    SEND_CMD_PACKET(FINGERPRINT_LEDOFF);
  }
}

uint8_t Adafruit_Fingerprint::LEDcontrol(uint8_t control, uint8_t speed,
                                         uint8_t coloridx, uint8_t count) {
  SEND_CMD_PACKET(FINGERPRINT_AURALEDCONFIG, control, speed, coloridx, count);
}

uint8_t Adafruit_Fingerprint::fingerSearch(uint8_t slot) {
  GET_CMD_PACKET(FINGERPRINT_SEARCH, slot, 0x00, 0x00, (uint8_t)(capacity >> 8),
                 (uint8_t)(capacity & 0xFF));

  fingerID = 0xFFFF;
  confidence = 0xFFFF;

  fingerID = packet.data[1];
  fingerID <<= 8;
  fingerID |= packet.data[2];

  confidence = packet.data[3];
  confidence <<= 8;
  confidence |= packet.data[4];

  return packet.data[0];
}

uint8_t Adafruit_Fingerprint::getTemplateCount(void) {
  GET_CMD_PACKET(FINGERPRINT_TEMPLATECOUNT);

  templateCount = packet.data[1];
  templateCount <<= 8;
  templateCount |= packet.data[2];

  return packet.data[0];
}

uint8_t Adafruit_Fingerprint::setPassword(uint32_t password) {
  SEND_CMD_PACKET(FINGERPRINT_SETPASSWORD, (uint8_t)(password >> 24),
                  (uint8_t)(password >> 16), (uint8_t)(password >> 8),
                  (uint8_t)(password & 0xFF));
}

uint8_t Adafruit_Fingerprint::writeRegister(uint8_t regAdd, uint8_t value) {
  SEND_CMD_PACKET(FINGERPRINT_WRITE_REG, regAdd, value);
}

uint8_t Adafruit_Fingerprint::setBaudRate(uint8_t baudrate) {
  return (writeRegister(FINGERPRINT_BAUD_REG_ADDR, baudrate));
}

uint8_t Adafruit_Fingerprint::setSecurityLevel(uint8_t level) {
  return (writeRegister(FINGERPRINT_SECURITY_REG_ADDR, level));
}

uint8_t Adafruit_Fingerprint::setPacketSize(uint8_t size) {
  return (writeRegister(FINGERPRINT_PACKET_REG_ADDR, size));
}

void Adafruit_Fingerprint::writeStructuredPacket(
    const Adafruit_Fingerprint_Packet &packet) {

  mySerial->write((uint8_t)(packet.start_code >> 8));
  mySerial->write((uint8_t)(packet.start_code & 0xFF));
  mySerial->write(packet.address[0]);
  mySerial->write(packet.address[1]);
  mySerial->write(packet.address[2]);
  mySerial->write(packet.address[3]);
  mySerial->write(packet.type);

  uint16_t wire_length = packet.length + 2;
  mySerial->write((uint8_t)(wire_length >> 8));
  mySerial->write((uint8_t)(wire_length & 0xFF));

  uint16_t sum = ((wire_length) >> 8) + ((wire_length) & 0xFF) + packet.type;
  for (uint8_t i = 0; i < packet.length; i++) {
    mySerial->write(packet.data[i]);
    sum += packet.data[i];
  }

  mySerial->write((uint8_t)(sum >> 8));
  mySerial->write((uint8_t)(sum & 0xFF));

  return;
}

uint8_t
Adafruit_Fingerprint::getStructuredPacket(Adafruit_Fingerprint_Packet *packet,
                                          uint16_t timeout) {
  uint8_t byte;
  uint16_t idx = 0, timer = 0;

  while (true) {
    while (!mySerial->available()) {
      delay(1);
      timer++;
      if (timer >= timeout) {
        return FINGERPRINT_TIMEOUT;
      }
    }
    byte = mySerial->read();
    switch (idx) {
    case 0:
      if (byte != (FINGERPRINT_STARTCODE >> 8))
        continue;
      packet->start_code = (uint16_t)byte << 8;
      break;
    case 1:
      packet->start_code |= byte;
      if (packet->start_code != FINGERPRINT_STARTCODE)
        return FINGERPRINT_BADPACKET;
      break;
    case 2:
    case 3:
    case 4:
    case 5:
      packet->address[idx - 2] = byte;
      break;
    case 6:
      packet->type = byte;
      break;
    case 7:
      packet->length = (uint16_t)byte << 8;
      break;
    case 8:
      packet->length |= byte;
      break;
    default:
      packet->data[idx - 9] = byte;
      if ((idx - 8) == packet->length) {
        return FINGERPRINT_OK;
      }
      break;
    }
    idx++;
    if ((idx + 9) >= sizeof(packet->data)) {
      return FINGERPRINT_BADPACKET;
    }
  }
  return FINGERPRINT_BADPACKET;
}

// ================================================================
// PATCH: readCharBuffer — upload template from sensor buffer to MCU
// ================================================================
uint8_t Adafruit_Fingerprint::readCharBuffer(uint8_t bufferID, uint8_t * outBuf, uint16_t * outLen) {
    uint8_t cmd_data[] = {FINGERPRINT_UPCHAR, bufferID};
    Adafruit_Fingerprint_Packet cmd(FINGERPRINT_COMMANDPACKET, sizeof(cmd_data), cmd_data);
    writeStructuredPacket(cmd);

    Adafruit_Fingerprint_Packet ack(0, 0, NULL);
    if (getStructuredPacket(&ack) != FINGERPRINT_OK)  return FINGERPRINT_PACKETRECIEVEERR;
    if (ack.type != FINGERPRINT_ACKPACKET)            return FINGERPRINT_PACKETRECIEVEERR;
    if (ack.data[0] != FINGERPRINT_OK)                return FINGERPRINT_IMAGEFAIL;

    *outLen = 0;
    Adafruit_Fingerprint_Packet pkt(0, 0, NULL);

    while (*outLen < 1024) {
        if (getStructuredPacket(&pkt) != FINGERPRINT_OK)  return FINGERPRINT_PACKETRECIEVEERR;

        uint16_t payload = (pkt.length > 2) ? (pkt.length - 2) : 0;

        uint16_t copyLen = payload;
        if (*outLen + copyLen > 1024)    copyLen = 1024 - *outLen;

        memcpy(outBuf + *outLen, pkt.data, copyLen);
        *outLen += copyLen;

        if (pkt.type == FINGERPRINT_ENDDATAPACKET) break;
    }

    return FINGERPRINT_OK;
}

// ================================================================
// PATCH: writeCharBuffer — download template from MCU to sensor buffer
// ================================================================
uint8_t Adafruit_Fingerprint::writeCharBuffer(uint8_t bufferID,
                                              uint8_t *data,
                                              uint16_t len) {
    uint8_t cmd[] = {0x09, bufferID};
    Adafruit_Fingerprint_Packet p(FINGERPRINT_COMMANDPACKET, sizeof(cmd), cmd);
    writeStructuredPacket(p);

    Adafruit_Fingerprint_Packet reply(0, 0, NULL);
    if (getStructuredPacket(&reply) != FINGERPRINT_OK)
        return FINGERPRINT_PACKETRECIEVEERR;
    if (reply.type != FINGERPRINT_ACKPACKET)
        return FINGERPRINT_PACKETRECIEVEERR;
    if (reply.data[0] != FINGERPRINT_OK)
        return reply.data[0];

    uint16_t chunkSize = packet_len;
    if (chunkSize > 128) chunkSize = 128;
    if (chunkSize == 0)  chunkSize = 64;

    uint16_t offset = 0;

    while (offset < len) {
        uint16_t remaining = len - offset;
        uint16_t thisChunk = (remaining > chunkSize) ? chunkSize : remaining;

        uint8_t packetType = (offset + thisChunk >= len)
                ? FINGERPRINT_ENDDATAPACKET
                : FINGERPRINT_DATAPACKET;

        Adafruit_Fingerprint_Packet dataPacket(packetType, thisChunk, data + offset);
        writeStructuredPacket(dataPacket);
        offset += thisChunk;
        delay(15);
    }

    // R307 does NOT send an ACK after ENDDATAPACKET — do not wait for one
    return FINGERPRINT_OK;
}

// ================================================================
// PATCH: match — compare two buffers already in slots 1 and 2
// ================================================================
uint8_t Adafruit_Fingerprint::match(uint16_t *score) {
  GET_CMD_PACKET(0x03);
  *score = ((uint16_t)packet.data[1] << 8) | packet.data[2];
  return packet.data[0];
}
