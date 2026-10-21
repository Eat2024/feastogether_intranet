import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
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

  // 查詢可匯出簽署副本的文件。
  @Get('exportable-documents') list(@Query() query: ExportQueryDto) {
    return this.exports.listDocuments(query);
  }

  // 查詢文件副本匯出歷程。
  @Get('exports') history(@Query() query: ExportQueryDto) {
    return this.exports.history(query);
  }

  // 由建立人申請文件副本 ZIP 匯出，回傳既有或新建的匯出狀態。
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
  ) {
    return this.exports.detail(numericId(id), exportId);
  }

  // 由建立人重試文件副本匯出工作。
  @Post('documents/:documentId/exports/:exportId/retries')
  @UseGuards(OriginGuard)
  async retry(
    @Param('documentId') id: string,
    @Param('exportId') exportId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.exports.retry(numericId(id), exportId);
    reply.status(result.status === 'completed' ? 200 : 202);
    return result;
  }

  // 下載匯出 ZIP 分檔，支援 Range 部分下載。
  @Get('documents/:documentId/exports/:exportId/files/:fileId')
  async download(
    @Param('documentId') id: string,
    @Param('exportId') exportId: string,
    @Param('fileId') fileId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-range') ifRange: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.exports.download(
      numericId(id),
      exportId,
      numericId(fileId),
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
