# Fleet Config secret slots

JoeDesk Fleet Config is a **plaintext paper file**. People and processes should
be able to read quota, desk limits, cadence and paths. That readability does
not extend to credentials.

## Plaintext policy vs AGE secrets

| Lives in Fleet Config | Must never appear here |
| --- | --- |
| Slot capability (`agenix`, `janus`) | Passwords, API keys, bearer tokens |
| Slot path / reference name (`joe-board-push-token`) | AGE ciphertext, decrypted secret material |
| The word `REDACTED` as the value marker | Rotation workflows or secret injection |

AGE / agenix owns encrypted secret material on the host. Janus keeps its own
capability boundary. JoeDesk only names the slots those systems already know.

The checked-in example (`public/joe/fleet-config.example.json`) therefore lists
`secretSlots.agenix: ["joe-board-push-token"]` and an empty Janus array. Those
strings are references, not values.

## What the flip plane shows

The Secret slots section lists each declared capability and path ref from the
current `inspr.joe.fleet-config.v1` document. Every declared slot ends with
`REDACTED`; an empty capability says `No slots declared` without implying a
hidden value exists. Preview fields for these refs are read-only. Propagation
still rejects slot edits (HOSTD-49). This slice does not rotate secrets
(HOSTD-52). Propagation outcomes are recorded by HOSTD-50 using changed-key
names only; attempted secret-slot changes appear only as
`secretSlots.[redacted]`.

## Janus/agenix ops

Rotate, inject and recover secrets in the existing host Janus / agenix
workflow — not on this board. v1 only needs that pointer: the Fleet Config
plane is a catalog of refs, not a secret manager.
