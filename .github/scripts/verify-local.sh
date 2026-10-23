#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
case "${1:-}" in
  commit)
    pnpm lint
    pnpm -C server test --runInBand
    ;;
  push)
    pnpm build
    ;;
  *) echo '用法：verify-local.sh commit|push' >&2; exit 2 ;;
esac
