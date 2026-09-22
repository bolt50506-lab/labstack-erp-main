import JsBarcode from 'jsbarcode';

/**
 * Renders a real, scannable Code128 barcode to a PNG data URL. Code128
 * handles alphanumeric sample IDs directly (unlike Code39/EAN, which
 * need a restricted character set), which matches the S-XXXXXX / order
 * code formats already used in this app.
 */
export function generateBarcodeDataUrl(value: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 1.6,
    height: 40,
    displayValue: true,
    fontSize: 12,
    margin: 4,
  });
  return canvas.toDataURL('image/png');
}
