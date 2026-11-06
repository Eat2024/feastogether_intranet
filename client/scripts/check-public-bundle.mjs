// 檢查 next build 的公開靜態檔（.next/static）不含隱藏維護登入的痕跡（使用者 2026-11-06 要求）。
// 只有隱藏頁自己的 chunk 可以含：以 .next/server/app/**/page_client-reference-manifest.js 判斷，
// 只出現在隱藏頁 manifest、沒有其他頁面引用的 chunk 才排除；其餘檔案（含 _buildManifest、_clientMiddlewareManifest）全部掃描。
// 用法：pnpm build 後執行 pnpm check:bundle。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEXT_DIR = new URL('../.next/', import.meta.url).pathname;
const HIDDEN_MANIFEST = 'ops-access-page/[entryKey]/page_client-reference-manifest.js';
const FORBIDDEN = /super-user|super_user|SuperUser|AUTH_SUPER_USER|ops-access/g;

const chunksIn = (manifest) =>
  new Set(readFileSync(join(NEXT_DIR, 'server/app', manifest), 'utf8').match(/static\/chunks\/[\w.-]+/g));

const manifests = readdirSync(join(NEXT_DIR, 'server/app'), { recursive: true }).filter((file) =>
  file.endsWith('page_client-reference-manifest.js'),
);
const shared = new Set(manifests.filter((m) => m !== HIDDEN_MANIFEST).flatMap((m) => [...chunksIn(m)]));
const hiddenOnly = [...chunksIn(HIDDEN_MANIFEST)].filter((chunk) => !shared.has(chunk));

// 確認排除的確實是隱藏頁的程式碼，避免 chunk 命名或 manifest 格式改變後變成什麼都沒掃到
if (!hiddenOnly.some((chunk) => readFileSync(join(NEXT_DIR, chunk), 'utf8').includes('super-user-entries'))) {
  throw new Error('找不到隱藏頁專用的 chunk，請確認頁面位置與 build 產物');
}

const leaks = readdirSync(join(NEXT_DIR, 'static'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name).slice(NEXT_DIR.length))
  .filter((file) => !hiddenOnly.includes(file))
  .flatMap((file) => {
    const found = readFileSync(join(NEXT_DIR, file), 'utf8').match(FORBIDDEN);
    return found ? [`${file}: ${[...new Set(found)].join(', ')}`] : [];
  });

if (leaks.length > 0) {
  console.error(`公開靜態檔含隱藏維護登入的痕跡：\n${leaks.join('\n')}`);
  process.exit(1);
}
console.log(`公開靜態檔未含隱藏維護登入的痕跡（已排除隱藏頁專用 chunk ${hiddenOnly.length} 個）`);
