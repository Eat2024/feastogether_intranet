'use client';

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import { AlertTitle } from '@mui/material';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode,
} from 'react';
import { saveUploadDocument } from '../actions';
import type { EFormDoc, UploadField } from '../types';

const ACCEPT = '.pdf,.doc,.docx';
// 欄位方塊尺寸（px）
const FIELD_W = 108;
const FIELD_H = 46;

/** 以放開的滑鼠位置為欄位中心，換算成左上角的頁面百分比，並確保整個欄位留在頁面內 */
function toFieldPosition(e: DragEvent, rect: DOMRect) {
  const maxX = 100 - (FIELD_W / rect.width) * 100;
  const maxY = 100 - (FIELD_H / rect.height) * 100;
  const x = ((e.clientX - rect.left - FIELD_W / 2) / rect.width) * 100;
  const y = ((e.clientY - rect.top - FIELD_H / 2) / rect.height) * 100;
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}

const FIELD_META: Record<
  UploadField['type'],
  { label: string; icon: ReactNode }
> = {
  sign: { label: '簽名欄位', icon: <DrawRoundedIcon fontSize="small" /> },
  date: { label: '日期欄位', icon: <EventRoundedIcon fontSize="small" /> },
};

type Errors = {
  name?: string;
  file?: string;
  fields?: string;
  submit?: string;
};

/** 表單區塊標題 */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="label" component="div" sx={{ mb: 1 }}>
      {children}
    </Typography>
  );
}

/** 頁面縮圖：點擊切換目前編輯的頁面，綠點表示此頁已有欄位 */
function PageThumb({
  page,
  active,
  hasField,
  onClick,
}: {
  page: number;
  active: boolean;
  hasField: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`第 ${page} 頁`}
      sx={{
        flex: 'none',
        width: 96,
        height: 132,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        bgcolor: 'background.paper',
        border: 1.5,
        borderColor: active ? 'primary.main' : 'grey.300',
        boxShadow: (theme) =>
          active ? `0 0 0 3px ${theme.palette.primary.less}` : 'none',
        borderRadius: 1,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <Stack spacing={0.5} sx={{ width: '70%' }}>
        {[100, 70, 85].map((w) => (
          <Box
            key={w}
            sx={{
              height: 3,
              width: `${w}%`,
              bgcolor: 'grey.300',
              borderRadius: 1,
            }}
          />
        ))}
      </Stack>
      <Typography variant="helper">第 {page} 頁</Typography>
      {hasField && (
        <Box
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'success.main',
          }}
        />
      )}
    </Box>
  );
}

/** 可拖曳到頁面上的欄位來源 */
function FieldSource({
  type,
  disabled,
}: {
  type: UploadField['type'];
  disabled: boolean;
}) {
  const meta = FIELD_META[type];
  return (
    <Box
      draggable={!disabled}
      onDragStart={(e) => e.dataTransfer.setData('text/field-type', type)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 2,
        py: 1,
        border: 1.5,
        borderStyle: 'dashed',
        borderColor: 'grey.300',
        borderRadius: 1,
        bgcolor: 'grey.50',
        color: 'text.secondary',
        cursor: disabled ? 'default' : 'grab',
      }}
    >
      {meta.icon}
      <Typography variant="label">{meta.label}</Typography>
    </Box>
  );
}

