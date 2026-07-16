#include "config.h"
#include "hardware.h"
#include "wifi_manager.h"
#include "storage.h"
#include "device_base64.h"
#include <Preferences.h>
#include <LittleFS.h>
#include <driver/rtc_io.h>
#include <PubSubClient.h>

// ===== GLOBAL INSTANCES =====
DeviceNetworkManager net;

// ===== GLOBAL STATE =====
AppState currentState = STATE_BOOT;
SessionConfig activeSession;
unsigned long lastActivity = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastMqttReconnect = 0;
unsigned long lastHttpPoll = 0;
bool mqttEverConnected = false;
bool mqttFailed = false;

// Track which students already marked this session to prevent duplicate scans
bool attendanceMarked[30] = {false};

// Track last processed command ID to avoid re-processing stale commands
int lastProcessedCmdId = -1;

// Guard flag to disable sleep during biometric enrollment
bool isEnrollmentActive = false;

// Timer for countdown flash intervals
unsigned long lastFlashTime = 0;

// Offline RFID mode
unsigned long lastWifiCheck = 0;
bool wifiReconnecting = false;

// ===== PROTOTYPES =====
void handleCommand(JsonDocument& cmd);
void processRFID();
void processFingerprint();
uint16_t nextAvailableSlot();
void markAttendance(String studentId, String studentName, String method, String rfidHex = "", uint16_t fingerId = 0);
bool connectMQTT();
void processOfflineRFID();
void handleActiveSessionTimeout();
void enterLightSleep(bool isTimeout);
void maintainConnections();
void updateLiveSessionDisplay();

// ===== MQTT =====
WiFiClient espClient;
PubSubClient mqttClient(espClient);

void mqttCallback(char* topic, byte* payload, unsigned int length) {
    char msg[length + 1];
    memcpy(msg, payload, length);
    msg[length] = '\0';
    Serial.printf("[MQTT] Received on %s: %s\n", topic, msg);

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, msg);
    if (err) { Serial.println("[MQTT] JSON parse error"); return; }

    String command = doc["command"].as<String>();

    if (command == "START") {
        Serial.println("[MQTT] START command received");
        activeSession.sessionId = doc["session_id"].as<String>();
        activeSession.mode = doc["mode"].as<String>();
        activeSession.startTime = doc["start_time"].as<time_t>();
        activeSession.endTime = doc["end_time"].as<time_t>();
        lastActivity = millis();
        currentState = STATE_CHECK_ACTIVE_SESSION;
    }
    else if (command == "END") {
        Serial.println("[MQTT] END command received");
        activeSession = SessionConfig();
        currentState = STATE_IDLE;
    }
    else if (command == "SET_MODE") {
        Serial.println("[MQTT] SET_MODE command received");
        activeSession.mode = doc["mode"].as<String>();
    }
    else if (command == "ENROLL_RFID") {
        Serial.println("[MQTT] RFID enrollment command received");
        JsonDocument fakeCmd;
        fakeCmd["data"]["type"] = "rfid";
        fakeCmd["data"]["id"] = doc["cmd_id"].as<int>();
        fakeCmd["data"]["target_user_id"] = doc["target_user_id"].as<String>();
        handleCommand(fakeCmd);
    }
    else if (command == "ENROLL_FINGERPRINT") {
        Serial.println("[MQTT] FP enrollment command received");
        JsonDocument fakeCmd;
        fakeCmd["data"]["type"] = "fingerprint";
        fakeCmd["data"]["id"] = doc["cmd_id"].as<int>();
        fakeCmd["data"]["target_user_id"] = doc["target_user_id"].as<String>();
        handleCommand(fakeCmd);
    }
}

// ===== PREFERENCES HELPERS =====
uint16_t getNextFingerSlot() {
    Preferences prefs;
    prefs.begin("finger", false);
    uint16_t slot = prefs.getUShort(PREFS_FINGER_SLOT, 1);
    prefs.end();
    if (slot > 200) slot = 1;
    return slot;
}

void saveNextFingerSlot(uint16_t slot) {
    Preferences prefs;
    prefs.begin("finger", false);
    prefs.putUShort(PREFS_FINGER_SLOT, slot);
    prefs.end();
}

