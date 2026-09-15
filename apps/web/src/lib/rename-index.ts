// Re-keys the emitted `index.html` to `app.html` inside a Rollup bundle so the file is
// written under the new name and VitePWA's precache manifest (built afterwards from
// dist/) lists it. The dev server keeps serving index.html.
export function rekeyIndexHtml<T extends { fileName: string }>(bundle: Record<string, T>): void {
  const html = bundle['index.html'];
  if (!html) return;
  html.fileName = 'app.html';
  bundle['app.html'] = html;
  delete bundle['index.html'];
}
