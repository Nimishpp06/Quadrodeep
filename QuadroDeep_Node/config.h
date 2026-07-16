#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#define API_BASE "http://192.168.137.1:3000"
#define LAB_ID "IOT_01"
#define FIRMWARE_VERSION "1.0.0"

#define WIFI_SSID "NIMISH 3333"
#define WIFI_PASSWORD "71@J838j"

// MQTT Configuration
#define MQTT_BROKER "192.168.137.1"
#define MQTT_PORT 1885
#define MQTT_TOPIC_CONTROL "lab/" LAB_ID "/control"
#define MQTT_TOPIC_STATUS "lab/" LAB_ID "/status"

// Hardware Pins
#define PIN_RFID_RST 4
#define PIN_RFID_MISO 19
#define PIN_RFID_MOSI 23
#define PIN_RFID_SCK 18
#define PIN_RFID_SS 5

#define PIN_FP_RX 16 // ESP32 RX2 -> RS307 TX
#define PIN_FP_TX 17 // ESP32 TX2 -> RS307 RX

#define PIN_BUZZER 14
#define PIN_PIR 33
#define PIN_BUTTON 32

#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22

#define PIN_RGB_R 27
#define PIN_RGB_G 26
#define PIN_RGB_B 25

// Constants
#define OFFLINE_QUEUE_FILE "/offline_queue.json"
#define OFFLINE_RFID_FILE "/offline_rfid.json"
#define PREFS_FINGER_SLOT "next_finger_slot"

// Global Enums
enum AppState {
    STATE_BOOT,
    STATE_INIT_HARDWARE,
    STATE_WIFI_PROVISION,
    STATE_SYNC_TIME,
    STATE_REGISTER_DEVICE,
    STATE_CHECK_ACTIVE_SESSION,
    STATE_MQTT_CONNECT,
    STATE_IDLE,
    STATE_SESSION_ACTIVE,
    STATE_OFFLINE
};

// Data Structures
struct StudentRecord {
    String id;
    String name;
    String rfid;
    uint16_t rs307Slot;       // 1-200 (Internal hardware memory slot)
    uint16_t sessionFingerId; // 1-30 (Backend session ID)
    bool hasRfid;
    bool hasFingerprint;
};

struct SessionConfig {
    String sessionId;
    String labId;
    String batchId;
    String mode;
    time_t startTime = 0;      // Session start (epoch)
    time_t endTime = 0;        // Session end (epoch)
    StudentRecord students[30];
    int studentCount = 0;
};

// Function Declarations from Main
uint16_t getNextFingerSlot();
void saveNextFingerSlot(uint16_t slot);

#endif // CONFIG_H