# NVR Simulator

**Live:** https://vishnuvsdevtech.github.io/nvr-simulator/

A scaled-down network video recorder you can break, so the concepts stop being
diagrams. Four cameras record to a RAID array under a retention policy; you can
lose a camera, pull a disk, corrupt a segment, and watch what the playback index
actually contains afterwards.

## What it models honestly

| Quantity | How it is computed |
|---|---|
| Bytes written | `bitrate ÷ 8 × seconds`, per camera |
| Capacity | `(live disks − redundancy) × 256 MB`, by RAID level |
| **Actual retention** | `min(policy, capacity)` — whichever runs out first |
| RAID tolerance | single 0, RAID 5 → 1, RAID 6 → 2 dead disks |
| Failure | dead disks > tolerance ⇒ recording stops immediately |
| Playback | one segment per camera per tick; gaps stay gaps |

The point the simulator makes visible: **retention is set by the disk, not by the
policy.** Ask for 15 minutes, get 9.6, and the counter shows both numbers side by
side until you shrink the bitrate or change the array.

## What is scaled

Disks are 256 MB, not terabytes; the clock runs 3× by default. A real 8-camera,
30-day site needs roughly 4–8 TB, which is exactly the arithmetic the simulator
lets you do before promising a customer anything.

## Things to try

1. **Fill it.** Leave it running at 3× — the policy says 15 min, the capacity says
   less. Watch "actual retention" settle below "policy retention".
2. **Kill a camera.** A gap appears in that lane; the other lanes keep filling.
   This is what a "missing footage" complaint looks like.
3. **Unplug a disk** on RAID 5 — state goes `degraded`. Unplug a second — `ARRAY
   FAILED`, and recording stops while the footage already written stays readable.
4. **Corrupt a segment.** It turns amber; click it and the hash is there but the
   status says it decodes with artefacts. That is the case your integrity proof
   exists for.
5. **Switch to RAID 6** with two dead disks and watch capacity drop by one disk
   while tolerance stays at two.

## What it is not

Not a real recorder: no codecs, no network, no ONVIF. The subject in each tile is
a moving rectangle, not video. What it does simulate accurately is the arithmetic
and the failure bookkeeping — which is where most storage conversations go wrong.