/** 系統簽署確認頁（公版 A4）預覽 */
function ConfirmPagePreview({
  name,
  docNumber,
  pages,
}: {
  name: string;
  docNumber: string | null;
  pages: number;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        maxWidth: 560,
        mx: 'auto',
        px: 5,
        py: 6,
        boxShadow: 2,
        minHeight: 400,
      }}
    >
      <Typography
        variant="sectionTitle"
        component="div"
        sx={{ textAlign: 'center', mb: 2 }}
      >
        電子簽署確認書
      </Typography>
      <Stack>
        <Typography variant="helper">
          文件名稱：{name || '（未命名文件）'}
        </Typography>
        <Typography variant="helper">
          文件編號：{docNumber ?? '（建立後產生）'}
        </Typography>
        <Typography variant="helper">文件頁數：{pages} 頁</Typography>
      </Stack>
      <Typography variant="content" sx={{ my: 5 }}>
        本人確認已閱讀並同意上述文件內容。
      </Typography>
      <Stack>
        <Typography variant="helper">簽署人：（簽署人姓名）</Typography>
        <Typography variant="helper">員工編號：（簽署人員工編號）</Typography>
      </Stack>
      <Box
        sx={{
          mt: 4,
          height: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 1.5,
          borderColor: 'grey.300',
          borderRadius: 1,
          bgcolor: 'grey.100',
        }}
      >
        <Typography variant="secondary">手寫簽名區</Typography>
      </Box>
      <Typography variant="helper" component="div" sx={{ mt: 2 }}>
        簽署時間：（簽署時自動帶入）
      </Typography>
      <Typography
        variant="helper"
        component="div"
        sx={{ textAlign: 'center', mt: 3 }}
      >
        — 公版 A4，將附加於原文件第 {pages + 1} 頁 —
      </Typography>
    </Paper>
  );
}

