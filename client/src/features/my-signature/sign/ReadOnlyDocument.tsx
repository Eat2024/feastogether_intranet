'use client';

import { getSignLayout } from '@/features/forms/signLayout';
import type { EFormDoc, Signer } from '@/features/forms/types';
import Paper from '@mui/material/Paper';
import { useState } from 'react';
import DocumentViewer from './DocumentViewer';

/** 無法簽署時的唯讀預覽；已簽署時顯示本人的簽名與簽署日期 */
export default function ReadOnlyDocument({ form, me }: { form: EFormDoc; me: Signer }) {
  const layout = getSignLayout(form);
  const [activePage, setActivePage] = useState(1);
  if (!layout) return null;

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <DocumentViewer
        form={form}
        signer={me}
        layout={layout}
        signatures={me.signatures ?? {}}
        signatureIds={me.signatureIds ?? {}}
        dateText={me.status === 'signed' ? (me.signedAt ?? '').slice(0, 10) : '—'}
        activePage={activePage}
        onPageChange={setActivePage}
      />
    </Paper>
  );
}
