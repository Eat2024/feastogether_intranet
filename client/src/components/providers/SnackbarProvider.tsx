'use client';

// 全站共用的提示訊息（Snackbar）；API 錯誤由 ReactQueryProvider 自動透過這裡顯示。
// 元件也可用 useSnackbar() 自行顯示成功或錯誤訊息。
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Severity = 'success' | 'error' | 'warning' | 'info';

type SnackbarContextValue = {
  showSnackbar: (message: string, severity?: Severity) => void;
};

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

export default function SnackbarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<{ message: string; severity: Severity } | null>(null);

  const showSnackbar = useCallback((message: string, severity: Severity = 'info') => {
    setCurrent({ message, severity });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ showSnackbar }), [showSnackbar]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={4000}
        onClose={(_, reason) => reason !== 'clickaway' && setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={current?.severity} onClose={() => setOpen(false)}>
          {current?.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar() {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar 必須在 SnackbarProvider 內使用');
  return ctx;
}