/** 新增／編輯上傳文件（流程第一步） */
export default function UploadEditor({
  form,
  locked = false,
}: {
  form?: EFormDoc;
  locked?: boolean;
}) {
  const up = form?.upload;
  const [name, setName] = useState(form?.name ?? '');
  const [fileName, setFileName] = useState(up?.fileName ?? '');
  const [pages, setPages] = useState(up?.pages ?? 0);
  const [confirmMode, setConfirmMode] = useState(up?.mode === 'confirmPage');
  const [fields, setFields] = useState<UploadField[]>(up?.fields ?? []);
  const [activePage, setActivePage] = useState(up?.fields[0]?.page ?? 1);
  const [errors, setErrors] = useState<Errors>({});
  const [dragOverFile, setDragOverFile] = useState(false);
  const [pending, startTransition] = useTransition();

  const nextFieldId = useRef(
    Math.max(0, ...(up?.fields ?? []).map((f) => f.id)) + 1,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const uploaded = pages > 0;
  const pageFields = fields.filter((f) => f.page === activePage);

  // 尚無後端：只取檔名，頁數以 3–5 頁模擬（實作時由後端轉檔後回傳頁數與預覽圖）
  const acceptFile = (file: File | undefined) => {
    if (!file || locked) return;
    const n = 3 + Math.floor(Math.random() * 3);
    setFileName(file.name);
    setPages(n);
    setActivePage(n);
    setFields([]);
    setErrors((e) => ({ ...e, file: undefined }));
  };

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOverFile(false);
    acceptFile(e.dataTransfer.files[0]);
  };

  const handleFieldDrop = (e: DragEvent) => {
    e.preventDefault();
    if (locked || !canvasRef.current) return;
    const { x, y } = toFieldPosition(
      e,
      canvasRef.current.getBoundingClientRect(),
    );
    const moveId = e.dataTransfer.getData('text/reposition-id');
    if (moveId) {
      setFields((prev) =>
        prev.map((f) =>
          f.id === Number(moveId) ? { ...f, page: activePage, x, y } : f,
        ),
      );
      return;
    }
    const type = (e.dataTransfer.getData('text/field-type') ||
      'sign') as UploadField['type'];
    setFields((prev) => [
      ...prev,
      { id: nextFieldId.current++, page: activePage, x, y, type },
    ]);
    setErrors((err) => ({ ...err, fields: undefined }));
  };

  const validate = () => {
    const next: Errors = {};
    if (!name.trim()) next.name = '請輸入文件名稱';
    if (!uploaded) next.file = '請先上傳文件';
    else if (!confirmMode && fields.length === 0) {
      next.fields = '請至少指定一個簽名位置，或改用系統簽署確認頁';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    startTransition(async () => {
      const result = await saveUploadDocument({
        id: form?.id,
        name,
        upload: {
          fileName,
          pages,
          mode: confirmMode ? 'confirmPage' : 'inline',
          fields,
        },
      });
      if (result?.error) setErrors({ submit: result.error });
    });
  };

  const isDraftOrNew = !form || form.status === 'draft';

  return (
    <Stack spacing={3}>
      {locked && (
        <Alert severity="info" variant="outlined">
          此文件已有人簽署或已停止，內容與簽名位置已鎖定，僅能查看。
        </Alert>
      )}
      {errors.submit && <Alert severity="error">{errors.submit}</Alert>}

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <TextField
            fullWidth
            label="文件名稱"
            placeholder="例如：供應商保密協議（NDA）"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name)
                setErrors((err) => ({ ...err, name: undefined }));
            }}
            disabled={locked}
            error={!!errors.name}
            helperText={errors.name}
          />

          <Box>
            <FieldLabel>上傳文件</FieldLabel>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Paper
              variant="outlined"
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              onClick={() => !locked && fileInput.current?.click()}
              onKeyDown={(e) => {
                if (!locked && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!locked) setDragOverFile(true);
              }}
              onDragLeave={() => setDragOverFile(false)}
              onDrop={handleFileDrop}
              sx={{
                p: 6,
                textAlign: 'center',
                borderStyle: 'dashed',
                borderColor: errors.file
                  ? 'error.main'
                  : dragOverFile
                    ? 'primary.main'
                    : 'grey.300',
                bgcolor: dragOverFile ? 'primary.less' : 'background.paper',
                cursor: locked ? 'default' : 'pointer',
              }}
            >
              <Stack spacing={1} sx={{ alignItems: 'center' }}>
                <UploadFileRoundedIcon
                  sx={{ fontSize: 40, color: 'text.secondary' }}
                />
                <Typography variant="subheading" component="div">
                  {uploaded ? fileName : '點擊或拖曳 Word／PDF 文件到這裡上傳'}
                </Typography>
                <Typography variant="helper">
                  {uploaded
                    ? `共 ${pages} 頁・點擊可重新上傳（重新上傳會清除已指定的欄位）`
                    : '原型示範：不會實際上傳檔案，頁數與逐頁預覽為模擬'}
                </Typography>
              </Stack>
            </Paper>
            {errors.file && (
              <Typography
                variant="helper"
                component="div"
                sx={{ color: 'error.dark', mt: 1 }}
              >
                {errors.file}
              </Typography>
            )}
          </Box>

          {uploaded && (
            <>
              <Box>
                <FieldLabel>逐頁預覽（點擊選擇頁面）</FieldLabel>
                <Box
                  sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}
                >
                  {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                    <PageThumb
                      key={p}
                      page={p}
                      active={p === activePage}
                      hasField={
                        !confirmMode && fields.some((f) => f.page === p)
                      }
                      onClick={() => setActivePage(p)}
                    />
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  px: 2,
                  py: 1.5,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                }}
              >
                <Box>
                  <Typography variant="subheading" component="div">
                    原文件版面不便標記，改用系統簽署確認頁
                  </Typography>
                  <Typography variant="helper">
                    適用：掃描文件、不允許改動原版面、找不到合適簽名位置
                  </Typography>
                </Box>
                <Switch
                  checked={confirmMode}
                  disabled={locked}
                  onChange={(e) => {
                    setConfirmMode(e.target.checked);
                    setErrors((err) => ({ ...err, fields: undefined }));
                  }}
                  slotProps={{ input: { 'aria-label': '改用系統簽署確認頁' } }}
                />
              </Box>

              {confirmMode ? (
                <Box>
                  <FieldLabel>
                    系統將自動產生「簽署確認頁」（公版
                    A4），附加於原文件最後一頁
                  </FieldLabel>
                  <ConfirmPagePreview
                    name={name}
                    docNumber={form?.docNumber ?? null}
                    pages={pages}
                  />
                </Box>
              ) : (
                <Box>
                  <FieldLabel>將欄位拖曳到頁面上你要的位置</FieldLabel>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <FieldSource type="sign" disabled={locked} />
                    <FieldSource type="date" disabled={locked} />
                  </Box>

                  <Box
                    ref={canvasRef}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFieldDrop}
                    sx={{
                      position: 'relative',
                      width: '100%',
                      maxWidth: 460,
                      aspectRatio: '210 / 297',
                      mx: 'auto',
                      px: 3,
                      py: 4,
                      overflow: 'hidden',
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: errors.fields ? 'error.main' : 'grey.300',
                      borderRadius: 1,
                      boxShadow: 2,
                    }}
                  >
                    <Typography variant="label" component="div" sx={{ mb: 2 }}>
                      第 {activePage} 頁
                    </Typography>
                    {[40, 80, 60, 80, 40, 80, 60].map((w, i) => (
                      <Box
                        key={i}
                        sx={{
                          height: 7,
                          width: `${w}%`,
                          mb: 1,
                          bgcolor: 'grey.100',
                          borderRadius: 1,
                        }}
                      />
                    ))}
                    {activePage === pages && (
                      <Stack spacing={1.5} sx={{ mt: 3 }}>
                        {['甲方', '乙方', '日期'].map((t) => (
                          <Typography key={t} variant="helper">
                            {t}：＿＿＿＿＿＿＿＿
                          </Typography>
                        ))}
                      </Stack>
                    )}

                    {pageFields.map((f) => (
                      <Box
                        key={f.id}
                        draggable={!locked}
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            'text/reposition-id',
                            String(f.id),
                          )
                        }
                        sx={{
                          position: 'absolute',
                          left: `${f.x}%`,
                          top: `${f.y}%`,
                          width: FIELD_W,
                          height: FIELD_H,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 0.5,
                          border: 1.5,
                          borderStyle: 'dashed',
                          borderColor: 'primary.main',
                          borderRadius: 1,
                          bgcolor: 'primary.less',
                          color: 'primary.dark',
                          cursor: locked ? 'default' : 'grab',
                          userSelect: 'none',
                        }}
                      >
                        {FIELD_META[f.type].icon}
                        <Typography variant="helper" sx={{ color: 'inherit' }}>
                          {FIELD_META[f.type].label}
                        </Typography>
                        {!locked && (
                          <Box
                            component="button"
                            type="button"
                            aria-label={`移除${FIELD_META[f.type].label}`}
                            onClick={() =>
                              setFields((prev) =>
                                prev.filter((x) => x.id !== f.id),
                              )
                            }
                            sx={{
                              position: 'absolute',
                              top: -9,
                              right: -9,
                              width: 20,
                              height: 20,
                              p: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '50%',
                              border: 1.5,
                              borderColor: 'common.white',
                              bgcolor: 'error.main',
                              color: 'common.white',
                              cursor: 'pointer',
                            }}
                          >
                            <CloseRoundedIcon sx={{ fontSize: 14 }} />
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>

                  <Typography
                    variant="helper"
                    component="div"
                    sx={{
                      textAlign: 'center',
                      mt: 1.5,
                      ...(errors.fields && { color: 'error.dark' }),
                    }}
                  >
                    {errors.fields ??
                      (fields.length
                        ? `已指定 ${fields.length} 個欄位位置（本頁 ${pageFields.length} 個，可再拖曳微調或點 × 移除）`
                        : '尚未指定簽名位置，請從上方拖曳欄位到頁面上')}
                  </Typography>

                  <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                    <AlertTitle>關於大量簽署時的畫面空間</AlertTitle>
                    這裡拖曳定位的是「這份文件範本」的欄位座標（第幾頁、x%、y%），只需設定一次。
                    之後不論是 5 人或 500
                    人簽署，系統都會用同一組座標，在每個人自己的那份文件副本上疊上各自的簽名——
                    不會因為簽署人數變多而需要更多畫面空間，也不需要逐一標記。
                  </Alert>
                </Box>
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          size="large"
          variant="outlined"
          href="/forms"
          disabled={pending}
        >
          {locked ? '返回列表' : '取消'}
        </Button>
        {!locked && (
          <Button
            size="large"
            variant="contained"
            onClick={submit}
            loading={pending}
          >
            {isDraftOrNew ? '下一步，設定簽署' : '儲存變更'}
          </Button>
        )}
      </Box>
    </Stack>
  );
}
