# Purple Van Road Trip — Sharon Seaweed Stand

A cozy 1–3 player cooperative browser PWA cooking game built for **iPads and laptops** (with **Kid Helper Mode** designed for a 5-year-old!). Drive your purple food-truck van from **Sharon, MA** to **San Jose, CA** across 8 real US destinations cooking **zero-spice** regional specialties featuring **seaweed, pasta, mild cheesy Cheetos, rainbow gummy bears, crispy french fries, and silly fish eyes**.

---

## Highlights

- **6 Unique Animal Chefs (No Duplicates Allowed)**:
  - **Purple Cat** (with glowing golden crescent moon necklace) — *Moonbeam Bat*
  - **Orange Dog** — *Happy Treat Spin*
  - **Panda** — *Bamboo Munch*
  - **Fox** — *Autumn Tail Twirl*
  - **Skunk** — *Silly Giggle-Fart*
  - **Small Cute Purple Bat** — *Loop-de-Loop Squeak*
- **8-Stop Cross-Country Road Trip (Earn ≥1 Star to Unlock the Next Stop!)**:
  1. **Sharon, MA** — Memorial Park Beach Seaweed Stand (Lake Massapoag)
  2. **New York City, NY** — Big Apple Park Cart & Coney Island Stand
  3. **Chicago, IL** — Windy City Lakefront Diner
  4. **Austin / Lake Travis, TX** — The Oasis Cliffside Sunset Terrace
  5. **Denver / Rocky Mountains, CO** — Mile High Pine Lodge
  6. **Yosemite National Park, CA** — Half Dome & Giant Sequoia Meadow
  7. **Lake Tahoe, CA** — Turquoise Alpine Lakeside Pier
  8. **San Jose, CA** — Silicon Valley Golden Night Market Finale
- **Built for a 5-Year-Old on an iPad**:
  - **Tap-to-Walk + Auto-Interact** (plus chunky **DO IT!** and **EMOTE** buttons, and WASD + Space + `E` on laptops).
  - **Kid Helper Mode**: Glowing golden dotted breadcrumb trail, bouncing star above the next station, picture-only recipe cards, optional gentle spoken hints, and **Cozy Cruise** no-burn safety.
  - **Adult Star Ping**: Tap **Ping Station** → tap any station to light up a purple star beacon on the child's iPad.
  - **Single-Player Mode**: 1-click **Play Solo** with scaled customer targets & an optional friendly AI Sous-Chef for testing or solo practice.
- **Zero Accounts, Private Invite Links & Automatic Saving**:
  - Players just enter a name (remembered on their device).
  - Each trip gets a 192-bit unguessable invite link + scannable iPad QR code, optional **Crew Lock**, and automatic SQLite saving—reopening the same invite link resumes right where the purple van parked.

---

## Quick Start: Local Play on Your MacBook (Sandboxed Apple Container)

For maximum security on your MacBook, run the server inside an isolated **Apple Container** micro-VM (`apple/container` on Apple Silicon). **Zero host folders on your MacBook are mounted**—saves live strictly in a managed container volume (`cooking-game-saves`).

```bash
chmod +x scripts/run-apple-container.sh
./scripts/run-apple-container.sh
```

Then:
1. Open `http://localhost:3000` on your MacBook and click **Start Family Road Trip** (or **Play Solo**).
2. Click **iPad QR Code** and point your iPad's camera at the screen to join immediately on home Wi-Fi!
3. On the iPad in Safari, tap **Share → Add to Home Screen** for fullscreen PWA mode.
4. When finished playing, stop the container:
   ```bash
   container stop purple-van-cooking
   ```

*(Alternatively, for local Node.js development without a container: `npm install && npm run dev`.)*

---

## Releasing & Serving in the Cloud (For Remote Family Play)

> **Never expose your MacBook via router port-forwarding.** When playing across different homes, deploy the same hardened `Dockerfile` to **Fly.io** or **Railway** with automatic HTTPS (`wss://`), persistent SQLite saves, and `HOST_SECRET` enabled so only your family can create new trips.

### Release on Fly.io (Recommended)
```bash
# 1. One-time setup (choose a unique app name in fly.toml)
fly auth login
fly apps create <your-unique-app-name>
fly volumes create cooking_game_saves --region bos --size 1
fly secrets set HOST_SECRET="your-family-passphrase"

# 2. Deploy (and re-run anytime to ship new releases without losing saves!)
fly deploy
```

### Release on Railway
1. Connect `craiz99/cooking-game` in Railway (auto-detects `Dockerfile`).
2. Attach a **Persistent Volume** at `/data`.
3. Set environment variables: `DATA_DIR=/data`, `ENABLE_HSTS=true`, and `HOST_SECRET=<your-family-passphrase>`.
4. Click **Generate Domain** for automatic HTTPS.

See **[docs/HOSTING.md](./docs/HOSTING.md)** for full security details, release checklists, and SQLite backup commands.

---

## Development & Verification

```bash
npm run typecheck   # Strict TypeScript check across shared, server & client
npm run build       # Builds Vite PWA bundle + compiled Node server
npm test            # Runs Vitest suite (security, data, SQLite, rooms, kitchen sim, assets)
```
