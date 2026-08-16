/**
 * Browser-safe authority matching for the connection trust fences: bare
 * `host[:port]` canonicalization and entry matching. Pure WHATWG URL logic —
 * no Node imports, so the client bundle can import it directly. The node-side
 * request fence (api-request-trust) and the browser-side page-posture checks
 * both read through these helpers so the two sides compare authorities the
 * same way.
 * @module
 */

/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable.
 * @param authority - the raw authority string (`host` or `host:port`).
 * @returns the parsed URL, or undefined when WHATWG parsing fails.
 */
export function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 * @param entry - the raw authority string.
 * @param entryUrl - the authority parsed as an http URL.
 * @returns the canonical `hostname` or `hostname:port` spelling.
 */
export function canonicalAuthority(entry: string, entryUrl: URL): string {
  // An authority that parsed under http cannot fail under https.
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether a URL authority matches a `trustedHosts`-style entry list. An entry
 * with an explicit port matches that exact authority; a port-less entry
 * matches the hostname on any port (the shape the CLI derives for IP-literal
 * LAN serving, where the bound port may be OS-assigned). Both sides compare
 * through WHATWG normalization, so case and a redundant `:80` never decide
 * trust.
 * @param hostUrl - the URL whose authority is being judged.
 * @param authorities - the entry list to match against.
 * @returns true when the URL authority matches an entry.
 */
export function isTrustedAuthority(hostUrl: URL, authorities: readonly string[]): boolean {
  return authorities.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Whether a page authority counts as a deployment-trusted remote: the
 * client-side mirror of the server fence, used where a browser must know its
 * own posture before calling privileged methods (the settings scope's
 * host-vs-memory persistence choice).
 * @param pageUrl - the page's own URL.
 * @param authorities - deployment-declared authorities (trusted or privileged host list).
 * @returns true when the page authority matches an entry (loopback is never
 * listed here — callers test it separately).
 */
export function isTrustedPageAuthority(pageUrl: URL, authorities: readonly string[]): boolean {
  return isTrustedAuthority(pageUrl, authorities)
}
