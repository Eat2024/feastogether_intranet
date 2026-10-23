# 發布操作指令

## UAT

```bash
bin/staging             # 將 origin/dev fast-forward 至 origin/uat
bin/staging feature/foo # 使用已推送的 origin/feature/foo
bin/staging .           # 使用目前分支對應的 origin 遠端版本
bin/staging <sha>       # 使用已存在於 origin 分支歷史的 commit
```

腳本會 fetch、顯示變更，再以一般 push 更新遠端 uat，觸發現有 self-hosted workflow。不切換本機分支、不 stash、不包含未提交／未推送的修改、不使用 force push。分支保護仍可能拒絕直接 push，此時應走 PR，不繞過保護。

uat 已包含來源時不重新部署；如需重跑，在 GitHub Actions 對 uat 手動觸發。來源與 uat 分歧時停止，需先整合。腳本成功表示分支更新成功，完整部署結果仍看 Actions；執行後會顯示依 SHA 查詢的指令。

## Production

`bin/deploy` 目前只提供明確的未就緒錯誤（exit 2），不推送 main／prod，也不觸發任何正式服務。電子簽目前沒有 production workflow，不能把 CKS 的 ECS 流程直接套上。

待確認正式環境部署方式、觸發分支、runner／主機、RDS／migration／備份與復原、S3／IAM／SMTP／HTTPS 後，再接通 production workflow，並加入已部署 UAT 的版本檢查及正式發布確認。不能僅以 commit 存在 uat 分支推定已完成 UAT 驗收。

## 驗證

```bash
bash .github/scripts/release-cli.test.sh
```

使用臨時 bare Git remote 驗證 fast-forward、來源 SHA、分歧拒絕與 working tree 保留，不操作 GitHub 或 AWS。
