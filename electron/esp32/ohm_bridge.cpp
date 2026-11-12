// Ohm Studio – Brücke zwischen echter ESP32-Firmware (im Espressif-QEMU) und der simulierten Schaltung.
// Wird beim Übersetzen automatisch zum Sketch hinzugefügt. Der Programmcode selbst läuft unverändert als
// echter Maschinencode; nur die Peripherie (Pins, ADC, PWM, Deep-Sleep, BLE-Scan) spricht über UART1
// mit Ohm Studio, weil der Emulator diese Hardware nicht mit der Außenwelt verbindet.
//
// Protokoll (Textzeilen auf UART1):
//   ESP32 → Ohm:  H <wakecause>           Start
//                 M <pin> <mode>           pinMode (0 IN, 1 OUT, 2 PULLUP, 3 PULLDOWN)
//                 O <pin> <0|1>            digitalWrite
//                 P <pin> <duty 0..1> <Hz> PWM (ledc/analogWrite/tone)
//                 S <sekunden>             BLE-Scan anfordern
//                 Z <maske-hex> <pegel> <us>  Deep-Sleep (GPIO-Wecker, Timer)
//                 W <grund> / D <off> <hex> / X   Aufwachen: RTC-Speicher sichern, dann
//                                          startet Ohm Studio den Emulator kalt neu (sein Soft-Reset ist unzuverlässig)
//   Ohm → ESP32:  I <maske-hex>            Pegel aller Eingänge
//                 W <grund> / D <off> <hex> / E   nach dem Kaltstart: Weckgrund und RTC-Speicher zurückspielen
//                 A <pin> <0..4095>        ADC-Wert
//                 R <anzahl>               danach je Gerät: <mac> <rssi> <name>
#include <Arduino.h>
#include "esp_sleep.h"
#include "soc/soc_caps.h"
#include "esp_system.h"
#if CONFIG_IDF_TARGET_ESP32C3
#include "esp_cpu.h"
#include "soc/soc.h"
#endif
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "ohm_bridge.h"


extern "C" {
void __pinMode(uint8_t pin, uint8_t mode);
void __digitalWrite(uint8_t pin, uint8_t val);
int __digitalRead(uint8_t pin);
}

static volatile uint64_t s_in = 0xFFFFFFFFFFFFFFFFull;
static volatile uint16_t s_adc[64];
static uint8_t s_mode[64];
static int8_t s_out[64];
static SemaphoreHandle_t s_lock = nullptr;
static volatile bool s_ready = false;

// BLE-Scan-Ergebnisse
static volatile int s_scanState = 0;  // 0 nichts, 1 wartet, 2 fertig
static OhmBleDevice s_scan[16];
static volatile int s_scanCount = 0;

// Deep-Sleep-Wecker (vom Programm eingerichtet)
static uint64_t s_wakeMask = 0;
static int s_wakeLevel = 1;
static int s_wakeExt = ESP_SLEEP_WAKEUP_GPIO;
static uint64_t s_wakeUs = 0;
// Aufwachen per Kaltstart für alle Chips: Der Soft-Reset (esp_restart) ist im Emulator unzuverlässig – beim klassischen
// ESP32 sofort, beim ESP32-C3 unter Windows („Stack protection fault“ nach RTC_SW_CPU_RST, gemessen in GitHub Actions)
#if 1
#define OHM_COLD_WAKE 1
extern "C" uint8_t _rtc_data_start[], _rtc_bss_end[];
static volatile bool s_restoreDone = false;
#endif
RTC_NOINIT_ATTR static uint32_t s_wakeMagic;
RTC_NOINIT_ATTR static uint32_t s_wakeCause;

static void send(const char *fmt, ...) {
  char buf[96];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  if (!s_ready || n <= 0) return;
  if (s_lock) xSemaphoreTake(s_lock, portMAX_DELAY);
  Serial1.write((const uint8_t *)buf, n);
  if (s_lock) xSemaphoreGive(s_lock);
}

static int hexv(char c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }

