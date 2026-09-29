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
import {
  FORM_STATUS_META,
  deriveStatus,
  formatRange,
  signedCount,
} from './status';
import RowActions from './RowActions';
import type { EFormDoc } from './types';

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
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                      }}
                    >
                      <LinearProgress
                        variant="determinate"
                        value={total ? (signed / total) * 100 : 0}
                      />
                      <Typography variant="helper">
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
