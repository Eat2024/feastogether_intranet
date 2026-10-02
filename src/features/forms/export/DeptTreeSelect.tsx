'use client';

import SearchInput from '@/components/SearchInput';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { useDeferredValue, useMemo, useState } from 'react';
import type { DeptNode } from './deptTree';

type Item = { id: string; label: string; children: Item[] };

const toItems = (nodes: DeptNode[]): Item[] =>
  nodes.map((n) => ({ id: n.id, label: `${n.name}（${n.count}）`, children: toItems(n.children) }));

/** 依部門名稱篩選：名稱符合的部門保留整個下層；上層部門只為顯示路徑而保留 */
function filterItems(nodes: DeptNode[], q: string): Item[] {
  return nodes.flatMap((n): Item[] => {
    if (n.name.toLowerCase().includes(q)) return toItems([n]);
    const children = filterItems(n.children, q);
    return children.length ? [{ id: n.id, label: `${n.name}（${n.count}）`, children }] : [];
  });
}

const collectIds = (items: Item[], out: string[] = []) => {
  for (const it of items) {
    out.push(it.id);
    collectIds(it.children, out);
  }
  return out;
};

/**
 * 部門樹狀多選（與「設定簽署」相同：勾選上層即選取所有下層，部分選取顯示「－」）。
 * value／onChange 只處理「最上層的勾選部門」，避免把所有下層 id 都寫進網址。
 * 搜尋時只會變更目前看得到的部門，被篩掉的部門維持原本的勾選。
 */
export default function DeptTreeSelect({
  tree,
  value,
  onChange,
}: {
  tree: DeptNode[];
  /** 勾選的最上層部門 id；空陣列表示全部部門 */
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { parentOf, descendantsOf } = useMemo(() => {
    const parent = new Map<string, string | null>();
    const desc = new Map<string, string[]>();
    const walk = (n: DeptNode, p: string | null): string[] => {
      parent.set(n.id, p);
      const all = [n.id, ...n.children.flatMap((c) => walk(c, n.id))];
      desc.set(n.id, all);
      return all;
    };
    tree.forEach((n) => walk(n, null));
    return { parentOf: parent, descendantsOf: desc };
  }, [tree]);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();
  const searching = !!q;
  const items = useMemo(() => (q ? filterItems(tree, q) : toItems(tree)), [tree, q]);
  const visibleIds = useMemo(() => collectIds(items), [items]);

  // 最上層勾選 → 完整選取（含所有下層）
  const fullSelected = useMemo(() => new Set(value.flatMap((id) => descendantsOf.get(id) ?? [])), [value, descendantsOf]);
  const selectedItems = useMemo(() => visibleIds.filter((id) => fullSelected.has(id)), [visibleIds, fullSelected]);

  // 一般瀏覽的展開狀態；搜尋字改變時重設為全部展開，之後仍可自由收合
  const [expanded, setExpanded] = useState<string[]>(() => tree.map((n) => n.id));
  const [searchExpanded, setSearchExpanded] = useState<{ query: string; ids: string[] }>({ query: '', ids: [] });
  if (searching && searchExpanded.query !== q) {
    setSearchExpanded({ query: q, ids: visibleIds });
  }

  const handleChange = (_: unknown, ids: string[]) => {
    // 可見部門以樹的結果為準，看不到的部門保留原本勾選
    const visible = new Set(visibleIds);
    const next = new Set([...fullSelected].filter((id) => !visible.has(id)));
    ids.forEach((id) => next.add(id));
    // 由下往上整理：有下層的部門，只有在所有下層都勾選時才算勾選
    // （搜尋時上層只顯示部分下層，不能因為勾了上層就把看不到的下層也選進來）
    const normalize = (n: DeptNode): boolean => {
      if (n.children.length === 0) return next.has(n.id);
      const all = n.children.map(normalize).every(Boolean);
      if (all) next.add(n.id);
      else next.delete(n.id);
      return all;
    };
    tree.forEach(normalize);
    // 只保留「上層沒被選取」的部門（最小涵蓋集合）
    onChange(
      [...next].filter((id) => {
        const p = parentOf.get(id);
        return !p || !next.has(p);
      }),
    );
  };

  return (
    <Stack spacing={1} sx={{ width: '100%', minWidth: 0 }}>
      <SearchInput fullWidth value={query} onChange={setQuery} placeholder="搜尋部門名稱" />
      <Box sx={{ border: 1, borderColor: 'formBorder', borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 0.5,
            minHeight: 40,
            bgcolor: 'formBorder',
          }}
        >
          <Typography variant="label" component="span">
            {value.length ? `已選 ${value.length} 個部門（含下層部門）` : '未勾選表示全部部門'}
          </Typography>
          {value.length > 0 && (
            <Button size="small" onClick={() => onChange([])}>
              清除
            </Button>
          )}
        </Box>
        <Box sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
          {items.length === 0 ? (
            <Typography variant="description" component="div" sx={{ py: 2, textAlign: 'center' }}>
              {searching ? '找不到符合的部門。' : '此文件沒有簽署人。'}
            </Typography>
          ) : (
            <RichTreeView
              items={items}
              multiSelect
              checkboxSelection
              selectionPropagation={{ descendants: true, parents: true }}
              selectedItems={selectedItems}
              onSelectedItemsChange={handleChange}
              expandedItems={searching ? searchExpanded.ids : expanded}
              onExpandedItemsChange={(_, ids) => {
                if (searching) setSearchExpanded({ query: q, ids });
                else setExpanded(ids);
              }}
              expansionTrigger="iconContainer"
            />
          )}
        </Box>
      </Box>
    </Stack>
  );
}
