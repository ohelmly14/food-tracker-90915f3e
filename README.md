# Food Tracker (local-only PWA)

Installable, offline-capable food tracker. No backend, no accounts: all data is stored in IndexedDB on this device (Dexie). Export backups from Settings.

Live: https://ohelmly14.github.io/food-tracker-90915f3e/

- `npm run dev` / `npm run build` / `npm test`
- Pure logic with tests: `src/lib/*` (nutrition, portions, shortcut parsing, import validation/matching, pantry scoring, drift, target suggestions); DB integration tests in `src/actions.test.ts` (fake-indexeddb).
- Recipe import format: [docs/recipe-v1.md](docs/recipe-v1.md)
- Barcode: native BarcodeDetector, fallback @zxing/browser. Product data: Open Food Facts.
- Deploy: `BASE_PATH=/food-tracker-90915f3e/ npm run build` then push `dist` to the `gh-pages` branch (`npm run deploy`).
