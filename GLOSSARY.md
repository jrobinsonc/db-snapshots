# DB Snapshots

A framework-agnostic CLI for creating, loading and managing database snapshots.

## Language

**Driver**:
The database engine a Connection speaks: `mysql` (also covers MariaDB), `pgsql` or `sqlite`.
_Avoid_: Engine, adapter, dialect

**Connection**:
A named set of settings that identifies one database to snapshot or load into, including its Driver.
_Avoid_: Environment, profile, target

**Snapshot**:
A full or partial SQL dump of one Connection's database, stored as a single `.sql` or `.sql.gz` file in the Snapshot Storage.
_Avoid_: Dump, backup, export

**Snapshot Name**:
The identity of a Snapshot: its filename without the `.sql` / `.sql.gz` extension. Unique within the Snapshot Storage.
_Avoid_: Label, ID

**Automatic Snapshot**:
A Snapshot whose name was generated from its Connection and creation time because no name was given. Only these are subject to Cleanup by default.
_Avoid_: Timestamped snapshot, default snapshot

**Named Snapshot**:
A Snapshot whose name was chosen explicitly by the user. Treated as a deliberate baseline.
_Avoid_: Custom snapshot, labelled snapshot

**Cleanup**:
Deleting older Automatic Snapshots so that only the newest N per Connection remain.
_Avoid_: Prune, rotate, purge

**Protected Connection**:
A Connection whose loads must be confirmed explicitly because overwriting it would be costly.
_Avoid_: Production connection

**Snapshot Storage**:
The single local directory holding all Snapshots for a project.
_Avoid_: Disk, dump dir, folder

**Snapshot Header**:
The leading SQL comment line in a Snapshot that records the Driver, Connection and creation time it was made with.
_Avoid_: Metadata file, sidecar
