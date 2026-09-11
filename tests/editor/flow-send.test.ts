// @vitest-environment jsdom
/**
 * PolicyDebateFlow send: tagline+cite extraction, the "not connected" /
 * "no tagline" guard toasts (no network call in either case), and the
 * presence → send → toast flow against a mocked fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { settings } from '../../src/editor/settings.js';
import { extractTaglinePayload, sendTaglineToFlowAsync } from '../../src/editor/flow-send.js';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
import { showToast } from '../../src/editor/toast.js';

function citeText(text: string): ReturnType<(typeof schema)['text']> {
  return schema.text(text, [schema.marks['cite_mark']!.create()]);
}

function cardWithCite(tagText: string, cite: string | null): PMNode {
  const children = [schema.nodes['tag']!.create(null, tagText ? schema.text(tagText) : undefined)];
  if (cite !== null) {
    children.push(schema.nodes['cite_paragraph']!.create(null, cite ? citeText(cite) : undefined));
  }
  return schema.nodes['card']!.create(null, children);
}

function para(text = ''): PMNode {
  return schema.nodes['paragraph']!.create(null, text ? schema.text(text) : undefined);
}

function mkView(doc: PMNode): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, { state: EditorState.create({ doc, schema }) });
}

/** Move the cursor to just inside the first node of the given type. */
function placeCursorIn(view: EditorView, typeName: string): void {
  let pos = -1;
  view.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === typeName) pos = p + 1;
    return true;
  });
  if (pos < 0) throw new Error(`no ${typeName} node in doc`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

describe('extractTaglinePayload', () => {
  it('pulls the tagline and cite-marked author/date from an enclosing card', () => {
    const view = mkView(schema.nodes['doc']!.create(null, [cardWithCite('Warming causes extinction', 'Mann 24')]));
    placeCursorIn(view, 'tag');
    const payload = extractTaglinePayload(view);
    expect(payload).toEqual({ taglineText: 'Warming causes extinction', authorDate: 'Mann 24' });
    view.destroy();
  });

  it('returns null when the card has a cite paragraph but no cite-marked text', () => {
    const view = mkView(
      schema.nodes['doc']!.create(null, [
        schema.nodes['card']!.create(null, [
          schema.nodes['tag']!.create(null, schema.text('Some tag')),
          schema.nodes['cite_paragraph']!.create(null, schema.text('plain, unmarked cite text')),
        ]),
      ]),
    );
    placeCursorIn(view, 'tag');
    expect(extractTaglinePayload(view)).toBeNull();
    view.destroy();
  });

  it('returns null for an empty tagline', () => {
    const view = mkView(schema.nodes['doc']!.create(null, [cardWithCite('', 'Mann 24')]));
    placeCursorIn(view, 'cite_paragraph');
    expect(extractTaglinePayload(view)).toBeNull();
    view.destroy();
  });

  it('returns null when the cursor is outside any card', () => {
    const view = mkView(schema.nodes['doc']!.create(null, [para('just a paragraph, no card here')]));
    placeCursorIn(view, 'paragraph');
    expect(extractTaglinePayload(view)).toBeNull();
    view.destroy();
  });

  it('works from anywhere inside the card, not just the tag itself', () => {
    const view = mkView(
      schema.nodes['doc']!.create(null, [
        (() => {
          const tag = schema.nodes['tag']!.create(null, schema.text('Tagline here'));
          const body = schema.nodes['card_body']!.create(null, schema.text('body text'));
          const cite = schema.nodes['cite_paragraph']!.create(null, citeText('Smith 23'));
          return schema.nodes['card']!.create(null, [tag, body, cite]);
        })(),
      ]),
    );
    placeCursorIn(view, 'card_body');
    expect(extractTaglinePayload(view)).toEqual({ taglineText: 'Tagline here', authorDate: 'Smith 23' });
    view.destroy();
  });
});

describe('sendTaglineToFlowAsync — guard clauses (no network call)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    settings.set('policyDebateFlowEnabled', false);
    settings.set('policyDebateFlowToken', '');
  });

  it('toasts "Connect PolicyDebateFlow in Settings first" when not connected, without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = mkView(schema.nodes['doc']!.create(null, [cardWithCite('Tag', 'Author 24')]));
    placeCursorIn(view, 'tag');
    await sendTaglineToFlowAsync(view);
    expect(showToast).toHaveBeenCalledWith('Connect PolicyDebateFlow in Settings first');
    expect(fetchMock).not.toHaveBeenCalled();
    view.destroy();
  });

  it('toasts "No tagline (with a cite) here to send" when connected but nothing sendable is at the cursor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'test-token');
    const view = mkView(schema.nodes['doc']!.create(null, [para('no card here')]));
    placeCursorIn(view, 'paragraph');
    await sendTaglineToFlowAsync(view);
    expect(showToast).toHaveBeenCalledWith('No tagline (with a cite) here to send');
    expect(fetchMock).not.toHaveBeenCalled();
    view.destroy();
  });
});

describe('sendTaglineToFlowAsync — network flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    settings.set('policyDebateFlowEnabled', false);
    settings.set('policyDebateFlowToken', '');
  });

  function connect(): void {
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'test-token');
  }

  function view(): EditorView {
    const v = mkView(schema.nodes['doc']!.create(null, [cardWithCite('Warming causes extinction', 'Mann 24')]));
    placeCursorIn(v, 'tag');
    return v;
  }

  it('sends the presence-supplied target and shows the sheet/flow success toast', async () => {
    connect();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            present: true,
            flowId: 'f1',
            flowName: 'Round 3 — Harvard',
            sheetId: 's1',
            sheetName: 'Off 1',
            focusedRow: 4,
            focusedCol: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const v = view();
    await sendTaglineToFlowAsync(v);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [presenceUrl, presenceInit] = fetchMock.mock.calls[0]!;
    expect(String(presenceUrl)).toContain('/pf-presence');
    expect((presenceInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(String(sendUrl)).toContain('/pf-send-card');
    const body = JSON.parse((sendInit as RequestInit).body as string);
    expect(body).toEqual({
      taglineText: 'Warming causes extinction',
      authorDate: 'Mann 24',
      sheetId: 's1',
      targetRow: 4,
      targetCol: 1,
    });

    expect(showToast).toHaveBeenCalledWith('Sent to Off 1 – Round 3 — Harvard');
    v.destroy();
  });

  it('toasts "PolicyDebateFlow isn\'t open" and never attempts the send when presence reports absent', async () => {
    connect();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ present: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const v = view();
    await sendTaglineToFlowAsync(v);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("PolicyDebateFlow isn't open");
    v.destroy();
  });

  it('toasts the expired-connection message on a 401 from presence', async () => {
    connect();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const v = view();
    await sendTaglineToFlowAsync(v);

    expect(showToast).toHaveBeenCalledWith('PolicyDebateFlow connection expired — re-pair in Settings');
    v.destroy();
  });

  it('toasts the expired-connection message on a 401 from send-card too', async () => {
    connect();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            present: true,
            flowId: 'f1',
            flowName: 'Round 3',
            sheetId: 's1',
            sheetName: 'Off 1',
            focusedRow: 0,
            focusedCol: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const v = view();
    await sendTaglineToFlowAsync(v);

    expect(showToast).toHaveBeenCalledWith('PolicyDebateFlow connection expired — re-pair in Settings');
    v.destroy();
  });

  it('surfaces a network failure as a failure toast rather than throwing', async () => {
    connect();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const v = view();
    await expect(sendTaglineToFlowAsync(v)).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Send to PolicyDebateFlow failed'));
    v.destroy();
  });
});
