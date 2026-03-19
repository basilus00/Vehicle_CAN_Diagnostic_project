#include <WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <mcp2515.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

// ================= CONFIG =================
#define SERIAL_BAUD 115200
#define CAN_BITRATE CAN_125KBPS
#define MCP_CS_PIN 5

// GPS Config
static const int RXPin = 16, TXPin = 17;
static const uint32_t GPSBaud = 9600;

// WiFi & MQTT
const char* ssid     = "TOPNET_C228";
const char* password = "MCHLIN9HAL7NKK";
const char* mqtt_server = "192.168.1.13";
const int   mqtt_port   = 1883;
const char* esp_id = "Na7la";

// ================= OBJECTS =================
MCP2515 mcp2515(MCP_CS_PIN);
TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

WiFiClient espClient;
PubSubClient client(espClient);

// OBD-II Values
float rpm = 0;
float speed_kmh = 0;
float coolant_c = 0;
float throttle_pct = 0;
float engine_load_pct = 0;
float intake_temp_c = 0;
float maf_gs = 0;

// GPS Values
float gps_lat = 0;
float gps_lng = 0;
float gps_alt = 0;
float gps_speed = 0;
float gps_course = 0;
int gps_sats = 0;
float gps_hdop = 0;

unsigned long lastPublishTime = 0;
const unsigned long publishInterval = 1000; // Publish OBD every 1s
unsigned long lastGPSPublish = 0;
const unsigned long gpsPublishInterval = 5000; // Publish GPS every 5s
unsigned long lastSummary = 0;

struct can_frame canMsg;

// ================= MQTT CALLBACK ==========
void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("MQTT Topic: ");
  Serial.println(topic);
  Serial.print("Message: ");
  Serial.println(message);
}

// ================= WIFI ===================
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("📡 Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✅ WiFi Connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("❌ WiFi Failed");
  }
}

// ================= MQTT ===================
void reconnect() {
  while (!client.connected()) {
    Serial.print("🔌 Connecting to MQTT...");
    if (client.connect(esp_id)) {
      Serial.println("✅ Connected");
    } else {
      Serial.print("❌ Failed (rc=");
      Serial.print(client.state());
      Serial.println(")");
      delay(3000);
    }
  }
}

// ================= SETUP ==================
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(100);
  
  Serial.println("\n\n╔════════════════════════════════════╗");
  Serial.println("║  OBD-II + GPS Dashboard           ║");
  Serial.println("║  Combined System                  ║");
  Serial.println("╚════════════════════════════════════╝\n");
  
  // Initialize CAN
  Serial.println("🚗 Initializing CAN Module...");
  mcp2515.reset();
  mcp2515.setBitrate(CAN_BITRATE, MCP_8MHZ);
  if (mcp2515.setNormalMode() == MCP2515::ERROR_OK) {
    Serial.println("✅ CAN initialized");
  } else {
    Serial.println("❌ CAN initialization failed!");
  }

  // Initialize GPS
  Serial.println("🛰️ Initializing GPS Module...");
  gpsSerial.begin(GPSBaud, SERIAL_8N1, RXPin, TXPin);
  Serial.println("✅ GPS initialized on UART2");
  Serial.print("TinyGPSPlus Library v. "); 
  Serial.println(TinyGPSPlus::libraryVersion());

  // WiFi Setup
  setup_wifi();
  
  // MQTT Setup
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  reconnect();
  
  Serial.println("════════════════════════════════════");
  Serial.println("System ready - Waiting for data\n");
}