uint16_t nextAvailableSlot() {
    uint16_t slot = getNextFingerSlot();
    saveNextFingerSlot(slot + 1);
    if (slot > 200) { saveNextFingerSlot(1); return 1; }
    return slot;
}

// ===== SETUP =====
void setup() {
    Serial.begin(115200);
    delay(500); // Give the serial monitor a moment to catch up
    
    // DIAGNOSTIC PRINT: To prove the new code actually uploaded successfully
    Serial.println("\n\n====================================");
    Serial.println("!!! ESP32 BOOTED - NEW CODE ACTIVE !!!");
    Serial.println("====================================");
    
    lastActivity = millis();
}
// ===== MAIN LOOP =====
void loop() {
    switch (currentState) {
        case STATE_BOOT:
            currentState = STATE_INIT_HARDWARE;
            break;

        case STATE_INIT_HARDWARE:
            hw.init();
            store.init();
            hw.display("QuadroDeep", "Connecting...");
            currentState = STATE_WIFI_PROVISION;
            break;

        case STATE_WIFI_PROVISION:
            hw.setRGB(0, 0, 255); 
            net.connectWiFi();    
            currentState = STATE_SYNC_TIME;
            break;

        case STATE_SYNC_TIME:
            net.syncTime();
            currentState = STATE_REGISTER_DEVICE;
            break;

        case STATE_REGISTER_DEVICE: {
            bool registered = false;
            for (int retry = 0; retry < 3 && !registered; retry++) {
                JsonDocument req;
                req["labId"] = LAB_ID;
                req["firmwareVersion"] = FIRMWARE_VERSION;
                String payload; serializeJson(req, payload);
                
                String res = net.httpPost("/api/device/register", payload);
                if (res.length() > 0) {
                    registered = true;
                } else {
                    Serial.printf("[REGISTER] Attempt %d failed, retrying...\n", retry + 1);
                    delay(2000);
                }
            }
            
            currentState = STATE_MQTT_CONNECT;
            break;
        }

        case STATE_CHECK_ACTIVE_SESSION: {
            hw.display("Loading Students...", activeSession.sessionId);
            Serial.printf("[STATE] CHECK_ACTIVE_SESSION: loading biometrics for sessionId=%s\n", activeSession.sessionId.c_str());
            String res = net.httpGet("/api/professor/session/biometrics?sessionId=" + activeSession.sessionId);
            JsonDocument doc; deserializeJson(doc, res);
            Serial.printf("[STATE] CHECK_ACTIVE_SESSION: HTTP response (first 200 chars): %s\n", res.substring(0, 200).c_str());
            
            if (doc["success"]) {
                JsonArray students = doc["data"]["students"].as<JsonArray>();
                activeSession.studentCount = 0;
                memset(attendanceMarked, 0, sizeof(attendanceMarked));
                
                activeSession.mode = doc["data"]["mode"].as<String>();
                
                for (JsonObject s : students) {
                    if (activeSession.studentCount < 30) {
                        StudentRecord& rec = activeSession.students[activeSession.studentCount];
                        rec.id = s["id"].as<String>();
                        rec.name = s["name"].as<String>();
                        rec.rfid = s["rfid"].as<String>();
                        rec.sessionFingerId = s["fingerId"].as<uint16_t>();
                        rec.rs307Slot = s["fingerId"].as<uint16_t>(); 
                        rec.hasRfid = (s["rfid"].as<String>().length() > 0);
                        rec.hasFingerprint = (s["biometric"].as<String>().length() > 0);
                        Serial.printf("[STATE] student[%d]: name=%s, rfid=%s, rs307Slot=%d\n",
                            activeSession.studentCount, rec.name.c_str(), rec.rfid.c_str(), rec.rs307Slot);
                        activeSession.studentCount++;
                    }
                }
                Serial.printf("[STATE] Session loaded: %d students, mode=%s\n", activeSession.studentCount, activeSession.mode.c_str());
                currentState = STATE_SESSION_ACTIVE;
            } else {
                currentState = STATE_IDLE;
            }
            break;
        }

        case STATE_MQTT_CONNECT:
            hw.display("Connecting MQTT", "");
            hw.setRGB(0, 0, 255);
            if (connectMQTT()) {
                currentState = STATE_IDLE;
            } else {
                currentState = STATE_IDLE;
            }
            break;

        case STATE_IDLE:
            hw.setRGB(0, 255, 0); 
            hw.display("No Session Live", "Ready to Trigger");

            if (mqttClient.connected()) {
                mqttClient.loop();
            } else if (!mqttFailed && !mqttEverConnected) {
                unsigned long now = millis();
                if (now - lastMqttReconnect > 30000) {
                    lastMqttReconnect = now;
                    connectMQTT();
                }
            } else if (mqttEverConnected && !mqttClient.connected()) {
                unsigned long now = millis();
                if (now - lastMqttReconnect > 30000) {
                    lastMqttReconnect = now;
                    connectMQTT();
                }
            }

            if (millis() - lastHttpPoll > 5000) {
                lastHttpPoll = millis();
                String res = net.httpGet("/api/device/command?labId=" + String(LAB_ID));
                if (res.length() > 0) {
                    JsonDocument cmd; deserializeJson(cmd, res);
                    if (cmd["success"] && !cmd["data"].isNull()) {
                        int cmdId = cmd["data"]["id"].as<int>();
                        if (cmdId != lastProcessedCmdId) {
                            lastProcessedCmdId = cmdId;
                            String type = cmd["data"]["type"].as<String>();
                            if (type == "load_session") {
                                activeSession.sessionId = cmd["data"]["target_user_id"].as<String>();
                                activeSession.mode = cmd["data"]["result_value"].as<String>();
                                currentState = STATE_CHECK_ACTIVE_SESSION;
                            } else if (type == "end_session") {
                                activeSession = SessionConfig();
                                currentState = STATE_IDLE;
                            } else if (type == "rfid" || type == "fingerprint" || type == "start_enrollment" || type == "end_enrollment" || type == "set_mode") {
                                handleCommand(cmd);
                            }
                        }
                    }
                }
            }

            // WiFi lost → offline RFID mode
            if (!net.isConnected() && millis() - lastWifiCheck > 10000) {
                lastWifiCheck = millis();
                Serial.println("[WIFI] Lost connection → entering OFFLINE mode");
                hw.display("Lost WiFi", "Going Offline");
                delay(1000);
                currentState = STATE_OFFLINE;
            }

            // 5-minute idle timeout → light sleep
            if (!isEnrollmentActive && millis() - lastActivity > 300000) {
                Serial.println("[IDLE] 5-minute timeout reached. Suspending...");
                enterLightSleep(false);
            }
            break;

        case STATE_OFFLINE: {
            hw.setRGB(255, 165, 0);
            hw.display("OFFLINE MODE", "Tap RFID Card");

            // Non-blocking WiFi reconnect: start once, check progress each loop
            if (!wifiReconnecting && !net.isConnected()) {
                Serial.println("[OFFLINE] Starting WiFi reconnect attempt...");
                WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
                wifiReconnecting = true;
                lastWifiCheck = millis();
            }

            // Every 5s, check if WiFi connected yet
            if (wifiReconnecting && millis() - lastWifiCheck > 5000) {
                lastWifiCheck = millis();
                if (WiFi.status() == WL_CONNECTED) {
                    wifiReconnecting = false;
                    Serial.printf("[OFFLINE] WiFi reconnected! IP: %s\n", WiFi.localIP().toString().c_str());

                    // Let TCP/IP stack settle before HTTP
                    delay(1000);

                    hw.setRGB(255, 255, 0);
                    hw.display("WiFi Back!", "Syncing...");
                    delay(500);

                    String queue = store.getOfflineRFIDQueue();
                    Serial.printf("[SYNC] Queue length: %d chars, content: %s\n", queue.length(), queue.substring(0, 100).c_str());

                    if (queue.length() > 5) {
                        JsonDocument req;
                        req["labId"] = LAB_ID;
                        req["records"] = serialized(queue);
                        String payload; serializeJson(req, payload);

                        hw.display("Syncing...", String(payload.length()) + " bytes");
                        Serial.printf("[SYNC] POSTing to /api/attendance/offline-rfid-sync, payload: %s\n", payload.c_str());

                        String res = net.httpPost("/api/attendance/offline-rfid-sync", payload);
                        Serial.printf("[SYNC] HTTP response (%d chars): %s\n", res.length(), res.c_str());

                        if (res.length() > 0) {
                            JsonDocument resp; deserializeJson(resp, res);
                            if (resp["success"]) {
                                store.clearOfflineRFIDQueue();
                                int p = resp["data"]["processed"].as<int>();
                                hw.setRGB(0, 255, 0);
                                hw.display("Sync OK", String(p) + " processed");
                                Serial.printf("[SYNC] Success! Processed %d records\n", p);
                                delay(1500);
                            } else {
                                String err = resp["error"].as<String>();
                                hw.setRGB(255, 0, 0);
                                hw.display("Sync Failed", err.length() > 0 ? err : "Server error");
                                Serial.printf("[SYNC] Server returned error: %s\n", err.c_str());
                                delay(1500);
                            }
                        } else {
                            hw.setRGB(255, 0, 0);
                            hw.display("Sync Error", "HTTP failed");
                            Serial.println("[SYNC] HTTP POST returned empty response");
                            delay(1500);
                        }
                    } else {
                        Serial.println("[SYNC] Queue empty or too short, skipping sync");
                    }
                    currentState = STATE_IDLE;
                    break;
                } else {
                    Serial.printf("[OFFLINE] WiFi not connected yet, status=%d\n", WiFi.status());
                }
            }

            // Keep MQTT alive when WiFi is connected
            if (net.isConnected()) {
                if (mqttClient.connected()) {
                    mqttClient.loop();
                } else if (mqttEverConnected) {
                    if (millis() - lastMqttReconnect > 30000) {
                        lastMqttReconnect = millis();
                        connectMQTT();
                    }
                }
            }

            processOfflineRFID();
            break;
        }

        case STATE_SESSION_ACTIVE: {
            if (mqttClient.connected()) {
                mqttClient.loop();
            } else if (mqttEverConnected || !mqttFailed) {
                unsigned long ms = millis();
                if (ms - lastMqttReconnect > 30000) {
                    lastMqttReconnect = ms;
                    connectMQTT();
                }
            }

            updateLiveSessionDisplay();

            time_t now = net.getCurrentLocalTime();
            if (activeSession.endTime > 0 && now >= activeSession.endTime) {
                hw.display("Session Ended", "");
                delay(2000);
                activeSession = SessionConfig(); 
                currentState = STATE_IDLE;
                break;
            }

            if (millis() - lastHeartbeat > 30000) {
                lastHeartbeat = millis();
                if (net.isConnected()) {
                    String queue = store.getOfflineQueuePayload();
                    if (queue.length() > 20) {
                        net.httpPost("/api/attendance/sync-offline", queue);
                        store.clearOfflineQueue();
                    }
                    JsonDocument hb;
                    hb["labId"] = LAB_ID;
                    hb["freeHeap"] = ESP.getFreeHeap();
                    hb["uptime"] = millis() / 1000;
                    String hStr; serializeJson(hb, hStr);
                    net.httpPost("/api/device/heartbeat", hStr);
                }
            }

            processRFID();
            processFingerprint();

            // Evaluate sleep requirements ONLY if enrollment mode is inactive
            if (!isEnrollmentActive) {
                handleActiveSessionTimeout();
            }
        }
    }
}

