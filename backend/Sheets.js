// Thin Sheet access. Apps Script only (uses SpreadsheetApp); not loaded by Node tests.
// Columns are located by the header text in row 1, so a tab that gained extra
// columns later still reads and writes correctly.

function sheet_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sh) throw new Error("Missing tab: " + tab + ". Run setup().");
  return sh;
}

function headersOf_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function readTable_(tab) {
  var sh = sheet_(tab);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headersOf_(sh);
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row) {
    return rowToObj(headers, row);
  });
}

// A tab's rows like readTable_, found and read once; null when the Sheet has no
// such tab or its row 1 lacks one of `columns` (an older Sheet before migrate).
function readTableOrNull_(tab, columns) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sh || sh.getLastColumn() === 0) return null;
  var headers = headersOf_(sh);
  for (var i = 0; i < columns.length; i++) if (headers.indexOf(columns[i]) === -1) return null;
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row) {
    return rowToObj(headers, row);
  });
}

// Writes one row below the last, formatting it first (text columns "@", the
// rest "General") so it never relies on setup() having formatted enough rows.
// Callers hold the write lock, so getLastRow() + 1 is free.
function appendObj_(tab, obj) {
  var sh = sheet_(tab);
  var headers = headersOf_(sh);
  var rowNum = sh.getLastRow() + 1;
  // Unlike appendRow, getRange cannot reach past the sheet's last row: grow it first.
  if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  var range = sh.getRange(rowNum, 1, 1, headers.length);
  range.setNumberFormats([headers.map(function (h) { return isTextColumn(tab, h) ? "@" : "General"; })]);
  range.setValues([objToRow(headers, obj)]);
}

// Writes rows below the last as one block, formatted as appendObj_ does.
// Callers hold the write lock.
function appendObjs_(tab, objs) {
  if (!objs.length) return;
  var sh = sheet_(tab);
  var headers = headersOf_(sh);
  var rowNum = sh.getLastRow() + 1;
  var need = rowNum + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
  var range = sh.getRange(rowNum, 1, objs.length, headers.length);
  var formats = headers.map(function (h) { return isTextColumn(tab, h) ? "@" : "General"; });
  range.setNumberFormats(objs.map(function () { return formats; }));
  range.setValues(objs.map(function (o) { return objToRow(headers, o); }));
}

// One column's cells from row 2 down (index 0 is sheet row 2); [] when the tab lacks it.
function columnValues_(tab, column) {
  var sh = sheet_(tab);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var col = headersOf_(sh).indexOf(column);
  if (col === -1) return [];
  return sh.getRange(2, col + 1, last - 1, 1).getValues().map(function (r) { return unsanitizeCell(r[0]); });
}

// One column's cells in the given sheet rows, read as one range from the
// first to the last of them (a picture's chunks are side by side).
function cellsAt_(tab, column, rowNums) {
  if (!rowNums.length) return [];
  var sh = sheet_(tab);
  var col = headersOf_(sh).indexOf(column);
  if (col === -1) return rowNums.map(function () { return ""; });
  var lo = Math.min.apply(null, rowNums), hi = Math.max.apply(null, rowNums);
  var cells = sh.getRange(lo, col + 1, hi - lo + 1, 1).getValues();
  return rowNums.map(function (n) { return unsanitizeCell(cells[n - lo][0]); });
}

// Deletes the given sheet rows, each run of neighbours at once, bottom up.
function deleteRowsAt_(tab, rowNums) {
  var sh = sheet_(tab);
  var list = rowNums.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < list.length) {
    var top = list[i], count = 1;
    while (i + count < list.length && list[i + count] === top - count) count++;
    sh.deleteRows(top - count + 1, count);
    i += count;
  }
}

// Writes only the patched columns of the first row whose `column` equals
// `value`, and returns that row as read back. A blank lookup value never
// matches (it would hit an empty row); a patch value of undefined is skipped.
// A cell Sheets hands back as a Date compares as yyyy-MM-dd (cellDate_).
function updateWhere_(tab, column, value, patch) {
  if (value === "" || value === null || value === undefined) return null;
  var sh = sheet_(tab);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var headers = headersOf_(sh);
  var col = headers.indexOf(column);
  if (col === -1) return null;
  var cells = sh.getRange(2, col + 1, last - 1, 1).getValues();
  for (var i = 0; i < cells.length; i++) {
    if (cellDate_(unsanitizeCell(cells[i][0])) !== String(value)) continue;
    var rowNum = i + 2;
    Object.keys(patch).forEach(function (key) {
      var c = headers.indexOf(key);
      if (c === -1 || patch[key] === undefined) return;
      sh.getRange(rowNum, c + 1).setValue(patch[key] === null ? "" : sanitizeCell(patch[key]));
    });
    return rowToObj(headers, sh.getRange(rowNum, 1, 1, headers.length).getValues()[0]);
  }
  return null;
}

// Whether a tab's row 1 has this column (an older Sheet may lack one until migrate).
function hasColumn_(tab, column) {
  var sh = sheet_(tab);
  return sh.getLastColumn() > 0 && headersOf_(sh).indexOf(column) !== -1;
}

// Whether the Sheet has this tab (an older Sheet may lack one until migrate).
function hasTab_(tab) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab) !== null;
}

function updateById_(tab, id, patch) {
  return updateWhere_(tab, "id", id, patch);
}

// Adds every tab TABS names that the Sheet lacks (row 1 frozen, as setup()
// leaves it), and every column a tab's row 1 lacks, at the end, bold and
// formatted the way setup() formats it (text columns "@"). Returns what it
// added as "Tab.column". Safe to run twice: the second run adds nothing.
function ensureColumns_() {
  var added = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      sh.setFrozenRows(1);
    }
    var have = sh.getLastColumn() === 0 ? [] : headersOf_(sh);
    TABS[tab].forEach(function (h) {
      if (have.indexOf(h) !== -1) return;
      var col = have.length + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
      sh.getRange(1, col).setValue(h).setFontWeight("bold");
      if (isTextColumn(tab, h)) sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat("@");
      have.push(h);
      added.push(tab + "." + h);
    });
  });
  return added;
}
