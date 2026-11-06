#!/usr/bin/env bash
# 不連線 Docker daemon；驗證保留清單、範圍與失敗時不誤刪。
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/state"
export CLIENT_IMAGE="ghcr.io/example/feastogether-intranet-client@sha256:$(printf '%064d' 1)"
export SERVER_IMAGE="ghcr.io/example/feastogether-intranet-server@sha256:$(printf '%064d' 2)"
export TEST_LOG="$tmp/log"
export PATH="$tmp/bin:$PATH"
cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_LOG"
case "$*" in
  'image inspect '*)
    [[ ${FAIL_INSPECT:-0} == 0 ]] || exit 1
    ref="${@: -1}"
    echo "${ref##*@}" ;;
  'image ls '*)
    for n in 1 2 3 4 5 6 7 8; do
      repo=${CLIENT_IMAGE%@*}
      [[ $n != 7 ]] || repo=ghcr.io/example/another-project
      tag="version-$n"
      [[ $n != 6 ]] || tag='<none>'
      printf '%s %s sha256:%064d sha256:%064d\n' "$repo" "$tag" "$n" "$n"
    done ;;
  'ps -aq '*)
    if [[ ${BLOCK_CONTAINER:-1} == 1 && "$*" == *"$(printf '%064d' 5)" ]]; then echo stopped-container; fi ;;
  'image rm '*) exit "${FAIL_REMOVE:-0}" ;;
  *) exit 99 ;;
esac
MOCK
chmod +x "$tmp/bin/docker"
printf 'CLIENT_IMAGE=%s\nSERVER_IMAGE=%s\n' "$CLIENT_IMAGE" "$SERVER_IMAGE" > "$tmp/state/current.env"
printf 'CLIENT_IMAGE=sha256:%064d\nSERVER_IMAGE=sha256:%064d\n' 3 4 > "$tmp/state/previous.env"
run() {
  : > "$TEST_LOG"
  actual=0
  bash "$root/cleanup-uat-images.sh" "$tmp/state" > "$tmp/output" 2>&1 || actual=$?
  [[ $actual == "$1" ]] || { cat "$tmp/output"; exit 1; }
}
run 1 # 容器引用會保留並回報清理不完整。
! grep -q 'image rm .*version-[123457]' "$TEST_LOG"
grep -q "image rm ${CLIENT_IMAGE%@*}@sha256:$(printf '%064d' 6)" "$TEST_LOG"
grep -q "image rm ${CLIENT_IMAGE%@*}:version-8" "$TEST_LOG"
export BLOCK_CONTAINER=0
run 0
grep -q "image rm ${CLIENT_IMAGE%@*}:version-5" "$TEST_LOG"
export FAIL_INSPECT=1
run 1
! grep -q 'image rm' "$TEST_LOG"
export FAIL_INSPECT=0 FAIL_REMOVE=1
run 1
# 缺少 previous 時不可猜測並清除。
rm "$tmp/state/previous.env"
run 1
! grep -q 'image rm' "$TEST_LOG"
echo '映像清理測試通過：保留兩版、停止中容器、其他專案、digest 引用與失敗保護。'
