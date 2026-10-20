import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { NotificationBatchDto } from '../dto/notification-batch.dto';
import { EsignReminderService } from '../services/esign-reminder.service';

@Controller('esign/documents/:documentId/notification-batches')
export class NotificationBatchesController {
  constructor(private readonly reminders: EsignReminderService) {}
  @Post()
  @HttpCode(202)
  @UseGuards(OriginGuard)
  create(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body() body: NotificationBatchDto,
  ) {
    return this.reminders.create(this.id(id), userId, body);
  }
  @Get(':batchId')
  detail(
    @Param('documentId') id: string,
    @Param('batchId') batchId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.reminders.detail(this.id(id), userId, batchId);
  }
  private id(value: string) {
    const id = Number(value);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(id))
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_ID_INVALID);
    return id;
  }
}
