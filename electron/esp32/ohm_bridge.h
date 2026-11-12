// Ohm Studio – Schnittstelle der Brücke für den BLE-Ersatz
#pragma once
#include <stdint.h>

#ifndef OHM_BLE_DEVICE_STRUCT
#define OHM_BLE_DEVICE_STRUCT
struct OhmBleDevice {
  char mac[24];
  char name[32];
  int rssi;
};
#endif

int ohm_ble_scan(uint32_t seconds, OhmBleDevice *out, int max);