// ===== MQTT CONNECTION =====
bool connectMQTT() {
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);

    String clientId = "ESP32_" + String(LAB_ID) + "_" + String(random(0xffff), HEX);

    for (int retry = 0; retry < 3; retry++) {
        if (mqttClient.connect(clientId.c_str())) {
            Serial.println("[MQTT] Connected!");
            mqttClient.subscribe(MQTT_TOPIC_CONTROL);
            Serial.printf("[MQTT] Subscribed to %s\n", MQTT_TOPIC_CONTROL);
            mqttEverConnected = true;
            mqttFailed = false;
            return true;
        }
        delay(300);
    }
    if (!mqttEverConnected) mqttFailed = true;
    return false;
}

// ===== PROCESS FUNCTIONS =====
void handleCommand(JsonDocument& cmd) {
    String type = cmd["data"]["type"].as<String>();
    lastActivity = millis();

    // Enrollment guard: prevent sleep during biometric configuration
    if (type == "start_enrollment") {
        isEnrollmentActive = true;
        hw.setRGB(128, 0, 128);
        hw.display("Enrollment Open", "Do Not Sleep");
        return;
    }
    else if (type == "end_enrollment") {
        isEnrollmentActive = false;
        lastActivity = millis();
        return;
    }

    int cmdId = cmd["data"]["id"].as<int>();

    Serial.printf("[CMD] Processing: %s (ID: %d)\n", type.c_str(), cmdId);
    hw.setRGB(255, 255, 0); // YELLOW = processing
    hw.beep(50);

    if (type == "rfid") {
        hw.setRGB(255, 255, 0);
        hw.display("ENROLL RFID", "Tap Card...");
        Serial.println("[CMD] enroll_rfid loop started. Waiting 10s for card tap...");
        
        unsigned long start = millis();
        bool enrolled = false;
        while (millis() - start < 10000) {
            yield(); // Allow background tasks
            if (hw.rfid.PICC_IsNewCardPresent() && hw.rfid.PICC_ReadCardSerial()) {
                String rfidHex = "";
                for (byte i = 0; i < hw.rfid.uid.size; i++) {
                    rfidHex += String(hw.rfid.uid.uidByte[i], HEX);
                }
                rfidHex.toUpperCase();
                Serial.printf("[CMD] Card detected! UID: %s\n", rfidHex.c_str());
                
                JsonDocument req;
                req["labId"] = LAB_ID;
                req["rfid"] = rfidHex;
                req["commandId"] = cmdId;
                String payload; serializeJson(req, payload);
                Serial.println("[CMD] Sending enrollment request to server...");
                
                bool success = false;
                for (int retry = 0; retry < 3 && !success; retry++) {
                    String response = net.httpPost("/api/device/enrollment/rfid", payload);
                    Serial.printf("[CMD] Enrollment response: %s\n", response.c_str());
                    if (response.length() > 0) {
                        JsonDocument resp; deserializeJson(resp, response);
                        if (resp["success"] == true) {
                            success = true;
                            break;
                        }
                    }
                    delay(500);
                }
                
                if (success) {
                    hw.setRGB(0, 255, 0); hw.beep(100, 2);
                    hw.display("Enrolled:", rfidHex);
                } else {
                    hw.setRGB(255, 0, 0); hw.beep(500);
                    hw.display("Enroll Failed", "Retry");
                }
                delay(2000);
                enrolled = true;
                break;
            }
            delay(10);
        }
        if (!enrolled) {
            Serial.println("[CMD] enroll_rfid timeout - no card detected.");
            // Notify backend so command is marked timeout immediately
            JsonDocument tReq;
            tReq["labId"] = LAB_ID;
            tReq["commandId"] = cmdId;
            tReq["status"] = "timeout";
            String tPayload; serializeJson(tReq, tPayload);
            net.httpPost("/api/device/enrollment/rfid", tPayload);
            hw.setRGB(255, 165, 0); // Orange
            hw.display("Timeout", "No card tapped");
            delay(1500);
        }
        currentState = STATE_IDLE;
    } 
    else if (type == "fingerprint") {
        hw.setRGB(255, 0, 255);
        hw.display("ENROLL FINGER", "Place Finger");
        
        if (hw.finger.getImage() == FINGERPRINT_OK) {
            hw.beep(60);
            delay(300);
            hw.finger.image2Tz(1);
            hw.display("Remove Finger", "Wait...");
            delay(2000);
            hw.display("Place Again", "");
            while (hw.finger.getImage() != FINGERPRINT_OK);
            hw.finger.image2Tz(2);
            
            if (hw.finger.createModel() == FINGERPRINT_OK) {
                uint16_t slot = nextAvailableSlot();
                if (hw.finger.storeModel(slot) == FINGERPRINT_OK) {
                    // Load model back from flash to CharBuffer1, then extract template
                    hw.finger.loadModel(slot);
                    delay(200);
                    
                    uint8_t templateBuf[1024];
                    uint16_t templateLen = 0;
                    uint8_t ret = hw.finger.readCharBuffer(1, templateBuf, &templateLen);
                    if (ret == FINGERPRINT_OK && templateLen > 0) {
                        String templateBase64 = DeviceBase64::encode(templateBuf, templateLen);
                        JsonDocument req;
                        req["labId"] = LAB_ID;
                        req["fingerId"] = slot;
                        req["templateBase64"] = templateBase64;
                        req["commandId"] = cmdId;
                        String payload; serializeJson(req, payload);
                        net.httpPost("/api/device/enrollment/fingerprint", payload);
                        String targetUserId = cmd["data"]["target_user_id"].as<String>();
                        for (int idx = 0; idx < activeSession.studentCount; idx++) {
                            if (activeSession.students[idx].id == targetUserId) {
                                activeSession.students[idx].rs307Slot = slot; break;
                            }
                        }
                        hw.setRGB(0, 255, 0); hw.beep(100, 3);
                        hw.display("Enrolled!", "Slot: " + String(slot));
                    } else {
                        hw.setRGB(255, 0, 0); hw.beep(500);
                        hw.display("Read TimeOut", "Retry");
                    }
                } else {
                    hw.setRGB(255, 0, 0); hw.beep(500);
                    hw.display("Failed", "Retry");
                }
            } else {
                hw.setRGB(255, 0, 0); hw.beep(500);
                hw.display("Failed", "Retry");
            }
        } else {
            hw.setRGB(255, 0, 0); hw.beep(500);
            hw.display("Failed", "Retry");
        }
        delay(2000);
        currentState = STATE_IDLE;
    }
    else if (type == "load_session") {
        isEnrollmentActive = false;
        activeSession.sessionId = cmd["data"]["sessionId"].as<String>();
        currentState = STATE_CHECK_ACTIVE_SESSION;
    }
    else if (type == "set_mode") {
        activeSession.mode = cmd["data"]["mode"].as<String>();
        updateLiveSessionDisplay();
        
        JsonDocument req;
        req["labId"] = LAB_ID;
        req["mode"] = activeSession.mode;
        String payload; serializeJson(req, payload);
        net.httpPut("/api/labs/mode", payload);
    }
}

