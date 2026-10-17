#!/bin/sh
# Fake lenz-ocr: reports how many bytes arrived on stdin.
n=$(wc -c | tr -d ' ')
printf '{"text":"bytes:%s","confidence":0.93,"coverage":0.41}\n' "$n"
