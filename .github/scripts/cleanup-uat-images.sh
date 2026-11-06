#!/usr/bin/env bash
# 由部署成功路徑呼叫，沿用部署鎖；只刪本專案的歷史映像引用。
set -euo pipefail
state_dir=${1:?缺少版本紀錄目錄}
: "${CLIENT_IMAGE:?缺少 CLIENT_IMAGE}"
: "${SERVER_IMAGE:?缺少 SERVER_IMAGE}"
repositories=("${CLIENT_IMAGE%@*}" "${SERVER_IMAGE%@*}")
protected=$'\n'
for manifest in current previous; do
  [[ -s "$state_dir/$manifest.env" ]] || { echo '版本紀錄不完整，略過清理' >&2; exit 1; }
  count=0
  while IFS='=' read -r key ref; do
    case "$key" in
      CLIENT_IMAGE|SERVER_IMAGE)
        [[ "$ref" =~ ^(sha256:[0-9a-f]{64}|ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64})$ ]] || exit 1
        id=$(docker image inspect --format '{{.Id}}' "$ref")
        [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
        protected+="$id"$'\n'
        count=$((count + 1)) ;;
    esac
  done < "$state_dir/$manifest.env"
  [[ $count == 2 ]] || exit 1
done
# 先完整取得清單；任何保留版本無法解析時都不進入刪除流程。
images=$(docker image ls --digests --no-trunc --format '{{.Repository}} {{.Tag}} {{.Digest}} {{.ID}}')
failed=0
while read -r repository tag digest id; do
  [[ "$repository" == "${repositories[0]}" || "$repository" == "${repositories[1]}" ]] || continue
  [[ "$protected" != *$'\n'"$id"$'\n'* ]] || continue
  # 包含停止中的容器也保護；不使用強制刪除。
  containers=$(docker ps -aq --filter "ancestor=$id")
  if [[ -n "$containers" ]]; then
    echo "映像仍有容器引用，保留：$id" >&2
    failed=1
    continue
  fi
  if [[ "$tag" != '<none>' ]]; then
    ref="$repository:$tag"
  elif [[ "$digest" != '<none>' ]]; then
    ref="$repository@$digest"
  else
    continue
  fi
  docker image rm "$ref" || failed=1
done <<< "$images"
exit "$failed"
