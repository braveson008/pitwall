import { useEffect, useRef } from "react";
import { EditorState, Compartment, Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, LanguageDescription, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";

export type EditorSelection = { startLine: number; endLine: number; top: number; left: number };

type Props = {
  path: string;
  /** The text on disk. A new value replaces the document, so only pass one on open or reload. */
  text: string;
  onDirty: (dirty: boolean) => void;
  /** Resolves true when the text reached the disk. */
  onSave: (text: string) => Promise<boolean>;
  onSelection: (selection: EditorSelection | null) => void;
};

// The diffs' own colours, so a file reads the same in Review and here.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.tagName], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--syntax-function)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--syntax-punctuation)" },
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.link, textDecoration: "underline" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--text)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "0", color: "var(--faint)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "36px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(var(--accent-rgb), 0.22)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-matchingBracket": { backgroundColor: "var(--pressed)", outline: "none" },
  ".cm-searchMatch": { backgroundColor: "var(--pressed)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)", borderColor: "var(--line)" },
});

export default function CodeEditor({ path, text, onDirty, onSave, onSelection }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDirty, onSave, onSelection });
  callbacks.current = { onDirty, onSave, onSelection };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let baseline: Text = Text.of(text.split("\n"));
    let dirty = false;
    const language = new Compartment();

    const setDirty = (next: boolean) => {
      if (next === dirty) return;
      dirty = next;
      callbacks.current.onDirty(next);
    };

    const save = (view: EditorView) => {
      const snapshot = view.state.doc;
      void callbacks.current.onSave(snapshot.toString()).then((ok) => {
        if (!ok) return;
        baseline = snapshot;
        setDirty(!view.state.doc.eq(baseline));
      });
      return true;
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: baseline,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(highlight, { fallback: true }),
          language.of([]),
          keymap.of([{ key: "Mod-s", run: save, preventDefault: true }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(!update.state.doc.eq(baseline));
            if (!update.selectionSet && !update.docChanged) return;
            const range = update.state.selection.main;
            if (range.empty) {
              callbacks.current.onSelection(null);
              return;
            }
            // Measured in CodeMirror's own read phase, so asking where the
            // selection is never forces a layout in the middle of a write.
            update.view.requestMeasure({
              read: (view) => {
                const coords = view.coordsAtPos(range.head);
                const box = view.dom.getBoundingClientRect();
                return coords ? { top: coords.bottom - box.top, left: Math.min(coords.left - box.left, box.width - 120) } : null;
              },
              write: (measured, view) => {
                const current = view.state.selection.main;
                if (!measured || current.empty) return;
                const doc = view.state.doc;
                const startLine = doc.lineAt(current.from).number;
                // A selection ending at the start of a line does not include it.
                const endAt = current.to > current.from && doc.lineAt(current.to).from === current.to ? current.to - 1 : current.to;
                callbacks.current.onSelection({ startLine, endLine: doc.lineAt(endAt).number, ...measured });
              },
            });
          }),
        ],
      }),
    });

    let cancelled = false;
    const description = LanguageDescription.matchFilename(languages, path);
    if (description) {
      void description.load().then((support) => {
        if (!cancelled) view.dispatch({ effects: language.reconfigure(support) });
      }).catch(() => {});
    }
    callbacks.current.onDirty(false);

    return () => {
      cancelled = true;
      callbacks.current.onSelection(null);
      view.destroy();
    };
  }, [path, text]);

  return <div className="dk-code-editor" ref={hostRef} />;
}
