"use client";

// 可排序的表頭：點擊以網址參數切換排序（重新整理或分享網址都會保留排序）。
// 須為 client 元件：Next.js Link 無法從伺服器元件當作 component 傳入 MUI。
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import UnfoldMoreRoundedIcon from "@mui/icons-material/UnfoldMoreRounded";
import TableCell from "@mui/material/TableCell";
import TableSortLabel, { tableSortLabelClasses } from "@mui/material/TableSortLabel";
import NextLink from "next/link";
import type { ReactNode } from "react";

export default function SortableHeaderCell({
  children,
  active,
  order,
  href,
}: {
  children: ReactNode;
  active: boolean;
  order: "asc" | "desc";
  /** 點擊後前往的網址（已帶好下一個排序狀態） */
  href: string;
}) {
  return (
    <TableCell sortDirection={active ? order : false}>
      <TableSortLabel
        component={NextLink}
        href={href}
        scroll={false}
        active={active}
        direction={active ? order : "asc"}
        // 未排序的欄位常駐顯示淡色「⇅」，讓使用者一眼看出此欄可排序（MUI 預設僅 hover 時顯示）
        IconComponent={active ? ArrowDownwardRoundedIcon : UnfoldMoreRoundedIcon}
        sx={{
          [`& .${tableSortLabelClasses.icon}`]: { opacity: active ? 1 : 0.4 },
          [`&:hover .${tableSortLabelClasses.icon}`]: { opacity: active ? 1 : 0.7 },
        }}
      >
        {children}
      </TableSortLabel>
    </TableCell>
  );
}
