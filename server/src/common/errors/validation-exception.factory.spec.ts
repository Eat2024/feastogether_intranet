import { ValidationError } from '@nestjs/common';
import { AppErrorCode } from './app-error-code';
import { validationExceptionFactory } from './validation-exception.factory';

describe('validationExceptionFactory', () => {
  it('將驗證錯誤統一轉為 INVALID_REQUEST 並攤平訊息', () => {
    const errors: ValidationError[] = [
      {
        property: 'roleName',
        constraints: { isNotEmpty: 'roleName 不可為空' },
      },
      {
        property: 'permissionIds',
        children: [{ property: '0', constraints: { isInt: '必須為整數' } }],
      },
    ] as ValidationError[];

    const ex = validationExceptionFactory(errors);

    expect(ex.code).toBe(AppErrorCode.INVALID_REQUEST);
    expect(ex.getStatus()).toBe(400);
    const body = ex.getResponse() as { error: string; message: string };
    expect(body.error).toBe(AppErrorCode.INVALID_REQUEST);
    expect(body.message).toContain('roleName 不可為空');
    expect(body.message).toContain('必須為整數');
  });

  it('無 constraint 時給預設訊息', () => {
    const ex = validationExceptionFactory([]);
    expect(ex.code).toBe(AppErrorCode.INVALID_REQUEST);
    expect((ex.getResponse() as { message: string }).message).toBe(
      '請求參數驗證失敗',
    );
  });
});
