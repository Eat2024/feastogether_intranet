// 只在伺服器端使用（src/proxy.ts、src/instrumentation.ts）：依來源網路決定隱藏路徑是否存在。
// 允許清單為 SUPER_USER_ALLOWED_CIDRS（逗號分隔的 CIDR，IPv4／IPv6 皆可）。
// client IP 只信 X-Real-IP：正式環境由主機 Nginx 覆寫成連線來源，client 自帶的值會被蓋掉；X-Forwarded-For 可被偽造，不採用。
import { BlockList, isIP } from 'node:net';

const familyOf = (address: string) => (isIP(address) === 4 ? 'ipv4' : 'ipv6');

function addCidr(list: BlockList, cidr: string): boolean {
  const [address, prefix, ...rest] = cidr.trim().split('/');
  if (!isIP(address) || rest.length > 0 || !/^\d{1,3}$/.test(prefix ?? '')) return false;
  const bits = Number(prefix);
  if (bits > (isIP(address) === 4 ? 32 : 128)) return false;
  list.addSubnet(address, bits, familyOf(address));
  return true;
}

/** 未設定或空字串回空清單（一律不允許）；任一項不是合法 CIDR 時丟錯，訊息只帶變數名、不帶值。 */
export function parseAllowedNetworks(value: string | undefined): BlockList {
  const list = new BlockList();
  if (!value?.trim()) return list;
  for (const cidr of value.split(',')) {
    if (!addCidr(list, cidr)) throw new Error('SUPER_USER_ALLOWED_CIDRS 必須是逗號分隔的 CIDR');
  }
  return list;
}

/** 只看 X-Real-IP；缺少或不是 IP 時不允許（BlockList.check 對非 IP 回 false）。 */
export function isAllowedClient(list: BlockList, headers: Headers): boolean {
  const ip = headers.get('x-real-ip') ?? '';
  return list.check(ip, familyOf(ip));
}