static void handleLine(char *l) {
#ifdef OHM_COLD_WAKE
  if (!s_restoreDone) {
    if (l[0] == 'W') {
      int c = atoi(l + 2);
      if (c) {
        s_wakeMagic = 0x0A11CE;
        s_wakeCause = c;
      }
      return;
    } else if (l[0] == 'D') {
      char *e;
      long off = strtol(l + 2, &e, 10);
      uint8_t *p0 = _rtc_data_start + off;
      for (e++; e[0] && e[1] && p0 < _rtc_bss_end; e += 2) *p0++ = (uint8_t)(hexv(e[0]) * 16 + hexv(e[1]));
      return;
    } else if (l[0] == 'E') {
      s_restoreDone = true;
      return;
    }
  }
#endif
  if (l[0] == 'I') {
    s_in = strtoull(l + 2, nullptr, 16);
  } else if (l[0] == 'A') {
    // ohne sscanf: das braucht viel Stack (führte unter Windows zum „Stack protection fault“ in dieser Task)
    char *e = nullptr;
    long pin = strtol(l + 2, &e, 10);
    long v = e ? strtol(e, nullptr, 10) : 0;
    if (pin >= 0 && pin < 64) s_adc[pin] = (uint16_t)v;
  } else if (l[0] == 'R') {
    s_scanCount = 0;
    int n = atoi(l + 2);
    if (n == 0) s_scanState = 2;
    else s_scanState = 10 + (n > 16 ? 16 : n);  // erwartet noch n Zeilen
  } else if (s_scanState >= 10) {
    int i = s_scanCount;
    if (i < 16) {
      // Zeile „<mac> <rssi> <name>“ von Hand zerlegen
      char *sp1 = strchr(l, ' ');
      char *sp2 = sp1 ? strchr(sp1 + 1, ' ') : nullptr;
      memset(s_scan[i].mac, 0, sizeof(s_scan[i].mac));
      memset(s_scan[i].name, 0, sizeof(s_scan[i].name));
      size_t ml = sp1 ? (size_t)(sp1 - l) : strlen(l);
      memcpy(s_scan[i].mac, l, ml < sizeof(s_scan[i].mac) - 1 ? ml : sizeof(s_scan[i].mac) - 1);
      s_scan[i].rssi = sp1 ? (int)strtol(sp1 + 1, nullptr, 10) : -127;
      if (sp2 && strcmp(sp2 + 1, "-") != 0) strncpy(s_scan[i].name, sp2 + 1, sizeof(s_scan[i].name) - 1);
      s_scanCount = i + 1;
    }
    if (s_scanCount >= s_scanState - 10) s_scanState = 2;
  }
}

static void rxTask(void *) {
  char line[96];
  int n = 0;
  for (;;) {
    while (Serial1.available()) {
      int c = Serial1.read();
      if (c == '\n' || n >= (int)sizeof(line) - 1) {
        line[n] = 0;
        if (n) handleLine(line);
        n = 0;
      } else if (c != '\r') line[n++] = (char)c;
    }
    vTaskDelay(1);
  }
}

static void bridgeBegin() {
  if (s_ready) return;
#if CONFIG_IDF_TARGET_ESP32C3
  // Nur im Emulator (die Brücke wird nie für echte Boards gebaut): Espressif-QEMU löst unter Windows falsche
  // Interrupts der Stack-Überwachung (ASSIST_DEBUG, CPU-Interrupt 27) aus, obwohl kein Stapel überläuft.
  // Die Software-Stackprüfung von FreeRTOS bleibt aktiv.
  esp_cpu_intr_disable(1u << ETS_ASSIST_DEBUG_INUM);
#endif
  for (int i = 0; i < 64; i++) {
    s_out[i] = -1;
    s_adc[i] = 0;
  }
  s_lock = xSemaphoreCreateMutex();
  // Standard-Pins von UART1 (im Emulator ohne Bedeutung; nicht die Pins von UART0, sonst trennt Serial.begin() die Brücke)
  Serial1.begin(115200);
  s_ready = true;
  xTaskCreate(rxTask, "ohm", 8192, nullptr, configMAX_PRIORITIES - 2, nullptr);
#ifdef OHM_COLD_WAKE
  // Nach einem Kaltstart nicht dem (zufälligen) Inhalt des RTC-Speichers trauen: Ohm Studio schickt Weckgrund
  // und den gesicherten RTC-Speicher zurück (oder nur „E“ beim ersten Einschalten).
  s_wakeMagic = 0;
  send("H 0\n");
  for (int i = 0; i < 300 && !s_restoreDone; i++) delay(5);
#else
  uint32_t cause = (s_wakeMagic == 0x0A11CE) ? s_wakeCause : 0;
  send("H %u\n", (unsigned)cause);
#endif
  // kurz auf den ersten Eingangsstand warten, damit setup() echte Pegel liest
  delay(30);
}