void markAttendance(String studentId, String studentName, String method, String rfidHex, uint16_t fingerId) {
    lastActivity = millis();
    String isoTime = net.getISOTime();

    if (net.isConnected()) {
        JsonDocument req;
        req["labId"] = LAB_ID;
        req["studentId"] = studentId;
        req["timestamp"] = isoTime;
        
        if (method == "rfid") req["rfid"] = rfidHex;
        else req["fingerId"] = fingerId;
        
        String payload; serializeJson(req, payload);
        String res = net.httpPost("/api/attendance/scan", payload);
        JsonDocument doc; deserializeJson(doc, res);
        
        if (doc["success"]) {
            String msg = doc["message"].as<String>();
            if (msg == "Already marked") {
                hw.setRGB(0, 255, 0); hw.beep(100, 1);
                hw.display("Already Marked", studentName);
            } else {
                hw.setRGB(0, 255, 0); hw.beep(100, 2);
                hw.display("Welcome " + studentName, "Present");
            }
        } else {
            hw.setRGB(255, 0, 0); hw.beep(500);
            hw.display("Unknown User", "");
        }
    } else {
        store.queueOfflineRecord(studentId, method, isoTime);
        hw.setRGB(255, 0, 0); hw.beep(100, 2); 
        hw.display("Offline Saved", studentName);
    }
    delay(2000);
}

