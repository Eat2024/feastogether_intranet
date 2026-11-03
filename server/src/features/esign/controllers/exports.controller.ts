import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import {
  PrepareExportDownloadDto,
  PreparedExportDownloadDto,
} from '../dto/export.dto';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { EsignExportService } from '../services/esign-export.service';
import { ExportQueryDto, ExportRequestDto } from '../dto/export.dto';

@Controller('esign')
export class ExportsController {
  constructor(
    private readonly exports: EsignExportService,
    @Inject(PRIVATE_FILE_STORAGE) private readonly storage: PrivateFileStorage,
  ) {}

  @Post('documents/:documentId/export-downloads')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OriginGuard)
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    summary: '準備當次匯出下載',
    description:
      '需有效員工 session、同源 Origin，以及同部門已發起且未刪除的文件。驗證名稱並補上 Excel 副檔名；空白回 null 以沿用原預設。此操作不保存設定、不產檔、不新增歷史紀錄。',
  })
  @ApiOkResponse({ type: PreparedExportDownloadDto })
  @ApiResponse({
    status: 400,
    description:
      'INVALID_REQUEST：檔名、類型或欄位不合法；文件 ID 沿用既有錯誤',
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({ status: 403, description: 'CSRF_ORIGIN_REJECTED：來源不允許' })
  @ApiResponse({
    status: 404,
    description: 'ESIGN_RESOURCE_NOT_FOUND：文件不存在、草稿、已刪除或非同部門',
  })
  prepareDownload(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body() body: PrepareExportDownloadDto,
  ): Promise<PreparedExportDownloadDto> {
    return this.exports.prepareDownload(numericId(id), userId, body);
  }

  // 查詢可匯出簽署副本的文件。
  @Get('exportable-documents') list(
    @Query() query: ExportQueryDto,
    @CurrentUserId() userId: number,
  ) {
    return this.exports.listDocuments(query, userId);
  }

  // 由同部門員工申請文件副本 ZIP 匯出，回傳既有或新建的匯出狀態。
  @Post('documents/:documentId/exports')
  @UseGuards(OriginGuard)
  async request(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body() _body: ExportRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.exports.request(numericId(id), userId);
    reply.status(result.status === 'completed' ? 200 : 202);
    return result;
  }

  // 查詢指定文件匯出工作的狀態與檔案資訊。
  @Get('documents/:documentId/exports/:exportId') detail(
    @Param('documentId') id: string,
    @Param('exportId') exportId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.exports.detail(numericId(id), exportId, userId);
  }

  // 由同部門員工重試文件副本匯出工作。
  @Post('documents/:documentId/exports/:exportId/retries')
  @UseGuards(OriginGuard)
  async retry(
    @Param('documentId') id: string,
    @Param('exportId') exportId: string,
    @CurrentUserId() userId: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.exports.retry(numericId(id), exportId, userId);
    reply.status(result.status === 'completed' ? 200 : 202);
    return result;
  }

  // 下載匯出 ZIP 分檔，支援 Range 部分下載。
  @Get('documents/:documentId/exports/:exportId/files/:fileId')
  async download(
    @Param('documentId') id: string,
    @Param('exportId') exportId: string,
    @CurrentUserId() userId: number,
    @Param('fileId') fileId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-range') ifRange: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.exports.download(
      numericId(id),
      exportId,
      numericId(fileId),
      userId,
    );
    const size = Number(file.fileSize);
    const etag = `"${file.sha256}"`;
    reply
      .type('application/zip')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
      .header('ETag', etag)
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalFileName ?? 'signed-copies.zip')}`,
      );
    const selected =
      !ifRange || ifRange === etag ? parseRange(range, size) : undefined;
    if (selected === null)
      return reply
        .status(416)
        .header('Content-Range', `bytes */${size}`)
        .send();
    if (selected)
      reply
        .status(206)
        .header(
          'Content-Range',
          `bytes ${selected.start}-${selected.end}/${size}`,
        )
        .header('Content-Length', selected.end - selected.start + 1);
    else reply.status(200).header('Content-Length', size);
    try {
      return reply.send(
        await this.storage.openReadStream(file, selected ?? undefined),
      );
    } catch {
      throw new AppException(...AppErrors.ESIGN_EXPORT_UNAVAILABLE);
    }
  }
}
function numericId(value: string) {
  const id = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(id))
    throw new AppException(...AppErrors.ESIGN_DOCUMENT_ID_INVALID);
  return id;
}
export function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  if (!value || value.includes(',')) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return undefined;
  if (!match[1] && !match[2]) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start > end
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}
