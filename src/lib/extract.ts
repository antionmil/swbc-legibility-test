import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "./address";

export { isPublicAddress };

/* READING A URL SOMEBODY ELSE TYPED.
 *
 * The server fetches it, which makes this an open door into our own network
 * unless it is guarded. The guards, all tested by attacking them:
 *   - http and https only, default ports only, no credentials in the URL
 *   - every address the name resolves to must be public — no loopback,
 *     private ranges, link-local (169.254.169.254 is the cloud metadata
 *     service), carrier-grade NAT, or IPv6 equivalents
 *   - redirects are followed by hand, and every hop is checked again,
 *     because "a public page that redirects to localhost" is the classic bypass
 *   - a size cap and a timeout, so one slow or huge page cannot pin a function
 *
 * The residual risk is DNS rebinding between the check and the fetch. It is
 * stated here rather than pretended away. */

export class Refused extends Error {}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Refused("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Refused("Only http and https pages can be read.");
  if (url.username || url.password) throw new Refused("Addresses with a login in them cannot be read.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Refused("Only pages on the standard web ports can be read.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Refused("That address points inside a network, not at a public page.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Refused("That address does not resolve.");
  if (!addresses.every((a) => isPublicAddress(a.address))) {
    throw new Refused("That address points inside a network, not at a public page.");
  }
  return url;
}

const MAX_BYTES = 1_500_000;

/** Fetch a public page's HTML with every hop checked. */
async function fetchPage(start: string): Promise<{ html: string; finalUrl: URL }> {
  let current = await assertPublicUrl(start);
  for (let hop = 0; hop < 4; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "LegibilityTest/1.0 (+https://legibilitytest.onedaybuilt.com)", accept: "text/html" },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) throw new Refused("That page redirects nowhere.");
        current = await assertPublicUrl(new URL(next, current).toString());
        continue;
      }
      if (!res.ok) throw new Refused(`That page answered with an error (${res.status}).`);
      if (!(res.headers.get("content-type") ?? "").includes("text/html")) throw new Refused("That address is not a web page.");

      const reader = res.body?.getReader();
      if (!reader) throw new Refused("That page sent nothing back.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); break; }
        chunks.push(value);
      }
      return { html: new TextDecoder().decode(Buffer.concat(chunks)), finalUrl: current };
    } catch (err) {
      if (err instanceof Refused) throw err;
      if ((err as Error).name === "AbortError") throw new Refused("That page took too long to answer.");
      throw new Refused("That page could not be reached.");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Refused("That page redirects too many times.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The words a visitor sees. No headless browser, by design: see the brief. */
export function visibleText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|section|header|footer)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? " "))
    .replace(/\s*\.\s*(\.\s*)+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_COPY = 6000;

export async function readUrl(raw: string) {
  const { html, finalUrl } = await fetchPage(raw.includes("://") ? raw : `https://${raw}`);
  const text = visibleText(html).slice(0, MAX_COPY);
  /* A page that builds its words in JavaScript arrives here nearly empty. Say
     so, instead of asking three models to describe a blank page. */
  if (text.length < 200) {
    throw new Refused("That page draws its words with JavaScript, so there is almost nothing to read. Paste the copy instead.");
  }
  finalUrl.hash = "";
  return { text, url: finalUrl };
}
