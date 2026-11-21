// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Same answers, byte for byte, on every input: BOM, stray CRs, unterminated
// quotes, quote junk, short/long rows, and {code, line, row} errors, in the
// order the reference meets them. Written from the reference's rules, not
// from any other parser.
//
// Speed comes from never building a field one character at a time:
//  - records with no quote at all (and no CR but a trailing CRLF) are split
//    natively with String.split(',');
//  - unquoted fields are scanned with charCodeAt and cut out with one slice,
//    the scan inlined in the field loop so no helper call or array is made
//    per field;
//  - quoted fields jump to the closing quote with indexOf, resolving doubled
//    quotes only when one is actually there, and count/normalise line breaks
//    inside quotes only when the content holds one.
// No state is kept from one call to the next.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    let quoted = false;

    // Fast path: the whole record is one physical line with no quote in it
    // and no CR except a trailing CRLF. Then no field can span lines, no
    // field is quoted, and a native split gives every field at once.
    const eol = text.indexOf('\n', pos);
    const hasLF = eol !== -1;
    const lineEnd = hasLF ? eol : n;
    const q0 = text.indexOf('"', pos);
    if (q0 === -1 || q0 >= lineEnd) {
      const r0 = text.indexOf('\r', pos);
      if (r0 === -1 || r0 >= lineEnd) {
        const s = text.slice(pos, lineEnd);
        if (s.length !== 0) {
          fields = s.split(',');
          pos = hasLF ? eol + 1 : n;
          if (hasLF) line += 1;
        } else {
          pos = hasLF ? eol + 1 : n;
          if (hasLF) line += 1;
          continue;
        }
      } else if (hasLF && r0 === lineEnd - 1) {
        const s = text.slice(pos, lineEnd - 1);
        if (s.length !== 0) {
          fields = s.split(',');
          pos = eol + 1;
          line += 1;
        } else {
          pos = eol + 1;
          line += 1;
          continue;
        }
      }
    }

    if (fields === null) {
      // Slow path: field by field, exactly as the reference reads them.
      fields = [];
      let ended = COMMA;
      while (ended === COMMA) {
        let field;
        // uv: the value an unquoted scan starts from, or null when this
        // field is already decided and no scan is needed.
        let uv = null;
        let countJunk = false;
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          const open = pos;
          const openLine = line;
          let start = pos + 1;
          let value = null;
          let q = text.indexOf('"', start);
          let closed = false;
          while (q !== -1) {
            if (text.charCodeAt(q + 1) === 34) {
              value = (value === null ? text.slice(start, q) : value + text.slice(start, q)) + '"';
              start = q + 2;
              q = text.indexOf('"', start);
            } else {
              closed = true;
              break;
            }
          }
          if (!closed) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            uv = '"';
          } else {
            value = value === null ? text.slice(start, q) : value + text.slice(start, q);
            // CRLF and lone CR inside quotes each read as one LF, and every
            // line break inside quotes counts toward the line.
            if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
              let delta = 0;
              let hasCR = false;
              for (let i = 0; i < value.length; i++) {
                const c = value.charCodeAt(i);
                if (c === 10) {
                  delta += 1;
                } else if (c === 13) {
                  delta += 1;
                  hasCR = true;
                  if (value.charCodeAt(i + 1) === 10) i += 1;
                }
              }
              line += delta;
              if (hasCR) value = value.replace(/\r\n?/g, '\n');
            }
            pos = q + 1;
            if (pos >= n) {
              field = value;
              ended = END;
            } else {
              const c = text.charCodeAt(pos);
              if (c === 44) {
                pos += 1;
                field = value;
                ended = COMMA;
              } else if (c === 10) {
                pos += 1;
                line += 1;
                field = value;
                ended = BREAK;
              } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line += 1;
                field = value;
                ended = BREAK;
              } else {
                // What follows the closing quote is appended as it stands,
                // up to the next comma or line break.
                uv = value;
                countJunk = true;
              }
            }
          }
        } else {
          quoted = false;
          uv = '';
        }
        if (uv === null) {
          fields.push(field);
          continue;
        }
        // Unquoted scan: characters onto `uv` up to the next comma or line
        // break; a CR not followed by LF is dropped (stray_cr). `added`
        // counts the characters kept, for the quote_junk check.
        let value = uv;
        let added = 0;
        let start = pos;
        ended = END;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            value += text.slice(start, pos);
            if (countJunk) added += pos - start;
            pos += 1;
            ended = COMMA;
            break;
          }
          if (c === 10) {
            value += text.slice(start, pos);
            if (countJunk) added += pos - start;
            pos += 1;
            line += 1;
            ended = BREAK;
            break;
          }
          if (c === 13) {
            if (text.charCodeAt(pos + 1) === 10) {
              value += text.slice(start, pos);
              if (countJunk) added += pos - start;
              pos += 2;
              line += 1;
              ended = BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            value += text.slice(start, pos);
            if (countJunk) added += pos - start;
            pos += 1;
            start = pos;
            continue;
          }
          pos += 1;
        }
        if (ended === END) {
          value += text.slice(start, pos);
          if (countJunk) added += pos - start;
        }
        if (countJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(value);
      }

      // A line that held only stray CRs is left with no characters: no record.
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
