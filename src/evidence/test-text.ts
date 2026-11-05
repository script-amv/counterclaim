import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
/** Decode the actual page content streams and hex-encoded text emitted by pdf-lib. */
export async function decodedPacketText(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map(page => {
    const contents = page.node.Contents();
    const objects = contents && 'asArray' in contents ? contents.asArray() : contents ? [contents] : [];
    return objects.map(object => {
      const stream = document.context.lookup(object);
      if (!(stream instanceof PDFRawStream)) return '';
      const commands = Buffer.from(decodePDFRawStream(stream).decode()).toString();
      return [...commands.matchAll(/<([0-9A-F]+)>\s*Tj/g)].map(m => Buffer.from(m[1]!, 'hex').toString('latin1')).join('\n');
    }).join('\n');
  }).join('\n');
}
