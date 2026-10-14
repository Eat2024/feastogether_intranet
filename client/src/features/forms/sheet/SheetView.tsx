// 簽到表的畫面版面（表頭＋表格），編輯預覽、簽署人簽到與唯讀檢視共用。
// 不含狀態；簽到格與備註格的內容由呼叫端透過 render 函式提供（僅限 Client Component 使用函式 props）。
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { SheetInfo, Signer } from "../types";
import type { SheetRow } from "./rules";

const COLUMNS = [
  { key: "no", label: "序號" },
  { key: "unit", label: "單位" },
  { key: "title", label: "職稱" },
  { key: "name", label: "姓名" },
  { key: "sign", label: "簽到" },
  { key: "time", label: "簽到時間" },
  { key: "remark", label: "備註" },
] as const;

// 表格線：外框只畫上、左，每格畫右、下，相鄰格線不重疊、左右邊緣對齊
const GRID_COLUMNS = "7% 17% 15% 13% 18% 14% 16%";
const cell = {
  borderRight: 1,
  borderBottom: 1,
  borderColor: "text.primary",
  px: 1,
  py: 0.75,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  overflowWrap: "anywhere",
} as const;

export default function SheetView({
  sheet,
  rows,
  attendance,
  renderSign,
  renderRemark,
  highlight,
  emptyText,
}: {
  sheet: SheetInfo;
  rows: SheetRow[];
  /** 應到／實到人數；省略時不顯示出席人數 */
  attendance?: { expected: number; actual: number };
  /** 自訂簽到格內容（例如簽名按鈕）；省略時顯示已簽的簽名圖 */
  renderSign?: (signer: Signer) => ReactNode;
  renderRemark?: (signer: Signer) => ReactNode;
  /** 標示的簽署人（本人那一列） */
  highlight?: string;
  emptyText?: string;
}) {
  const fields = attendance
    ? [
        ...sheet.fields,
        {
          label: "出席人數",
          value: `應到 ${attendance.expected} 人；實到 ${attendance.actual} 人`,
        },
      ]
    : sheet.fields;

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2, overflowX: "auto" }}
    >
      <Box sx={{ minWidth: 640 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 3,
            mb: 2,
            position: "relative",
          }}
        >
          <Typography variant="sectionTitle" component="div">
            {sheet.title || "（表單標題）"}
          </Typography>
          {sheet.formCode && (
            <Typography
              variant="secondary"
              component="div"
              sx={{ position: "absolute", right: 0 }}
            >
              {sheet.formCode}
            </Typography>
          )}
        </Box>

        <Box sx={{ borderTop: 1, borderLeft: 1, borderColor: "text.primary" }}>
          {/* 表頭：兩欄排列的「欄位名稱｜內容」 */}
          {fields.length > 0 && (
            <Box
              sx={{ display: "grid", gridTemplateColumns: "14% 36% 14% 36%" }}
            >
              {fields.map((f, i) => (
                <Box key={`${f.label}-${i}`} sx={{ display: "contents" }}>
                  <Box
                    sx={{
                      ...cell,
                      justifyContent: "center",
                      bgcolor: "formBorder",
                    }}
                  >
                    <Typography variant="label" component="span">
                      {f.label}
                    </Typography>
                  </Box>
                  <Box sx={cell}>
                    <Typography variant="content" component="span">
                      {f.value || "—"}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {/* 奇數個欄位時補滿最後一列 */}
              {fields.length % 2 === 1 && (
                <Box sx={{ ...cell, gridColumn: "span 2" }} />
              )}
            </Box>
          )}

          <Box
            sx={{
              ...cell,
              justifyContent: "center",
              letterSpacing: "1em",
              bgcolor: "formBorder",
            }}
          >
            <Typography variant="label" component="span">
              簽到人員
            </Typography>
          </Box>
          <Box role="table" aria-label="簽到名單">
            <Box
              role="row"
              sx={{ display: "grid", gridTemplateColumns: GRID_COLUMNS }}
            >
              {COLUMNS.map((c) => (
                <Box
                  key={c.key}
                  role="columnheader"
                  sx={{ ...cell, justifyContent: "center" }}
                >
                  <Typography variant="label" component="span">
                    {c.label}
                  </Typography>
                </Box>
              ))}
            </Box>
            {rows.length === 0 && (
              <Box sx={{ ...cell, justifyContent: "center", py: 3 }}>
                <Typography variant="description">
                  {emptyText ?? "尚未加入簽署人"}
                </Typography>
              </Box>
            )}
            {rows.map(({ no, signer }) => {
              const mine = !!signer && signer.id === highlight;
              const sig = signer?.signatures?.[1];
              const values: Record<(typeof COLUMNS)[number]["key"], ReactNode> =
                {
                  no,
                  unit: signer?.unit ?? "",
                  title: signer?.title ?? "",
                  name: signer?.name ?? "",
                  sign: signer
                    ? (renderSign?.(signer) ??
                      (sig ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 簽名為 data URL，不經 next/image 最佳化
                        <img
                          src={sig}
                          alt={`${signer.name} 的簽名`}
                          style={{ maxHeight: 36, maxWidth: "100%" }}
                        />
                      ) : signer.status === "signed" ? (
                        "已簽到"
                      ) : (
                        ""
                      )))
                    : "",
                  time: signer?.status === "signed" ? signer.signedAt : "",
                  remark: signer
                    ? (renderRemark?.(signer) ?? signer.remark ?? "")
                    : "",
                };
              return (
                <Box
                  key={no}
                  role="row"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLUMNS,
                    bgcolor: mine ? "primary.less" : undefined,
                  }}
                  aria-current={mine ? "true" : undefined}
                >
                  {COLUMNS.map((c) => (
                    <Box
                      key={c.key}
                      role="cell"
                      sx={{
                        ...cell,
                        minHeight: 48,
                        justifyContent:
                          c.key === "no" ? "flex-start" : "center",
                      }}
                    >
                      <Typography
                        variant="content"
                        component="div"
                        sx={{
                          width:
                            c.key === "remark" || c.key === "sign"
                              ? "100%"
                              : undefined,
                          textAlign: c.key === "no" ? "left" : "center",
                        }}
                      >
                        {values[c.key]}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
