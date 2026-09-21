#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/app/src/main/assets/web/vendor"
mkdir -p "$VENDOR/three-addons/loaders" "$VENDOR/three-addons/utils"

THREE_VERSION="0.180.0"
THREE_VRM_VERSION="3.5.5"

curl -fL --retry 3 --retry-delay 1 \
  "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.min.js" \
  -o "$VENDOR/three.module.min.js"

curl -fL --retry 3 --retry-delay 1 \
  "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.core.min.js" \
  -o "$VENDOR/three.core.min.js"

curl -fL --retry 3 --retry-delay 1 \
  "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js" \
  -o "$VENDOR/three-addons/loaders/GLTFLoader.js"

curl -fL --retry 3 --retry-delay 1 \
  "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/utils/BufferGeometryUtils.js" \
  -o "$VENDOR/three-addons/utils/BufferGeometryUtils.js"

curl -fL --retry 3 --retry-delay 1 \
  "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@${THREE_VRM_VERSION}/lib/three-vrm.module.min.js" \
  -o "$VENDOR/three-vrm.module.min.js"

echo "Nexus web dependencies installed."
