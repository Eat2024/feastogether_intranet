'use client';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import type { Signer } from './types';

type SignerRowProps = {
  signer: Signer;
  /** 姓名左側（例：勾選框） */
  left?: ReactNode;
  right: ReactNode;
};

/** 簽署人一列：姓名＋員工編號（或 Email），左右兩側內容由各 dialog 決定 */
export function SignerRow({ signer, left, right }: SignerRowProps) {
  return (
    <ListItem divider sx={{ gap: 1.5, py: 1 }}>
      {left}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="content" component="span">
          {signer.name}
        </Typography>{' '}
        <Typography variant="helper">{signer.email ?? signer.employeeNo}</Typography>
      </Box>
      {right}
    </ListItem>
  );
}

/** 有框線、圓角 8px 的簽署人列表容器 */
export function SignerList({ children }: { children: ReactNode }) {
  return (
    <List
      disablePadding
      sx={{
        border: 1,
        borderColor: 'formBorder',
        borderRadius: 2,
        overflow: 'hidden',
        '& > li:last-of-type': { borderBottom: 0 },
      }}
    >
      {children}
    </List>
  );
}
