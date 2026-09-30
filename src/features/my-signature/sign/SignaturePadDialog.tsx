'use client';

import { color } from '@/theme/tokens';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';

const PAD_HEIGHT = 220;
// 簽名筆跡外框至少要這麼大（CSS px），避免只點一下就送出
const MIN_INK_SIZE = 40;

/**
 * 裁掉簽名四周的空白（保留少許邊距）。簽名會被縮小放進約 108×46 的欄位，
 * 不裁切的話整塊簽名板被等比縮小約 5–10 倍，筆畫會細到看不清楚。
 * 回傳 null 表示筆跡太小。
 */
function trimSignature(canvas: HTMLCanvasElement, ratio: number): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const inkW = (maxX - minX) / ratio;
  const inkH = (maxY - minY) / ratio;
  if (inkW < MIN_INK_SIZE && inkH < MIN_INK_SIZE) return null;

  const margin = 8 * ratio;
  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  const w = Math.min(width, maxX + margin) - x;
  const h = Math.min(height, maxY + margin) - y;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

type SignaturePadDialogProps = {
  open: boolean;
  /** 例：第 3 頁・第 2 個簽名欄位 */
  subtitle: string;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
};

/** 手寫簽名板：支援滑鼠、觸控與手寫筆；每個簽名欄位都需現場親手簽名 */
export default function SignaturePadDialog({ open, subtitle, onClose, onConfirm }: SignaturePadDialogProps) {
  const theme = useTheme();
  // ≤768 時全螢幕，手機上有較大的簽名空間
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const ratioRef = useRef(1);
  const [tooSmall, setTooSmall] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  // canvas 在 Dialog 開啟後才掛載：以 callback ref 初始化，並依實際尺寸與螢幕像素比設定解析度。
  // 必須用 useCallback 固定函式：若每次渲染都是新函式，React 會重新呼叫 ref，
  // 重設 canvas 尺寸會清空畫布，導致剛畫好的筆畫在 setHasInk 觸發重新渲染後消失
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    padRef.current?.off();
    padRef.current = null;
    canvasRef.current = canvas;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')?.scale(ratio, ratio);
    ratioRef.current = ratio;
    // 筆畫稍粗：簽名縮小放進欄位後仍清晰可辨
    const pad = new SignaturePad(canvas, { penColor: color.textDefault, minWidth: 1.8, maxWidth: 4.2 });
    pad.addEventListener('endStroke', () => {
      setHasInk(!pad.isEmpty());
      setTooSmall(false);
    });
    padRef.current = pad;
    // 每次開啟 Dialog 都會重新掛載 canvas，從空白開始
    setHasInk(false);
    setTooSmall(false);
  }, []);

  const clear = () => {
    padRef.current?.clear();
    setHasInk(false);
    setTooSmall(false);
  };

  const confirm = () => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas || pad.isEmpty()) return;
    const dataUrl = trimSignature(canvas, ratioRef.current);
    if (!dataUrl) {
      setTooSmall(true);
      return;
    }
    onConfirm(dataUrl);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle component="div">
        <Stack spacing={0.5}>
          <Typography variant="sectionTitle">手寫簽名</Typography>
          <Typography variant="secondary">{subtitle}</Typography>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Stack spacing={1}>
          <Typography variant="secondary">請在下方框內親手書寫你的簽名，建議一筆完成、清晰可辨識。</Typography>
          <Box
            sx={{
              position: 'relative',
              height: PAD_HEIGHT,
              border: 1,
              borderColor: 'formBorder',
              borderRadius: 2,
              bgcolor: 'grey.50',
              overflow: 'hidden',
            }}
          >
            {/* 簽名基準線 */}
            <Box
              sx={{
                position: 'absolute',
                left: 24,
                right: 24,
                bottom: 48,
                borderBottom: 1,
                borderColor: 'grey.300',
                pointerEvents: 'none',
              }}
            />
            {!hasInk && (
              <Typography
                variant="helper"
                sx={{ position: 'absolute', left: 24, bottom: 24, pointerEvents: 'none' }}
              >
                請在此處簽名
              </Typography>
            )}
            <Box
              component="canvas"
              ref={attachCanvas}
              aria-label="手寫簽名區"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' }}
            />
          </Box>
          {tooSmall && (
            <Typography variant="helper" sx={{ color: 'error.dark' }}>
              簽名過小，請清除後重新簽名，並盡量寫滿簽名框。
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, justifyContent: 'space-between' }}>
        <Button onClick={clear} disabled={!hasInk}>
          清除重寫
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={onClose}>
            取消
          </Button>
          <Button variant="contained" onClick={confirm} disabled={!hasInk}>
            確認簽名
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
