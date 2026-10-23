#!/usr/bin/env bash
# 在現有 UAT EC2 上執行；不建立或重設資料庫，不修改 Nginx。
set -Eeuo pipefail
umask 077
: "${TARGET_SHA:?缺少 TARGET_SHA}"
: "${CLIENT_IMAGE:?缺少 CLIENT_IMAGE}"
: "${SERVER_IMAGE:?缺少 SERVER_IMAGE}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
for image in "$CLIENT_IMAGE" "$SERVER_IMAGE"; do
  [[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || exit 2
done
export CLIENT_IMAGE SERVER_IMAGE
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
uat_root=/home/feasteng/deploy/intranet-uat
state_dir="$uat_root/releases"
mkdir -p "$state_dir" "$uat_root/backups"
exec 9>"$uat_root/deploy.lock"
flock -n 9 || { echo '另一個 UAT 部署正在執行' >&2; exit 1; }
compose=(docker compose --project-name intranet-uat --env-file "$uat_root/.env" -f "$repo_root/docker-compose.uat.yml")
"${compose[@]}" config --quiet

# 只接管已存在的環境；避免錯誤的主機產生全新空資料庫。
for volume in mysql-data redis-data esign-data; do
  docker volume inspect "intranet-uat_$volume" >/dev/null
done
for service in mysql redis; do
  id=$("${compose[@]}" ps -q "$service")
  [[ -n "$id" && $(docker inspect -f '{{.State.Health.Status}}' "$id") == healthy ]] || {
    echo "$service 尚未 healthy，停止部署" >&2; exit 1;
  }
done
"${compose[@]}" pull server worker client

# 保存部署前實際映像，包含第一次由手動部署轉入 CI/CD 的版本。
old_client=$(docker inspect -f '{{.Image}}' intranet-uat-client-1)
old_server=$(docker inspect -f '{{.Image}}' intranet-uat-server-1)
old_worker=$(docker inspect -f '{{.Image}}' intranet-uat-worker-1)
[[ "$old_server" == "$old_worker" ]] || { echo 'server/worker 舊版本不同，請先確認' >&2; exit 1; }
backup="$uat_root/backups/${TARGET_SHA}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
migration_started=false
services_changed=false

start_apps() {
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 180 server || return 1
  # worker 沒有 HTTP healthcheck，不使用 --wait。
  "${compose[@]}" up -d --no-deps worker client
}
smoke() {
  curl --fail --silent --show-error --retry 12 --retry-connrefused --retry-delay 5 \
    --max-time 10 http://127.0.0.1:3000/api/health >/dev/null || return 1
  curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3000/ >/dev/null || return 1
  local worker_id
  worker_id=$("${compose[@]}" ps -q worker)
  [[ -n "$worker_id" ]] || return 1
  for attempt in {1..12}; do
    [[ $(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$worker_id") == 'true 0' ]] || return 1
    if docker logs "$worker_id" 2>&1 | grep -F 'background worker started' >/dev/null; then
      sleep 5
      [[ $(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$worker_id") == 'true 0' ]]
      return
    fi
    sleep 5
  done
  return 1
}
on_error() {
  trap - ERR
  if [[ "$migration_started" == true ]]; then
    echo "migration 已開始，可能包含無法回滾的 DDL；保留服務停止狀態，請人工處理。備份：$backup" >&2
    "${compose[@]}" stop client worker server || true
  elif [[ "$services_changed" == true ]]; then
    echo '部署失敗；本次未執行 migration，嘗試恢復部署前映像。' >&2
    export CLIENT_IMAGE="$old_client" SERVER_IMAGE="$old_server"
    if start_apps && smoke; then
      echo '已恢復部署前應用程式版本' >&2
    else
      echo '恢復失敗，需要人工處理' >&2
    fi
  fi
  exit 1
}
trap on_error ERR

# exit 10 專指 pending；連線／載入錯誤不能誤認成需要 migration。
check_status=0
"${compose[@]}" run --rm --no-deps -T server node -e '
(async () => {
  const ds = require("./dist/infrastructure/database/mysql/data-source.js").default;
  try { await ds.initialize(); process.exitCode = (await ds.showMigrations()) ? 10 : 0; }
  catch { console.error("migration 檢查失敗，請檢查 DB 連線與映像"); process.exitCode = 1; }
  finally { if (ds.isInitialized) await ds.destroy(); }
})();' || check_status=$?
case "$check_status" in
  0) echo '沒有 pending migration' ;;
  10)
    services_changed=true
    "${compose[@]}" stop client worker server
    # 停止寫入後備份；root 密碼由 MySQL 容器既有環境取得，不輸出到命令列。
    "${compose[@]}" exec -T mysql sh -c \
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' \
      | gzip > "$backup.tmp"
    gzip -t "$backup.tmp"
    mv "$backup.tmp" "$backup"
    migration_started=true
    "${compose[@]}" run --rm --no-deps -T server node node_modules/typeorm/cli.js \
      migration:run -d dist/infrastructure/database/mysql/data-source.js
    ;;
  *) echo 'migration 檢查失敗，未更動服務' >&2; exit 1 ;;
esac
services_changed=true
start_apps
smoke
if [[ -f "$state_dir/current.env" ]]; then
  cp "$state_dir/current.env" "$state_dir/previous.env"
fi
printf 'TARGET_SHA=%s\nCLIENT_IMAGE=%s\nSERVER_IMAGE=%s\n' \
  "$TARGET_SHA" "$CLIENT_IMAGE" "$SERVER_IMAGE" > "$state_dir/current.env.tmp"
mv "$state_dir/current.env.tmp" "$state_dir/current.env"
printf 'CLIENT_IMAGE=%s\nSERVER_IMAGE=%s\n' "$old_client" "$old_server" > "$state_dir/before-last-deploy.env"
echo "UAT 部署成功：$TARGET_SHA"
