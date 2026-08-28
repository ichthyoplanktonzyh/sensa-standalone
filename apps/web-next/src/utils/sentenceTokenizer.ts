import type { SentenceToken } from '../types';
import { lemmatize } from '../services/quickDict';

/**
 * 将可能包含 <b> 标签的例句 HTML 字符串解析为结构化 Token 列表
 * 保证保留原始空格、标点符号，同时支持词形还原与 TTS 字符偏移量对齐
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

  // 2. 对每个 segment 按照单词和非单词（标点/空格）进行细分
  // 英文词元模式：支持带连字符或缩写的词，如 "We'll", "state-of-the-art"
  const wordOrPunctRegex = /([a-zA-Z0-9]+(?:['’][a-zA-Z0-9]+)?|[^\w\s]+|\s+)/g;

  for (const seg of segments) {
    let subMatch: RegExpExecArray | null;
    while ((subMatch = wordOrPunctRegex.exec(seg.text)) !== null) {
      const rawText = subMatch[0];
      const isWord = /^[a-zA-Z0-9]+(?:['’][a-zA-Z0-9]+)?$/.test(rawText);
      const cleanWord = isWord ? rawText.replace(/['’]/g, "'") : '';
      const lemma = isWord ? lemmatize(cleanWord) : '';

      const charStart = currentPlainOffset;
      const charEnd = currentPlainOffset + rawText.length;
      currentPlainOffset = charEnd;

      tokens.push({
        id: `tok_${tokenCounter++}`,
        text: rawText,
        cleanWord,
        lemma,
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
