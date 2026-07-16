#pragma once
#include "config.h"
#include <LittleFS.h>
#include <ArduinoJson.h>

class StorageManager {
public:
    void init() {
        // Format if mount fails (true parameter)
        if (!LittleFS.begin(true)) {
            Serial.println("LittleFS Mount Failed");
        }
    }

    void queueOfflineRecord(String studentId, String method, String timestamp) {
        JsonDocument doc;
        
        if (LittleFS.exists(OFFLINE_QUEUE_FILE)) {
            File file = LittleFS.open(OFFLINE_QUEUE_FILE, "r");
            deserializeJson(doc, file);
            file.close();
        } else {
            doc.to<JsonArray>();
        }
        
        JsonArray queue = doc.as<JsonArray>();
        JsonObject record = queue.add<JsonObject>();
        record["studentId"] = studentId;
        record["method"] = method;
        record["timestamp"] = timestamp;
        
        File file = LittleFS.open(OFFLINE_QUEUE_FILE, "w");
        serializeJson(doc, file);
        file.close();
    }

    String getOfflineQueuePayload() {
        if (!LittleFS.exists(OFFLINE_QUEUE_FILE)) return "[]";
        
        File file = LittleFS.open(OFFLINE_QUEUE_FILE, "r");
        String payload = file.readString();
        file.close();
        
        return payload;
    }

    void clearOfflineQueue() {
        if (LittleFS.exists(OFFLINE_QUEUE_FILE)) {
            LittleFS.remove(OFFLINE_QUEUE_FILE);
        }
    }

    // === Offline RFID Queue (raw RFID scans, no WiFi needed) ===
    void queueOfflineRFID(String rfid, String isoTime) {
        JsonDocument doc;
        if (LittleFS.exists(OFFLINE_RFID_FILE)) {
            File file = LittleFS.open(OFFLINE_RFID_FILE, "r");
            deserializeJson(doc, file);
            file.close();
        } else {
            doc.to<JsonArray>();
        }
        JsonArray queue = doc.as<JsonArray>();
        JsonObject record = queue.add<JsonObject>();
        record["rfid"] = rfid;
        record["scannedAt"] = isoTime;
        File file = LittleFS.open(OFFLINE_RFID_FILE, "w");
        serializeJson(doc, file);
        file.close();
    }

    String getOfflineRFIDQueue() {
        if (!LittleFS.exists(OFFLINE_RFID_FILE)) return "[]";
        File file = LittleFS.open(OFFLINE_RFID_FILE, "r");
        String payload = file.readString();
        file.close();
        return payload;
    }

    void clearOfflineRFIDQueue() {
        if (LittleFS.exists(OFFLINE_RFID_FILE)) {
            LittleFS.remove(OFFLINE_RFID_FILE);
        }
    }
};

extern StorageManager store;
StorageManager store;