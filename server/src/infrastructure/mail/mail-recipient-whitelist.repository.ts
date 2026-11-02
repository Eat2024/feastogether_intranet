import { Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { MailRecipientWhitelist } from './mail-recipient-whitelist.entity';

@Injectable()
export class MailRecipientWhitelistRepository {
  findActive(manager: EntityManager): Promise<MailRecipientWhitelist[]> {
    return manager.find(MailRecipientWhitelist, {
      where: { deletedAt: IsNull() },
    });
  }
}
