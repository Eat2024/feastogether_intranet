import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  getSchemaPath,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { InitiationJobDto } from '../dto/initiation-job.dto';
import { EsignInitiationJobService } from '../services/esign-initiation-job.service';

@ApiCookieAuth('sessionCookie')
@ApiExtraModels(InitiationJobDto)
@Controller('esign/documents/:documentId/initiation-jobs')
export class InitiationJobsController {
  constructor(private readonly jobs: EsignInitiationJobService) {}

  @Get('latest')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人查詢最近一次背景發起工作，尚無工作回 null' })
  @ApiOkResponse({
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(InitiationJobDto) }],
    },
  })
  @ApiResponse({ status: 401, description: '尚未登入' })
  @ApiResponse({ status: 404, description: '文件不存在或不是建立人' })
  latest(
    @Param('documentId', ParseIntPipe) documentId: number,
    @CurrentUserId() userId: number,
  ): Promise<InitiationJobDto | null> {
    return this.jobs.latest(documentId, userId);
  }

  @Get(':jobId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人查詢背景發起工作摘要' })
  @ApiOkResponse({ type: InitiationJobDto })
  @ApiResponse({ status: 401, description: '尚未登入' })
  @ApiResponse({ status: 404, description: '工作不存在或不是建立人' })
  get(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUserId() userId: number,
  ): Promise<InitiationJobDto> {
    return this.jobs.get(documentId, jobId, userId);
  }
}