void processRFID() {
    if (activeSession.mode == "attendance_fingerprint") {
        Serial.println("[RFID] mode=attendance_fingerprint, skipping RFID");
        return;
    }
    Serial.printf("[RFID] studentCount=%d\n", activeSession.studentCount);
    
    if (hw.rfid.PICC_IsNewCardPresent() && hw.rfid.PICC_ReadCardSerial()) {
        String uid = "";
        for (byte i = 0; i < hw.rfid.uid.size; i++) {
            uid += String(hw.rfid.uid.uidByte[i], HEX);
        }
        uid.toUpperCase();
        Serial.printf("[RFID] Scanned UID: %s (studentCount=%d)\n", uid.c_str(), activeSession.studentCount);

        bool found = false;
        for (int i = 0; i < activeSession.studentCount; i++) {
            Serial.printf("[RFID] compare student[%d].rfid=%s\n", i, activeSession.students[i].rfid.c_str());
            if (activeSession.students[i].rfid == uid) {
                if (attendanceMarked[i]) {
                    hw.setRGB(0, 255, 0); hw.beep(100, 1);
                    hw.display("Already Marked", activeSession.students[i].name);
                    delay(2000);
                } else {
                    markAttendance(activeSession.students[i].id, activeSession.students[i].name, "rfid", uid, 0);
                    attendanceMarked[i] = true;
                }
                found = true; break;
            }
        }
        if(!found) {
            hw.setRGB(255, 0, 0); hw.beep(500);
            hw.display("Unknown Card", "");
            delay(1500);
        }
        hw.rfid.PICC_HaltA();
        hw.rfid.PCD_Init();
    }
}

