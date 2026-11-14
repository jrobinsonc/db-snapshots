# Database Snapshots

[![CI](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jrobinsonc/db-snapshots/badge)](https://scorecard.dev/viewer/?uri=github.com/jrobinsonc/db-snapshots)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=jrobinsonc_db-snapshots&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=jrobinsonc_db-snapshots)

Framework-agnostic CLI for creating, loading and managing database Snapshots.

> [!WARNING]
> This project is in a very early stage and is **not ready to be used by any means**. Expect missing features, breaking changes and bugs. Do not use it, especially against databases that hold data you care about.

## Requirements

`dbs` streams Snapshots through each Driver's standard client binaries ([ADR-0001](docs/adr/0001-load-through-client-binaries.md)).

For the `mysql` Driver (MySQL and MariaDB), both client binaries must be available on `PATH`:

- `mysqldump` — used by `dbs create`
- `mysql` — used by `dbs load`

The compiled `dbs` binary is self-contained and does not require Bun on the machine where it runs.

## Configuration

Configuration lives in `.db-snapshots.json` at the project root, discovered automatically by walking up from the current working directory. If no config file is found, commands fail with instructions to run `dbs init`.

Example `.db-snapshots.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/jrobinsonc/db-snapshots/v0.1.0/db-snapshots.schema.json",
  "default_connection": "local",
  "storage": "snapshots",
  "connections": {
    "local": {
      "driver": "mysql",
      "host": "127.0.0.1",
      "port": 3306,
      "user": "root",
      "password": "${DB_PASSWORD}",
      "database": "app_dev"
    }
  }
}
```

### Top-level fields

| Field                | Type     | Required / Default     | Description                                                                                             |
| -------------------- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `$schema`            | `string` | Optional               | Reference to `db-snapshots.schema.json` for editor autocomplete and validation (written by `dbs init`). |
| `default_connection` | `string` | Optional               | Name of the Connection used when none is specified.                                                     |
| `storage`            | `string` | Default: `"snapshots"` | Snapshot Storage directory, resolved relative to the directory containing `.db-snapshots.json`.         |
| `connections`        | `object` | Required               | Named Connections (at least one entry is required).                                                     |

### Connection fields

| Field      | Type                | Required                | Description                                                                                                                                                                                                       |
| ---------- | ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `driver`   | `"mysql"`           | Required                | The Driver the Connection speaks (`mysql` covers both MySQL and MariaDB).                                                                                                                                         |
| `host`     | `string`            | Optional                | Database server host (when omitted, the client binary's own default applies).                                                                                                                                     |
| `port`     | `integer \| string` | Optional                | Database server port number, or a string for environment-variable interpolation.                                                                                                                                  |
| `user`     | `string`            | Optional                | Database username.                                                                                                                                                                                                |
| `password` | `string`            | Optional                | Database password. Never written literally by `dbs init` (use `${DB_PASSWORD}`). Passed to `mysql` / `mysqldump` via a temporary `0600` option file (`--defaults-extra-file`), never on the process command line. |
| `database` | `string`            | Required for operations | Database name to snapshot or load into.                                                                                                                                                                           |

The config is validated strictly against [`db-snapshots.schema.json`](db-snapshots.schema.json); unknown fields are rejected.

### Connection resolution

`dbs create` and `dbs load` resolve the target Connection in order:

1. `default_connection` (an unknown Connection name is an immediate error and never falls through).
2. The only Connection, if `connections` has exactly one entry.
3. An interactive Connection picker when `stdin` is a TTY, or an error listing available Connection names when noninteractive.

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
