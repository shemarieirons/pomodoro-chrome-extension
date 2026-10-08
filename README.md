# Pomodoro Timer

A Chrome extension for the Pomodoro Technique: focus sessions, short breaks, and long breaks, with background alarms and system notifications.

## Load unpacked (local)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open the extension from the Chrome toolbar

## Publish / upload to Chrome Web Store

Zip this folder so `manifest.json` is at the root of the ZIP, then upload it in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension config (MV3) |
| `background.js` | Timer state, alarms, session cycle |
| `popup.js` / `hello.html` | Popup UI |
| `offscreen.html` / `offscreen.js` | Completion chime |
| `hello_extensions.png` | Icon / notification image |
