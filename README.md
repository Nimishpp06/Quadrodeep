# Quadrodeep: Smart Multi-Factor Access Control System

Quadrodeep is a secure, IoT-based access control solution built on the ESP32 platform. Designed as a robust security gate, it combines dual-layer authentication (Biometric Fingerprint + RFID) with real-time environment monitoring and localized power management.

## 🚀 Key Features
* **Dual-Layer Authentication:** Secure access using an AS608 Fingerprint Scanner and an MFRC522 RFID module.
* **Environment Awareness:** PIR Motion Sensor to trigger automated system wakeups or security alerts.
* **Local Visual Interface:** I2C LCD screen providing instant status feedback, access approvals, or denial warnings.
* **Power Resiliency:** Hardware-level integration with a custom UPS / Booster power circuit via screw terminals to ensure 24/7 uptime.

## 🛠️ System Architecture & Pin Layout
The system bridges hardware components through a unified 38-pin ESP32 development board footprint split across two main headers (`J1` and `J2`).

### J1 Connections (Right Side)
* **SPI Bus (RFID):** MOSI (D23), MISO (D19), SCK (D18), SDA/NSS (D5)
* **I2C Bus (LCD):** SCL (D22), SDA (D21)
* **Status Indication (RGB LED):** Red (D4), Green (D16), Blue (D17)

### J2 Connections (Left Side)
* **UART Serial (AS608 Biometrics):** TX (D32), RX (D33)
* **Peripherals & Inputs:** PIR Sensor (D25), RFID Reset (D27), Push Button (D14)
* **Main Power Line:** VIN / 5V from Screw Terminal

---

## 📁 Repository Structure
* `/KiCad_Project` — Schematic designs, netlists, and final custom PCB layouts.
* `/Embedded_Code` — Firmware source files (`.ino` / C++) compiled for the ESP32.
* `/Documentation` — Circuit wiring diagrams, data sheets, and pin configuration manifests.

## 👥 The Development Team
* **Member 1:** Nimish patil 
* **Member 2:** Ashley dsilva
* **Member 3:** Sweekar mandavkar 
* **Member 4:** Dhruv maurya
