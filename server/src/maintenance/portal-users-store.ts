import { PortalImportError } from './portal-users-source';
import { constants } from 'node:fs';
import { mkdir, open, realpath, stat, access } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** source workspace 與只含 dist 的部署容器都能辨識程式目錄。 */
export async function findCodeRoot(start = __dirname): Promise<string> {
  let directory = await realpath(start);
  let packageRoot: string | undefined;
  while (true) {
    for (const marker of ['pnpm-workspace.yaml', '.git']) {
      try {
        await access(resolve(directory, marker));
        return directory;
      } catch {
        /* 繼續尋找 workspace */
      }
    }
    if (!packageRoot) {
      try {
        await access(resolve(directory, 'package.json'));
        packageRoot = directory;
      } catch {
        /* 非 package 目錄 */
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (!packageRoot) throw new PortalImportError('無法辨識程式根目錄');
  return packageRoot;
}

/** 維護檔案只能放在 repository 外的私人目錄。 */
export async function privatePath(
  path: string,
  writing = false,
): Promise<string> {
  const absolute = resolve(path);
  const repository = await findCodeRoot();
  if (absolute === repository || absolute.startsWith(repository + sep))
    throw new PortalImportError('維護檔案不得存放於 repository');
  if (writing) await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(absolute));
  if (parent === repository || parent.startsWith(repository + sep))
    throw new PortalImportError('維護檔案不得經連結存放於 repository');
  if ((await stat(parent)).mode & 0o077)
    throw new PortalImportError('維護目錄權限必須為 0700');
  return resolve(parent, absolute.slice(absolute.lastIndexOf(sep) + 1));
}
export async function writePrivate(
  path: string,
  value: unknown,
): Promise<void> {
  const target = await privatePath(path, true);
  const file = await open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function readPrivate(path: string): Promise<Buffer> {
  const target = await privatePath(path);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.mode & 0o077)
      throw new PortalImportError('維護檔案權限必須為 0600');
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function readSource(path: string): Promise<Buffer> {
  // 原始來源同樣避免被符號連結導回 repository 或公開檔案。
  return readPrivate(path);
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readPrivate(path)).toString('utf8')) as unknown;
}
