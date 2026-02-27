# Notes: SVG→PDF strategy

This implementation exports PDF pages by rasterizing each rendered OSMD SVG page into a high-resolution PNG and then placing each PNG into a jsPDF page with fit-to-page scaling and margins.

## Why true vector SVG→PDF was not implemented here

A robust in-browser *vector* SVG→PDF pipeline for complex OpenSheetMusicDisplay output is not straightforward with the current stack. In practice, it typically requires an additional conversion layer (for example svg-to-pdfkit + pdfkit, or other SVG parsing/rendering adapters) that brings additional bundle/runtime complexity and can still require careful handling for fonts, text layout, and transformed groups.

Given the project constraints (client-side only, GitHub Pages, desktop browser support, and immediate reliability), the raster pipeline was implemented to ship dependable export behavior now.

## What would be needed next time for vector PDF

A likely path:

1. Add a browser-compatible vector SVG→PDF conversion pipeline (e.g., `pdfkit` + `svg-to-pdfkit`, or another maintained SVG-to-PDF renderer).
2. Validate fidelity for OSMD output specifically:
   - complex paths and glyphs
   - text/font embedding and fallback behavior
   - transformed groups and clipping
3. Keep multipage handling by rendering one SVG per PDF page.
4. Compare output size, text selectability, and print quality against current raster output.

## Known limitations of typical vector approaches

- Font handling can be brittle without embedding/registering fonts.
- Some SVG features (filters, masks, clip-path combinations) may render inconsistently.
- Browser bundling size/cost can increase noticeably.
- Multipage orchestration still needs explicit page layout + margin logic.
