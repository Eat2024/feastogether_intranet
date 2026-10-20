# 完成副本用繁體中文字型

- 來源：Noto Sans TC variable TTF，固定上游 revision `f8d157532fbfaeda587e826d4cd5b21a49186f7c`。
- [上游原檔](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf)
- 授權：SIL Open Font License 1.1，完整文字見 `OFL.txt`，保留原字型的 copyright/license metadata。
- 修改：固定字重 500、只保留「饗賓集團 內部文件 請勿外流」字元，衍生名稱改為 **Esign Watermark TC Medium**，不以 Noto 名稱發布衍生字型。
- 檔案 SHA-256：`b5c2ee8d1fe8b1ba565d1ad2a54c76464c5b43f6dff3da1c70820630e1290a8c`。

產生方式：`uv run --with fonttools==4.60.2 python server/assets/fonts/build-font.py`。產生工具只供維護資產，執行服務不需要 Python 或網路。TTF 約 7 KiB，不將整份 CJK 字型塞入每一份 PDF。選擇 TTF 是因 pdf-lib/fontkit 的 CFF OTF 子集在實際 MuPDF 渲染無法載入；交付前已實際渲染並解碼 QR。

`server/src/assets/fonts` 是此目錄的相對連結；Nest build 將內容複製至 `dist/assets/fonts`。部署須保留整個 `dist`（含字型與授權），不依賴主機字型或執行時網路下載。
