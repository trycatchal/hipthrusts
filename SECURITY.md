# Security Policy

HipThrusTS is a security-focused library: its whole purpose is making
insecure request handlers fail to compile. We take reports about gaps in
that promise seriously.

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest 0.x release | ✅ |
| older releases | ❌ |

Until 1.0, fixes land on the latest release only.

## Reporting a vulnerability

Please **do not open a public issue** for security reports.

Use [GitHub's private vulnerability reporting](https://github.com/trycatchal/hipthrusts/security/advisories/new)
to report privately. You should receive an acknowledgement within a week.

## Scope

In scope:

- Bypasses of the lifecycle guarantees — e.g. a handler that compiles and runs
  without `sanitizeInputs`, `preAuthorize`, `finalAuthorize`, or
  `redactResponse` actually executing.
- Sanitization/validation helpers (`hipthrusts/zod`, `hipthrusts/mongoose`)
  letting unvalidated data through, including injection via query objects.
- Error handling leaking internal details in adapter responses.

Out of scope:

- Vulnerabilities in peer dependencies themselves (report those upstream).
- Misuse of escape hatches the docs explicitly warn about (e.g. `NoopPreAuth`
  where real authorization is required).
