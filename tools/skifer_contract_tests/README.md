# skifer-contract-tests

Contract suite of the skifer public API (`SK-02`, HTTP contract `D14` of plan 01). It only checks
shapes, consistency and invariants, never row values, so it runs against any target:

- a running API: `pytest --pyargs skifer_contract_tests --skifer-base-url=https://host` (root URL,
  routes are relative to `/api/v1`);
- an ASGI app in process, no network: ini key `skifer_contract_app = "module:factory"`.

The bearer comes from `SKIFER_CONTRACT_TOKEN` (default `mock-token`). The plugin is registered
through the `pytest11` entry point.

To play the suite, the target must serve the plan 01 §4 catalogue as fixtures: `sales.orders`
(`revenue`, `region` with at least two values, `channel`), `sales.customers` (`segment`, joined to
`sales.orders` both ways through `related_models`) and `finance.invoices` (`invoiced_amount`,
`status`) with an `EXPIRED` certification that the gate turns into `DENY`.

## Fixtures required of the target (D15)

Some prepared states cannot be reached through a normal request; the target declares them through
suite configuration instead of the suite guessing at them:

| Ini key / env var | Expected state on the target |
|---|---|
| `skifer_contract_warn_model` | A model key whose certification gate decision is `WARN`. |
| `skifer_contract_require_human_model` | A model key whose certification gate decision is `REQUIRE_HUMAN`. |
| `skifer_contract_readonly_token` / `SKIFER_CONTRACT_READONLY_TOKEN` (the env var takes priority) | A bearer token authenticated with `models:read` but without `query:execute`, so `POST /query` answers `ScopeDenied`. |

If a key is left unset, the tests that need it fail with a message naming the key to configure —
they never skip. `finance.invoices` must remain in the `DENY`/`EXPIRED` state described above.
`ResourceUnavailable` is out of contract (D15): no normal request provokes it reliably on a real
target, so the suite never asserts it.