extern "C" {

// ---------- setup() umschließen: Brücke vor dem Anwenderprogramm starten ----------
void __real__Z5setupv();
void __wrap__Z5setupv() {
  bridgeBegin();
  __real__Z5setupv();
}

// ---------- Digitale Pins ----------
// Die UART1-Pins der Brücke (RX1/TX1) nie umkonfigurieren – sonst trennt der Pin-Manager die Brücke.
// Im Emulator haben diese Pins keine echte Funktion; die Schaltung sieht sie trotzdem über die Brücke.
static inline bool bridgePin(uint8_t pin) { return pin == (uint8_t)RX1 || pin == (uint8_t)TX1; }

void pinMode(uint8_t pin, uint8_t mode) {
  if (!bridgePin(pin)) __pinMode(pin, mode);
  if (pin < 64) {
    uint8_t m = (mode == OUTPUT) ? 1 : (mode == INPUT_PULLUP) ? 2 : (mode == INPUT_PULLDOWN) ? 3 : 0;
    s_mode[pin] = m;
    send("M %d %d\n", pin, m);
  }
}

void digitalWrite(uint8_t pin, uint8_t val) {
  if (!bridgePin(pin)) __digitalWrite(pin, val);
  if (pin < 64 && s_out[pin] != (int8_t)(val ? 1 : 0)) {
    s_out[pin] = val ? 1 : 0;
    send("O %d %d\n", pin, val ? 1 : 0);
  }
}

int digitalRead(uint8_t pin) {
  if (pin >= 64) return 0;
  if (s_mode[pin] == 1) return s_out[pin] > 0 ? 1 : 0;
  return (int)((s_in >> pin) & 1ull);
}

// ---------- ADC ----------
uint16_t analogRead(uint8_t pin) {
  return pin < 64 ? s_adc[pin] : 0;
}
uint32_t __real_analogReadMilliVolts(uint8_t pin);
uint32_t __wrap_analogReadMilliVolts(uint8_t pin) {
  return pin < 64 ? (uint32_t)s_adc[pin] * 3300u / 4095u : 0;
}

// ---------- PWM ----------
static uint32_t s_freq[64];
static uint8_t s_res[64];
bool __real_ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
bool __wrap_ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution) {
  if (pin < 64) {
    s_freq[pin] = freq;
    s_res[pin] = resolution;
  }
  return __real_ledcAttach(pin, freq, resolution);
}
bool __real_ledcWrite(uint8_t pin, uint32_t duty);
bool __wrap_ledcWrite(uint8_t pin, uint32_t duty) {
  if (pin < 64) {
    uint32_t max = (1u << (s_res[pin] ? s_res[pin] : 8)) - 1u;
    send("P %d %.4f %u\n", pin, max ? (double)duty / max : 0.0, (unsigned)(s_freq[pin] ? s_freq[pin] : 5000));
    s_out[pin] = -1;
  }
  return __real_ledcWrite(pin, duty);
}
uint32_t __real_ledcWriteTone(uint8_t pin, uint32_t freq);
uint32_t __wrap_ledcWriteTone(uint8_t pin, uint32_t freq) {
  if (pin < 64) send("P %d %.4f %u\n", pin, freq ? 0.5 : 0.0, (unsigned)freq);
  return __real_ledcWriteTone(pin, freq);
}
void __real_analogWrite(uint8_t pin, int value);
void __wrap_analogWrite(uint8_t pin, int value) {
  if (pin < 64) send("P %d %.4f %u\n", pin, value / 255.0, 1000u);
  __real_analogWrite(pin, value);
}