void processFingerprint() {
    if (activeSession.mode == "attendance_rfid") {
        Serial.println("[FP] mode=attendance_rfid, skipping fingerprint");
        return;
    }
    Serial.printf("[FP] studentCount=%d\n", activeSession.studentCount);
    
    uint8_t img = hw.finger.getImage();
    if (img == FINGERPRINT_OK) {
        Serial.println("[FP] getImage OK, proceeding...");
    } else if (img == FINGERPRINT_NOFINGER) {
        // Normal - no finger placed yet, silent
    } else {
        Serial.printf("[FP] getImage returned error code: %d\n", img);
    }
    if (img == FINGERPRINT_OK) {
        uint8_t tz = hw.finger.image2Tz();
        if (tz == FINGERPRINT_OK) {
            hw.display("Session LIVE", "Scanning FP...");
            uint8_t fs = hw.finger.fingerFastSearch();
            if (fs == FINGERPRINT_OK) {
                uint16_t rs307Slot = hw.finger.fingerID;
                uint16_t confidence = hw.finger.confidence;
                Serial.printf("[FP] fingerFastSearch slot=%d confidence=%d\n", rs307Slot, confidence);
                bool found = false;
                
                for (int i = 0; i < activeSession.studentCount; i++) {
                    Serial.printf("[FP] compare student[%d].rs307Slot=%d\n", i, activeSession.students[i].rs307Slot);
                    if (activeSession.students[i].rs307Slot == rs307Slot) {
                        if (attendanceMarked[i]) {
                            hw.setRGB(0, 255, 0); hw.beep(100, 1);
                            hw.display("Already Marked", activeSession.students[i].name);
                            delay(2000);
                        } else {
                            markAttendance(
                                activeSession.students[i].id,
                                activeSession.students[i].name,
                                "fingerprint",
                                "",
                                activeSession.students[i].sessionFingerId
                            );
                            attendanceMarked[i] = true;
                        }
                        found = true; break;
                    }
                }
                if(!found) {
                    hw.setRGB(255, 0, 0); hw.beep(500);
                    hw.display("Unknown Finger", "");
                    delay(1500);
                }
            } else {
                Serial.printf("[FP] fingerFastSearch failed: code=%d\n", fs);
            }
        } else {
            Serial.printf("[FP] image2Tz failed: code=%d\n", tz);
        }
    }
}

