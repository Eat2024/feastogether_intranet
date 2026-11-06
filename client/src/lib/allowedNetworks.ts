// 只在伺服器端使用（src/proxy.ts）：依來源網路決定隱藏路徑是否存在。
// 允許清單為 SUPER_USER_ALLOWED_CIDRS（逗號分隔的 CIDR，IPv4／IPv6 皆可）。
// client IP 只信 X-Real-IP：正式環境由主機 Nginx 覆寫成連線來源，client 自帶的值會被蓋掉；X-Forwarded-For 可被偽造，不採用。
import { BlockList, isIP } from 'node:net';

const familyOf = (address: string) => (isIP(address) === 4 ? 'ipv4' : 'ipv6');

/** 未設定或空字串回空清單（一律不允許）；格式錯誤時 BlockList.addSubnet 會丟錯。 */
export function parseAllowedNetworks(value: string | undefined): BlockList {
  const list = new BlockList();
  for (const cidr of value ? value.split(',') : []) {
    const [address, prefix] = cidr.trim().split('/');
    list.addSubnet(address, Number(prefix), familyOf(address));
  }
  return list;
}

/** 只看 X-Real-IP；缺少或不是 IP 時不允許（BlockList.check 對非 IP 回 false）。 */
export function isAllowedClient(list: BlockList, headers: Headers): boolean {
  const ip = headers.get('x-real-ip') ?? '';
  return list.check(ip, familyOf(ip));
}
