// hash-super-user-password.ts — 產生 SUPER_USER_PASSWORD_HASH 的離線工具。
// 只用本機 node:crypto：不載入 Nest、不讀 .env、不連 DB／Redis。
// 密碼只從互動式終端機無回顯讀取並二次確認，不讀命令列參數或管線輸入；stdout 只輸出 hash。
//
// CLI：pnpm -C server super-user:hash-password
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import {
  hashSuperUserPassword,
  SUPER_USER_PASSWORD_MAX_BYTES,
} from '#app/features/auth/helpers/super-user-password';

async function main(): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error('請在互動式終端機執行；不接受管線或檔案輸入密碼。');
    return 1;
  }
  // 輸出丟棄：readline 照常處理編輯鍵但不回顯輸入；historySize 0 不保留輸入歷史。
  // Ctrl-C／Ctrl-D 由 readline 以 AbortError 中止，非零結束且不產生 hash。
  const rl = createInterface({
    input: process.stdin,
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    terminal: true,
    historySize: 0,
  });
  const ask = async (prompt: string) => {
    process.stderr.write(prompt);
    const answer = await rl.question('');
    process.stderr.write('\n');
    return answer;
  };

  try {
    const password = await ask('Super user 密碼：');
    const bytes = Buffer.byteLength(password, 'utf8');
    if (bytes === 0 || bytes > SUPER_USER_PASSWORD_MAX_BYTES) {
      console.error(
        `密碼長度須為 1～${SUPER_USER_PASSWORD_MAX_BYTES} UTF-8 bytes，未產生 hash。`,
      );
      return 1;
    }
    if ((await ask('再次輸入確認：')) !== password) {
      console.error('兩次輸入不一致，未產生 hash。');
      return 1;
    }
    process.stdout.write(`${await hashSuperUserPassword(password)}\n`);
    return 0;
  } finally {
    rl.close();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