// ---------- Deep-Sleep mit GPIO-/Timer-Wecker ----------
#if SOC_GPIO_SUPPORT_DEEPSLEEP_WAKEUP
// ESP32-C3 & Co.: Wecken über beliebige GPIOs
esp_err_t __wrap_esp_deep_sleep_enable_gpio_wakeup(uint64_t mask, esp_deepsleep_gpio_wake_up_mode_t mode) {
  s_wakeMask = mask;
  s_wakeLevel = mode == ESP_GPIO_WAKEUP_GPIO_HIGH ? 1 : 0;
  s_wakeExt = ESP_SLEEP_WAKEUP_GPIO;
  return ESP_OK;
}
#endif
#if SOC_PM_SUPPORT_EXT0_WAKEUP
// Klassischer ESP32: EXT0 (ein RTC-Pin)
esp_err_t __wrap_esp_sleep_enable_ext0_wakeup(gpio_num_t gpio, int level) {
  s_wakeMask = 1ull << (int)gpio;
  s_wakeLevel = level ? 1 : 0;
  s_wakeExt = ESP_SLEEP_WAKEUP_EXT0;
  return ESP_OK;
}
#endif
#if SOC_PM_SUPPORT_EXT1_WAKEUP
// EXT1 (mehrere RTC-Pins; „irgendeiner HIGH“ bzw. „alle LOW“ – vereinfacht: irgendeiner hat den Pegel)
esp_err_t __wrap_esp_sleep_enable_ext1_wakeup(uint64_t mask, esp_sleep_ext1_wakeup_mode_t mode) {
  s_wakeMask = mask;
  s_wakeLevel = mode == ESP_EXT1_WAKEUP_ANY_HIGH ? 1 : 0;
  s_wakeExt = ESP_SLEEP_WAKEUP_EXT1;
  return ESP_OK;
}
#endif
esp_err_t __real_esp_sleep_enable_timer_wakeup(uint64_t us);
esp_err_t __wrap_esp_sleep_enable_timer_wakeup(uint64_t us) {
  s_wakeUs = us;
  return ESP_OK;
}
esp_sleep_wakeup_cause_t __real_esp_sleep_get_wakeup_cause(void);
esp_sleep_wakeup_cause_t __wrap_esp_sleep_get_wakeup_cause(void) {
  if (s_wakeMagic == 0x0A11CE) return (esp_sleep_wakeup_cause_t)s_wakeCause;
  return ESP_SLEEP_WAKEUP_UNDEFINED;
}
// Aufwachen: Auf dem C3 per Soft-Reset (RTC-Speicher bleibt wie auf echter Hardware erhalten). Auf dem klassischen
// ESP32 ist der Soft-Reset im Emulator unzuverlässig, deshalb RTC-Speicher an Ohm Studio schicken und kalt neu starten.
static void wakeUp(uint32_t cause) {
#ifdef OHM_COLD_WAKE
  send("W %u\n", (unsigned)cause);
  int len = _rtc_bss_end - _rtc_data_start;
  for (int off = 0; off < len; off += 32) {
    char hex[72];
    int n = len - off < 32 ? len - off : 32;
    for (int i = 0; i < n; i++) sprintf(hex + 2 * i, "%02x", _rtc_data_start[off + i]);
    send("D %d %s\n", off, hex);
  }
  send("X\n");
  for (;;) vTaskDelay(100);  // Ohm Studio beendet den Emulator und startet ihn neu
#else
  s_wakeMagic = 0x0A11CE;
  s_wakeCause = cause;
  esp_restart();
#endif
}

void __real_esp_deep_sleep_start(void);
void __wrap_esp_deep_sleep_start(void) {
  send("Z %llx %d %llu\n", (unsigned long long)s_wakeMask, s_wakeLevel, (unsigned long long)s_wakeUs);
  Serial.flush();
  uint64_t t0 = esp_timer_get_time();
  for (;;) {
    if (s_wakeMask) {
      uint64_t lv = s_in;
      for (int p = 0; p < 64; p++)
        if ((s_wakeMask >> p) & 1ull)
          if ((int)((lv >> p) & 1ull) == s_wakeLevel) wakeUp(s_wakeExt);
    }
    if (s_wakeUs && (uint64_t)(esp_timer_get_time() - t0) >= s_wakeUs) wakeUp(ESP_SLEEP_WAKEUP_TIMER);
    vTaskDelay(2);
  }
}

}  // extern "C"

// ---------- BLE-Scan über die Brücke (vom BLE-Ersatz aufgerufen) ----------
int ohm_ble_scan(uint32_t seconds, OhmBleDevice *out, int max) {
  s_scanState = 1;
  s_scanCount = 0;
  send("S %u\n", (unsigned)seconds);
  uint32_t t0 = millis();
  // echte Scandauer abwarten, Ergebnis kommt in dieser Zeit
  while (millis() - t0 < seconds * 1000u + 2000u) {
    if (s_scanState == 2 && millis() - t0 >= seconds * 1000u) break;
    delay(10);
  }
  int n = s_scanCount < max ? s_scanCount : max;
  for (int i = 0; i < n; i++) out[i] = s_scan[i];
  s_scanState = 0;
  return n;
}
