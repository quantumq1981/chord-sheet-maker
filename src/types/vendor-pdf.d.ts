// Type shims for the browser-only vector-PDF vendor modules.
// The standalone pdfkit build and svg-to-pdfkit ship without usable types at
// these import paths, so we declare minimal surfaces here.

declare module 'pdfkit/js/pdfkit.standalone.js' {
  // The standalone UMD build default-exports the PDFDocument constructor.
  // Typed loosely on purpose — we only use a small slice of the API.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PDFDocument: any;
  export default PDFDocument;
}

declare module 'svg-to-pdfkit' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SVGtoPDF: (doc: any, svg: string, x?: number, y?: number, options?: Record<string, unknown>) => void;
  export default SVGtoPDF;
}
