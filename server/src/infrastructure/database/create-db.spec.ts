import { assertDevDbTarget } from './create-db';

describe('assertDevDbTarget（db:create）', () => {
  it.each([
    ['未設 NODE_ENV（本機）', undefined, 'feastogether_intranet'],
    ['development', 'development', 'feastogether_intranet'],
    ['連字號／底線', undefined, 'my-app_dev'],
  ])('%s → 允許建立 %s', (_label, nodeEnv, database) => {
    expect(assertDevDbTarget(nodeEnv, database)).toBe(database);
  });

  it.each(['production', 'staging'])(
    'NODE_ENV=%s → 拒絕（已部署環境由部署流程建庫）',
    (nodeEnv) => {
      expect(() => assertDevDbTarget(nodeEnv, 'feastogether_intranet')).toThrow(
        `NODE_ENV=${nodeEnv}`,
      );
    },
  );

  it.each([
    ['空字串', ''],
    ['未設定', undefined],
    ['含反引號（避免 SQL 注入）', 'nest`; DROP DATABASE x; --'],
    ['含空白', 'nest seed'],
  ])('DB 名%s → 拒絕', (_label, database) => {
    expect(() => assertDevDbTarget(undefined, database)).toThrow('DB_MYSQL_DB');
  });
});
