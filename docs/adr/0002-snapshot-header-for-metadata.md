# Store Snapshot metadata in an in-file SQL comment header

Each Snapshot records its Driver, Connection and creation time in a leading SQL comment line (`-- db-snapshots: driver=… connection=… created=…`) rather than in a sidecar file or index. File mtime is unreliable (copies, checkouts and syncs reset it), and that metadata drives ordering, `--latest`, Cleanup and the Driver-mismatch check. A comment is valid input for every client, so the Snapshot stays a single self-describing file that is loadable as-is. A sidecar would need to be kept in sync on copy, rename and delete.

## Considered Options

- **gzip header comment (`FCOMMENT`)**: readable without inflating any data, but plain `.sql` files would still need the SQL comment (two mechanisms), Bun/Node zlib cannot write custom gzip header fields (we would hand-build gzip headers), and `gunzip`/recompression drops the field.
- **Sidecar file or central index**: free to read, but must be kept in sync on copy, rename and delete; copying only the Snapshot file silently loses its metadata.
- **Encoding metadata in the filename**: free to read, but the filename is the Snapshot Name, and Named Snapshots must keep the exact name the user chose.

## Consequences

- Reading the header of a `.sql.gz` Snapshot does **not** decompress the file. gzip is a streaming format, so the reader inflates only the leading block until the first newline and then stops. The cost is constant regardless of Snapshot size (measured: ~0.3 ms and ~136 KB read on a 382 MB `.sql.gz`, versus ~1 s to decompress it fully). Do not "optimize" this away with a sidecar or index.
- Header reads must use a streaming reader that stops at the first newline. Never read or inflate the whole file to get metadata.
- Foreign `.sql` files without a header remain supported, with mtime as a fallback and unknown Connection/Driver.
