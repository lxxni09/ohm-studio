#!/usr/bin/env bash
# Exportiert alle Beispielprojekte als Gerber und prüft sie mit gerbonara (unabhängiger Parser).
set -euo pipefail
PY=${PYTHON:-python3}
OUT=$(mktemp -d)
fails=0
for f in examples/*.ohm; do
  n=$(basename "$f" .ohm)
  cp "$f" "$OUT/$n.ohm"
  npx tsx scripts/ohm.ts export "$OUT/$n.ohm" gerber
  for i in $(seq 1 20); do [ -s "$OUT/$n-gerber.zip" ] && break; sleep 0.2; done
  mkdir -p "$OUT/$n"
  unzip -o -q "$OUT/$n-gerber.zip" -d "$OUT/$n"
  exp=$(npx tsx scripts/gerber-expect.ts "$OUT/$n.ohm")
  echo "== $n (erwartet: $exp)"
  # shellcheck disable=SC2086
  if ! "$PY" scripts/check_gerber.py "$OUT/$n" $exp 2>/dev/null | tail -3; then fails=$((fails+1)); fi
done
echo "Projekte mit Fehlern: $fails"
exit $fails
