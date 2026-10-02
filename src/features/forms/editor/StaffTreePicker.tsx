'use client';

import SearchInput from '@/components/SearchInput';
import CorporateFareRoundedIcon from '@mui/icons-material/CorporateFareRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTreeItemModel } from '@mui/x-tree-view/hooks';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { TreeItem, type TreeItemProps } from '@mui/x-tree-view/TreeItem';
import { forwardRef, useDeferredValue, useMemo, useState } from 'react';
import { SignerAvatar } from '../SignerList';
import type { OrgDept } from '../types';

// 已選人員標籤最多顯示幾位，其餘以「還有 N 位」表示
const MAX_CHIPS = 40;

type DeptItem = { id: string; kind: 'dept'; label: string; total: number; children: TreeNode[] };
type EmpItem = { id: string; kind: 'emp'; label: string; employeeNo: string; title: string; deptName: string };
type TreeNode = DeptItem | EmpItem;

const deptKey = (id: string) => `d:${id}`;
const empKey = (id: string) => `e:${id}`;
const isEmpKey = (key: string) => key.startsWith('e:');
const empIdOf = (key: string) => key.slice(2);

/** 部門樹轉成樹狀元件的項目；有搜尋字時只保留符合的員工（部門名稱符合則保留整個部門） */
function buildItems(depts: OrgDept[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  const convert = (d: OrgDept, keepAll: boolean): DeptItem | null => {
    const deptMatch = keepAll || (!!q && d.name.toLowerCase().includes(q));
    const children = d.children.map((c) => convert(c, deptMatch)).filter((c): c is DeptItem => c !== null);
    const employees: EmpItem[] = d.employees
      .filter((e) => !q || deptMatch || e.name.toLowerCase().includes(q) || (e.employeeNo ?? e.id).toLowerCase().includes(q))
      .map((e) => ({
        id: empKey(e.id),
        kind: 'emp',
        label: e.name,
        employeeNo: e.employeeNo ?? e.id,
        title: e.title,
        deptName: d.name,
      }));
    const total = employees.length + children.reduce((sum, c) => sum + c.total, 0);
    if (q && total === 0) return null;
    // 員工排在子部門前面
    return { id: deptKey(d.id), kind: 'dept', label: d.name, total, children: [...employees, ...children] };
  };
  return depts.map((d) => convert(d, !q)).filter((d): d is DeptItem => d !== null);
}

function collect(items: TreeNode[], out: { emps: EmpItem[]; deptIds: string[] }) {
  for (const item of items) {
    if (item.kind === 'emp') out.emps.push(item);
    else {
      out.deptIds.push(item.id);
      collect(item.children, out);
    }
  }
  return out;
}

/** 部門底下（含子部門）所有可見員工的 id */
function empKeysUnder(item: DeptItem, out: string[] = []) {
  for (const c of item.children) {
    if (c.kind === 'emp') out.push(c.id);
    else empKeysUnder(c, out);
  }
  return out;
}

const OrgTreeItem = forwardRef<HTMLLIElement, TreeItemProps>(function OrgTreeItem(props, ref) {
  const item = useTreeItemModel<TreeNode>(props.itemId);
  const label =
    item?.kind === 'emp' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, minWidth: 0 }}>
        <SignerAvatar name={item.label} />
        <Typography variant="content" component="span" noWrap>
          {item.label}
        </Typography>
        <Typography variant="helper" noWrap>
          {item.employeeNo}
        </Typography>
        <Typography variant="helper" noWrap sx={{ ml: 'auto', pl: 1 }}>
          {item.title}
        </Typography>
      </Box>
    ) : item?.kind === 'dept' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, minWidth: 0 }}>
        <CorporateFareRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="label" component="span" noWrap sx={{ color: 'text.primary' }}>
          {item.label}
        </Typography>
        <Typography variant="helper">（{item.total}）</Typography>
      </Box>
    ) : (
      props.label
    );
  return <TreeItem {...props} ref={ref} label={label} />;
});

