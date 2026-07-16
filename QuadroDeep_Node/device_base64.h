#pragma once
#include <Arduino.h>

namespace DeviceBase64 { // <-- Renamed to avoid system clashes
    const char b64_alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    String encode(const uint8_t* data, size_t length) {
        String out = "";
        out.reserve(((length + 2) / 3) * 4);
        
        for (size_t i = 0; i < length; i += 3) {
            uint32_t val = (data[i] << 16);
            if (i + 1 < length) val |= (data[i + 1] << 8);
            if (i + 2 < length) val |= data[i + 2];

            out += b64_alphabet[(val >> 18) & 0x3F];
            out += b64_alphabet[(val >> 12) & 0x3F];
            out += (i + 1 < length) ? b64_alphabet[(val >> 6) & 0x3F] : '=';
            out += (i + 2 < length) ? b64_alphabet[val & 0x3F] : '=';
        }
        return out;
    }
}