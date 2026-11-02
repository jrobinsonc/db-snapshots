# Database Snapshots

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