/** 依部門階層選擇需簽署的同仁；勾選部門即選取其下（含子部門）所有同仁 */
export default function StaffTreePicker({
  org,
  selected,
  onChange,
  error,
}: {
  org: OrgDept[];
  /** 已選員工 id */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  error?: boolean;
}) {
  const [query, setQuery] = useState('');
  // 輸入時先更新輸入框，樹的篩選延後計算，避免打字卡頓
  const deferredQuery = useDeferredValue(query);
  const items = useMemo(() => buildItems(org, deferredQuery), [org, deferredQuery]);
  const { emps: visibleEmps, deptIds } = useMemo(() => collect(items, { emps: [], deptIds: [] }), [items]);
  const empById = useMemo(() => {
    const map = new Map<string, EmpItem>();
    collect(buildItems(org, ''), { emps: [], deptIds: [] }).emps.forEach((e) => map.set(empIdOf(e.id), e));
    return map;
  }, [org]);

  const searching = !!deferredQuery.trim();
  // 一般瀏覽時使用者自己的展開狀態；清除搜尋後會回到這裡
  const [expanded, setExpanded] = useState<string[]>([]);
  // 搜尋時的展開狀態：搜尋字改變時重設為「全部展開」，之後仍可自由收合／展開
  const [searchExpanded, setSearchExpanded] = useState<{ query: string; ids: string[] }>({
    query: '',
    ids: [],
  });
  if (searching && searchExpanded.query !== deferredQuery) {
    setSearchExpanded({ query: deferredQuery, ids: deptIds });
  }
  const expandedItems = searching ? searchExpanded.ids : expanded;

  // 樹的選取狀態由「已選員工」推導：部門底下可見員工全選時，部門顯示為已勾選
  const selectedItems = useMemo(() => {
    const keys = visibleEmps.filter((e) => selected.has(empIdOf(e.id))).map((e) => e.id);
    const walk = (list: TreeNode[]) => {
      for (const item of list) {
        if (item.kind !== 'dept') continue;
        const under = empKeysUnder(item);
        if (under.length > 0 && under.every((k) => selected.has(empIdOf(k)))) keys.push(item.id);
        walk(item.children);
      }
    };
    walk(items);
    return keys;
  }, [items, visibleEmps, selected]);

  const handleSelect = (_: unknown, keys: string[]) => {
    // 只更新目前可見（搜尋結果）的員工，其餘已選的人保留
    const visible = new Set(visibleEmps.map((e) => empIdOf(e.id)));
    const next = new Set([...selected].filter((id) => !visible.has(id)));
    keys.filter(isEmpKey).forEach((k) => next.add(empIdOf(k)));
    onChange(next);
  };

  const selectedList = [...selected].map((id) => empById.get(id)).filter((e): e is EmpItem => !!e);

  return (
    <Stack spacing={1.5}>
      <SearchInput fullWidth value={query} onChange={setQuery} placeholder="搜尋姓名、員工編號或部門" />

      <Box
        sx={{
          border: 1,
          borderColor: error ? 'error.main' : 'formBorder',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 1,
            bgcolor: 'formBorder',
          }}
        >
          <Typography variant="label" component="span">
            {searching ? `搜尋結果 ${visibleEmps.length} 人` : '勾選部門可一次選取其下所有同仁'}
          </Typography>
          <Typography variant="secondary" component="span">
            已選 {selected.size} 人
          </Typography>
        </Box>
        <Box sx={{ maxHeight: 420, overflowY: 'auto', py: 0.5 }}>
          {items.length === 0 ? (
            <Typography variant="description" component="div" sx={{ py: 3, textAlign: 'center' }}>
              找不到符合的同仁或部門。
            </Typography>
          ) : (
            <RichTreeView
              items={items}
              getItemLabel={(item) => item.label}
              getItemChildren={(item) => (item.kind === 'dept' ? item.children : undefined)}
              slots={{ item: OrgTreeItem }}
              multiSelect
              checkboxSelection
              selectionPropagation={{ descendants: true, parents: true }}
              selectedItems={selectedItems}
              onSelectedItemsChange={handleSelect}
              expandedItems={expandedItems}
              onExpandedItemsChange={(_, ids) => {
                if (searching) setSearchExpanded({ query: deferredQuery, ids });
                else setExpanded(ids);
              }}
              // 點擊文字只展開／收合，勾選請點核取方塊
              expansionTrigger="iconContainer"
            />
          )}
        </Box>
      </Box>

      {selectedList.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="label" component="span">
              已選擇的同仁
            </Typography>
            <Button size="small" onClick={() => onChange(new Set())}>
              清除全部
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {selectedList.slice(0, MAX_CHIPS).map((e) => {
              const id = empIdOf(e.id);
              return (
                <Chip
                  key={id}
                  size="small"
                  variant="outlined"
                  label={`${e.label} ${e.employeeNo}`}
                  title={`${e.deptName}・${e.title}`}
                  onDelete={() => {
                    const next = new Set(selected);
                    next.delete(id);
                    onChange(next);
                  }}
                />
              );
            })}
            {selectedList.length > MAX_CHIPS && (
              <Chip size="small" variant="soft" label={`還有 ${selectedList.length - MAX_CHIPS} 位`} />
            )}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
