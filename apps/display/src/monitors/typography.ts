const NBSP = " ";

/**
 * Longest pair of final words that is still bound together. Monitor text is
 * large; a longer pair could no longer fit on one line and would then be
 * split inside a word (`overflow-wrap: anywhere`), which is worse than a widow.
 */
export const MAX_BOUND_TAIL_CHARS = 20;

/**
 * Keeps a single word from ending up alone on the last line (a typographic
 * widow, "Hurenkind"): in every line of three or more words, the last two
 * words are joined with a non-breaking space. Authored line breaks stay;
 * one- and two-word lines and over-long final pairs are left alone.
 */
export function withoutWidows(text: string): string {
  return text.split("\n").map((line) => {
    const match = /^(.*\S)[ \t]+(\S+)([ \t]*)$/.exec(line);
    if (!match) return line;
    const [, head, last, trailing] = match;
    const before = /(\S+)$/.exec(head!)![1]!;
    const words = head!.trim().split(/[ \t]+/).length + 1;
    if (words < 3 || before.length + 1 + last!.length > MAX_BOUND_TAIL_CHARS) return line;
    return `${head}${NBSP}${last}${trailing}`;
  }).join("\n");
}
