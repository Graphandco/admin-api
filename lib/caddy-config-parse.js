/**
 * Extraction (mapping + redirections) depuis le JSON de GET /config/ (Caddy admin API)
 */

function collectHostsFromMatchers(match) {
  if (!match) return [];
  const matchers = Array.isArray(match) ? match : [match];
  const hosts = new Set();
  for (const m of matchers) {
    if (!m || typeof m !== 'object') continue;
    const h = m.host;
    if (h) (Array.isArray(h) ? h : [h]).forEach((x) => hosts.add(String(x)));
  }
  return [...hosts];
}

function upstreamDial(u) {
  if (!u || typeof u !== 'object') return null;
  return u.dial || u.to || (typeof u === 'string' ? u : null);
}

function extractReverseProxyDials(h) {
  if (h.handler !== 'reverse_proxy') return [];
  const out = [];
  if (h.upstreams && Array.isArray(h.upstreams)) {
    h.upstreams.forEach((u) => {
      const d = upstreamDial(u);
      if (d) out.push(d);
    });
  }
  if (h.dial) out.push(h.dial);
  return out;
}

function getLocationValue(h) {
  if (h.location) return h.location;
  const hdrs = h.headers;
  if (hdrs && typeof hdrs === 'object') {
    const loc = hdrs.Location || hdrs.location;
    if (Array.isArray(loc) && loc[0]) return String(loc[0]);
    if (typeof loc === 'string') return loc;
  }
  return null;
}

function walkHandlers(handleArray, inheritedHosts, listen, serverKey, results) {
  if (!Array.isArray(handleArray)) return;
  for (const h of handleArray) {
    if (!h || typeof h !== 'object') continue;
    if (h.handler === 'subroute' && h.routes) {
      walkRouteList(h.routes, inheritedHosts, listen, serverKey, results);
    } else if (h.handler === 'reverse_proxy') {
      const dials = extractReverseProxyDials(h);
      const up = dials.length ? dials.join(', ') : '—';
      results.mapping.push({
        hosts: inheritedHosts,
        listen,
        server: serverKey,
        upstream: up,
        upstreams: dials,
      });
    } else if (h.handler === 'http_redirect' || h.handler === 'redirect') {
      const to = h.location || getLocationValue(h) || h.uri || '—';
      const code = h.status_code ?? h.status ?? h.statusCode ?? 302;
      results.redirects.push({
        hosts: inheritedHosts,
        listen,
        server: serverKey,
        to,
        code,
      });
    } else if (h.handler === 'static_response') {
      const code = h.status_code ?? h.status ?? h.statusCode;
      const loc = getLocationValue(h);
      const isRedir = (typeof code === 'number' && code >= 300 && code < 400) || !!loc;
      if (!isRedir) continue;
      const to = loc || h.body || '—';
      results.redirects.push({
        hosts: inheritedHosts,
        listen,
        server: serverKey,
        to,
        code: code && code >= 300 && code < 400 ? code : 302,
      });
    } else if (h.handler === 'vars' && h.routes) {
      walkRouteList(h.routes, inheritedHosts, listen, serverKey, results);
    }
  }
}

function walkRouteList(routes, inheritedHosts, listen, serverKey, results) {
  if (!Array.isArray(routes)) return;
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue;
    const routeHosts = collectHostsFromMatchers(route.match);
    const effectiveHosts = routeHosts.length ? routeHosts : inheritedHosts;
    if (Array.isArray(route.handle)) {
      walkHandlers(route.handle, effectiveHosts, listen, serverKey, results);
    }
    if (Array.isArray(route.routes)) {
      walkRouteList(route.routes, effectiveHosts, listen, serverKey, results);
    }
  }
}

function parseCaddyConfig(cfg) {
  const results = { mapping: [], redirects: [] };
  const servers = cfg?.apps?.http?.servers;
  if (!servers || typeof servers !== 'object') return results;
  for (const [serverKey, srv] of Object.entries(servers)) {
    if (!srv || typeof srv !== 'object') continue;
    const listen = Array.isArray(srv.listen) ? srv.listen.join(', ') : String(srv.listen || '—');
    if (Array.isArray(srv.routes)) {
      walkRouteList(srv.routes, [], listen, serverKey, results);
    }
  }
  return results;
}

function keyRow(r, keyParts) {
  return keyParts
    .map((k) => (k === 'hosts' ? JSON.stringify(r.hosts ?? []) : String(r[k] ?? '')))
    .join('\0');
}

function uniqueRowsBy(rows, keyParts) {
  const seen = new Set();
  return rows.filter((r) => {
    const s = keyRow(r, keyParts);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function postProcess({ mapping, redirects }) {
  return {
    mapping: uniqueRowsBy(mapping, ['hosts', 'listen', 'server', 'upstream']),
    redirects: uniqueRowsBy(redirects, ['hosts', 'to', 'code', 'listen', 'server']),
  };
}

module.exports = { parseCaddyConfig, postProcess };
