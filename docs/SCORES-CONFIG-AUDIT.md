# Live scores config audit

Generated 2026-08-12. Re-run any time with the one-liner at the bottom.

**The rule:** scores come from `https://tsu-scores-bridge.onrender.com` on channel
`sports`, NOT from `bridge.tradesecretsunlocked.com`. See TSU-OVERLAY-STANDARD.md §11.

An overlay in the BROKEN column connects successfully, logs no error, and receives
no scores forever. It cannot be detected from `bridge_events`, because the bridge
deliberately never logs `scores` events. It must be checked in the file or the browser.

> **Re-read this before trusting the table below (added 2026-08-18).**
> This audit only lists overlays that had scores wiring **on 2026-08-12**. Overlays with no
> scores wiring at all were omitted — so **absence from this table is not a pass**.
>
> `blue-light-rips` is the worked example. It was absent here because on 2026-08-12 it had
> no scores wiring whatsoever. Wiring was added on **2026-08-15**, three days after this
> audit and after the rule was written, and it was added **against the main bridge**. It
> then sat broken until 2026-08-18 while its `known_issues` row said "fixed".
>
> Two lessons, both now gates in TSU-OVERLAY-STANDARD §11:
> 1. **Re-run this audit after any change that touches scores**, not just periodically.
> 2. **Never mark a scores issue fixed without confirming the HOST**, not just the channel.
>    Getting the channel right and the host wrong looks identical to working code.

| Overlay | Scores wiring |
|---|---|
| 7cbreaks | **BROKEN**, points at main bridge |
| NationofCards | **BROKEN**, points at main bridge |
| apex-card-company | **BROKEN**, points at main bridge |
| barn-breaks | **BROKEN**, points at main bridge |
| birdie-breaks | **BROKEN**, points at main bridge |
| blue-light-rips | **FIXED 2026-08-18**, dedicated service (was BROKEN, wired 08-15 against the main bridge) |
| crunch-zone | **FIXED 2026-08-18** overlay side, dedicated service. **Producer side still open**: bridge_keys.namespace='crunchzone' means the producer publishes to `sports-crunchzone`, which nobody listens to. See known_issues bug 17 |
| break-doctor | **BROKEN**, points at main bridge |
| breakout-kings | **BROKEN**, points at main bridge |
| breakz4dayz | **BROKEN**, points at main bridge |
| cbcb | **BROKEN**, points at main bridge |
| chance-pehrson | **BROKEN**, points at main bridge |
| doghouse-breaks | OK, dedicated service |
| doublembreakz | **BROKEN**, points at main bridge |
| golden-triangle | **BROKEN**, points at main bridge |
| h-vault | **BROKEN**, points at main bridge |
| hit-streak-collectibles | **BROKEN**, points at main bridge |
| hoovs | **BROKEN**, points at main bridge |
| jim-and-tabby | **BROKEN**, points at main bridge |
| jp2-cards | OK, dedicated service |
| lakefront-breaks | **BROKEN**, points at main bridge |
| legends-hobby | **BROKEN**, points at main bridge |
| lnl | **BROKEN**, points at main bridge |
| midwestbreak | **BROKEN**, points at main bridge |
| northland-breaks-2 | **BROKEN**, points at main bridge |
| northland-breaks | **BROKEN**, points at main bridge |
| pmm | **BROKEN**, points at main bridge |
| powerv2 | **BROKEN**, points at main bridge |
| quantum-breaks | OK, dedicated service |
| southside-collects | **BROKEN**, points at main bridge |
| terminal-takes | **BROKEN**, points at main bridge |
| texas-hobby | **BROKEN**, points at main bridge |
| thehitchasers | **BROKEN**, points at main bridge |
| windy-city-breaks | **BROKEN**, points at main bridge |
| wizards-trading-cards | **BROKEN**, points at main bridge |

Overlays with no scores wiring at all are omitted. They are not broken, they simply
never implemented scores. If such a client IS entitled to scores in `client_services`,
they are paying for something their overlay cannot display, which is worth catching.

## Re-run this audit

```bash
cd card-break-overlay/overlays
for f in */index.html; do d=$(dirname "$f")
  has=$(grep -cE "connectScoresSSE|channel=sports" "$f"); [ "$has" -eq 0 ] && continue
  ded=$(grep -c "tsu-scores-bridge" "$f")
  [ "$ded" -gt 0 ] && echo "OK      $d" || echo "BROKEN  $d"
done
```

## Cross-check against who is actually paying

```sql
select bk.client_name, bk.whatnot_handle
from client_services cs join bridge_keys bk on bk.key = cs.key
where cs.service='scores' and cs.entitled and cs.enabled and bk.active
order by 1;
```

Any client in that result whose overlay is BROKEN above is entitled to scores and is
not receiving them.
