# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nestaa404/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nestaa404/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for the [make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
(`csv-reader-speed-01-run-20261121`): write a faster drop-in for make.fun's own
csv-reader 1.0.0 that answers exactly as it does on every case.

## What it does

`solve.js` exports `run(input)`, which returns csv-reader 1.0.0's answer
`{columns, rows, errors}` for one case's `{text, header}` — byte for byte the
same reading, including the broken-row policy: a leading U+FEFF is dropped,
records end at LF or CRLF, empty lines are no records, a CR outside quotes
that is not followed by LF is dropped (`stray_cr`), a field opening with a
quote runs to the next undoubled quote with `""` read as one quote and every
CRLF or lone CR inside read as LF, junk after a closing quote is appended as
it stands (`quote_junk`), a quote that never closes is a literal character
and the text after it is read again as unquoted (`unterminated_quote`), a
quote inside an unquoted field is literal, and records are padded
(`short_row`) or cut (`long_row`) to the first record's width, each error
`{code, line, row}` in the order met.

`main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`.

## Why it is faster

The reference reads one character at a time and builds every field a
character at a time. This entry never does that:

- records with no quote at all (and no CR but a trailing CRLF) are split
  natively with `String.split(',')`;
- unquoted fields are scanned with `charCodeAt` and cut out with a single
  `slice`, the scan inlined in the field loop so no helper call or array is
  made per field;
- quoted fields jump to the closing quote with `indexOf`, resolving doubled
  quotes only when one is actually there, and count and normalise line
  breaks inside quotes only when the content holds one.

No state is kept from one case to the next, and nothing is cached between
cases. Dependency-free, JavaScript only, no WebAssembly or native addons.

## Measured locally (practice set, 6 cases, 10.2 MB of CSV)

| entry | CPU per full set |
| --- | --- |
| house baseline (csv-reader 1.0.0) | ~1.09 s |
| this entry (`run` only) | ~0.19 s |

about 5.6x faster on the parser, with identical answers on all 6 practice
cases, on 12 further full-size cases drawn from the kit's own generator with
fresh seeds, and on 50,112 differential fuzz cases against the reference.

## Run it

```sh
node main.ts
```

with `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` standing in for `/input`
and `/output` outside the sandbox. Requires Node 22 or later.

## License

MIT — see [LICENSE](LICENSE).
