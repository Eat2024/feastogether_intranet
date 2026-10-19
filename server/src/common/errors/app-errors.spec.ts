import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { AppErrors } from './app-errors';
import { AppException } from './app.exception';

describe('業務錯誤集中管理', () => {
  it('正式程式的 AppException 均引用 AppErrors，避免新增散落的錯誤定義', () => {
    const root = resolve(__dirname, '../..');
    const violations: string[] = [];
    function scan(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts'))
          continue;
        const source = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node) {
          if (
            ts.isNewExpression(node) &&
            node.expression.getText(source) === 'AppException'
          ) {
            const argument = node.arguments?.[0];
            const definition =
              argument && ts.isSpreadElement(argument)
                ? argument.expression
                : undefined;
            const reference =
              definition && ts.isCallExpression(definition)
                ? definition.expression
                : definition;
            if (
              !reference ||
              !ts.isPropertyAccessExpression(reference) ||
              reference.expression.getText(source) !== 'AppErrors'
            ) {
              const line =
                source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
              violations.push(`${relative(root, path)}:${line}`);
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    scan(root);
    expect(violations).toEqual([]);
  });

  it('動態上傳錯誤保留原本 HTTP 與訊息契約', () => {
    const error = new AppException(
      ...AppErrors.ESIGN_UPLOAD_FIELD_UNSUPPORTED('unexpected'),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      error: 'INVALID_REQUEST',
      message: '不支援的欄位：unexpected',
    });
  });

  it('DTO 動態訊息與無 constraint 時的預設訊息均沿用原契約', () => {
    expect(
      new AppException(
        ...AppErrors.REQUEST_VALIDATION_FAILED('欄位 A 錯誤; 欄位 B 錯誤'),
      ).getResponse(),
    ).toEqual({
      error: 'INVALID_REQUEST',
      message: '欄位 A 錯誤; 欄位 B 錯誤',
    });
    expect(
      new AppException(
        ...AppErrors.REQUEST_VALIDATION_FAILED(''),
      ).getResponse(),
    ).toEqual({
      error: 'INVALID_REQUEST',
      message: '請求參數驗證失敗',
    });
  });
  it('組織樹錯誤與使用者登入錯誤分開', () => {
    expect(AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE).toEqual([
      'ORG_CHART_UPSTREAM_UNAVAILABLE',
      '組織架構來源暫時無法使用，請稍後再試',
      502,
    ]);
    expect(AppErrors.ORG_CHART_UNAVAILABLE).toEqual([
      'ORG_CHART_UNAVAILABLE',
      '組織架構暫時無法使用，請稍後再試',
      503,
    ]);
  });
});
