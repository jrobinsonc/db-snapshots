# Database Snapshots

[![CI](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/jrobinsonc/db-snapshots)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/jrobinsonc/db-snapshots/main)](https://github.com/jrobinsonc/db-snapshots/commits/main)
[![Bun](https://img.shields.io/badge/bun-%E2%89%A51.4.4-black?logo=bun)](https://bun.com/docs/installation)
[![CodeQL](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jrobinsonc/db-snapshots/badge)](https://scorecard.dev/viewer/?uri=github.com/jrobinsonc/db-snapshots)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=jrobinsonc_db-snapshots&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=jrobinsonc_db-snapshots)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=jrobinsonc_db-snapshots&metric=coverage)](https://sonarcloud.io/summary/new_code?id=jrobinsonc_db-snapshots)

Quickly create and load a database snapshots.

> [!WARNING]
> This project is in a very early stage and is **not ready to be used by any means**. Expect missing features, breaking changes and bugs. Do not use it, especially against databases that hold data you care about.

## Development

### Requirements

- [MySQL client CLI v8+](https://dev.mysql.com/doc/mysql-shell/en/mysql-shell-install.html)
- [Bun v1.4.4+](https://bun.com/docs/installation)

### Install

Install dependencies and run checks with Bun's built-in tools:

```sh
bun install
bun check         # type check
bun fmt --check   # check formatting (run `bun fmt` to fix)
bun lint          # lint (Bun canary builds only, for now)
bun test
```

The project has no `lint`, `check` or `fmt` scripts on purpose: a script with one of those names would shadow Bun's built-in command.
