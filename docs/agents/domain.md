# 領域文件

client 與 server 使用共用領域詞彙，採 single-context 配置。

探索業務前讀取根目錄 `GLOSSARY.md` 與 `docs/adr/` 中相關決策；若不存在則直接繼續，不預先建立空文件。若未來存在 `GLOSSARY-MAP.md`，依其指向讀取相關領域。

命名沿用已定義詞彙；若與既有 ADR 衝突，明確指出決策與原因。功能行為以 `specs/` 中適用規格為依據。
