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

## Commands

### `dbs init`

Interactively creates `.db-snapshots.json` in the current directory for one MySQL Connection (prompts for Connection name, host, port, user, password and database).

- Writes `$schema` pointing to `db-snapshots.schema.json`.
- Never writes a literal password: if a literal password is entered, writes `"${DB_PASSWORD}"` and advises storing the secret in `.env`.
- Refuses if `.db-snapshots.json` already exists, or when `stdin` is not a TTY.

### `dbs create [name]`

Streams a Snapshot of the resolved Connection's database into Snapshot Storage via `mysqldump` (`--single-transaction --quick --no-tablespaces --skip-comments`, plus `--set-gtid-purged=OFF` on MySQL).

- Writes a leading Snapshot Header comment (`-- db-snapshots: driver=mysql connection=<name> created=<ISO-8601 UTC>`, see [ADR-0002](docs/adr/0002-snapshot-header-for-metadata.md)).
- Without `[name]`, creates an **Automatic Snapshot** named `<connection>_<YYYY-MM-DD_HH-mm-ss>` (local time).
- With `[name]`, creates a **Named Snapshot** with that Snapshot Name (characters outside `[A-Za-z0-9._-]` are sanitized to `-`; leading dots are rejected).
- Checks both `.sql` and `.sql.gz` for an existing Snapshot Name: prompts for confirmation (default No) interactively, or fails with `snapshot_exists` when `stdin` is not a TTY.
- Writes atomically to `<file>.partial` and renames on completion; removes `.partial` on failure or `Ctrl-C` (exit code `130`).

### `dbs load [name]`

Streams a Snapshot into the resolved Connection's database via `mysql`.

- Resolves the target Snapshot in order:
  1. Exact Snapshot Name match.
  2. Substring match: a single match is used directly; multiple matches open a filtered interactive picker (or fail with `ambiguous_snapshot` listing candidates when `stdin` is not a TTY).
  3. When `[name]` is omitted: opens an interactive autocomplete picker sorted newest first (or fails when `stdin` is not a TTY).
- Verifies the Snapshot Header's Driver matches the Connection's Driver before dropping anything (`driver_mismatch`); MySQL and MariaDB share the `mysql` Driver, and headerless `.sql` files skip this check.
- Drops all existing tables and views in the target database (with `FOREIGN_KEY_CHECKS=0`, leaving routines and events untouched) before loading so the database matches the Snapshot.

### `dbs list`

Lists all top-level `.sql` Snapshots in Snapshot Storage sorted newest first by creation time (Snapshot Header `created`, falling back to file `mtime` for headerless files).

- Shows `Name`, `Connection`, `Driver`, `Created at`, `Size` (human-readable, base 1024) and `Compressed` (`—` for unknown values on headerless files), or `No snapshots found` when Snapshot Storage is empty.

### `dbs delete [name]`

Removes a Snapshot from Snapshot Storage using the same Snapshot resolution as `dbs load` (exact match, substring match or interactive picker).

- Prompts for confirmation (default No) when resolved via a substring match in interactive mode.
- Never connects to the database or requires client binaries.

### `dbs cleanup`

Deletes older **Automatic Snapshots** (`<connection>_<YYYY-MM-DD_HH-mm-ss>` whose filename prefix matches the Connection recorded in the Snapshot Header) so that only the newest `2` per Connection remain.

- Leaves **Named Snapshots** and headerless files untouched, and prints each deleted Snapshot Name.

### Global options

- `--help`, `-h`, `dbs help [command]`, `dbs <command> --help` — Show general or command help.
- `--version` — Print the `dbs` version.
- `--no-color` (or `NO_COLOR`) — Disable ANSI color output (also disabled automatically when output is not a TTY).

## Development

### Requirements

- [Bun v1.4.4+](https://bun.com/docs/installation)
- [MySQL client CLI (`mysql` and `mysqldump`)](https://dev.mysql.com/doc/)

### Install, check, test and build

Install dependencies, run static checks, run the test suite and compile the standalone binary with Bun:

```sh
bun install
bun check         # type check
bun fmt --check   # check formatting (run `bun fmt` to fix)
bun lint          # lint (Bun canary builds only, for now)
bun run test      # run the test suite (or `bun test`)
bun run build     # compile the standalone binary to dist/dbs
```

The project has no `lint`, `check` or `fmt` scripts in `package.json` on purpose (run `bun lint` directly rather than `bun run lint`): a script with one of those names would shadow Bun's built-in command.
