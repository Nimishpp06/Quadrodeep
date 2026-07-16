#ifndef HARDWARE_H
#define HARDWARE_H

#include "config.h"
#include <Wire.h>
#include <SPI.h>
#include <LiquidCrystal_I2C.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <driver/rtc_io.h> // ESP32 core 3.x RTC requirement

class HardwareManager {
public:
    LiquidCrystal_I2C lcd;
    MFRC522 rfid;
    Adafruit_Fingerprint finger;

    HardwareManager() : lcd(0x27, 16, 2), rfid(PIN_RFID_SS, PIN_RFID_RST), finger(&Serial2) {}

    void init() {
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
        lcd.init();
        lcd.backlight();
        
        pinMode(PIN_RGB_R, OUTPUT);
        pinMode(PIN_RGB_G, OUTPUT);
        pinMode(PIN_RGB_B, OUTPUT);
        pinMode(PIN_BUZZER, OUTPUT);
        setRGB(0, 0, 0); 
        
        SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
        rfid.PCD_Init();
        rfid.PCD_SetAntennaGain(rfid.RxGain_max); // using RxGain_max as it's the valid enum for MFRC522
        
        Serial2.begin(57600, SERIAL_8N1, PIN_FP_RX, PIN_FP_TX);
        finger.begin(57600);
        if (!finger.verifyPassword()) {
            Serial.println("FP sensor NOT found!");
        } else {
            Serial.println("FP sensor OK");
        }
    }

    void display(String line1, String line2) {
        lcd.clear();
        lcd.setCursor(0, 0); lcd.print(line1);
        lcd.setCursor(0, 1); lcd.print(line2);
    }

    void setRGB(uint8_t r, uint8_t g, uint8_t b) {
        // Common Anode: 0=ON, 255=OFF (inverted)
        analogWrite(PIN_RGB_R, 255 - r);
        analogWrite(PIN_RGB_G, 255 - g);
        analogWrite(PIN_RGB_B, 255 - b);
    }

    void beep(int duration, int times = 1) {
        for(int i = 0; i < times; i++) {
            digitalWrite(PIN_BUZZER, HIGH);
            delay(duration);
            digitalWrite(PIN_BUZZER, LOW);
            if(times > 1 && i < times - 1) delay(duration);
        }
    }

    void wakeInit() {
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
        lcd.init();
        lcd.backlight();
        
        pinMode(PIN_RGB_R, OUTPUT);
        pinMode(PIN_RGB_G, OUTPUT);
        pinMode(PIN_RGB_B, OUTPUT);
        pinMode(PIN_BUZZER, OUTPUT);
        setRGB(0, 0, 0); 
        
        SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
        rfid.PCD_Init();
        rfid.PCD_SetAntennaGain(rfid.RxGain_max);
        
        if (!finger.verifyPassword()) {
            Serial.println("FP sensor unresponsive after wake, re-initializing...");
            Serial2.begin(57600, SERIAL_8N1, PIN_FP_RX, PIN_FP_TX);
            finger.begin(57600);
            if (!finger.verifyPassword()) {
                Serial.println("FP sensor NOT found after wake!");
            } else {
                Serial.println("FP sensor recovered OK");
            }
        } else {
            Serial.println("FP sensor OK (no re-init needed)");
        }
    }

    void sleepPrepare() {
        lcd.noBacklight();
        lcd.clear();
        digitalWrite(PIN_RGB_R, HIGH);
        digitalWrite(PIN_RGB_G, HIGH);
        digitalWrite(PIN_RGB_B, HIGH);
        rfid.PCD_AntennaOff();
    }
};

extern HardwareManager hw;
HardwareManager hw;

#endif // HARDWARE_H