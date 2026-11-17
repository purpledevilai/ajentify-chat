/**
 * Anchored text edits — the one `edits` contract used everywhere on the platform.
 *
 * BYTE-IDENTICAL SHARED MODULE: this file lives in three packages —
 *   - ajentify-sdk            `src/textEdits.ts`              (@ajentify/sdk)
 *   - ajentify-chat           `packages/chat/src/lib/textEdits.ts`  (@ajentify/chat)
 *   - ajentify-voice          `packages/voice/src/lib/textEdits.ts` (@ajentify/voice)
 * Author once, copy verbatim; a literal `diff` must be empty. It mirrors (not imports) the
 * Python source of truth `ajentify-api/src/Services/TextEdits.py` (also in ajentify-connect and the
 * execution lambda's `aj_apply_edits`). Change the semantics in the Python module first, then
 * every mirror.
 *
 * Contract (Notebook 2026-11-17 plan §3.1): an ordered list of edits, each one of
 *
 *   { operation: 'replace',       target: '<exact existing text>', content: '<new text>' }
 *   { operation: 'insert_before', anchor: '<exact existing text>', content: '<text>' }
 *   { operation: 'insert_after',  anchor: '<exact existing text>', content: '<text>' }
 *   { operation: 'delete',        target: '<exact existing text>' }
 *
 * The target/anchor must occur EXACTLY once in the text (exact, case- and whitespace-sensitive).
 * Edits apply in order — a later edit may reference text produced by an earlier one — and are
 * all-or-nothing: the first failing edit throws `TextEditError` and the caller keeps the original.
 *
 * Note: JS strings are UTF-16 while Python counts code points, so `contexts` windows may differ
 * by a few characters around astral-plane characters. Accepted; do not try to fix.
 */

export const EDIT_OPERATIONS = ['replace', 'insert_before', 'insert_after', 'delete'] as const;
export const EDIT_CONTEXT_CHARS = 80;
export const MAX_AMBIGUOUS_CONTEXTS = 3;

/** Vendor marker the web schema editor stores so an `edits` parameter survives a reload. It is
 * stripped (with every other `x-ajentify-*` key) before a tool schema reaches an LLM provider. */
export const EDITS_TYPE_MARKER = 'x-ajentify-type';

export type EditOperationName = (typeof EDIT_OPERATIONS)[number];

export type EditOperation = {
  operation: EditOperationName;
  /** Exact existing text to replace or delete (replace, delete). */
  target?: string;
  /** Exact existing text to insert next to (insert_before, insert_after). */
  anchor?: string;
  /** New text (replace, insert_before, insert_after). */
  content?: string;
};

export type EditSummary = {
  replaced: number;
  inserted_before: number;
  inserted_after: number;
  deleted: number;
};

export type TextEditErrorCode = 'empty_edits' | 'invalid_edit' | 'target_not_found' | 'ambiguous_target';

/** Canonical JSON Schema of an `edits` parameter. Custom tools built in the web editor / SDKs
 * emit exactly this; built-in tools build the same shape from their pydantic models. */
export const EDITS_SCHEMA = {
  type: 'array',
  minItems: 1,
  [EDITS_TYPE_MARKER]: 'edits',
  description:
    'Ordered, all-or-nothing text edits. Each target/anchor must occur EXACTLY once in the text ' +
    '(matching is exact, case- and whitespace-sensitive); include enough surrounding text to make it ' +
    'unique. A later edit may reference text produced by an earlier one.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: [...EDIT_OPERATIONS] },
      target: { type: 'string', description: 'Exact existing text to replace or delete (replace, delete).' },
      anchor: { type: 'string', description: 'Exact existing text to insert next to (insert_before, insert_after).' },
      content: { type: 'string', description: 'New text (replace, insert_before, insert_after).' },
    },
  },
} as const;

/** One-line description of the shape, for tool parameter descriptions. */
export const EDITS_FIELD_DESCRIPTION =
  'Ordered list of edits. Each is one of: ' +
  '{"operation": "replace", "target": "<exact existing text>", "content": "<new text>"}; ' +
  '{"operation": "insert_before", "anchor": "<exact existing text>", "content": "<text to insert>"}; ' +
  '{"operation": "insert_after", "anchor": "<exact existing text>", "content": "<text to insert>"}; ' +
  '{"operation": "delete", "target": "<exact existing text>"}. ' +
  'Targets/anchors must be non-empty and occur exactly once.';

/**
 * A failed edit. `code` is one of `empty_edits`, `invalid_edit`, `target_not_found`,
 * `ambiguous_target`; `details` always carries `edit_index` for per-edit failures and, for
 * `ambiguous_target`, `match_count` + up to `MAX_AMBIGUOUS_CONTEXTS` surrounding `contexts`.
 */
