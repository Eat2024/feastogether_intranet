# 舊版容量量測的重現資料

baseline-5c79e52.patch 保存 Spec023 暫時 baseline worktree 的全部程式差異，基準為完整 commit `5c79e5220b5bccb6fa6eafe07fcc6d4cf7a83b0f`。

內容僅為合成容量測試：6,000 改為 5,001 人、尾批斷言及 SQL／HTTP／worker／policy 量測。產品程式沒有改動。此 patch 是當時實際量測版本的原樣保存，不套用到目前產品分支。

重現時另建該基準的暫時 checkout，對 patch 執行 `git apply --check` 後再套用；安裝對應依賴，使用隔離測試 DB／Redis 執行容量測試。不要使用 UAT／production 憑證。三輪結果與環境限制見上一層 performance.md。

收尾時將 patch 納入功能分支後移除暫時 worktree。node_modules 與 .env.test 的本機連結是測試環境設定，不納入版本控制；原始目標檔案不刪除。
