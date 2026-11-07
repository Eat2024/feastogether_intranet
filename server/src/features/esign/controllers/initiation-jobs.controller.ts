import { RequirePermissions } from '#app/features/authorization/decorators/require-permissions.decorator';
import {
  InitiationJobResponseDto,
  LatestInitiationJobResponseDto,
  InitiationIssuesResponseDto,
  InitiationInputResponseDto,
} from '../dto/initiation-response.dto';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import type { FastifyReply } from 'fastify';
import {
  Controller,
  Post,
  Body,
  Headers,
  Res,
  UseGuards,
  Get,
  Query,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import {
  InitiationJobDto,
  InitiationIssuesQueryDto,
} from '../dto/initiation-job.dto';
import { EsignInitiationJobService } from '../services/esign-initiation-job.service';

@ApiCookieAuth('sessionCookie')
@RequirePermissions('esign.document.manage')
@Controller('esign/documents/:documentId/initiation-jobs')
export class InitiationJobsController {
  constructor(private readonly jobs: EsignInitiationJobService) {}

  @Post(':jobId/retries')
  @UseGuards(OriginGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '新 UUID；相同 key 重播原子工作',
  })
  @ApiResponse({ status: 400, description: '缺少合法 key 或 body 不為空' })
  @ApiResponse({ status: 404, description: '工作不存在或不是有效建立人' })
  @ApiResponse({ status: 409, description: '忙碌、重播衝突或不符合新重試條件' })
  @ApiResponse({ status: 410, description: '原確認輸入已清理' })
  @ApiOperation({ summary: '建立人以新請求識別重試原確認輸入' })
  @ApiResponse({
    status: 202,
    type: InitiationJobResponseDto,
    description: '新工作可靠受理',
  })
  @ApiOkResponse({
    type: InitiationJobResponseDto,
    description: '同 key 重播原子工作',
  })
  async retry(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUserId() userId: number,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<InitiationJobDto> {
    const result = await this.jobs.retry(documentId, jobId, userId, key, body);
    reply
      .code(result.reused ? 200 : 202)
      .header(
        'Location',
        `/api/esign/documents/${documentId}/initiation-jobs/${result.jobId}`,
      )
      .header('Cache-Control', 'private, no-store');
    return result;
  }

  @Get('latest')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人查詢最近一次背景發起工作，尚無工作回 null' })
  @ApiOkResponse({
    type: LatestInitiationJobResponseDto,
  })
  @ApiResponse({ status: 401, description: '尚未登入' })
  @ApiResponse({ status: 404, description: '文件不存在或不是建立人' })
  latest(
    @Param('documentId', ParseIntPipe) documentId: number,
    @CurrentUserId() userId: number,
  ): Promise<InitiationJobDto | null> {
    return this.jobs.latest(documentId, userId);
  }

  @Get(':jobId/issues')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人分頁查詢失敗人員問題' })
  @ApiOkResponse({ type: InitiationIssuesResponseDto })
  @ApiResponse({ status: 409, description: '工作尚未失敗' })
  @ApiResponse({ status: 410, description: '問題明細已清理' })
  issues(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUserId() userId: number,
    @Query() query: InitiationIssuesQueryDto,
  ) {
    return this.jobs.issues(documentId, jobId, userId, query);
  }

  @Get(':jobId/input')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人還原背景發起的確認輸入' })
  @ApiOkResponse({ type: InitiationInputResponseDto })
  @ApiResponse({ status: 410, description: '原確認輸入已清理' })
  input(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.jobs.input(documentId, jobId, userId);
  }

  @Get(':jobId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '建立人查詢背景發起工作摘要' })
  @ApiOkResponse({ type: InitiationJobResponseDto })
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
