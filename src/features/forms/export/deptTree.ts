// 匯出用的「簽署人部門樹」（僅供伺服器端使用）：只保留這份文件簽署人所屬的部門與其上層，人數為該文件簽署人數
import { MOCK_EMPLOYEES } from '../mock';
import { expandDeptIds, getDeptIdOf, getOrgTree } from '../orgChart';
import type { EFormDoc, OrgDept, Signer } from '../types';

/** 部門樹節點；id 為組織架構部門 id，或以 g: 開頭的分組（未列入組織架構、以 Email 加入） */
export type DeptNode = { id: string; name: string; count: number; children: DeptNode[] };

const EMAIL_GROUP = 'g:email';
const OTHER_ROOT = 'g:other';
const otherDeptGroup = (name: string) => `g:dept:${name}`;

/** 簽署人歸屬的部門鍵 */
export function signerDeptKey(s: Signer): string {
  const orgDept = getDeptIdOf(s.id);
  if (orgDept) return orgDept;
  if (s.email) return EMAIL_GROUP;
  const mockDept = MOCK_EMPLOYEES.find((e) => e.id === s.id)?.dept;
  return otherDeptGroup(mockDept ?? '未分類');
}

export function buildSignerDeptTree(form: EFormDoc): DeptNode[] {
  const direct = new Map<string, number>();
  for (const s of form.signers) {
    const key = signerDeptKey(s);
    direct.set(key, (direct.get(key) ?? 0) + 1);
  }

  const convert = (d: OrgDept): DeptNode | null => {
    const children = d.children.map(convert).filter((c): c is DeptNode => c !== null);
    const count = (direct.get(d.id) ?? 0) + children.reduce((sum, c) => sum + c.count, 0);
    return count ? { id: d.id, name: d.name, count, children } : null;
  };
  const tree = getOrgTree().map(convert).filter((d): d is DeptNode => d !== null);

  const others = [...direct.entries()]
    .filter(([key]) => key.startsWith('g:dept:'))
    .map(([key, count]) => ({ id: key, name: key.slice('g:dept:'.length), count, children: [] }));
  if (others.length) {
    tree.push({ id: OTHER_ROOT, name: '未列入組織架構', count: others.reduce((n, o) => n + o.count, 0), children: others });
  }
  const emails = direct.get(EMAIL_GROUP);
  if (emails) tree.push({ id: EMAIL_GROUP, name: '以 Email 加入', count: emails, children: [] });
  return tree;
}

/** 網址上的部門（最上層勾選）展開為所有涵蓋的部門鍵；未勾選回傳 null（全部部門） */
export function selectedDeptKeys(ids: string[]): Set<string> | null {
  if (ids.length === 0) return null;
  const keys = expandDeptIds(ids.filter((id) => !id.startsWith('g:')));
  for (const id of ids) {
    if (id === OTHER_ROOT) MOCK_EMPLOYEES.forEach((e) => keys.add(otherDeptGroup(e.dept)));
    else if (id.startsWith('g:')) keys.add(id);
  }
  // 「未列入組織架構」也涵蓋查無部門者
  if (ids.includes(OTHER_ROOT)) keys.add(otherDeptGroup('未分類'));
  return keys;
}

/** 已勾選部門的名稱（文件資訊工作表用） */
export function selectedDeptNames(ids: string[], tree: DeptNode[]): string[] {
  const names = new Map<string, string>();
  const walk = (n: DeptNode) => {
    names.set(n.id, n.name);
    n.children.forEach(walk);
  };
  tree.forEach(walk);
  return ids.map((id) => names.get(id) ?? id);
}
