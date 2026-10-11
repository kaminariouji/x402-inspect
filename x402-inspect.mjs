#!/usr/bin/env node
// x402-inspect — see what a pay-per-call (x402) endpoint actually charges, before you pay.
//
// Usage:
//   node x402-inspect.mjs <url> [--json] [--headers]
//
// What it does:
//   GETs the URL without any payment. If the endpoint answers HTTP 402, it decodes the
//   payment challenge (x402 v1 and v2) and prints the terms: scheme, network, asset,
//   amount (with decimals when the asset is known), payTo, timeout, and any extensions
//   (e.g. bazaar input/output schemas). No keys, no signing, no payment — ever.
//
// Exit codes: 0 = inspected (paid or free), 1 = network/parse error.

const KNOWN_ASSETS = {
  // EVM stablecoins commonly used by x402 endpoints (address lowercase -> symbol, decimals)
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6, chain: 'base' },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6, chain: 'ethereum' },
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6, chain: 'polygon' },
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6, chain: 'arbitrum' },
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': { symbol: 'USDC', decimals: 6, chain: 'optimism' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18, chain: 'ethereum' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6, chain: 'ethereum' },
  '0x55d398326f99059ff775485246999027b3197955': { symbol: 'USDT', decimals: 18, chain: 'bsc' },
}

const NETWORK_NAMES = {
  base: 'Base',
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  bsc: 'BNB Smart Chain',
  'eip155:8453': 'Base (eip155:8453)',
  'eip155:1': 'Ethereum (eip155:1)',
  'eip155:137': 'Polygon (eip155:137)',
  'eip155:42161': 'Arbitrum (eip155:42161)',
  'eip155:10': 'Optimism (eip155:10)',
  'eip155:56': 'BNB Smart Chain (eip155:56)',
}

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ''))

function formatAmount(amount, asset) {
  const raw = String(amount ?? '')
  if (!/^\d+$/.test(raw)) return raw || '-'
  const known = KNOWN_ASSETS[String(asset || '').toLowerCase()]
  if (!known) return `${raw} (base units; unknown asset)`
  const n = Number(raw) / 10 ** known.decimals
  return `${n} ${known.symbol}`
}

function decodeChallenge(headers) {
  // x402 v2: PAYMENT-REQUIRED header carries base64 JSON. Some servers also send
  // WWW-Authenticate with an x402 scheme (v1 style) — try both.
  const get = (name) => headers.get(name)
  const candidates = [get('payment-required'), get('www-authenticate')].filter(Boolean)
  for (const raw of candidates) {
    const trimmed = String(raw).trim()
    // Try base64 JSON (v2)
    try {
      const json = JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'))
      if (json && (json.accepts || json.x402Version !== undefined)) return { source: 'PAYMENT-REQUIRED (base64 JSON)', version: json.x402Version, challenge: json }
    } catch {}
    // Try inline JSON
    try {
      const json = JSON.parse(trimmed)
      if (json && (json.accepts || json.x402Version !== undefined)) return { source: 'WWW-Authenticate (JSON)', version: json.x402Version, challenge: json }
    } catch {}
    // Try stripping an "x402 " scheme prefix
    const m = trimmed.match(/^x402\s+(.+)$/i)
    if (m) {
      try {
        const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
        return { source: 'WWW-Authenticate (x402 scheme, base64)', version: json.x402Version, challenge: json }
      } catch {}
    }
  }
  return null
}

function normalizeAccepts(challenge) {
  // v2: accepts[].{scheme,network,amount,asset,payTo,maxTimeoutSeconds,extra}
  // v1: accepts[].{scheme,network,maxAmountRequired,asset,payTo,resource,description,mimeType,maxTimeoutSeconds}
  return (challenge.accepts || []).map((a) => ({
    scheme: a.scheme,
    network: a.network,
    amount: a.amount ?? a.maxAmountRequired,
    asset: a.asset,
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds,
    extra: a.extra,
    resource: typeof a.resource === 'string' ? a.resource : a.resource?.url,
    description: a.description || a.resource?.description,
    mimeType: a.mimeType || a.resource?.mimeType,
  }))
}

async function main() {
  const args = process.argv.slice(2)
  const url = args.find((a) => !a.startsWith('--'))
  const asJson = args.includes('--json')
  const showHeaders = args.includes('--headers')
  if (!url) {
    console.log('usage: node x402-inspect.mjs <url> [--json] [--headers]')
    process.exit(1)
  }

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const bodyText = await res.text()
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = bodyText.slice(0, 500)
  }
  const decoded = res.status === 402 ? decodeChallenge(res.headers) : null

  if (asJson) {
    console.log(JSON.stringify({ url, httpStatus: res.status, challengeSource: decoded?.source || null, x402Version: decoded?.version ?? null, challenge: decoded?.challenge || null, body }, null, 2))
    return
  }

  console.log(`x402-inspect — ${url}`)
  console.log(`http        ${res.status}${res.status === 402 ? '  (payment required)' : ''}`)
  if (showHeaders) {
    for (const [k, v] of res.headers) console.log(`header      ${k}: ${String(v).slice(0, 120)}`)
  }

  if (res.status === 402 && decoded) {
    const c = decoded.challenge
    const r = c.resource && typeof c.resource === 'object' ? c.resource : {}
    console.log(`challenge   ${decoded.source}${decoded.version !== undefined ? `  x402Version ${decoded.version}` : ''}`)
    if (r.serviceName) console.log(`service     ${r.serviceName}`)
    if (r.description || typeof c.resource === 'string') console.log(`about       ${r.description || c.resource}`)
    if (Array.isArray(r.tags) && r.tags.length) console.log(`tags        ${r.tags.join(', ')}`)
    const accepts = normalizeAccepts(c)
    accepts.forEach((a, i) => {
      console.log('')
      console.log(`option ${i + 1}    scheme ${a.scheme}  network ${NETWORK_NAMES[a.network] || a.network}`)
      console.log(`price       ${formatAmount(a.amount, a.asset)}`)
      console.log(`asset       ${a.asset}${KNOWN_ASSETS[String(a.asset || '').toLowerCase()] ? '  (' + KNOWN_ASSETS[String(a.asset).toLowerCase()].symbol + ')' : ''}`)
      console.log(`payTo       ${a.payTo}${isAddr(a.payTo) ? '' : '  [WARNING: not a 0x address]'}`)
      if (a.maxTimeoutSeconds) console.log(`timeout     ${a.maxTimeoutSeconds}s`)
      if (a.resource && a.resource !== url) console.log(`resource    ${a.resource}`)
    })
    if (c.extensions) {
      const exNames = Object.keys(c.extensions)
      console.log('')
      console.log(`extensions  ${exNames.join(', ')}`)
      const bazaar = c.extensions.bazaar?.info
      if (bazaar?.output?.example) console.log(`example out ${JSON.stringify(bazaar.output.example).slice(0, 200)}`)
    }
    const why = body?.next_actions?.[0]?.why
    if (body?.code || why) console.log(`\ngateway     ${body?.code || '-'}${why ? ' — ' + why : ''}`)
    console.log('\nnote        no payment was sent; this tool never signs or spends.')
  } else if (res.status === 200) {
    console.log('result      endpoint answered without payment (free or already-authorized)')
    console.log(`body        ${JSON.stringify(body).slice(0, 300)}`)
  } else {
    console.log(`body        ${JSON.stringify(body).slice(0, 300)}`)
  }
}

main().catch((e) => {
  console.error('error:', e.message)
  process.exit(1)
})
