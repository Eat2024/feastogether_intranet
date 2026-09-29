'use client';

import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, useTransition } from 'react';
import { saveSigners } from '../actions';
import { SignerAvatar } from '../SignerList';
import type { EFormDoc, StaffMember } from '../types';
import DeadlineRangePicker from './DeadlineRangePicker';

/** 設定簽署人員與簽署期間（流程第二步） */
export default function SignersEditor({
  form,
  employees,
}: {
  form: EFormDoc;
  employees: StaffMember[];
}) {
  const [selected, setSelected] = useState(
    () => new Set(form.signers.map((s) => s.id)),
  );
  const [query, setQuery] = useState('');
  const [deadline, setDeadline] = useState<{
    start: string | null;
    end: string | null;
  }>({
    start: null,
    end: null,
  });
  const [error, setError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<'save' | 'publish' | null>(
    null,
  );
  const [, startTransition] = useTransition();

  const q = query.trim();
  // 可用姓名或員工編號搜尋
  const list = employees.filter(
    (e) => !q || e.name.includes(q) || e.employeeNo.includes(q),
  );
  const listSelectedCount = list.filter((e) => selected.has(e.id)).length;
  const allListSelected = list.length > 0 && listSelectedCount === list.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(undefined);
  };

  // 全選只作用於目前搜尋結果
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      list.forEach((e) =>
        allListSelected ? next.delete(e.id) : next.add(e.id),
      );
      return next;
    });
    setError(undefined);
  };

  const submit = (publish: boolean) => {
    if (selected.size === 0) {
      setError('請至少選擇一位需簽署人員');
      return;
    }
    setPendingAction(publish ? 'publish' : 'save');
    startTransition(async () => {
      const result = await saveSigners({
        id: form.id,
        signerIds: [...selected],
        deadline,
        publish,
      });
      if (result?.error) {
        setError(result.error);
        setPendingAction(null);
      }
    });
  };

  const busy = pendingAction !== null;

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="label" component="div" sx={{ mb: 1 }}>
              需簽署人員
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="搜尋員工姓名或員工編號"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ mb: 2 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <List
              disablePadding
              sx={{
                border: 1,
                borderColor: error ? 'error.main' : 'formBorder',
                borderRadius: 2,
                maxHeight: 360,
                overflowY: 'auto',
                '& > li:last-of-type': { borderBottom: 0 },
              }}
            >
              {/* 表頭列：全選目前搜尋結果＋已選人數 */}
              <ListItem
                divider
                sx={{
                  gap: 1.5,
                  py: 0.5,
                  bgcolor: 'formBorder',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                <Checkbox
                  size="small"
                  checked={allListSelected}
                  indeterminate={listSelectedCount > 0 && !allListSelected}
                  disabled={list.length === 0}
                  onChange={toggleAll}
                  slotProps={{ input: { 'aria-label': '全選目前列表' } }}
                />
                <Typography variant="label" sx={{ flex: 1 }}>
                  全選
                </Typography>
                <Typography variant="secondary" component="span">
                  已選 {selected.size} 人
                </Typography>
              </ListItem>
              {list.length === 0 ? (
                <ListItem sx={{ py: 3, justifyContent: 'center' }}>
                  <Typography variant="description">
                    找不到符合的員工。
                  </Typography>
                </ListItem>
              ) : (
                list.map((emp) => (
                  <ListItem key={emp.id} divider disablePadding>
                    <ListItemButton
                      onClick={() => toggle(emp.id)}
                      sx={{ gap: 1.5, py: 1 }}
                    >
                      <Checkbox
                        size="small"
                        checked={selected.has(emp.id)}
                        tabIndex={-1}
                        disableRipple
                        slotProps={{
                          input: { 'aria-label': `選擇 ${emp.name}` },
                        }}
                      />
                      <SignerAvatar name={emp.name} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="content" component="span">
                          {emp.name}
                        </Typography>{' '}
                        <Typography variant="helper">
                          {emp.employeeNo}
                        </Typography>
                      </Box>
                      <Typography variant="helper">{emp.dept}</Typography>
                    </ListItemButton>
                  </ListItem>
                ))
              )}
            </List>
            {error && (
              <Typography
                variant="helper"
                component="div"
                sx={{ color: 'error.dark', mt: 1 }}
              >
                {error}
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant="label" component="div" sx={{ mb: 1 }}>
              簽署期間（選填）
            </Typography>
            <DeadlineRangePicker
              start={deadline.start}
              end={deadline.end}
              onChange={setDeadline}
            />
            <Typography variant="helper" component="div" sx={{ mt: 1 }}>
              {deadline.start || deadline.end
                ? `已選擇：${deadline.start ?? '今天開始'} ～ ${deadline.end ?? '不限結束'}`
                : '留空表示從發起當天開始、不設結束日，簽署人可隨時完成簽署。'}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {error && error !== '請至少選擇一位需簽署人員' && (
        <Alert severity="error">{error}</Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="large"
          variant="outlined"
          href={`/forms/${form.id}/edit`}
          disabled={busy}
        >
          上一步，回到上傳文件
        </Button>
        <Button
          size="large"
          variant="outlined"
          onClick={() => submit(false)}
          loading={pendingAction === 'save'}
          disabled={busy}
        >
          儲存設定（暫不發起）
        </Button>
        {/* 取消與主要動作靠右，主鈕在最右 */}
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button size="large" variant="outlined" href="/forms" disabled={busy}>
            取消
          </Button>
          <Button
            size="large"
            variant="contained"
            onClick={() => submit(true)}
            loading={pendingAction === 'publish'}
            disabled={busy}
          >
            發起簽署，通知所有簽署人
          </Button>
        </Box>
      </Box>
    </Stack>
  );
}
