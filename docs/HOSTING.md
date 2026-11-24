# Hosting, Sandboxing & Release Guide

Purple Van Road Trip is designed for **two clean deployment modes**:
1. **Home Wi-Fi Only on your MacBook** (sandboxed inside an **Apple Container** micro-VM with zero host file access).
2. **Cloud Hosting for Remote Family Play** (**Fly.io** or **Railway**) — so remote traffic never touches your MacBook or home IP.

> **Security Rule**: Never configure router port-forwarding to your MacBook. Use Apple Container for home Wi-Fi play, and deploy to Fly.io or Railway whenever you want to play across different locations.

---

## Option A: Local Home Wi-Fi Play on MacBook (Apple Container Sandbox)

Running inside Apple's open-source **`container`** CLI (`apple/container` on Apple Silicon macOS) isolates the server inside a dedicated lightweight Linux VM (`Virtualization.framework`). **Zero folders from your MacBook are mounted into the container**—SQLite saves live exclusively inside an isolated managed volume (`cooking-game-saves`).

### Prerequisites
- Apple Silicon Mac (M1/M2/M3/M4) with [Apple `container` CLI](https://github.com/apple/container/releases) installed.

### Start the Sandboxed Game Server
```bash
chmod +x scripts/run-apple-container.sh
./scripts/run-apple-container.sh
```

What this does automatically:
1. Starts the Apple Container runtime (`container system start`).
2. Creates a dedicated `cooking-game-saves` volume mounted **only** at `/data`.
3. Builds the hardened non-root OCI image (`Dockerfile`) with `/app` set read-only.
4. Starts the micro-VM capped at `2 CPUs` / `512 MB RAM` and prints both your `localhost` URL and your home Wi-Fi IP (`http://192.168.x.x:3000`).
5. On the opening **Sharon Seaweed Stand** screen, tap **Show QR Code** and point your iPad's camera at it to join immediately!

### Stop When Done Playing
```bash
container stop purple-van-cooking
```
*(Your SQLite saves stay safely preserved in the `cooking-game-saves` volume until you start it again!)*

### Tip for iPad Fullscreen PWA
On the iPad in Safari, open your trip invite link, tap the **Share** button, and select **Add to Home Screen**. This creates a full-screen Purple Van app icon right on the iPad!

---

## Option B: Releasing to the Cloud on Fly.io (Recommended for Remote Play)

Fly.io runs the exact same hardened `Dockerfile`, provides **automatic HTTPS (`wss://`)**, unlocks full PWA Service Worker caching on iPads, costs **~$0–$2/mo** (auto-stops when idle, wakes in ~1s when your family opens the invite link), and persists SQLite saves on a dedicated 1 GB volume.

### First-Time Release Setup
1. Install the Fly CLI and sign in:
   ```bash
   brew install flyctl
   fly auth login
   ```
2. Edit `app = "purple-van-cooking"` in `fly.toml` to a unique name (e.g., `app = "my-family-purple-van"`).
3. Create the Fly app and persistent SQLite volume (pick a region near you, e.g. `bos` or `sjc`):
   ```bash
   fly apps create my-family-purple-van
   fly volumes create cooking_game_saves --region bos --size 1
   ```
4. **(Recommended Security Step)** Set a `HOST_SECRET` passphrase so only you can create brand-new road trips on the public URL (family members joining via your invite link never need it!):
   ```bash
   fly secrets set HOST_SECRET="choose-a-family-passphrase"
   ```
5. Deploy the release:
   ```bash
   fly deploy
   ```
6. Open `https://my-family-purple-van.fly.dev`, enter your `HOST_SECRET` once to create your family trip, and share the generated invite link!

### How to Ship Future Releases Without Losing Saves
SQLite saves live on the persistent `/data` volume, separate from the container image. To ship an update:
```bash
git pull origin main
fly deploy
```
Fly.io builds the new image, swaps the machine cleanly, and re-attaches `/data`—your family's stars and purple van location stay 100% intact!

*(Optional pre-release backup: before major upgrades, use the in-lobby **Export Save Backup** button or run `fly ssh sftp get /data/trips.sqlite ./backup-trips.sqlite`.)*

---

## Option C: Releasing to the Cloud on Railway (1-Click GitHub Deploys)

1. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → select `craiz99/cooking-game`.
2. Railway automatically detects the `Dockerfile`.
3. Add a **Persistent Volume** mounted at `/data`.
4. Under **Variables**, set:
   - `DATA_DIR=/data`
   - `ENABLE_HSTS=true`
   - `HOST_SECRET=<your-family-passphrase>`
5. Under **Settings → Networking**, click **Generate Domain** to get an automatic HTTPS URL.
6. Every future push to `main` automatically releases a fresh build while keeping `/data/trips.sqlite` intact!
