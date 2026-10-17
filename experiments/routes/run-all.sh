#!/usr/bin/env bash
cd "$(dirname "$0")/../.."
for preset in modes checkpoints deadend; do
  for i in 0 1 2; do npx tsx experiments/routes/run-batch.ts $preset $i 3 > /tmp/m-$preset.$i.log 2>&1 & done
  wait
  echo "$preset klar $(date +%T)" >> /tmp/m-all.log
done
echo ALLT_KLART >> /tmp/m-all.log
