# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Complexity sizes (T-shirt)

Track an issue's estimated complexity with an additional `size:*` label, alongside its category and state role.

| Size | Label     | Meaning              |
| ---- | --------- | -------------------- |
| XS   | `size:xs` | Extra small effort   |
| S    | `size:s`  | Small effort         |
| M    | `size:m`  | Medium effort        |
| L    | `size:l`  | Large effort         |
| XL   | `size:xl` | Extra large effort   |

An issue should carry at most one `size:*` label. The `triage` skill does not calculate these automatically; apply or update them during triage when the effort is clear.
