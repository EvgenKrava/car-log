// Split free text into chunks of at most maxLen characters, breaking on line
// boundaries. A single line longer than maxLen is hard-split. Whitespace-only
// lines are dropped when they would start a chunk; no empty chunks are produced.
export function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(current);
    current = '';
  };
  for (const line of text.split('\n')) {
    if (line.length > maxLen) {
      pushCurrent();
      for (let i = 0; i < line.length; i += maxLen) chunks.push(line.slice(i, i + maxLen));
      continue;
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > maxLen) {
      pushCurrent();
      current = line;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks.filter((c) => c.trim().length > 0);
}

// Flat merge preserving list order, truncated at cap.
export function mergeCandidates<T>(lists: T[][], cap: number): T[] {
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (out.length >= cap) return out;
      out.push(item);
    }
  }
  return out;
}