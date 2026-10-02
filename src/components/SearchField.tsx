"use client";

// 列表搜尋框：輸入停頓後把關鍵字寫入網址參數（保留其他參數，例如排序），由伺服器端篩選。
// 使用注音等輸入法選字期間不觸發搜尋，選字完成才送出。
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchInput from "./SearchInput";
import { useEffect, useRef, useState, useTransition } from "react";

const DEBOUNCE_MS = 300;

export default function SearchField({
  placeholder,
  param = "q",
  width = 360,
}: {
  placeholder: string;
  /** 對應的網址參數名稱 */
  param?: string;
  width?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlValue = params.get(param) ?? "";

  const [value, setValue] = useState(urlValue);
  // 網址被外部改變時（例如按上一頁）同步輸入框內容
  const [syncedUrlValue, setSyncedUrlValue] = useState(urlValue);
  if (urlValue !== syncedUrlValue) {
    setSyncedUrlValue(urlValue);
    setValue(urlValue);
  }

  const composing = useRef(false);
  const [composeTick, setComposeTick] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const next = value.trim();
    if (composing.current || next === urlValue.trim()) return;
    const timer = setTimeout(() => {
      const qs = new URLSearchParams(params);
      if (next) qs.set(param, next);
      else qs.delete(param);
      const query = qs.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // composeTick：選字結束後重新觸發
  }, [value, composeTick, urlValue, params, param, pathname, router]);

  return (
    <SearchInput
      value={value}
      onChange={setValue}
      placeholder={placeholder}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        setComposeTick((t) => t + 1);
      }}
      sx={{ width: "100%", maxWidth: width, bgcolor: "background.paper" }}
    />
  );
}
