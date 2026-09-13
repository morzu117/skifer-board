# Security Policy

## Supported versions

The project is in its design phase; there is no released version yet. Once releases exist, only the
latest minor version receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through
[GitHub private vulnerability reporting](https://github.com/morzu117/skifer-board/security/advisories/new)
or by e-mail to houbartjulien80@gmail.com.

Include a description, steps to reproduce, the impact you foresee, and any suggested fix. You will
receive an acknowledgement within 7 days.

## Scope reminders

skifer-board is a consumption layer: it never holds data credentials, never emits SQL, and never
bypasses skifer's certification gate. Any code path that would let a browser forge a scope, a
consumer class, or a bearer token toward skifer is a vulnerability and is in scope for this policy.
