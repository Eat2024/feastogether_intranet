"use client";

// 以連結切換的分頁標籤：狀態記在網址上，重新整理或上一頁都會停在同一分頁
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Link from "next/link";

export default function LinkTabs({
  value,
  tabs,
}: {
  value: string;
  tabs: { value: string; label: string; href: string }[];
}) {
  return (
    <Tabs value={value} sx={{ borderBottom: 1, borderColor: "divider" }}>
      {tabs.map((t) => (
        <Tab key={t.value} value={t.value} label={t.label} component={Link} href={t.href} scroll={false} />
      ))}
    </Tabs>
  );
}
