import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import TooltipIconButton from '@/components/TooltipIconButton';
import {
  FORM_STATUS_META,
  deriveStatus,
  formatRange,
  signedCount,
} from './status';
import type { EFormDoc } from './types';

// 操作按鈕依狀態顯示／停用，規則沿用 req_doc/forms-admin.html
function RowActions({ form }: { form: EFormDoc }) {
  const status = deriveStatus(form);
  const signed = signedCount(form);
  const total = form.signers.length;

  if (status === 'draft') {
    return (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {total === 0 ? (
          <TooltipIconButton
            label="繼續編輯"
            icon={<EditNoteRoundedIcon />}
            color="primary"
          />
        ) : (
          <>
            <TooltipIconButton
              label="發起簽署"
              icon={<SendRoundedIcon />}
              color="primary"
            />
            <TooltipIconButton label="編輯" icon={<EditRoundedIcon />} />
          </>
        )}
        <TooltipIconButton label="刪除" icon={<DeleteOutlineRoundedIcon />} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <TooltipIconButton label="檢視" icon={<VisibilityRoundedIcon />} />
      {status === 'active' && total - signed > 0 && (
        <TooltipIconButton label="通知" icon={<NotificationsActiveRoundedIcon />} />
      )}
      <TooltipIconButton
        label="編輯"
        icon={<EditRoundedIcon />}
        disabled={signed !== 0 || status === 'stopped'}
      />
      <TooltipIconButton
        label="停止簽署"
        icon={<StopCircleRoundedIcon />}
        color="error"
        disabled={status === 'stopped' || status === 'completed'}
      />
      <TooltipIconButton
        label="刪除"
        icon={<DeleteOutlineRoundedIcon />}
        disabled={signed !== 0}
      />
    </Box>
  );
}

export default function FormsTable({ forms }: { forms: EFormDoc[] }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>文件名稱</TableCell>
            <TableCell>起迄時間</TableCell>
            <TableCell>文件狀態</TableCell>
            <TableCell>簽署人狀態</TableCell>
            <TableCell>建立人</TableCell>
            <TableCell>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {forms.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                <Typography variant="description">
                  尚無電子簽文件，點擊右上角「新增電子簽文件」建立第一份文件。
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            forms.map((form) => {
              const status = FORM_STATUS_META[deriveStatus(form)];
              const signed = signedCount(form);
              const total = form.signers.length;
              return (
                <TableRow key={form.id} hover>
                  <TableCell>
                    <Typography variant="content">{form.name}</Typography>
                    {form.docNumber && (
                      <Typography variant="helper">{form.docNumber}</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatRange(form.startAt, form.endAt)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="soft"
                      label={status.label}
                      color={status.color}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={total ? (signed / total) * 100 : 0}
                        sx={{ flex: 1 }}
                      />
                      <Typography
                        variant="helper"
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {signed}/{total}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="content">
                      {form.createdBy.name}
                    </Typography>
                    <Typography variant="helper">
                      {form.createdBy.employeeNo}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <RowActions form={form} />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
