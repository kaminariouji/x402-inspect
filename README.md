# x402-inspect

**See what a pay-per-call (x402) endpoint actually charges — before you pay.**

A pay-per-call HTTP API answers an unpaid request with `HTTP 402 Payment Required` and the
payment terms in a header. This tool makes that request for you and turns the challenge into
a readable summary: scheme, network, asset, price (with decimals when the asset is known),
`payTo`, timeout, and any extensions the server advertises (schemas, examples).

- **Zero dependencies.** Node 18+, no `npm install`.
- **No keys, no signing, no payment.** It inspects; it never spends. Exit code 0 on a
  successful inspection, 1 on a network/parse error.
- Handles **x402 v2** (`PAYMENT-REQUIRED` header, base64 JSON) and **v1** (`WWW-Authenticate`
  with an `x402` scheme, inline or base64 JSON) challenges.

## Usage

```
node x402-inspect.mjs <url> [--json] [--headers]
```

| flag | effect |
|---|---|
| `--json` | print the raw decoded challenge as JSON (machine-readable) |
| `--headers` | also print all response headers |

## Sample output

Real call, 2026-10-11 (FlapJax Agent/Wallet Checker — a paid x402 endpoint on Base):

```
$ node x402-inspect.mjs "https://flapjax-check.run402.com/check?address=0x8c062dc5d775b7d5efc168f75a875f392f53dcdf"
x402-inspect — https://flapjax-check.run402.com/check?address=0x8c062dc5d775b7d5efc168f75a875f392f53dcdf
http        402  (payment required)
challenge   PAYMENT-REQUIRED (base64 JSON)  x402Version 2
service     FlapJax Checker
about       Agent/wallet check for any EVM address: ERC-8004 agent-likeness (BSC identity registry + ~38k registered agents), sybil first-funder cluster flags, FLAPJAX holding and basic BSC/Base chain facts.
tags        wallets, sybil, erc-8004, agents, run402

option 1    scheme exact  network Base (eip155:8453)
price       0.02 USDC
asset       0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (USDC)
payTo       0x3393319386c77ea0e8873a9bf510f1b6668a02a8
timeout     300s

extensions  bazaar
example out {"sybil":{"cluster_flag":"none"},"address":"0x8004A169FB4a3325136EB29fA0ceB6D2e539a432","flapjax":{"holds":false},"agent_likeness":{"score":0.82}}

gateway     PAYMENT_REQUIRED — Retry the request with an x402 payment header, or set a tier first.

note        no payment was sent; this tool never signs or spends.
```

A free endpoint answers `200` and the tool says so; anything else prints the status and a
body preview. Endpoints that are already free are simply reported as free.

## Who it helps

- **Agent developers** wiring a paid API into a pipeline: check the terms in CI before your
  agent ever signs a payment, and fail fast if `payTo` or the price changes.
- **Evaluators** comparing x402 services: the price, asset and network are normalized, so two
  endpoints become comparable at a glance.
- **Operators** debugging their own 402: run it against your endpoint to see exactly what a
  client receives, including whether your extension metadata is well-formed.

## How it works

`GET` the URL with no payment header → read the response. On `402`:

1. `PAYMENT-REQUIRED` header → base64-decode → JSON (x402 v2).
2. Fallback: `WWW-Authenticate` with an `x402` scheme, inline or base64 JSON (v1 style).
3. Normalize `accepts[]` across versions (`amount` in v2, `maxAmountRequired` in v1).
4. Format the amount with decimals from a small known-asset table (USDC/DAI/USDT on the common
   EVM chains); unknown assets print base units with a note.

It never constructs, signs, or sends a payment — inspection only.

## Limits (honest)

- The known-asset table is intentionally small; unknown assets show raw base units.
- It inspects **one** URL per run; batch your own loop.
- v1 handling is best-effort (the v1 spec is less uniform across servers).
- A 402 body is often a generic gateway envelope; the useful data is in the header, which is
  why this tool reads the header.

## License

MIT