void processOfflineRFID() {
    if (hw.rfid.PICC_IsNewCardPresent() && hw.rfid.PICC_ReadCardSerial()) {
        String uid = "";
        for (byte i = 0; i < hw.rfid.uid.size; i++) {
            uid += String(hw.rfid.uid.uidByte[i], HEX);
        }
        uid.toUpperCase();
        char buf[64];
        snprintf(buf, sizeof(buf), "%lu", millis());
        String isoTime(buf);
        store.queueOfflineRFID(uid, isoTime);
        hw.setRGB(0, 255, 0);
        hw.beep(200, 1);
        hw.display("Saved Offline", uid.c_str());
        Serial.printf("[OFFLINE] Queued RFID: %s\n", uid.c_str());
        delay(1500);
        hw.rfid.PICC_HaltA();
        hw.rfid.PCD_Init();
    }
}

// ===== ACTIVE SESSION TIMEOUT WITH COUNTDOWN =====
void handleActiveSessionTimeout() {
    unsigned long elapsed = millis() - lastActivity;

    if (elapsed >= 15000) {
        Serial.println("[TIMEOUT] Inactivity threshold crossed. Suspending to sleep...");
        enterLightSleep(true);
    }
    else if (elapsed >= 14000) {
        if (millis() - lastFlashTime > 200) {
            lastFlashTime = millis();
            hw.setRGB(255, 0, 0);
            hw.beep(100);
        }
    }
    else if (elapsed >= 13000) {
        if (millis() - lastFlashTime > 350) {
            lastFlashTime = millis();
            hw.setRGB(255, 165, 0);
            hw.beep(100);
        }
    }
    else if (elapsed >= 12000) {
        if (millis() - lastFlashTime > 500) {
            lastFlashTime = millis();
            hw.setRGB(255, 255, 0);
            hw.beep(100);
        }
    }
}

