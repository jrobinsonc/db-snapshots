# Contributing

## Requirements

- [Bun v1.4.4+](https://bun.com/docs/installation)
- [MySQL client CLI (`mysql` and `mysqldump`)](https://dev.mysql.com/doc/)

## Install, check, test and build

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

## Project docs

- [`GLOSSARY.md`](GLOSSARY.md): the domain language used in code, issues and docs.
- [`docs/adr/`](docs/adr/): architecture decision records.
