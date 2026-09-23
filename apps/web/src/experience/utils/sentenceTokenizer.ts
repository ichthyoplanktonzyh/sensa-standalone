import type { SentenceToken } from '../types';

/**
 * 将可能包含 <b> 标签的例句 HTML 字符串解析为结构化 Token 列表
 * 保证保留原始空格、标点符号与 TTS/查词所需的字符偏移量。
 * 词形还原必须读取完整句子，因此由 Reference 查词模块在点击后完成。
 */
export function tokenizeSentence(sentenceHtml: string): {
  tokens: SentenceToken[];
  plainText: string;
} {
  // 1. 拆分 <b> 标签块，提取每个字符是否属于 target 重点词
  // 例如 "These <b>folk</b> customs..."
  const regex = /(<b>[\s\S]*?<\/b>|[^<]+|<[^>]+>)/g;
  let match: RegExpExecArray | null;

  interface Segment {
    text: string;
    isTarget: boolean;
  }

  const segments: Segment[] = [];
  while ((match = regex.exec(sentenceHtml)) !== null) {
    const chunk = match[0];
    if (chunk.startsWith('<b>') && chunk.endsWith('</b>')) {
      const innerText = chunk.slice(3, -4);
      segments.push({ text: innerText, isTarget: true });
    } else if (!chunk.startsWith('<')) {
      segments.push({ text: chunk, isTarget: false });
    }
  }

  const tokens: SentenceToken[] = [];
  let currentPlainOffset = 0;
  let tokenCounter = 0;

  // 2. Segment words in the source script while retaining punctuation and
  // whitespace as tokens, so offsets still address the original sentence.
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, {granularity: 'word'})
    : null;
  const fallbackTokens = /([\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)?|[^\p{L}\p{M}\p{N}\s]+|\s+)/gu;

  for (const seg of segments) {
    const parts = segmenter
      ? Array.from(segmenter.segment(seg.text), part => ({text: part.segment, isWord: part.isWordLike === true}))
      : Array.from(seg.text.matchAll(fallbackTokens), match => ({text: match[0], isWord: /^[\p{L}\p{M}\p{N}]/u.test(match[0])}));
    for (const {text: rawText, isWord} of parts) {
      const cleanWord = isWord ? rawText.replace(/['’]/g, "'") : '';

      const charStart = currentPlainOffset;
      const charEnd = currentPlainOffset + rawText.length;
      currentPlainOffset = charEnd;

      tokens.push({
        id: `tok_${tokenCounter++}`,
        text: rawText,
        cleanWord,
        isWord,
        isTarget: seg.isTarget && isWord,
        charStart,
        charEnd,
      });
    }
  }

  const plainText = tokens.map((t) => t.text).join('');

  return {
    tokens,
    plainText,
  };
}

/**
 * 根据 TTS onboundary 抛出的 charIndex 快速定位命中哪一个 Word Token
 */
export function findTokenIndexByCharOffset(
  tokens: SentenceToken[],
  charIndex: number
): number {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.isWord && charIndex >= t.charStart && charIndex < t.charEnd) {
      return i;
    }
  }
  // 如果正好落在空格，找下一个最近的 word
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.isWord && t.charStart >= charIndex) {
      return i;
    }
  }
  return -1;
}