export class TextEditError extends Error {
  readonly code: TextEditErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: TextEditErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TextEditError';
    this.code = code;
    this.details = details ?? {};
  }

  toJSON(): { code: TextEditErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Start offsets of every (overlapping) occurrence of `needle`. */
function findAll(text: string, needle: string): number[] {
  const hits: number[] = [];
  let start = 0;
  for (;;) {
    const idx = text.indexOf(needle, start);
    if (idx < 0) break;
    hits.push(idx);
    start = idx + 1;
  }
  return hits;
}

function context(text: string, idx: number, needleLen: number): string {
  const half = Math.floor(EDIT_CONTEXT_CHARS / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, idx + needleLen + half);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns `[operation, needle, content]`. Throws `TextEditError('invalid_edit')`. */
export function validateEdit(edit: unknown, index: number): [EditOperationName, string, string] {
  if (!isObject(edit)) {
    throw new TextEditError('invalid_edit', `Edit ${index} must be an object.`, { edit_index: index });
  }
  const operation = edit.operation;
  if (!(EDIT_OPERATIONS as readonly unknown[]).includes(operation)) {
    throw new TextEditError(
      'invalid_edit',
      `Edit ${index}: operation must be one of ${EDIT_OPERATIONS.join(', ')}.`,
      { edit_index: index, operation: operation ?? null },
    );
  }
  const op = operation as EditOperationName;
  const needleField = op === 'insert_before' || op === 'insert_after' ? 'anchor' : 'target';
  let needle = edit[needleField];
  if (needle == null && needleField === 'target' && edit.anchor != null) {
    needle = edit.anchor; // be forgiving about target/anchor mix-ups
  }
  if (needle == null && needleField === 'anchor' && edit.target != null) {
    needle = edit.target;
  }
  if (typeof needle !== 'string' || needle === '') {
    throw new TextEditError('invalid_edit', `Edit ${index}: '${needleField}' must be a non-empty string.`, {
      edit_index: index,
    });
  }
  let content = edit.content;
  if (op === 'delete') {
    content = '';
  } else if (content == null || typeof content !== 'string') {
    throw new TextEditError('invalid_edit', `Edit ${index}: 'content' must be a string.`, { edit_index: index });
  } else if ((op === 'insert_before' || op === 'insert_after') && content === '') {
    throw new TextEditError('invalid_edit', `Edit ${index}: 'content' must be non-empty for ${op}.`, {
      edit_index: index,
    });
  }
  return [op, needle, content as string];
}

/**
 * Apply `edits` in order to `text`. Returns `{ text, summary }` where summary is
 * `{ replaced, inserted_before, inserted_after, deleted }` counts. Throws `TextEditError`
 * on the first failing edit; the input is never mutated.
 */
export function applyEdits(text: string, edits: EditOperation[]): { text: string; summary: EditSummary } {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new TextEditError('empty_edits', 'edits must be a non-empty list.');
  }
  if (typeof text !== 'string') {
    throw new TextEditError('invalid_edit', 'text must be a string.');
  }
  const summary: EditSummary = { replaced: 0, inserted_before: 0, inserted_after: 0, deleted: 0 };
  for (let index = 0; index < edits.length; index++) {
    const [operation, needle, content] = validateEdit(edits[index], index);
    const hits = findAll(text, needle);
    if (hits.length === 0) {
      throw new TextEditError(
        'target_not_found',
        `The target for edit ${index} was not found in the text (matching is exact, case- and whitespace-sensitive).`,
        { edit_index: index, match_count: 0 },
      );
    }
    if (hits.length > 1) {
      throw new TextEditError(
        'ambiguous_target',
        `The target for edit ${index} occurred ${hits.length} times; include more surrounding text to make it unique.`,
        {
          edit_index: index,
          match_count: hits.length,
          contexts: hits.slice(0, MAX_AMBIGUOUS_CONTEXTS).map((h) => context(text, h, needle.length)),
        },
      );
    }
    const idx = hits[0] as number;
    if (operation === 'replace') {
      text = text.slice(0, idx) + content + text.slice(idx + needle.length);
      summary.replaced += 1;
    } else if (operation === 'insert_before') {
      text = text.slice(0, idx) + content + text.slice(idx);
      summary.inserted_before += 1;
    } else if (operation === 'insert_after') {
      const end = idx + needle.length;
      text = text.slice(0, end) + content + text.slice(end);
      summary.inserted_after += 1;
    } else {
      text = text.slice(0, idx) + text.slice(idx + needle.length);
      summary.deleted += 1;
    }
  }
  return { text, summary };
}
