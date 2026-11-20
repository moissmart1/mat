// Runs inside Chromium. Range rectangles include the font's full ascent and
// descent. Measure glyph ink for overlap checks while retaining the browser's
// positions, line wrapping and shaping for each grapheme.
module.exports = function textInk() {
  const ctx = document.createElement("canvas").getContext("2d");
  const range = document.createRange();
  const letters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return (node) => {
    const style = getComputedStyle(node.parentElement);
    ctx.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
    const rects = [];
    for (const { index, segment } of letters.segment(node.data)) {
      if (!segment.trim()) continue;
      const text = style.textTransform === "uppercase" ? segment.toUpperCase() : segment;
      const m = ctx.measureText(text);
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height || !m.width) continue;
      const yScale = r.height / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
      const baseline = r.top + yScale * m.fontBoundingBoxAscent;
      const xScale = r.width / m.width;
      rects.push({
        left: r.left - xScale * m.actualBoundingBoxLeft,
        right: r.left + xScale * m.actualBoundingBoxRight,
        top: baseline - yScale * m.actualBoundingBoxAscent,
        bottom: baseline + yScale * m.actualBoundingBoxDescent,
      });
    }
    return rects;
  };
};
