# QuadroDeep — Smart Attendance & Access Control System

QuadroDeep is a full-stack IoT attendance management system combining **ESP32 hardware** (RFID + Fingerprint), a **Node.js backend**, and a **web dashboard** with per-role analytics. Developed for academic lab environments.

## Architecture

```
┌─────────────────┐       MQTT / HTTP        ┌──────────────────┐
│  ESP32 Node(s)  │ ◄─────────────────────► │  Node.js Backend │
│  (RFID + FP)    │                          │  (Express API)   │
└─────────────────┘                          └────────┬─────────┘
                                                      │ Supabase
                                                      ▼
                                              ┌──────────────────┐
                                              │   PostgreSQL DB  │
                                              └──────────────────┘
                                                      ▲
                                              ┌───────┴────────┐
                                              │  Web Frontend  │
                                              │  (index.html)  │
                                              └────────────────┘
```

## Features by Role

### Student — Self-Monitoring Dashboard
- **Attendance Gauge** with color-coded eligibility (green/orange/red)
- **Eligibility Countdown** — how many more classes can be missed before falling below 75%
- **Punctuality Score** — on-time vs late arrival tracking
- **Verification Mode Pie Chart** — RFID vs Fingerprint preference
- **History Timeline** — chronological check-in log with status badges

### Professor — Classroom & Behavioral Analytics
- **Live Attendance Rate** — real-time turnout per session
- **Daily/Weekly Trends** — 30-day line chart
- **Authentication Mode Pie** — RFID vs Fingerprint adoption
- **At-Risk Student Flagging** — students with >15% attendance drop over 2 weeks
- **Session Initialization** — start/end live sessions with biometric push to ESP32

### Admin — System Health & Compliance
- **Device Status Monitor** — online/offline/sleep counts per lab
- **Hardware Alerts** — low memory warnings, sensor error rates
- **Bypass Log** — tracking force-initialized sessions outside timetable
- **Enrollment Progress Matrix** — total students vs RFID vs biometric onboarding rates
- **Global Attendance Rate** with most-utilized lab identification

## Hardware Setup (ESP32 Node)

### Pin Configuration

| Component | ESP32 Pin |
|-----------|-----------|
| RFID RST | GPIO 4 |
| RFID MISO | GPIO 19 |
| RFID MOSI | GPIO 23 |
| RFID SCK | GPIO 18 |
| RFID SDA/SS | GPIO 5 |
| Fingerprint RX (ESP TX2) | GPIO 17 |
| Fingerprint TX (ESP RX2) | GPIO 16 |
| Buzzer | GPIO 14 |
| PIR / IR Sensor | GPIO 33 |
| Push Button | GPIO 32 |
| I2C SDA (LCD) | GPIO 21 |
| I2C SCL (LCD) | GPIO 22 |
| RGB Red | GPIO 27 |
| RGB Green | GPIO 26 |
| RGB Blue | GPIO 25 |

### Power Management
- **Light Sleep** after 5 minutes of idle (no active session)
- Wakes on GPIO 33 (IR detection) or GPIO 32 (button press)
- RGB LED forced OFF during sleep via `digitalWrite`
- Fingerprint UART preserved across sleep cycles (no re-init on wake)

## Software Stack

| Layer | Technology |
|-------|-----------|
| **Firmware** | Arduino / C++ (ESP32) |
| **Backend** | Node.js + Express |
| **Database** | Supabase (PostgreSQL) |
| **Frontend** | Vanilla JS + Chart.js |
| **Real-time** | MQTT (Mosquitto) |
| **Communication** | HTTP REST + MQTT Pub/Sub |

## Backend API Overview

6 analytics endpoints added for dashboard data:

| Endpoint | Role | Data |
|----------|------|------|
| `/api/analytics/student/:id` | Student | Attendance %, eligibility, punctuality, mode preference, history |
| `/api/analytics/professor/dashboard` | Professor | Session turnout, 30-day trends, at-risk students, mode split |
| `/api/analytics/professor/heatmap` | Professor | Arrival time distribution |
| `/api/analytics/admin/overview` | Admin | System-wide stats, device status, alerts |
| `/api/analytics/admin/enrollment-progress` | Admin | Biometric onboarding tracking |
| `/api/analytics/admin/bypass-log` | Admin | Force-init session audit |

## Getting Started

### Prerequisites
- Node.js v18+
- Supabase project
- MQTT broker (Mosquitto)
- ESP32 with Arduino IDE

### Backend Setup
```bash
cd backend
npm install
cp .env.example .env   # configure Supabase + MQTT
node server.js
```

### ESP32 Firmware
1. Open `QuadroDeep_Node/QuadroDeep_Node.ino` in Arduino IDE
2. Install dependencies: `MFRC522`, `Adafruit_Fingerprint`, `LiquidCrystal_I2C`, `PubSubClient`, `ArduinoJson`
3. Update `config.h` with your WiFi credentials and backend IP
4. Upload to ESP32

### Frontend
Open `index.html` in a browser (or serve via Live Server on port 5501).

---

## Development Team

- **Nimish Patil**
- **Ashley Dsilva**
- **Sweekar Mandavkar**
- **Dhruv Maurya**
