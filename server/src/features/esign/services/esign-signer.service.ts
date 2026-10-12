import { Injectable } from '@nestjs/common';

/** 簽署人輸入的業務規則。 */
@Injectable()
export class EsignSignerService {
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
