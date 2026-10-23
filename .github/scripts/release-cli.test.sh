#!/usr/bin/env bash
# 真實 Git bare remote 回歸測試，不連 GitHub、不觸發實際部署。
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp=$(mktemp -d)
trap 'result=$?; if [[ $result != 0 && -f "$tmp/output" ]]; then cat "$tmp/output" >&2; fi; rm -rf "$tmp"' EXIT
git init --bare -q "$tmp/remote.git"
git init -q -b dev "$tmp/work"
cd "$tmp/work"
git config user.email test@example.invalid
git config user.name '發布腳本測試'
git config core.hooksPath /dev/null
git remote add origin "$tmp/remote.git"
mkdir -p bin .github/workflows
cp "$repo_root/bin/staging" "$repo_root/bin/deploy" bin/
printf 'name: fixture\n' > .github/workflows/uat-release.yml
git add .
git commit -qm initial
initial=$(git rev-parse HEAD)
git branch uat
git branch main
git push -q origin dev uat main
printf 'first\n' > change.txt
git add change.txt
git commit -qm first
candidate=$(git rev-parse HEAD)
git push -q origin dev
printf 'uncommitted\n' >> change.txt
before_status=$(git status --porcelain)
bin/staging > "$tmp/output" 2>&1
[[ $(git --git-dir="$tmp/remote.git" rev-parse uat) == "$candidate" ]]
[[ $(git branch --show-current) == dev ]]
[[ $(git status --porcelain) == "$before_status" ]]
bin/staging > "$tmp/output" 2>&1
grep -q '沒有更新' "$tmp/output"
if bin/staging missing > "$tmp/output" 2>&1; then exit 1; fi
# 未推送 SHA 必須拒絕。
git add change.txt
git commit -qm unpublished
unpublished=$(git rev-parse HEAD)
if bin/staging "$unpublished" > "$tmp/output" 2>&1; then exit 1; fi
# 發布已推送的當前分支。
git push -q origin dev
bin/staging . > "$tmp/output" 2>&1
[[ $(git --git-dir="$tmp/remote.git" rev-parse uat) == "$unpublished" ]]
# 來源分歧不得覆寫 UAT。
git checkout -qb feature "$initial"
printf 'other\n' > other.txt
git add other.txt
git commit -qm divergent
git push -q origin feature
if bin/staging feature > "$tmp/output" 2>&1; then exit 1; fi
[[ $(git --git-dir="$tmp/remote.git" rev-parse uat) == "$unpublished" ]]
# 合法已推送 SHA 可發布。
git checkout -q dev
printf 'next\n' > next.txt
git add next.txt
git commit -qm next
next=$(git rev-parse HEAD)
git push -q origin dev
bin/staging "$next" > "$tmp/output" 2>&1
[[ $(git --git-dir="$tmp/remote.git" rev-parse uat) == "$next" ]]
status=0
bin/deploy > "$tmp/output" 2>&1 || status=$?
[[ "$status" == 2 ]]
[[ $(git --git-dir="$tmp/remote.git" rev-parse main) == "$initial" ]]
echo '發布 CLI 測試通過：預設分支、無變更、工作目錄保留、缺少來源、未推送 SHA、當前分支、分歧拒絕、SHA 發布、production 未就緒拒絕。'
