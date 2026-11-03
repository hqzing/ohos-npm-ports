const testStart = /^  (?:static test[A-Z][A-Za-z0-9_]*\s*=|(?:async\s+)?test(?:Setup)?\s*\()/m;

export function splitRecipe(source) {
  if (!source.startsWith('#!/usr/bin/env node')) return { docsText: '', buildText: source, testText: '' };
  const firstLineEnd = source.indexOf('\n');
  const header = source.slice(0, firstLineEnd + 1);
  let body = source.slice(firstLineEnd + 1);
  let docsText = '';
  const comment = /^\s*\/\*[\s\S]*?\*\//.exec(body);
  if (comment) {
    docsText = comment[0];
    body = body.slice(comment[0].length);
  }
  const match = testStart.exec(body);
  if (!match) return { docsText, buildText: header + body, testText: '' };
  return {
    docsText,
    buildText: header + body.slice(0, match.index),
    testText: body.slice(match.index),
  };
}

export function recipeBuildText(source) {
  return splitRecipe(source).buildText;
}
