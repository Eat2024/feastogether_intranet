import { Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { EsignStoppageService } from './esign-stoppage.service';

@Injectable()
export class EsignExpiryService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly stoppage: EsignStoppageService,
  ) {}

  async reconcile(now = new Date()): Promise<number> {
    let stopped = 0;
    let afterId = 0;
    while (true) {
      const rows = await this.documents.findExpiredActiveIds(
        now,
        this.mysql.getManager(),
        afterId,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        if (await this.stoppage.stopByDeadline(Number(row.id), now))
          stopped += 1;
      }
      afterId = Number(rows[rows.length - 1].id);
    }
    return stopped;
  }
}
