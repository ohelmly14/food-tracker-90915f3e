# Food Tracker (local-only PWA)

Installable, offline-capable food tracker. No backend, no accounts: all data is stored in IndexedDB on this device (Dexie). Export backups from Settings.

Live: https://ohelmly14.github.io/food-tracker-90915f3e/

- `npm run dev` / `npm run build` / `npm test`
- Pure logic with tests: `src/lib/*` (nutrition, portions, shortcut parsing, import validation/matching, pantry scoring, drift, target suggestions); DB integration tests in `src/actions.test.ts` (fake-indexeddb).
- Recipe import format: [docs/recipe-v1.md](docs/recipe-v1.md)
- Barcode: rear camera with an aiming frame. BarcodeDetector is used only when the browser reports real UPC/EAN support. iPhone Safari does not (the API is off, and broken even if the Shape Detection flag is on), so iPhone — in Safari and as a Home Screen app — decodes with ZXing. A denied camera, a missing camera, or a product Open Food Facts doesn't have is explained on screen; the barcode can be typed, and an unknown product can be saved on the device. Product data: Open Food Facts.
- Deploy: `BASE_PATH=/food-tracker-90915f3e/ npm run build` then push `dist` to the `gh-pages` branch (`npm run deploy`).