// ===== LIGHT SLEEP ENGINE =====
void enterLightSleep(bool isTimeout) {
    hw.display("", "");
    hw.sleepPrepare();
    hw.setRGB(0, 0, 0);
    delay(100);

    pinMode(33, INPUT_PULLUP);
    pinMode(32, INPUT_PULLUP);

    gpio_wakeup_enable(GPIO_NUM_33, GPIO_INTR_LOW_LEVEL);
    gpio_wakeup_enable(GPIO_NUM_32, GPIO_INTR_LOW_LEVEL);
    esp_sleep_enable_gpio_wakeup();

    Serial.println("[SLEEP] Core suspended. Listening for sensor/button LOW pull...");
    Serial.flush();

    esp_light_sleep_start();

    delay(200);

    hw.wakeInit();
    hw.beep(80, 1);

    Serial.println("[WAKE] Wakeup line caught. System execution restored.");
    lastActivity = millis();
    lastWifiCheck = millis();
    maintainConnections();
}

// ===== CONNECTIONS MAINTENANCE =====
void maintainConnections() {
    if (!net.isConnected()) return;

    if (mqttClient.connected()) {
        mqttClient.loop();
    } else if (mqttEverConnected && millis() - lastMqttReconnect > 30000) {
        lastMqttReconnect = millis();
        connectMQTT();
    } else if (!mqttFailed && !mqttEverConnected) {
        if (millis() - lastMqttReconnect > 30000) {
            lastMqttReconnect = millis();
            connectMQTT();
        }
    }
}

// ===== SMART DISPLAY TRACKING ENGINE =====
void updateLiveSessionDisplay() {
    static unsigned long lastDisplayToggle = 0;
    static bool displayToggleState = false;

    if (millis() - lastDisplayToggle > 2000) {
        lastDisplayToggle = millis();
        displayToggleState = !displayToggleState;
    }

    hw.setRGB(0, 0, 255);

    if (displayToggleState) {
        if (activeSession.mode == "attendance_rfid" || activeSession.mode == "rfid_only") {
            hw.display("Attendance Live", "SCAN RFID CARD");
        } else if (activeSession.mode == "attendance_fingerprint" || activeSession.mode == "fingerprint_only") {
            hw.display("Attendance Live", "PLACE FINGER");
        } else if (activeSession.mode == "either") {
            hw.display("Attendance Live", "CARD OR FINGER");
        } else {
            hw.display("Session Live", "Ready to Scan");
        }
    } else {
        hw.display("Class: " + String(LAB_ID), "Roster: " + String(activeSession.studentCount));
    }
}
