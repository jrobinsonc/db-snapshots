# Load Snapshots through the Driver's client binaries

Snapshots are loaded by streaming the file into each Driver's standard client (`mysql`, `psql`, `sqlite3`), never by executing SQL in-process through a database driver. Loading in-process (for example with `Bun.SQL` / `bun:sqlite`) would remove the client-tool dependency on the load side, but it requires the tool to split SQL into statements itself. That parser has to track quoting and escape rules that differ per engine, strip client meta-commands such as `psql`'s `\connect`, and handle `COPY … FROM stdin` blocks. The clients already do all of this correctly and stream large files without buffering them.

## Consequences

- Each Driver needs both its dump and load binaries available (or reachable through `exec_prefix`).
- PostgreSQL dumps can use COPY format instead of slower `--inserts`.
- `psql` must be run with `ON_ERROR_STOP=1`, because by default it continues after errors.
