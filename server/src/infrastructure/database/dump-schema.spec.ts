import { normalizeSchemaDump } from './dump-schema';

describe('normalizeSchemaDump（schema:dump）', () => {
  it('拿掉 AUTO_INCREMENT 計數，避免隨資料變動產生無意義的 diff', () => {
    const raw =
      'CREATE TABLE `auth_roles` (\n  `id` bigint NOT NULL AUTO_INCREMENT\n) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4;\n';

    const out = normalizeSchemaDump(raw);

    expect(out).not.toMatch(/AUTO_INCREMENT=\d+/);
    // 欄位定義的 AUTO_INCREMENT 屬性要保留
    expect(out).toContain('`id` bigint NOT NULL AUTO_INCREMENT');
    expect(out).toContain('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;');
  });

  it('加上「自動產生、勿手改、以 migration 為準」的檔頭，結尾只留一個換行', () => {
    const out = normalizeSchemaDump('SELECT 1;\n\n\n');

    expect(out.startsWith('-- 由 `pnpm -C server schema:dump` 自動產生')).toBe(
      true,
    );
    expect(out).toContain('不要直接匯入本檔');
    expect(out.endsWith('SELECT 1;\n')).toBe(true);
  });
});
