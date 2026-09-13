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
