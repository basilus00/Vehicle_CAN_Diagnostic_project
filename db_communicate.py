import serial
import time
import sys

# ================== CONFIG ==================
PORT = 'COM3'                     # ← change this (Windows: COMx, Linux/Mac: /dev/ttyUSB0 or /dev/cu.usbserial-xxx)
BAUD = 115200
CSV_PATH = r"C:/Users/hirah/Videos/cann/audi_obd_data.csv"   # full path to your CSV

DELAY_BETWEEN_LINES = 0.1       # 5 ms → adjust if too fast/slow
# ============================================

def main():
    print(f"Tentative de connexion sur {PORT} à {BAUD} bauds...")
    
    try:
        ser = serial.Serial(PORT, BAUD, timeout=1)
        time.sleep(2.5)  # important: give time for reset/bootloader
        print("Port ouvert avec succès\n")
    except Exception as e:
        print(f"Erreur d'ouverture du port : {e}")
        sys.exit(1)

    print("Envoi du fichier CSV...\n")

    sent_lines = 0
    
    with open(CSV_PATH, 'r', encoding='latin1') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith('#'):  # skip empty lines & comments
                continue
                
            # Optional: send a small header on first real line
            if sent_lines == 0:
                ser.write(b"---START---\n")
                time.sleep(0.1)
            
            ser.write((line + '\n').encode('latin1'))
            sent_lines += 1
            
            if sent_lines % 50 == 0:
                print(f"{sent_lines} lignes envoyées...")
            
            time.sleep(DELAY_BETWEEN_LINES)

    # Optional end marker
    ser.write(b"---END---\n")
    time.sleep(0.2)

    print(f"\nTerminé ! {sent_lines} lignes envoyées.")
    ser.close()
    print("Port série fermé.")

if __name__ == "__main__":
    main()