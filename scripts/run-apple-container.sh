#!/usr/bin/env bash
# Launches Purple Van Road Trip inside an isolated Apple Container micro-VM on macOS.
# Security: mounts ZERO host directories — saves live exclusively in a managed
# container volume ("cooking-game-saves") mounted at /data inside the VM.

set -euo pipefail

IMAGE_NAME="purple-van-cooking:latest"
CONTAINER_NAME="purple-van-cooking"
VOLUME_NAME="cooking-game-saves"
PORT="${PORT:-3000}"

if ! command -v container >/dev/null 2>&1; then
  echo "❌ Apple 'container' CLI not found."
  echo "Install it from: https://github.com/apple/container/releases"
  exit 1
fi

echo "1/4 Ensuring Apple Container system service is running..."
container system start >/dev/null 2>&1 || true

echo "2/4 Ensuring isolated save volume '${VOLUME_NAME}' exists (no Mac host files mounted)..."
container volume create "${VOLUME_NAME}" >/dev/null 2>&1 || true

echo "3/4 Building hardened OCI image '${IMAGE_NAME}'..."
container build -t "${IMAGE_NAME}" .

# Stop any prior instance cleanly
container stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
container rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true

# Detect MacBook Wi-Fi IP so in-lobby QR codes point iPads on home Wi-Fi directly here
MAC_LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)"

echo "4/4 Starting sandboxed micro-VM container on port ${PORT}..."
# Note: in apple/container, ALL flags MUST come before the image name!
EXTRA_ENV=()
if [[ -n "${HOST_SECRET:-}" ]]; then
  EXTRA_ENV+=(-e "HOST_SECRET=${HOST_SECRET}")
fi

container run \
  --name "${CONTAINER_NAME}" \
  --detach \
  --publish "0.0.0.0:${PORT}:3000" \
  --volume "${VOLUME_NAME}:/data" \
  --cpus 2 \
  --memory 512M \
  -e "PUBLIC_HOST=${MAC_LAN_IP}" \
  "${EXTRA_ENV[@]}" \
  "${IMAGE_NAME}"

echo ""
echo "✅ Purple Van Road Trip is running inside an isolated Apple Container VM!"
echo "   MacBook:  http://localhost:${PORT}"
echo "   iPad/LAN: http://${MAC_LAN_IP}:${PORT}"
echo ""
echo "   Logs:     container logs -f ${CONTAINER_NAME}"
echo "   Stop:     container stop ${CONTAINER_NAME}"
