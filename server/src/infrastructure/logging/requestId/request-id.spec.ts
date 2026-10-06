import {
  bindRequestIdToResponse,
  CLS_REQUEST_ID,
  generateRequestId,
  isValidUuid,
  REQUEST_ID_HEADER,
  requestIdFromHeaders,
  resolveRequestId,
} from './request-id';

const LOWER = '550e8400-e29b-41d4-a716-446655440000';
const UPPER = '550E8400-E29B-41D4-A716-446655440000';

describe('request-id', () => {
  describe('isValidUuid', () => {
    it('接受合法 UUID（含大寫、各版本）', () => {
      expect(isValidUuid(LOWER)).toBe(true);
      expect(isValidUuid(UPPER)).toBe(true);
      expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
      expect(isValidUuid('a0eebc99-9c0b-11 d1-80b4-00c04fd430c8')).toBe(false);
    });

    it('拒絕非 UUID / 空 / 過長 / 含控制字元 / 非字串', () => {
      expect(isValidUuid('abc-123')).toBe(false);
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid(`${LOWER}extra`)).toBe(false);
      expect(isValidUuid(`${LOWER}\n`)).toBe(false);
      expect(isValidUuid(undefined)).toBe(false);
      expect(isValidUuid(['a', 'b'])).toBe(false);
    });
  });

  describe('resolveRequestId', () => {
    it('合法 UUID → normalize 小寫沿用', () => {
      expect(resolveRequestId(LOWER)).toBe(LOWER);
      expect(resolveRequestId(UPPER)).toBe(LOWER);
    });

    it('無效值（空 / 非 UUID / 多值陣列 / undefined）→ null', () => {
      expect(resolveRequestId('')).toBeNull();
      expect(resolveRequestId('abc-123')).toBeNull();
      expect(resolveRequestId([LOWER, LOWER])).toBeNull();
      expect(resolveRequestId(undefined)).toBeNull();
    });
  });

  describe('generateRequestId', () => {
    it('帶合法 header → 沿用（小寫）', () => {
      expect(generateRequestId({ 'x-request-id': UPPER })).toBe(LOWER);
    });

    it('無 / 無效 header → 生成新的小寫 UUID', () => {
      const a = generateRequestId({});
      const b = generateRequestId({ 'x-request-id': 'abc-123' });
      expect(isValidUuid(a)).toBe(true);
      expect(a).toBe(a.toLowerCase());
      expect(isValidUuid(b)).toBe(true);
      expect(a).not.toBe(b);
    });
  });

  describe('requestIdFromHeaders', () => {
    it('由 raw req.headers 取得 request id（沿用合法、normalize 小寫）', () => {
      expect(requestIdFromHeaders({ headers: { 'x-request-id': UPPER } })).toBe(
        LOWER,
      );
      expect(isValidUuid(requestIdFromHeaders({ headers: {} }))).toBe(true);
    });
  });

  describe('bindRequestIdToResponse', () => {
    it('鏡射 CLS id 到 requestId key 並用 setHeader 回寫（raw res）', () => {
      const cls = { getId: () => LOWER, set: jest.fn() };
      const setHeader = jest.fn();
      bindRequestIdToResponse(cls, { setHeader });
      expect(cls.set).toHaveBeenCalledWith(CLS_REQUEST_ID, LOWER);
      expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, LOWER);
    });

    it('無 setHeader 時改用 FastifyReply.header', () => {
      const cls = { getId: () => LOWER, set: jest.fn() };
      const header = jest.fn();
      bindRequestIdToResponse(cls, { header });
      expect(header).toHaveBeenCalledWith(REQUEST_ID_HEADER, LOWER);
    });
  });
});
