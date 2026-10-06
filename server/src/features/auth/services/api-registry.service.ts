import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import {
  REGISTER_API_KEY,
  RegisterApiMetadata,
} from '#app/framework/decorators/register-api.decorator';
import { AuthApi } from '#app/features/auth/entities/auth-api.entity';
import { ApiRegistryRepository } from '#app/features/auth/repositories/api-registry.repository';

/** @Controller / @Get 等寫入 PATH_METADATA 的形狀（Nest 允許陣列多路徑）。 */
type MetadataPath = string | string[] | undefined;

/** 只用來讀 metadata 的 route handler；不呼叫，故參數／回傳型別不重要。 */
type RouteHandler = (...args: never[]) => unknown;

/** 掃描所得的單一路由分類結果。 */
export interface DiscoveredRoute {
  method: string;
  route: string;
  isPublic: boolean;
  register?: RegisterApiMetadata;
}

/**
 * API registry：開機冪等同步 auth_apis / 預設 auth_api_permissions（FR-031），
 * 並掃描 shadow API（既非 @Public 又缺 @RegisterApi）開機 fail-closed（FR-032）。
 */
@Injectable()
export class ApiRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApiRegistryService.name);

  constructor(
    private readonly apiRegistryRepository: ApiRegistryRepository,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const routes = this.collectRoutes();
    // 結構不變式：有 shadow API 即視為程式缺陷，拒絕啟動。
    this.assertNoShadowApi(routes);
    // 資料同步：容忍 DB 未就緒（與 MysqlProvider「DB 掛了服務照起」一致）。
    await this.syncApis(routes);
  }

  /** 列舉所有 controller route，讀取 @RegisterApi / @Public metadata 分類。 */
  collectRoutes(): DiscoveredRoute[] {
    const routes: DiscoveredRoute[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      // InstanceWrapper 是 InstanceWrapper<any>，這裡收斂成最小可用型別，
      // 避免 any 沿著 prototype → handler → reflector.get 一路擴散。
      const instance = wrapper.instance as object | null | undefined;
      const metatype = wrapper.metatype;
      if (!instance || !metatype) continue;

      const controllerPath = this.reflector.get<MetadataPath>(
        PATH_METADATA,
        metatype,
      );
      const classPublic = !!this.reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        metatype,
      );
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as RouteHandler;
        const requestMethod = this.reflector.get<RequestMethod | undefined>(
          METHOD_METADATA,
          handler,
        );
        const methodPath = this.reflector.get<MetadataPath>(
          PATH_METADATA,
          handler,
        );
        if (requestMethod === undefined || methodPath === undefined) continue;

        routes.push({
          method: RequestMethod[requestMethod],
          route: this.buildRoute(controllerPath, methodPath),
          isPublic:
            classPublic ||
            !!this.reflector.get<boolean | undefined>(IS_PUBLIC_KEY, handler),
          register: this.reflector.get<RegisterApiMetadata | undefined>(
            REGISTER_API_KEY,
            handler,
          ),
        });
      }
    }
    return routes;
  }

  /** 每個 route 必須「恰好」命中 @Public 或 @RegisterApi 其一，否則拒啟動（FR-032）。 */
  assertNoShadowApi(routes: DiscoveredRoute[]): void {
    const shadows: string[] = [];
    const conflicts: string[] = [];

    for (const r of routes) {
      const hasRegister = !!r.register;
      if (!hasRegister && !r.isPublic) shadows.push(`${r.method} ${r.route}`);
      if (hasRegister && r.isPublic) conflicts.push(`${r.method} ${r.route}`);
    }

    if (shadows.length || conflicts.length) {
      throw new Error(
        'API registry 完整性檢查失敗：' +
          (shadows.length
            ? `\n  未宣告（需 @RegisterApi 或 @Public）：\n   - ${shadows.join('\n   - ')}`
            : '') +
          (conflicts.length
            ? `\n  同時標記 @Public 與 @RegisterApi（擇一）：\n   - ${conflicts.join('\n   - ')}`
            : ''),
      );
    }
  }

  /** 冪等 upsert auth_apis + 受保護端點的預設 auth_api_permissions。 */
  async syncApis(routes: DiscoveredRoute[]): Promise<void> {
    if (!this.apiRegistryRepository.isReady()) {
      this.logger.warn('API registry 略過同步：MySQL 尚未就緒');
      return;
    }

    try {
      for (const r of routes) {
        const api = await this.upsertApi(r);
        if (r.register) await this.ensureDefaultPermissions(api.id, r.register);
      }
      this.logger.log(`API registry 同步完成（${routes.length} 個 route）`);
    } catch (err) {
      this.logger.error(
        `API registry 同步失敗（DB 未就緒？服務續行）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** 受保護端點以 @RegisterApi.key 為 api_key；公開端點以 public:METHOD:route 合成鍵，便於完整盤點。 */
  private async upsertApi(route: DiscoveredRoute): Promise<AuthApi> {
    const apiKey =
      route.register?.key ?? `public:${route.method}:${route.route}`;

    return this.apiRegistryRepository.upsertApi({
      apiKey,
      method: route.method,
      route: route.route,
      isPublic: route.isPublic,
    });
  }

  /** 依 @RegisterApi.permissions 補齊預設對應（insert-if-missing，不刪手動新增的）。 */
  private async ensureDefaultPermissions(
    apiId: number,
    meta: RegisterApiMetadata,
  ): Promise<void> {
    for (const permissionKey of meta.permissions) {
      const permission =
        await this.apiRegistryRepository.findPermissionByKey(permissionKey);
      if (!permission) {
        this.logger.warn(
          `@RegisterApi(${meta.key}) 對應權限 ${permissionKey} 尚未 seed，略過綁定`,
        );
        continue;
      }
      await this.apiRegistryRepository.upsertApiPermission(
        apiId,
        permission.id,
      );
    }
  }

  /** 串接全域前綴 /api + controller path + method path，正規化斜線。 */
  private buildRoute(controllerPath: unknown, methodPath: unknown): string {
    const segments = ['api', controllerPath, methodPath]
      .map((p) => (Array.isArray(p) ? (p as unknown[])[0] : p))
      .filter((p): p is string | number => p != null && p !== '')
      .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
      .filter((p) => p !== '');
    return '/' + segments.join('/');
  }
}
