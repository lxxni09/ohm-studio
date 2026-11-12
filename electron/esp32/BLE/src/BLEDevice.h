// Ohm Studio – BLE-Ersatz für den ESP32-Emulator.
// Der Emulator hat keine Funk-Hardware. Diese Bibliothek bietet dieselbe Schnittstelle wie arduino-esp32 3.x
// (Scannen) und holt die Ergebnisse über die Ohm-Studio-Brücke aus der simulierten Umgebung.
#pragma once
#include <Arduino.h>
#include <vector>

#ifndef OHM_BLE_DEVICE_STRUCT
#define OHM_BLE_DEVICE_STRUCT
struct OhmBleDevice {
  char mac[24];
  char name[32];
  int rssi;
};
#endif
int ohm_ble_scan(uint32_t seconds, OhmBleDevice *out, int max);

class BLEAddress {
 public:
  BLEAddress() {}
  explicit BLEAddress(const String &s) : m_s(s) { m_s.toLowerCase(); }
  String toString() const { return m_s; }
  bool equals(const BLEAddress &o) const { return m_s.equalsIgnoreCase(o.m_s); }
  bool operator==(const BLEAddress &o) const { return equals(o); }
  bool operator!=(const BLEAddress &o) const { return !equals(o); }
 private:
  String m_s;
};

class BLEAdvertisedDevice {
 public:
  BLEAdvertisedDevice() {}
  BLEAdvertisedDevice(const OhmBleDevice &d) : m_addr(String(d.mac)), m_name(d.name), m_rssi(d.rssi) {}
  BLEAddress getAddress() { return m_addr; }
  int getRSSI() { return m_rssi; }
  String getName() { return m_name; }
  bool haveName() { return m_name.length() > 0; }
  bool haveRSSI() { return true; }
  String toString() { return "Name: " + m_name + ", Address: " + m_addr.toString() + ", rssi: " + String(m_rssi); }
 private:
  BLEAddress m_addr;
  String m_name;
  int m_rssi = -127;
};

class BLEScanResults {
 public:
  int getCount() { return (int)m_list.size(); }
  BLEAdvertisedDevice getDevice(uint32_t i) { return i < m_list.size() ? m_list[i] : BLEAdvertisedDevice(); }
  void dump() {
    for (auto &d : m_list) Serial.println(d.toString());
  }
  std::vector<BLEAdvertisedDevice> m_list;
};

class BLEAdvertisedDeviceCallbacks {
 public:
  virtual ~BLEAdvertisedDeviceCallbacks() {}
  virtual void onResult(BLEAdvertisedDevice advertisedDevice) = 0;
};

class BLEScan {
 public:
  void setActiveScan(bool) {}
  void setInterval(uint16_t) {}
  void setWindow(uint16_t) {}
  void setAdvertisedDeviceCallbacks(BLEAdvertisedDeviceCallbacks *cb, bool = false, bool = true) { m_cb = cb; }
  BLEScanResults *start(uint32_t duration, bool is_continue = false) {
    if (!is_continue) m_results.m_list.clear();
    OhmBleDevice buf[16];
    int n = ohm_ble_scan(duration, buf, 16);
    for (int i = 0; i < n; i++) {
      BLEAdvertisedDevice d(buf[i]);
      m_results.m_list.push_back(d);
      if (m_cb) m_cb->onResult(d);
    }
    return &m_results;
  }
  bool start(uint32_t duration, void (*done)(BLEScanResults), bool is_continue = false) {
    start(duration, is_continue);
    if (done) done(m_results);
    return true;
  }
  void stop() {}
  void clearResults() { m_results.m_list.clear(); }
  BLEScanResults *getResults() { return &m_results; }
 private:
  BLEScanResults m_results;
  BLEAdvertisedDeviceCallbacks *m_cb = nullptr;
};

class BLEDevice {
 public:
  static void init(String name) {
    s_name = name;
    s_init = true;
  }
  static BLEScan *getScan() {
    static BLEScan scan;
    return &scan;
  }
  static void deinit(bool = false) { s_init = false; }
  static bool getInitialized() { return s_init; }
  static BLEAddress getAddress() { return BLEAddress(String("24:0a:c4:00:00:01")); }
  static inline String s_name = "";
  static inline bool s_init = false;
};
