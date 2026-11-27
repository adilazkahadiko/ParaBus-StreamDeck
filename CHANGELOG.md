# Changelog

## 0.2.0

- Add `parabus1:` LAN connection codes and an IPv4 override. Verify the pinned SHA-256 certificate, validity, self-signature and TLS 1.3 before sending credentials over HTTPS or WSS.
- Add Output Selector and Selector OFF buttons, short/long release behavior, additive toggles, selected/overlay indicators and permission/error feedback.
- Preserve existing loopback and action settings. Accept the host's restricted LAN state without participant data.
- Encrypt saved tokens with Windows CurrentUser DPAPI; migrate legacy global settings. Never store the complete code or a plaintext token in new settings writes.
- Include corresponding-source version URLs in the package's `SOURCE.txt` (v0.2.0; tag creation/publication is separate).

## 0.1.3

- Preserve numeric title suffixes and add optional button labels.

## 0.1.2

- Display permitted participant/Bus names in button titles with width limits.

## 0.1.1

- Add participant/name choices and permission-change reconnection handling.

## 0.1.0

- Local mute, relative fader and emergency mute buttons with API v1 authentication.
