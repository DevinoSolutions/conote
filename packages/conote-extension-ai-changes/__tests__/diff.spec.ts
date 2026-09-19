import { describe, expect, it } from 'vite-plus/test'

import { collapseWhitespace, diffWords, isWhitespaceOnlyEdit, tokenize } from '../src/index.js'

describe('tokenize', () => {
  it('bundles trailing horizontal whitespace with each word', () => {
    expect(tokenize('the quick fox')).toEqual(['the ', 'quick ', 'fox'])
  })

  it('keeps each newline as its own token', () => {
    expect(tokenize('a\nb')).toEqual(['a', '\n', 'b'])
  })

  it('round-trips: joining tokens reproduces the input', () => {
    const text = '  leading  and\ntrailing   spaces \n\n end'
    expect(tokenize(text).join('')).toBe(text)
  })

  it('returns no tokens for the empty string', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('diffWords', () => {
  it('returns no hunks for identical text', () => {
    expect(diffWords('the cat sat', 'the cat sat')).toEqual([])
  })

  it('produces a replace hunk for a changed word', () => {
    const hunks = diffWords('the cat', 'the dog')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({ oldStart: 4, oldEnd: 7, newText: 'dog' })
  })

  it('produces a pure-insertion hunk (oldStart === oldEnd)', () => {
    const hunks = diffWords('a c', 'a b c')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(hunks[0].oldEnd)
    expect(hunks[0].oldStart).toBe(2)
    expect(hunks[0].newText).toBe('b ')
  })

  it('produces a pure-deletion hunk (newText === "")', () => {
    const hunks = diffWords('a b c', 'a c')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].newText).toBe('')
    expect('a b c'.slice(hunks[0].oldStart, hunks[0].oldEnd)).toBe('b ')
  })

  it('produces multiple hunks separated by equal runs', () => {
    const hunks = diffWords('one two three four', 'ONE two THREE four')
    expect(hunks).toHaveLength(2)
    expect('one two three four'.slice(hunks[0].oldStart, hunks[0].oldEnd)).toBe('one ')
    expect(hunks[0].newText).toBe('ONE ')
    expect('one two three four'.slice(hunks[1].oldStart, hunks[1].oldEnd)).toBe('three ')
    expect(hunks[1].newText).toBe('THREE ')
  })

  it('treats a whitespace-only difference as a change', () => {
    const hunks = diffWords('hello world', 'hello  world')
    expect(hunks.length).toBeGreaterThan(0)
    // Reconstructing the new text from the hunks yields the double space.
    const [h] = hunks
    const rebuilt = 'hello world'.slice(0, h.oldStart) + h.newText + 'hello world'.slice(h.oldEnd)
    expect(rebuilt).toBe('hello  world')
  })

  it('reconstructs the new text when all hunks are applied', () => {
    const oldText = 'The quick brown fox jumps'
    const newText = 'A quick red fox leaps'
    const hunks = diffWords(oldText, newText)
    let result = oldText
    for (const h of [...hunks].sort((a, b) => b.oldStart - a.oldStart)) {
      result = result.slice(0, h.oldStart) + h.newText + result.slice(h.oldEnd)
    }
    expect(result).toBe(newText)
  })

  it('flags a reflow (single -> double space) as whitespace-only', () => {
    const [hunk] = diffWords('hello world', 'hello  world')
    const oldText = 'hello world'.slice(hunk.oldStart, hunk.oldEnd)
    expect(isWhitespaceOnlyEdit(oldText, hunk.newText)).toBe(true)
  })

  it('does not flag a real word change as whitespace-only', () => {
    const [hunk] = diffWords('the cat', 'the dog')
    const oldText = 'the cat'.slice(hunk.oldStart, hunk.oldEnd)
    expect(isWhitespaceOnlyEdit(oldText, hunk.newText)).toBe(false)
  })

  it('falls back to a single whole-text hunk when the token product is too large', () => {
    const oldText = Array.from({ length: 1200 }, (_, i) => `old${i}`).join(' ')
    const newText = Array.from({ length: 1200 }, (_, i) => `new${i}`).join(' ')
    const hunks = diffWords(oldText, newText)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(0)
    expect(hunks[0].oldEnd).toBe(oldText.length)
    expect(hunks[0].newText).toBe(newText)
  })
})

describe('isWhitespaceOnlyEdit', () => {
  it('treats stray leading/trailing spaces and reflows as whitespace-only', () => {
    expect(isWhitespaceOnlyEdit('hello ', 'hello  ')).toBe(true)
    expect(isWhitespaceOnlyEdit('word', 'word ')).toBe(true)
    expect(isWhitespaceOnlyEdit('', ' ')).toBe(true)
    expect(isWhitespaceOnlyEdit('a b', 'a  b')).toBe(true)
  })

  it('keeps a word-boundary change (ab -> a b) as a real edit', () => {
    expect(isWhitespaceOnlyEdit('ab', 'a b')).toBe(false)
    expect(isWhitespaceOnlyEdit('cat', 'dog')).toBe(false)
    expect(isWhitespaceOnlyEdit('', 'b ')).toBe(false)
  })

  it('collapseWhitespace normalizes runs and trims', () => {
    expect(collapseWhitespace('  a   b  ')).toBe('a b')
  })
})
