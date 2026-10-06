import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AuthApi } from '#app/features/auth/entities/auth-api.entity';
import { AuthJobPermission } from '#app/features/auth/entities/auth-job-permission.entity';

@Injectable()
export class ApiRegistryRepository {
  constructor(
    private readonly db: MysqlEntityService,
    @Inject(MYSQL_MAIN) private readonly dataSource: DataSource,
  ) {}

  /** 連線初始化失敗時 TypeORM 尚未建立 entity metadata，repository 不可操作。 */
  isReady(): boolean {
    return this.dataSource.isInitialized;
  }

  async upsertApi(input: {
    apiKey: string;
    method: string;
    route: string;
    isPublic: boolean;
  }): Promise<AuthApi> {
    await this.db.authApi.upsert(
      {
        ...input,
        isActive: true,
      },
      ['apiKey'],
    );
    return this.db.authApi.findOneByOrFail({ apiKey: input.apiKey });
  }

  findPermissionByKey(
    permissionKey: string,
  ): Promise<AuthJobPermission | null> {
    return this.db.authJobPermission.findOneBy({ permissionKey });
  }

  async upsertApiPermission(
    apiId: number,
    permissionId: number,
  ): Promise<void> {
    await this.db.authApiPermission.upsert({ apiId, permissionId }, [
      'apiId',
      'permissionId',
    ]);
  }
}
