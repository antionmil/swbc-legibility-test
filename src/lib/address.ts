/* Is an address on the public internet? Pure logic with no imports, kept apart
   from the fetching code so it can be tested on its own — which it has to be,
   because it is the one thing standing between a typed URL and our network. */
import { isIP } from "node:net";

const BLOCKED_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16],
  [0xac100000, 12], [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
];

export function v4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/** Expand an IPv6 address to its eight 16-bit groups. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  /* A trailing dotted IPv4 (::ffff:127.0.0.1) becomes two hex groups first. */
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && a.length !== 8) return null;
  const groups = [...a, ...Array(8 - a.length - b.length).fill("0"), ...b].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

const embeddedV4 = (hi: number, lo: number) =>
  [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].join(".");

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return !BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (kind === 6) {
    /* Written as groups, not as strings. The first version matched
       "::ffff:127.0.0.1" with a regex — but Node normalises that address to
       "::ffff:7f00:1" before it ever reaches here, so the loopback check was
       skipped and only an empty port 80 stopped the request. */
    const g = expandV6(ip);
    if (!g) return false;
    if (g.every((x) => x === 0)) return false; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicAddress(embeddedV4(g[6], g[7])); // IPv4-mapped
    if (g.slice(0, 6).every((x) => x === 0)) return isPublicAddress(embeddedV4(g[6], g[7])); // IPv4-compatible (deprecated)
    if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicAddress(embeddedV4(g[6], g[7])); // NAT64 reaches IPv4
    if (g[0] === 0x2002) return isPublicAddress(embeddedV4(g[1], g[2])); // 6to4 reaches IPv4
    if ((g[0] & 0xfe00) === 0xfc00) return false; // unique-local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
    if ((g[0] & 0xff00) === 0xff00) return false; // multicast
    return true;
  }
  return false;
}
