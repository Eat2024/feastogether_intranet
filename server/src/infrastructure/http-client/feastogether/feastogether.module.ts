import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { FeastogetherClient } from './feastogether.client';
import { FeastogetherConfig } from './feastogether.config';
import { FeastogetherBrandService } from './services/feastogether-brand.service';
import { FeastogetherDepartmentService } from './services/feastogether-department.service';
import { FeastogetherHrService } from './services/feastogether-hr.service';

/**
 * 饗賓 API 集中層。對外只暴露 domain service（與 client 供 003 擴充用）；
 * base URL / X-API-KEY 收斂在 FeastogetherConfig + FeastogetherClient。
 */
@Module({
  imports: [HttpModule],
  providers: [
    FeastogetherConfig,
    FeastogetherClient,
    FeastogetherBrandService,
    FeastogetherDepartmentService,
    FeastogetherHrService,
  ],
  exports: [
    FeastogetherBrandService,
    FeastogetherDepartmentService,
    FeastogetherHrService,
    FeastogetherClient,
  ],
})
export class FeastogetherModule {}