// ================= LOOP ===================
void loop() {
  // Maintain MQTT connection
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Feed GPS parser continuously
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  // Read CAN messages
  if (mcp2515.readMessage(&canMsg) == MCP2515::ERROR_OK) {
    if (canMsg.can_id == 0x7E8 && canMsg.can_dlc >= 3 && canMsg.data[0] == 0x41) {
      uint8_t pid = canMsg.data[1];

      switch (pid) {
        case 0x04: { // Engine Load (%)
          int load = canMsg.data[2];
          engine_load_pct = load * 100.0 / 255.0;
          break;
        }

        case 0x05: { // Coolant Temp (°C)
          coolant_c = (int)canMsg.data[2] - 40;
          break;
        }

        case 0x0C: { // Engine RPM
          uint16_t raw = (canMsg.data[2] << 8) | canMsg.data[3];
          rpm = raw / 4.0;
          break;
        }

        case 0x0D: { // Vehicle Speed (km/h)
          speed_kmh = canMsg.data[2];
          break;
        }

        case 0x0F: { // Intake Air Temp (°C)
          intake_temp_c = (int)canMsg.data[2] - 40;
          break;
        }

        case 0x10: { // MAF Air Flow (g/s)
          uint16_t raw = (canMsg.data[2] << 8) | canMsg.data[3];
          maf_gs = raw / 100.0;
          break;
        }

        case 0x11: { // Throttle Position (%)
          int pos = canMsg.data[2];
          throttle_pct = pos * 100.0 / 255.0;
          break;
        }
      }
    }
  }

  // Publish OBD-II data every 1 second
  unsigned long now = millis();
  if (now - lastPublishTime >= publishInterval) {
    lastPublishTime = now;

    client.publish((String(esp_id) + "/obd2/rpm").c_str(), String(rpm, 0).c_str());
    client.publish((String(esp_id) + "/obd2/speed").c_str(), String(speed_kmh, 0).c_str());
    client.publish((String(esp_id) + "/obd2/coolant").c_str(), String(coolant_c, 1).c_str());
    client.publish((String(esp_id) + "/obd2/throttle").c_str(), String(throttle_pct, 1).c_str());
    client.publish((String(esp_id) + "/obd2/load").c_str(), String(engine_load_pct, 1).c_str());
    client.publish((String(esp_id) + "/obd2/intake").c_str(), String(intake_temp_c, 1).c_str());
    client.publish((String(esp_id) + "/obd2/maf").c_str(), String(maf_gs, 1).c_str());
  }

  // Publish GPS data every 5 seconds
  if (now - lastGPSPublish >= gpsPublishInterval) {
    lastGPSPublish = now;

    if (gps.location.isValid()) {
      gps_lat = gps.location.lat();
      gps_lng = gps.location.lng();
      gps_alt = gps.altitude.meters();
      gps_sats = gps.satellites.value();
      gps_hdop = gps.hdop.hdop();
      gps_speed = gps.speed.kmph();
      gps_course = gps.course.deg();

      client.publish((String(esp_id) + "/gps/latitude").c_str(), String(gps_lat, 6).c_str());
      client.publish((String(esp_id) + "/gps/longitude").c_str(), String(gps_lng, 6).c_str());
      client.publish((String(esp_id) + "/gps/altitude").c_str(), String(gps_alt, 2).c_str());
      client.publish((String(esp_id) + "/gps/satellites").c_str(), String(gps_sats).c_str());
      client.publish((String(esp_id) + "/gps/hdop").c_str(), String(gps_hdop, 1).c_str());
      client.publish((String(esp_id) + "/gps/speed").c_str(), String(gps_speed, 2).c_str());
      client.publish((String(esp_id) + "/gps/course").c_str(), String(gps_course, 2).c_str());
    }
  }

  // Print summary every 10 seconds
  if (now - lastSummary > 10000) {
    lastSummary = now;
    Serial.println("\n═══════ OBD-II + GPS Summary ═══════");
    Serial.println("--- OBD-II Data ---");
    Serial.print("RPM: "); Serial.print(rpm, 0); Serial.println(" rpm");
    Serial.print("Speed: "); Serial.print(speed_kmh, 0); Serial.println(" km/h");
    Serial.print("Coolant: "); Serial.print(coolant_c, 1); Serial.println(" °C");
    Serial.print("Throttle: "); Serial.print(throttle_pct, 1); Serial.println(" %");
    Serial.print("Load: "); Serial.print(engine_load_pct, 1); Serial.println(" %");
    Serial.print("Intake: "); Serial.print(intake_temp_c, 1); Serial.println(" °C");
    Serial.print("MAF: "); Serial.print(maf_gs, 1); Serial.println(" g/s");
    
    Serial.println("--- GPS Data ---");
    if (gps.location.isValid()) {
      Serial.print("Latitude: "); Serial.println(gps_lat, 6);
      Serial.print("Longitude: "); Serial.println(gps_lng, 6);
      Serial.print("Altitude: "); Serial.print(gps_alt, 2); Serial.println(" m");
      Serial.print("Satellites: "); Serial.println(gps_sats);
      Serial.print("HDOP: "); Serial.println(gps_hdop, 1);
      Serial.print("Speed: "); Serial.print(gps_speed, 2); Serial.println(" km/h");
      Serial.print("Course: "); Serial.print(gps_course, 2); Serial.println(" °");
    } else {
      Serial.print("⏳ Waiting for GPS fix... Sats: ");
      Serial.println(gps.satellites.value());
    }
    Serial.println("══════════════════════════════════\n");
  }
}