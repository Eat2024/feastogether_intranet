import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import { configureApp } from '#app/bootstrap/app.bootstrap';
import { ApiRegistryService } from '#app/features/auth/services/api-registry.service';

/**
 * CI gate（FR-032）：每個 route 必須恰好命中 @Public 或 @RegisterApi 其一。
 * app.init() 本身就會跑 onApplicationBootstrap → assertNoShadowApi；
 * 此處檢查實際 route 的分類結果，違反即讓 CI build 失敗。
 */
describe('API coverage (shadow API gate)', () => {
  let app: NestFastifyApplication;
  let registry: ApiRegistryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    registry = app.get(ApiRegistryService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('每個 route 恰好被分類一次（@Public 或 @RegisterApi）', () => {
    for (const route of registry.collectRoutes()) {
      const classified = route.isPublic !== !!route.register; // XOR
      expect(classified).toBe(true);
    }
  });
});
