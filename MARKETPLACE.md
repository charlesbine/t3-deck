# Publishing T3 Deck to the Elgato Marketplace

This checklist covers everything required to submit **T3 Deck** via the [Elgato Maker Console](https://maker.elgato.com/).

---

## 1. Maker Account & Organization Setup

1. Sign in to the **[Elgato Maker Console](https://maker.elgato.com/)** (uses your Corsair / Elgato account).
2. Create a **Maker Organization** (your creator / developer brand name, e.g., `Charles Bine`).
3. Review and sign the **Maker Agreement** in the portal.
4. *(Optional)* Connect payout info only if publishing paid products — T3 Deck is free/open-source.

---

## 2. Pre-Submission Technical Checklist

Elgato's Marketplace review verifies every item below:

- [x] **Official SDK v2:** Built on `@elgato/streamdeck` `^2.1.0` with `SDKVersion: 2` and `Nodejs.Version: "24"`.
- [x] **Packaged via official Stream Deck CLI (`>= 1.6`):** `npm run pack` runs `streamdeck validate` (0 warnings) and `streamdeck pack` (produces `com.charlesbine.t3-deck.streamDeckPlugin` with Elgato DRM packaging support).
- [x] **Immutable plugin bundle:** T3 Deck never writes inside `com.charlesbine.t3-deck.sdPlugin/` at runtime — its scoped session token lives in `~/.config/t3-deck/session.json` (`0600`) and logs go through `@elgato/streamdeck`'s logger.
- [x] **No runtime `manifest.json` reads:** Plugin code never reads `manifest.json` from disk.
- [x] **All bundled profiles validated:** 6 device profiles (`Stream Deck+`, `+ XL`, `MK.2`, `XL`, `Neo`, `Mini`) validated cleanly by `streamdeck validate`.
- [ ] **Public Support / Repository URL:** Once `https://github.com/charlesbine/t3-deck` is made **public**, add `"URL": "https://github.com/charlesbine/t3-deck"` back to `com.charlesbine.t3-deck.sdPlugin/manifest.json` (private repos return HTTP 404 during `streamdeck validate`).
- [ ] **OS Declaration:** Currently `manifest.json` declares macOS (`MinimumVersion: "13"`). That's completely fine for Marketplace — Elgato tags the listing as **macOS** automatically. *(If you later add Windows support, replace `/usr/bin/open` in `src/plugin.ts` with `cmd /c start` / `shell` fallback and add `"Platform": "windows"` to `manifest.json`.)*
- [ ] **Verify on fresh install:** Double-click the built `com.charlesbine.t3-deck.streamDeckPlugin` after running `streamdeck unlink com.charlesbine.t3-deck` to confirm clean install + profile import before uploading.

---

## 3. Ready-to-Upload Marketplace Metadata

Elgato's naming rules require **≤ 30 characters**, English title case, **must include the product category (`Plugin`)**, and no promotional buzzwords ("Pro", "Best", emojis).

- **Product Name:** `T3 Deck Plugin` *(14 chars — compliant)*
- **Category:** Plugins → Developer Tools / Productivity
- **Tagline (Short Description):**
  > Real-time T3 Code mission control for Elgato Stream Deck — inspect & approve agent commands, answer questions, switch models, and monitor quotas.
- **Full Description:** Copy the highlights, Visual Tour overview, and Requirements from [README.md](README.md).
- **Support / Documentation URL:** `https://github.com/charlesbine/t3-deck`
- **Plugin Archive:** Build fresh with:
  ```sh
  npm run typecheck && npm test && npm run pack
  ```
  Upload `com.charlesbine.t3-deck.streamDeckPlugin`.

---

## 4. Pre-Generated Visual Assets

All required Elgato Marketplace dimensions are already generated in `marketing/marketplace/`:

| Asset Slot | Elgato Spec | File in Repo |
|---|---|---|
| **App Icon** | `288 × 288 px` PNG | [app-icon-288x288.png](marketing/marketplace/app-icon-288x288.png) |
| **Product Thumbnail** | `1920 × 960 px` PNG | [thumbnail-1920x960.png](marketing/marketplace/thumbnail-1920x960.png) |
| **Gallery Image 1** | `1920 × 960 px` PNG | [gallery-1-storyboard-1920x960.png](marketing/marketplace/gallery-1-storyboard-1920x960.png) |
| **Gallery Image 2** | `1920 × 960 px` PNG | [gallery-2-multidevice-1920x960.png](marketing/marketplace/gallery-2-multidevice-1920x960.png) |
| **Optional Demo Video** | `1920 × 1080 px` MP4 (< 250 MB) | *(Optional — short 30s phone clip of approving a subagent command & turning dials converts super well!)* |

---

## 5. Submission & Review Flow

1. In Maker Console, click **Products → Create Product → Stream Deck Plugin**.
2. Upload the `.streamDeckPlugin` archive, `288×288` App Icon, `1920×960` Thumbnail, and Gallery images.
3. Add **Reviewer Testing Notes** explaining that T3 Deck connects to a local [T3 Code](https://github.com/pingdotgg/t3code) instance (link to T3 Code download/repo so Elgato QA can test live connection + offline reconnect state).
4. Submit for review (Elgato allows up to 3 concurrent pending submissions; typical review feedback arrives in Maker Console and by email).
5. For future releases, bump `package.json` (`1.2.0` → `1.3.0`) and `manifest.json` (`1.2.0.0` → `1.3.0.0`), run `npm run pack`, and upload the new build as a new version in Maker Console.
