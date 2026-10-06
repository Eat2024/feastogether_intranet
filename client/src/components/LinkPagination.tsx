"use client";

// 以連結切換頁碼的分頁元件；hrefs[i] 為第 i+1 頁的網址
import Pagination from "@mui/material/Pagination";
import PaginationItem from "@mui/material/PaginationItem";
import Link from "next/link";

export default function LinkPagination({ page, hrefs }: { page: number; hrefs: string[] }) {
  if (hrefs.length <= 1) return null;
  return (
    <Pagination
      page={page}
      count={hrefs.length}
      shape="rounded"
      // 統一靠右對齊（外層需為區塊或 column 排列，nav 才會撐滿寬度）
      sx={{ "& .MuiPagination-ul": { justifyContent: "flex-end" } }}
      renderItem={(item) => {
        // 第一頁的「上一頁」、最後一頁的「下一頁」頁碼會超出範圍（0 或 count+1），不可給 Link 空的網址
        const href = item.page ? hrefs[item.page - 1] : undefined;
        return href && !item.disabled && item.type !== "start-ellipsis" && item.type !== "end-ellipsis" ? (
          <PaginationItem {...item} component={Link} href={href} scroll={false} />
        ) : (
          <PaginationItem {...item} />
        );
      }}
    />
  );
}
