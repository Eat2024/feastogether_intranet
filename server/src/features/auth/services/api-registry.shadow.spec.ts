import { ApiRegistryService, DiscoveredRoute } from './api-registry.service';

/** 僅測純結構邏輯（assertNoShadowApi / buildRoute），不需 DB / Nest DI。 */
const service = () =>
  new ApiRegistryService(
    null as never, // apiRegistryRepository
    null as never, // discovery
    null as never, // scanner
    null as never, // reflector
  );

const route = (over: Partial<DiscoveredRoute>): DiscoveredRoute => ({
  method: 'GET',
  route: '/api/x',
  isPublic: false,
  ...over,
});

describe('ApiRegistryService.assertNoShadowApi', () => {
  it('每個 route 恰好命中 @Public 或 @RegisterApi 其一時通過', () => {
    const routes = [
      route({ isPublic: true }),
      route({ register: { key: 'x.do', name: 'x', permissions: ['p'] } }),
    ];
    expect(() => service().assertNoShadowApi(routes)).not.toThrow();
  });

  it('既非 @Public 又缺 @RegisterApi → shadow，拋錯', () => {
    expect(() =>
      service().assertNoShadowApi([route({ route: '/api/shadow' })]),
    ).toThrow(/shadow|未宣告/i);
  });

  it('同時標記 @Public 與 @RegisterApi → 衝突，拋錯', () => {
    expect(() =>
      service().assertNoShadowApi([
        route({
          isPublic: true,
          register: { key: 'x.do', name: 'x', permissions: ['p'] },
        }),
      ]),
    ).toThrow(/擇一|Public/i);
  });
});

describe('ApiRegistryService.syncApis', () => {
  it('DataSource 未初始化時略過同步，不操作 repository', async () => {
    const apiRegistryRepository = {
      isReady: jest.fn().mockReturnValue(false),
      upsertApi: jest.fn(),
    };
    const registry = new ApiRegistryService(
      apiRegistryRepository as never,
      null as never,
      null as never,
      null as never,
    );

    await registry.syncApis([route({ isPublic: true })]);

    expect(apiRegistryRepository.upsertApi).not.toHaveBeenCalled();
  });
});
