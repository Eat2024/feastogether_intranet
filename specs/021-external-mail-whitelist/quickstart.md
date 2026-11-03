# Quickstart: 信箱規則驗證

沿用 Spec 018 quickstart 的前置條件：測試 DB 僅用 `feastogether_intranet_test` 前綴、合成人資與 SMTP、不寄真實郵件、不對 UAT 寫入。本文件只列本次新增的驗證。

## 單元

- 只有信箱規則：命中地址允許；`other@`、`tester+uat@`、`tester@sub.`、`tester1@` 阻擋；組織樹與 `staff_emails` 呼叫 0 次。
- 全部命中信箱規則時人資來源丟錯：仍允許。
- 信箱與員編規則並存：只以未命中地址查人資，結果聯集。
- 仍有未命中者且人資故障：`MailWhitelistCheckFailedError`。

## Schema

- `email` 合法：一般地址、255 字元地址。
- `email` 非法：含大寫、前後或中間空白、換行、缺 `@`、兩個 `@`、`@` 開頭或結尾、256 字元。
- 部門 51 字元、員編 21 字元仍被拒。
- 有信箱列（含已撤銷）時 down 失敗且資料不變；刪除後 down／up 成功。

## E2E

- OTP：信箱規則命中、合成人資來源丟錯 → 200、可驗證、`external_otp.sent` 一筆。
- 外部催簽：信箱規則命中、合成人資來源丟錯 → delivered。

## 指令

```bash
pnpm -C server test --runInBand
pnpm -C server test:schema
pnpm -C server test:e2e:security
pnpm -C server test:e2e
pnpm -C server lint:check
pnpm -C server build
```

## 環境上版

1. 依既有 migration 流程套用 `MailWhitelistEmailRule1793664001000`。
2. 依 018 maintenance 新增信箱規則，例如 `INSERT INTO mail_recipient_whitelist (type, value, remark) VALUES ('email', ?, ?)`，值為小寫完整地址。
3. 以該地址建立外部簽署人，確認邀請、催簽與 OTP 寄達。
