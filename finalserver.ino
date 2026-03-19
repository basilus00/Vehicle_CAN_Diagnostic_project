#include <SPI.h>
#include <mcp2515.h>

//#include <LiquidCrystal.h>

// LCD pins: RS, E, D4, D5, D6, D7
//LiquidCrystal lcd(12, 11, 5, 4, 3, 2);


MCP2515 mcp2515(10);           // ← ton pin CS (change si différent)

#define SERIAL_BAUD 115200
#define CAN_BITRATE CAN_125KBPS  // ← try this if 125 doesn't work   // change à CAN_500KBPS si ton réseau OBD est en 500 kbps

struct can_frame canMsg;
bool receivingData = false;

void setup() {
  Serial.begin(SERIAL_BAUD);
  while (!Serial);
  mcp2515.reset();
  mcp2515.setBitrate(CAN_BITRATE, MCP_8MHZ);           // ajoute MCP_8MHZ si cristal 8 MHz
  mcp2515.setNormalMode();
  delay(500);
 // lcd.begin(16, 2);
  //lcd.clear();
  //lcd.setCursor(0, 0);
  //lcd.print("CAN prêt");
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    // Début / fin du flux
    if (line == "---START---") {
      receivingData = true;
  //    lcd.setCursor(0, 0);
    //  lcd.print("Début réception CSV !");
      return;
    }
    if (line == "---END---") {
      receivingData = false;
      return;
    }

    if (!receivingData) return;

    // Ignorer la ligne d'en-tête ou lignes vides
    if (line.startsWith("Timestamp") || line.length() < 10) {
      return;
    }

    // Découpage des colonnes (8 colonnes après Timestamp)
    int commas[7];
    int pos = 0;
    int count = 0;

    for (int i = 0; i < line.length() && count < 7; i++) {
      if (line[i] == ',') {
        commas[count++] = i;
      }
    }

    if (count < 7) {
      return;
    }

    // Extraction des valeurs
    String rpmStr       = line.substring(commas[0] + 1, commas[1]);
    String speedStr     = line.substring(commas[1] + 1, commas[2]);
    String coolantStr   = line.substring(commas[2] + 1, commas[3]);
    String throttleStr  = line.substring(commas[3] + 1, commas[4]);
    String loadStr      = line.substring(commas[4] + 1, commas[5]);
    String intakeStr    = line.substring(commas[5] + 1, commas[6]);
    String mafStr       = line.substring(commas[6] + 1);

    int rpm      = rpmStr.toInt();
    int speed    = speedStr.toInt();
    int coolant  = coolantStr.toInt();
    int throttle = throttleStr.toInt();
    int load     = loadStr.toInt();
    int intake   = intakeStr.toInt();
    float maf    = mafStr.toFloat();

    // Envoi séquentiel des messages OBD-II (avec petit délai pour éviter surcharge)
    sendObdRpm(rpm);
    delay(80);

    sendObdSpeed(speed);
    delay(80);

    sendObdCoolant(coolant);
    delay(80);

    sendObdThrottle(throttle);
    delay(80);

    sendObdEngineLoad(load);
    delay(80);

    sendObdIntakeTemp(intake);
    delay(80);

    sendObdMAF(maf);
    delay(80);

  }
}

// ───────────────────────────────────────────────
// Fonctions d'envoi OBD-II (Mode 01)
// ───────────────────────────────────────────────

void sendObdRpm(int rpm) {
  uint16_t scaled = rpm * 4;
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x0C;           // PID Engine RPM
  canMsg.data[2] = highByte(scaled);
  canMsg.data[3] = lowByte(scaled);
  memset(&canMsg.data[4], 0, 4);
  mcp2515.sendMessage(&canMsg);
}

void sendObdSpeed(int kmh) {
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x0D;           // PID Vehicle Speed
  canMsg.data[2] = constrain(kmh, 0, 255);
  memset(&canMsg.data[3], 0, 5);
  mcp2515.sendMessage(&canMsg);
}

void sendObdCoolant(int tempC) {
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x05;           // PID Engine Coolant Temp
  canMsg.data[2] = constrain(tempC + 40, 0, 255);
  memset(&canMsg.data[3], 0, 5);
  mcp2515.sendMessage(&canMsg);
}

void sendObdThrottle(int percent) {
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x11;           // PID Throttle Position
  canMsg.data[2] = map(percent, 0, 100, 0, 255);
  memset(&canMsg.data[3], 0, 5);
  mcp2515.sendMessage(&canMsg);
}

void sendObdEngineLoad(int percent) {
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x04;           // PID Calculated Engine Load
  canMsg.data[2] = map(percent, 0, 100, 0, 255);
  memset(&canMsg.data[3], 0, 5);
  mcp2515.sendMessage(&canMsg);
}

void sendObdIntakeTemp(int tempC) {
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x0F;           // PID Intake Air Temp
  canMsg.data[2] = constrain(tempC + 40, 0, 255);
  memset(&canMsg.data[3], 0, 5);
  mcp2515.sendMessage(&canMsg);
}

void sendObdMAF(float g_s) {
  uint16_t scaled = (uint16_t)(g_s * 100.0);   // g/s × 100
  canMsg.can_id = 0x7E8;
  canMsg.can_dlc = 8;
  canMsg.data[0] = 0x41;
  canMsg.data[1] = 0x10;           // PID MAF Air Flow Rate
  canMsg.data[2] = highByte(scaled);
  canMsg.data[3] = lowByte(scaled);
  memset(&canMsg.data[4], 0, 4);
  mcp2515.sendMessage(&canMsg);
}