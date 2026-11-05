import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

// 用法同 useState，但值會同步到 sessionStorage：同一分頁內換頁後狀態還在，關閉分頁即清空。
// 用 useSyncExternalStore 而不是在 useEffect 裡 setState 還原，避免 mount 後多一次渲染；
// SSR 時走 getServerSnapshot 回傳初始值。（移植自 CKS_Acceptance_System）

// setValue 時通知訂閱同一個 key 的所有元件重新讀取
const listeners = new Map<string, Set<() => void>>();

// getSnapshot 必須回傳穩定的參考，所以快取「原始字串 → 解析結果」
const cache = new Map<string, { raw: string | null; value: unknown }>();

const emit = (key: string) => listeners.get(key)?.forEach((notify) => notify());

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    // 瀏覽器封鎖儲存空間時當作沒存過
  }
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // 壞資料當作沒存過
    }
  }
  cache.set(key, { raw, value });
  return value;
}

export function useSessionStorageState<T>(key: string, initialValue: T) {
  const subscribe = useCallback(
    (notify: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(notify);
      return () => set.delete(notify);
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initialValue),
    () => initialValue,
  );

  const setValue = useCallback(
    (action: SetStateAction<T>) => {
      const next =
        typeof action === "function"
          ? (action as (prev: T) => T)(read(key, initialValue))
          : action;
      const raw = JSON.stringify(next);
      cache.set(key, { raw, value: next });
      try {
        sessionStorage.setItem(key, raw);
      } catch {
        // 存不進去時只在這次瀏覽期間有效
      }
      emit(key);
    },
    [key, initialValue],
  );

  return [value, setValue] as const;
}
