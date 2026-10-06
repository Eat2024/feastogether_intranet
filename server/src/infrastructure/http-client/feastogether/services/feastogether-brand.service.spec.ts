import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { FeastogetherApiError } from '../feastogether.client';
import { FeastogetherBrandService } from './feastogether-brand.service';

describe('FeastogetherBrandService', () => {
  const build = () => {
    const client = { get: jest.fn(), post: jest.fn() };
    return { service: new FeastogetherBrandService(client as never), client };
  };

  it('getBrandInfo：打 brand_info（noauth）並回傳 data', async () => {
    const { service, client } = build();
    const data = [{ div_code: 'A' }];
    client.get.mockResolvedValue(data);

    await expect(service.getBrandInfo()).resolves.toBe(data);
    expect(client.get).toHaveBeenCalledWith('/api/v1/brand/brand_info');
  });

  it('上游 5xx → 502 EATOGETHER_API_SERVICE_UNAVAILABLE', async () => {
    const { service, client } = build();
    client.get.mockRejectedValue(new FeastogetherApiError(500, null, 'x'));

    await expect(service.getBrandInfo()).rejects.toMatchObject({
      code: AppErrorCode.EATOGETHER_API_SERVICE_UNAVAILABLE,
    });
    await expect(service.getBrandInfo()).rejects.toBeInstanceOf(AppException);
  });
});
