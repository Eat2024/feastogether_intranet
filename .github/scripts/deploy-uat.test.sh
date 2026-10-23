#!/usr/bin/env bash
# 用替身驗證失敗分支，不接觸 Docker daemon、UAT 或真實密碼。
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/repo/.github/scripts" "$tmp/uat"
sed "s|/home/feasteng/deploy/intranet-uat|$tmp/uat|g" "$repo_root/.github/scripts/deploy-uat.sh" > "$tmp/repo/.github/scripts/deploy-uat.sh"
export TEST_LOG="$tmp/commands"
export PATH="$tmp/bin:$PATH"
export TARGET_SHA=1111111111111111111111111111111111111111
export CLIENT_IMAGE=ghcr.io/example/client@sha256:$(printf '%064d' 1)
export SERVER_IMAGE=ghcr.io/example/server@sha256:$(printf '%064d' 2)
cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
case "$*" in
  'volume inspect '*|'network inspect '*) exit 0 ;;
  'inspect -f {{.Image}} intranet-uat-client-1') echo sha256:old-client ;;
  'inspect -f {{.Image}} '*) echo sha256:old-server ;;
  'inspect -f {{.State.Health.Status}} '*) echo healthy ;;
  'inspect -f {{.State.Running}} {{.RestartCount}} '*) echo 'true 0' ;;
  'logs '*) echo '[worker] background worker started' ;;
  *' ps -q '*) echo mock-container ;;
  *'process.exitCode = (await ds.showMigrations())'*) exit "${CHECK_STATUS:-0}" ;;
  *' pull db-backup') exit "${FAIL_PULL_BACKUP:-0}" ;;
  *' run --rm --no-deps -T db-backup'*)
    [[ ${FAIL_BACKUP:-0} == 0 ]] || exit 1
    echo 'CREATE TABLE example (id INT);' ;;
  *' migration:run '*) exit "${MIGRATE_STATUS:-0}" ;;
  *' up -d '*)
    if [[ ${FAIL_START:-0} == 1 && "$SERVER_IMAGE" != sha256:old-server ]]; then exit 1; fi ;;
esac
MOCK
cat > "$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/sleep"
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/flock"
chmod +x "$tmp/bin/"*
run_case() {
  : > "$TEST_LOG"
  rm -rf "$tmp/uat/releases" "$tmp/uat/backups"
  local actual=0
  bash "$tmp/repo/.github/scripts/deploy-uat.sh" > "$tmp/output" 2>&1 || actual=$?
  [[ "$actual" == "$1" ]] || { cat "$tmp/output"; exit 1; }
}
export CHECK_STATUS=0
run_case 0
test -f "$tmp/uat/releases/current.env"
! grep -q "db-backup" "$TEST_LOG"
! grep -q 'migration:run' "$TEST_LOG"
export CHECK_STATUS=1
run_case 1
! grep -q ' stop ' "$TEST_LOG"
! grep -q ' up -d ' "$TEST_LOG"
export CHECK_STATUS=10 FAIL_PULL_BACKUP=1
run_case 1
! grep -q ' stop ' "$TEST_LOG"
! grep -q 'migration:run' "$TEST_LOG"
export FAIL_PULL_BACKUP=0
run_case 0
grep -q 'migration:run' "$TEST_LOG"
! grep -q 'mysql-data\|exec -T mysql' "$TEST_LOG"
test "$(find "$tmp/uat/backups" -name '*.sql.gz' | wc -l | tr -d ' ')" = 1
export FAIL_BACKUP=1
run_case 1
! grep -q 'migration:run' "$TEST_LOG"
grep -q '已恢復部署前' "$tmp/output"
export FAIL_BACKUP=0 MIGRATE_STATUS=1
run_case 1
! grep -q ' up -d ' "$TEST_LOG"
test ! -f "$tmp/uat/releases/current.env"
export CHECK_STATUS=0 MIGRATE_STATUS=0 FAIL_START=1
run_case 1
grep -q '已恢復部署前' "$tmp/output"
test ! -f "$tmp/uat/releases/current.env"
echo '部署流程測試通過：正常部署、檢查失敗、備份、備份失敗回復、migration 失敗停止、應用部署失敗回復。'
