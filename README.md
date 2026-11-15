# Database Snapshots

[![CI](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/jrobinsonc/db-snapshots/actions/workflows/github-code-scanning/codeql)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jrobinsonc/db-snapshots/badge)](https://scorecard.dev/viewer/?uri=github.com/jrobinsonc/db-snapshots)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=jrobinsonc_db-snapshots&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=jrobinsonc_db-snapshots)
[![Latest release](https://img.shields.io/github/v/release/jrobinsonc/db-snapshots)](https://github.com/jrobinsonc/db-snapshots/releases)

Take a snapshot before running migrations, switching branches, or testing queries, and load it back with a single command whenever you need a clean slate.

> [!WARNING]
> This project is in a very early stage and is **not ready to be used by any means**. Expect missing features, breaking changes and bugs. Do not use it, especially against databases that hold data you care about.

## Requirements

`dbs` works with MySQL and MariaDB. The MySQL client tools must be installed and on your `PATH`:

- `mysqldump`, to create snapshots
- `mysql`, to load them

## Installation

There are no prebuilt binaries yet. To build `dbs` from source you need [Bun](https://bun.com/docs/installation):

```sh
git clone https://github.com/jrobinsonc/db-snapshots.git
cd db-snapshots
bun install
bun run build   # creates dist/dbs
```

Copy `dist/dbs` anywhere on your `PATH`. The binary is self-contained, so the machine you run it on doesn't need Bun.

## Quick start

```sh
dbs init                   # set up your connection in .db-snapshots.json
dbs create before-migration  # take a snapshot
# ...run migrations, break things...
dbs load before-migration    # put the database back the way it was
```

## Commands

### `dbs init`

Creates `.db-snapshots.json` in the current directory by asking for your connection details: connection name, host, port, user, password and database.

```sh
dbs init
```

Good to know:

- If you type a password, it isn't saved in the file. The file gets `"${DB_PASSWORD}"` instead, and you're advised to keep the password in `.env`. See the [note on passwords](#passwords) first, because this doesn't work yet.
- It won't overwrite an existing `.db-snapshots.json`.

### `dbs create [name]`

Takes a snapshot of your database and saves it to snapshot storage.

```sh
dbs create                 # automatic snapshot, e.g. local_2026-11-15_09-30-00
dbs create before-migration  # named snapshot
```

Good to know:

- Without a name you get an **automatic snapshot**, named after the connection and the current time. `dbs cleanup` removes old ones for you.
- With a name you get a **named snapshot**, which `dbs cleanup` never removes. Use these for baselines you want to keep.
- Names can contain letters, digits, `.`, `_` and `-`. Any other character becomes `-` (`my db!` is saved as `my-db-`), and a name can't start with a dot.
- If a snapshot with that name already exists, you're asked whether to overwrite it (default No).
- Press `Ctrl-C` to cancel. No partial snapshot is left behind.

### `dbs load [name]`

> [!CAUTION]
> Loading **drops every table and view** in the target database before loading the snapshot. Anything not in the snapshot is lost. Stored routines and events are left as they are.

Loads a snapshot into your database, replacing its tables and views.

```sh
dbs load before-migration  # exact name
dbs load migration         # part of a name also works
dbs load                   # pick from a list, newest first
```

Good to know:

- If part of a name matches more than one snapshot, you pick from the matches.
- A snapshot can only be loaded into a database of the same type it was taken from (MySQL and MariaDB count as the same type). A mismatch is caught before anything is dropped.

### `dbs list`

Lists the snapshots in snapshot storage, newest first.

```sh
dbs list
```

```text
Name                           Connection  Driver  Created at           Size       Compressed
before-migration               local       mysql   2026-11-15 09:30:00  12.4 MiB   no
local_2026-11-14_18-02-11      local       mysql   2026-11-14 18:02:11  12.1 MiB   no
```

Snapshot files that weren't created by `dbs` show `—` for the details it can't know.

### `dbs delete [name]`

Deletes a snapshot from snapshot storage. It finds the snapshot the same way `dbs load` does: by exact name, part of a name, or from a list.

```sh
dbs delete before-migration
dbs delete              # pick from a list
```

Good to know:

- If you typed only part of the name, you're asked to confirm before anything is deleted (default No).
- It doesn't touch your database, and the MySQL client tools don't need to be installed.

### `dbs cleanup`

Deletes old automatic snapshots, keeping the newest 2 for each connection.

```sh
dbs cleanup
```

Good to know:

- Named snapshots are never deleted, and neither are snapshot files that weren't created by `dbs`.
- Each deleted snapshot is printed.

### Global options

| Option                                            | Description                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `--help`, `-h`, `dbs help [command]`              | Show general help, or help for one command.                              |
| `--version`                                       | Print the `dbs` version.                                                 |
| `--no-color` (or set the `NO_COLOR` env variable) | Turn off colored output. Color is also off when output isn't a terminal. |

## Configuration

`dbs` reads `.db-snapshots.json`, usually created by `dbs init`. It looks in the current directory and then each parent directory, so you can run `dbs` from anywhere in your project.

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

| Field                | Required | Description                                                                                                           |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `connections`        | Yes      | Your connections, by name. At least one is required.                                                                  |
| `default_connection` | No       | The connection to use when you have more than one. See [Which connection is used](#which-connection-is-used).         |
| `storage`            | No       | Snapshot storage: the directory where snapshots are saved, relative to `.db-snapshots.json`. Defaults to `snapshots`. |
| `$schema`            | No       | Turns on autocomplete and validation in editors that support JSON Schema (`dbs init` adds it).                        |

Unknown fields are rejected, so a typo in a field name shows up as an error instead of being silently ignored.

### Connection fields

| Field      | Required | Description                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------- |
| `driver`   | Yes      | The database type. Only `mysql` is supported for now, and it covers both MySQL and MariaDB. |
| `database` | Yes      | The database to snapshot and load into.                                                     |
| `host`     | No       | Database server host. Defaults to whatever the MySQL client tools use.                      |
| `port`     | No       | Database server port.                                                                       |
| `user`     | No       | Database user.                                                                              |
| `password` | No       | Database password. See [Passwords](#passwords).                                             |

### Passwords

The password is never passed on the command line, so it doesn't show up in process lists.

> [!NOTE]
> Environment variables such as `"${DB_PASSWORD}"` are **not supported yet** ([#45](https://github.com/jrobinsonc/db-snapshots/issues/45)). They're sent as the literal text. Until then, either put the password in the file (and keep that file out of version control) or leave `password` out.

### Which connection is used

When `dbs create` or `dbs load` runs:

- If you set `default_connection`, that connection is used. If the name doesn't match any connection, you get an error.
- If you have only one connection, that one is used.
- Otherwise you pick from a list of your connections.

## Scripting and CI

When `dbs` isn't running in an interactive terminal, it never prompts. Any step that would ask you something fails with an error instead. That includes `dbs init`, choosing between connections or snapshots, and confirming an overwrite or delete. So in scripts, pass exact snapshot names and set `default_connection` if you have more than one connection.

Exit codes:

| Code  | Meaning                                                            |
| ----- | ------------------------------------------------------------------ |
| `0`   | Success.                                                           |
| `1`   | The command failed (for example, a snapshot wasn't found).         |
| `2`   | The command was used incorrectly (for example, an unknown option). |
| `130` | Cancelled with `Ctrl-C`.                                           |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
