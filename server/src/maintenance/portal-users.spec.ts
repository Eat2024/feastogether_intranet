import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  chmod,
  symlink,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findCodeRoot,
  privatePath,
  readPrivate,
  writePrivate,
} from './portal-users-store';
import {
  parsePortalUsers,
  PORTAL_HEADER,
  validateAcquiredAt,
} from './portal-users-source';

const hex = (value: string | null) =>
  value === null ? 'NULL' : Buffer.from(value).toString('hex');
const row = (
  id = '00000001',
  name = '合成人員',
  email: string | null = ' A@EXAMPLE.TEST ',
  status = '1',
) =>
  [
    hex(id),
    hex(name),
    hex('D01'),
    hex('合成部門'),
    hex(email),
    status,
    hex('職稱'),
  ].join('\t');
const source = (...rows: string[]) =>
  Buffer.from([PORTAL_HEADER, ...rows, ''].join('\n'));

describe('Portal 匯入來源驗證', () => {
  it('還原 UTF-8、前導零、狀態與正規化 email，相同重複列合併', () => {
    const result = parsePortalUsers(
      source(row(), row(), row('00000002', '第二位', null, '0')),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.duplicateRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      empid: '00000001',
      name: '合成人員',
      email: 'a@example.test',
      personStatus: '正式',
    });
    expect(result.rows[1]).toMatchObject({ email: null, personStatus: '試用' });
  });
  it.each([
    Buffer.from(''),
    source('bad'),
    source(row().replace('3030303030303031', 'zz')),
    source(row().replace(hex('合成人員'), 'ff')),
    source(row('', '姓名')),
    source(row('00000001', '')),
    source(row('00000001', '姓名', 'bad')),
    source(row('00000001', '字'.repeat(101))),
    source(row('00000001'), row('00000001', '不同姓名')),
    source(row('00Ab1234'), row('00ab1234')),
  ])('不合法來源整批拒絕 %#', (input) => {
    expect(() => parsePortalUsers(input)).toThrow();
  });
  it('同員編合格及不合格狀態衝突整批拒絕，不因略過順序放行', () => {
    expect(() =>
      parsePortalUsers(
        source(row(), row('00000001', '合成人員', ' A@EXAMPLE.TEST ', '2')),
      ),
    ).toThrow('衝突');
    expect(() =>
      parsePortalUsers(
        source(row('00000001', '合成人員', ' A@EXAMPLE.TEST ', '2'), row()),
      ),
    ).toThrow('衝突');
  });
  it('不合格來源及有理由排除名單只分類，不建立帳號', () => {
    const parsed = parsePortalUsers(
      source(row('00000001', '', '', '1'), row('00000002', '人員', null, '2')),
      [{ employeeNo: '00000001', reason: '來源確認缺姓名' }],
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.excludedRows).toBe(1);
    expect(parsed.ineligibleRows).toBe(1);
    expect(() =>
      parsePortalUsers(source(row()), [{ employeeNo: '00000001', reason: '' }]),
    ).toThrow();
  });
});

describe('私人批次檔案', () => {
  it('compiled 容器從 package.json 找根目錄，不把 / 當 repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portal-code-'));
    try {
      const code = join(directory, 'app');
      await mkdir(join(code, 'dist', 'maintenance'), { recursive: true });
      await writeFile(join(code, 'package.json'), '{}');
      expect(await findCodeRoot(join(code, 'dist', 'maintenance'))).toBe(
        await realpath(code),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('拒絕 repo、公開目錄／檔案、symbolic link 與覆寫既有artifact', async () => {
    await expect(
      privatePath(join(__dirname, 'private.json'), true),
    ).rejects.toThrow('repository');
    const directory = await mkdtemp(join(tmpdir(), 'portal-private-'));
    try {
      const file = join(directory, 'artifact.json');
      await writePrivate(file, { synthetic: true });
      await expect(writePrivate(file, {})).rejects.toThrow();
      const link = join(directory, 'link.json');
      await symlink(file, link);
      await expect(readPrivate(link)).rejects.toThrow();
      await chmod(file, 0o644);
      await expect(readPrivate(file)).rejects.toThrow('0600');
      await chmod(directory, 0o755);
      await expect(readPrivate(file)).rejects.toThrow('0700');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('來源取得時間必須明確且有效，不接受未來日期或猜測時間', () => {
  expect(validateAcquiredAt('2026-01-01T08:00:00+08:00')).toBe(
    '2026-01-01T00:00:00.000Z',
  );
  for (const value of [
    '',
    '2026-01-01',
    '2026-02-31T00:00:00Z',
    '9999-01-01T00:00:00Z',
  ])
    expect(() => validateAcquiredAt(value)).toThrow();
});
