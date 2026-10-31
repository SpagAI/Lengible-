declare module "word-extractor" {
  class WordExtractor {
    extract(source: string | Buffer): Promise<{ getBody(): string; getFootnotes(): string; getHeaders(): string; getTextboxes(o?: unknown): string }>;
  }
  export default WordExtractor;
}
