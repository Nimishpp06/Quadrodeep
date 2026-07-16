#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include "config.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

class DeviceNetworkManager {
private:
    Preferences prefs;
    time_t timeOffset = 0;

public:
    bool isConnected() { return WiFi.status() == WL_CONNECTED; }

void connectWiFi() {
        Serial.println("\n====================================");
        Serial.print("Connecting to WiFi: ");
        Serial.println(WIFI_SSID);
        Serial.println("====================================");

        // 1. HARD WIPE CACHE: Clear out any corrupted state machine entries
        WiFi.disconnect(true, true); 
        delay(500);
        
        WiFi.mode(WIFI_STA); 
        
        // 2. DISABLE POWER SAVE: Stops phone hotspots from dropping connections
        WiFi.setSleep(false); 
        WiFi.setTxPower(WIFI_POWER_19_5dBm);  // Max TX power
        delay(200);

        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        
        int retries = 0;
        while (WiFi.status() != WL_CONNECTED && retries < 40) { // Up to 20 seconds timeout
            delay(500); 
            Serial.print("."); 
            
            // 3. KICKSTART ASSIST: If stuck for more than 7 seconds, nudge the radio
            if (retries == 14) {
                Serial.print("[Nudging Radio...]");
                WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
            }
            retries++;
        }
        
        if (WiFi.status() == WL_CONNECTED) {
            Serial.println("\n[SUCCESS] WiFi Connected Successfully!");
            Serial.print("ESP32 IP Address: ");
            Serial.println(WiFi.localIP());
        } else {
            Serial.println("\n\n[ERROR] WiFi Connection Failed!");
            Serial.print("Current Status Code: "); 
            Serial.println(WiFi.status());
            if (WiFi.status() == 6) {
                Serial.println("-> Hint: Password mismatch, or Hotspot is broadcasting on 5GHz instead of 2.4GHz.");
            }
            delay(2000);
        }
    }
    void syncTime() {
        configTime(19800, 0, "pool.ntp.org", "time.nist.gov"); // 19800 = IST offset
        struct tm ti;
        if (getLocalTime(&ti, 5000)) {
            String res = httpGet("/api/device/sync-time");
            if (res.length() > 0) {
                JsonDocument doc; deserializeJson(doc, res);
                if (doc["success"]) {
                    time_t serverTime = doc["data"]["unix"].as<time_t>();
                    timeOffset = serverTime - time(nullptr);
                }
            }
        }
    }

    time_t getCurrentLocalTime() { return time(nullptr) + timeOffset; }

    String getISOTime() {
        time_t now = getCurrentLocalTime();
        struct tm *ti = gmtime(&now);
        char buf[30];
        strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000Z", ti);
        return String(buf);
    }

    String httpPost(String endpoint, String payload) {
        if (!isConnected()) return "";
        HTTPClient http;
        http.begin(String(API_BASE) + endpoint);
        http.addHeader("Content-Type", "application/json");
        String response = "";
        if (http.POST(payload) > 0) response = http.getString();
        http.end();
        return response;
    }

    String httpPut(String endpoint, String payload) {
        if (!isConnected()) return "";
        HTTPClient http;
        http.begin(String(API_BASE) + endpoint);
        http.addHeader("Content-Type", "application/json");
        String response = "";
        if (http.PUT(payload) > 0) response = http.getString();
        http.end();
        return response;
    }

    String httpGet(String endpoint) {
        if (!isConnected()) return "";
        HTTPClient http;
        http.begin(String(API_BASE) + endpoint);
        String response = "";
        if (http.GET() > 0) response = http.getString();
        http.end();
        return response;
    }
};

extern DeviceNetworkManager net; // Declaration only

#endif // WIFI_MANAGER_H