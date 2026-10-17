#!/usr/bin/env bash
# Kör alla huvudserier sekventiellt, var och en i 4 parallella skärvor. Återupptar där den slutade.
cd "$(dirname "$0")/../.."
for preset in s1 s2 s3; do
  for i in 0 1 2 3; do npx tsx experiments/hybrid/run-batch.ts $preset $i 4 > /tmp/$preset.$i.log 2>&1 & done
  wait
  echo "$preset klar $(date +%T)" >> /tmp/run-all.log
done
echo ALLT_KLART >> /tmp/run-all.log
