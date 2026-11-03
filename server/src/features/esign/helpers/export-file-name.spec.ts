import { exportFileName } from './export-file-name';
import { AppException } from '#app/common/errors/app.exception';

describe('當次匯出檔名', () => {
  it('中文名稱移除前後空白並補上 Excel 副檔名', () => {
    expect(exportFileName('  年度紀錄  ', 'excel')).toBe('年度紀錄.xlsx');
  });
  it.each([undefined, '', '   '])('未指定或空白沿用原預設：%p', (value) => {
    expect(exportFileName(value, 'excel')).toBeNull();
  });
  it('結尾副檔名不分大小寫且隨格式切換', () => {
    expect(exportFileName('年度紀錄.XLSX', 'excel')).toBe('年度紀錄.xlsx');
    expect(exportFileName('年度紀錄.zip', 'excel')).toBe('年度紀錄.xlsx');
    expect(exportFileName('年度紀錄.xlsx', 'zip')).toBe('年度紀錄.zip');
    expect(exportFileName('年度.2026', 'excel')).toBe('年度.2026.xlsx');
  });
  it('輸入字元上限與最終 bytes 上限分開檢查', () => {
    expect(exportFileName('a'.repeat(100), 'excel')).toHaveLength(105);
    expect(exportFileName('中'.repeat(83) + 'a', 'excel')).toHaveLength(89);
    expect(exportFileName('😀'.repeat(25), 'zip')).toBe(
      `${'😀'.repeat(25)}.zip`,
    );
    expect(() => exportFileName('a'.repeat(101), 'excel')).toThrow(
      AppException,
    );
    expect(() => exportFileName('中'.repeat(84), 'excel')).toThrow(
      AppException,
    );
  });
  it.each([
    null,
    1,
    {},
    ['x'],
    '../x',
    'x/y',
    'x\\y',
    'x\n',
    '\rx',
    'x\u0000',
    'x\u202e',
    'x:y',
    'x?y',
    'x*y',
    'x|y',
    '<x>',
    'x"y',
    '.',
    '..',
    '.xlsx',
    '.hidden',
    'x.',
    'x..xlsx',
    'CON',
    'con.txt',
    'nul.zip',
    'COM1',
    'LPT9.txt',
  ])('拒絕非法值且不回顯輸入：%p', (value) => {
    expect(() => exportFileName(value, 'excel')).toThrow(AppException);
  });
});
