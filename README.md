# QuadroDeep — Smart Attendance System

> **K. J. Somaiya Institute of Technology** — Academic IoT Project

A full-stack IoT attendance management system for academic lab environments. Combines **ESP32-based hardware** (RFID + Fingerprint) with a **Node.js backend** and **role-based web dashboards** for students, professors, and administrators.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Hardware Pinout](#hardware-pinout)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Team](#team)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                    │
│  Student Dashboard · Professor Dashboard · Admin View    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP REST
┌──────────────────────▼──────────────────────────────────┐
│              Node.js Backend (Express)                   │
│  Authentication · Analytics · Session Management · MQTT  │
└──────┬───────────────────────────────┬──────────────────┘
       │ MQTT Pub/Sub                  │ REST
┌──────▼──────┐                 ┌──────▼──────────────────┐
│  ESP32 Node │  ◄──────────── │     Supabase (PostgreSQL) │
│  (RFID+FP)  │  light sleep   │  Attendance · Users · Labs │
└─────────────┘   wake-on-IR   └─────────────────────────┘
```

---

## Features

### Student View
- **Attendance gauge** with color-coded eligibility (≥75% green, <75% red)
- **"Can miss" counter** — how many more classes before falling below threshold
- **Punctuality tracking** — on-time vs late arrival breakdown
- **Verification mode chart** — RFID vs Fingerprint preference
- **Check-in history** — last 20 entries with status badges

### Professor View
- **Live session turnout** — present / total per session
- **Attendance trends** — 30-day line chart
- **Mode adoption pie** — RFID vs Fingerprint usage
- **At-risk flagging** — students with >15% attendance drop over 2 weeks
- **Arrival heatmap** — time-of-day distribution

### Admin View
- **Device fleet monitor** — online / offline / sleep per lab
- **Hardware alerts** — low memory, sensor errors, MQTT drops
- **Enrollment matrix** — students onboarded vs RFID vs biometric
- **Bypass audit log** — force-initialized sessions outside timetable
- **Global attendance rate** with most-utilized lab

### Hardware Capabilities
- Dual-factor authentication (RFID + Fingerprint)
- Light sleep after 5 min idle — wakes on IR motion or button press
- UART state preserved across sleep (no fingerprint re-init)
- Common-anode RGB status indicator
- Standalone offline queue with JSON storage on SPIFFS

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Firmware** | Arduino / C++ (ESP32) |
| **Backend** | Node.js + Express |
| **Database** | Supabase (PostgreSQL) |
| **Frontend** | Vanilla JS + Chart.js |
| **Messaging** | MQTT (Mosquitto) |
| **Biometrics** | R307 / AS608 Fingerprint Scanner |
| **RFID** | MFRC522 |
| **Display** | I2C LCD 16×2 |
| **Power** | Light sleep (ESP32 deep sleep variant) |

---

## Hardware Pinout

| Component | ESP32 Pin | Bus |
|-----------|-----------|-----|
| RFID RST | GPIO 4 | — |
| RFID MISO | GPIO 19 | SPI |
| RFID MOSI | GPIO 23 | SPI |
| RFID SCK | GPIO 18 | SPI |
| RFID SDA/SS | GPIO 5 | SPI |
| Fingerprint RX (ESP TX2) | GPIO 17 | UART2 |
| Fingerprint TX (ESP RX2) | GPIO 16 | UART2 |
| Buzzer | GPIO 14 | — |
| IR / PIR Motion | GPIO 33 | — (wake source) |
| Push Button | GPIO 32 | — (wake source) |
| I2C SDA | GPIO 21 | I2C |
| I2C SCL | GPIO 22 | I2C |
| RGB Red | GPIO 27 | Common anode |
| RGB Green | GPIO 26 | Common anode |
| RGB Blue | GPIO 25 | Common anode |

---

## Project Structure

```
QuadroDeep/
├── QuadroDeep_Node/          # ESP32 firmware
│   ├── QuadroDeep_Node.ino   # Main state machine
│   ├── config.h              # Pins, WiFi, MQTT, API base
│   ├── hardware.h            # Init / wake / sleep helpers
│   ├── wifi_manager.h        # WiFi provisioning
│   ├── storage.h             # SPIFFS offline queue
│   └── device_base64.h       # Base64 fingerprint templates
├── backend/                  # Node.js server
│   ├── server.js             # Express app + routes
│   ├── jobs/                 # Cron jobs (reminders)
│   ├── services/             # Notification service
│   ├── templates/            # Email templates
│   ├── utils/                # Helpers (Resend, retry)
│   ├── package.json
│   └── .env.example          # Required environment variables
├── index.html                # Web dashboard
├── QuadroDeep-Logo.png
└── somaiya-logo.png
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- Supabase (PostgreSQL) project
- Mosquitto MQTT broker
- ESP32 with Arduino IDE
- R307 / AS608 fingerprint sensor + MFRC522 RFID module

### Backend

```bash
cd backend
cp .env.example .env    # Edit with your credentials
npm install
node server.js
```

### ESP32 Firmware

1. Open `QuadroDeep_Node/QuadroDeep_Node.ino` in Arduino IDE
2. Install libraries: `MFRC522`, `Adafruit_Fingerprint`, `LiquidCrystal_I2C`, `PubSubClient`, `ArduinoJson`
3. Edit `config.h`:
   - Set `WIFI_SSID` / `WIFI_PASSWORD`
   - Set `API_BASE` to your backend IP
   - Set `MQTT_BROKER` to your broker IP
4. Upload to ESP32

### Frontend

Serve `index.html` via Live Server (port 5501) or any static server.

---

## Configuration

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service-role JWT |
| `MQTT_BROKER_URL` | `mqtt://<broker-ip>:1885` |
| `RESEND_API_KEY` | Resend email API key |
| `FROM_EMAIL` | Sender email address |

### ESP32 (`QuadroDeep_Node/config.h`)

| Constant | Description |
|----------|-------------|
| `API_BASE` | Backend URL (e.g. `http://192.168.1.100:3000`) |
| `LAB_ID` | Lab identifier (e.g. `IOT_01`) |
| `WIFI_SSID` | WiFi network name |
| `WIFI_PASSWORD` | WiFi password |
| `MQTT_BROKER` | Broker IP address |

---

## API Endpoints

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| `GET` | `/api/analytics/student/:id` | Student | Attendance %, eligibility, punctuality, mode pie, history |
| `GET` | `/api/analytics/professor/dashboard` | Professor | Session stats, 30-day trends, at-risk list, mode split |
| `GET` | `/api/analytics/professor/heatmap` | Professor | Arrival time bucket distribution |
| `GET` | `/api/analytics/admin/overview` | Admin | Users, labs, devices, attendance rate, alerts |
| `GET` | `/api/analytics/admin/enrollment-progress` | Admin | RFID vs biometric onboarding |
| `GET` | `/api/analytics/admin/bypass-log` | Admin | Force-init session audit trail |

---

## Team

- **Nimish Patil**
- **Ashley Dsilva**
- **Sweekar Mandavkar**
- **Dhruv Maurya**

**K. J. Somaiya Institute of Technology, Mumbai**
