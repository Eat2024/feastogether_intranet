'use client';

import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Link from 'next/link';
import { MY_SIGN_TABS, type MySignTab } from './tasks';

/** 分頁以網址 ?tab= 記錄，重新整理或上一頁都會停在同一分頁 */
export default function MySignTabs({
  value,
  counts,
}: {
  value: MySignTab;
  counts: Record<MySignTab, number>;
}) {
  return (
    <Tabs value={value} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      {MY_SIGN_TABS.map((tab) => (
        <Tab
          key={tab.key}
          value={tab.key}
          label={`${tab.label}（${counts[tab.key]}）`}
          component={Link}
          href={`?tab=${tab.key}`}
          scroll={false}
        />
      ))}
    </Tabs>
  );
}
