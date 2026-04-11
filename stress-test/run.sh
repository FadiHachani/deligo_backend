#!/usr/bin/env bash
# Deligo stress test runner
# Usage:
#   ./stress-test/run.sh seed         — seed DB and generate tokens.json
#   ./stress-test/run.sh http         — run HTTP load test
#   ./stress-test/run.sh ws           — run WebSocket load test
#   ./stress-test/run.sh all          — seed + http + ws sequentially
#   ./stress-test/run.sh smoke        — quick 30s smoke test (http only)

set -e
cd "$(dirname "$0")/.."   # project root = deligo-api/

CMD="${1:-help}"

install_k6() {
  if command -v k6 &>/dev/null; then return; fi
  echo "Installing k6..."
  sudo gpg --no-default-keyring \
    --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
    --keyserver hkp://keyserver.ubuntu.com:80 \
    --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 2>/dev/null
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update -qq
  sudo apt-get install -y k6
  echo "k6 installed: $(k6 version)"
}

case "$CMD" in
  seed)
    echo "=== Seeding database ==="
    npx ts-node --project tsconfig.json stress-test/seed.ts
    ;;

  http)
    install_k6
    echo "=== Running HTTP load test ==="
    k6 run stress-test/http-load.js
    ;;

  ws)
    install_k6
    echo "=== Running WebSocket load test ==="
    k6 run stress-test/ws-load.js
    ;;

  smoke)
    install_k6
    echo "=== Smoke test (30s, 10 VUs) ==="
    k6 run --vus 10 --duration 30s \
      --env SCENARIO=smoke \
      stress-test/http-load.js
    ;;

  all)
    echo "=== Full stress test suite ==="
    bash "$0" seed
    bash "$0" http
    bash "$0" ws
    ;;

  help|*)
    echo "Usage: $0 [seed|http|ws|smoke|all]"
    ;;
esac
