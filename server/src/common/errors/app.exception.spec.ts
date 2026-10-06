import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from './app-error-code';
import { AppException } from './app.exception';

describe('AppException', () => {
  it('未帶 details 時維持既有 response 契約', () => {
    const exception = new AppException(
      AppErrorCode.INVALID_REQUEST,
      '請求錯誤',
      HttpStatus.BAD_REQUEST,
    );

    expect(exception.getResponse()).toEqual({
      error: AppErrorCode.INVALID_REQUEST,
      message: '請求錯誤',
    });
  });

  it('帶 details 時保留內容且不 mutate 輸入物件', () => {
    const details = { rowIndex: 0, field: 'quantity' };
    const exception = new AppException(
      AppErrorCode.INVALID_REQUEST,
      '請求錯誤',
      HttpStatus.BAD_REQUEST,
      details,
    );

    expect(exception.getResponse()).toEqual({
      error: AppErrorCode.INVALID_REQUEST,
      message: '請求錯誤',
      details,
    });
    expect(details).toEqual({ rowIndex: 0, field: 'quantity' });
  });
});
