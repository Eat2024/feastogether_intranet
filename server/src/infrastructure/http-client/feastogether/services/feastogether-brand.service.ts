import { Injectable } from '@nestjs/common';
import { FeastogetherClient } from '../feastogether.client';
import { mapFeastogetherUpstreamError } from '../feastogether-error.util';
import { BrandInfoItem } from '../types/brand.types';

const PATHS = {
  brandInfo: '/api/v1/brand/brand_info',
} as const;

/** 饗賓品牌主檔（noauth，僅 X-API-KEY）。顯示 / 同步用，不參與授權（FR-105）。 */
@Injectable()
export class FeastogetherBrandService {
  constructor(private readonly client: FeastogetherClient) {}

  /** 取得所有品牌及其下屬門市。 */
  async getBrandInfo(): Promise<BrandInfoItem[]> {
    try {
      return await this.client.get<BrandInfoItem[]>(PATHS.brandInfo);
    } catch (error) {
      throw mapFeastogetherUpstreamError(error);
    }
  }
}
