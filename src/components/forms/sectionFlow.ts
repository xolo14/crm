/**
 * "Go to section based on answer" (Google Forms branching) shared by both form systems.
 *
 * A form is a flat list of items; `section_break` items start a new page. Multiple-choice /
 * dropdown questions may carry a `goTo` map: option → target. Targets:
 *   "next"   continue to the following section (default)
 *   "submit" finish the form
 *   <id>     jump to the section whose break item has this id
 * When several branching questions in one section are answered, the last one wins (as in Google Forms).
 */

export type GoToTarget = "next" | "submit" | string;

export type FlowSection<T> = {
  /** `section_break` item id, or "section-default" for the implicit first page. */
  id: string;
  title?: string;
  description?: string;
  items: T[];
  /** Index of the break item in the flat list (-1 for the implicit first section). */
  breakIndex: number;
};

export function splitIntoSections<T>(
  items: T[],
  opts: {
    isBreak: (item: T) => boolean;
    id: (item: T) => string;
    title?: (item: T) => string | undefined;
    description?: (item: T) => string | undefined;
  },
): FlowSection<T>[] {
  const sections: FlowSection<T>[] = [];
  let current: FlowSection<T> = { id: "section-default", items: [], breakIndex: -1 };
  items.forEach((item, idx) => {
    if (opts.isBreak(item)) {
      // Explicit sections are kept even when empty (they carry a title); the implicit first
      // page is dropped when the form starts with a section break.
      if (current.breakIndex >= 0 || current.items.length) sections.push(current);
      current = {
        id: opts.id(item) || `section-${idx}`,
        title: opts.title?.(item),
        description: opts.description?.(item),
        items: [],
        breakIndex: idx,
      };
      return;
    }
    current.items.push(item);
  });
  if (current.breakIndex >= 0 || current.items.length || sections.length === 0) sections.push(current);
  return sections;
}

/**
 * Decide where to go after `currentIdx`.
 * `pickTarget(item)` returns the target chosen by the respondent's answer to `item`, or null when
 * the item has no branching / is unanswered.
 */
export function resolveNextSection<T>(
  sections: FlowSection<T>[],
  currentIdx: number,
  pickTarget: (item: T) => GoToTarget | null,
): number | "submit" {
  const section = sections[currentIdx];
  if (!section) return "submit";
  let target: GoToTarget | null = null;
  for (const item of section.items) {
    const t = pickTarget(item);
    if (t) target = t; // last answered branching question wins
  }
  if (target === "submit") return "submit";
  if (target && target !== "next") {
    const idx = sections.findIndex((s) => s.id === target);
    if (idx >= 0 && idx !== currentIdx) return idx;
  }
  return currentIdx + 1 < sections.length ? currentIdx + 1 : "submit";
}

/** Section choices offered in the builder for a branching question (excludes the current section). */
export function goToChoices<T>(sections: FlowSection<T>[], currentSectionId: string): Array<{ value: GoToTarget; label: string }> {
  const out: Array<{ value: GoToTarget; label: string }> = [
    { value: "next", label: "Continue to next section" },
  ];
  sections.forEach((s, i) => {
    if (s.id === currentSectionId) return;
    out.push({ value: s.id, label: `Go to section ${i + 1}${s.title ? ` (${s.title})` : ""}` });
  });
  out.push({ value: "submit", label: "Submit form" });
  return out;
}

/** Only sections that were actually visited count for required-field validation and for the progress bar. */
export function visitedSectionIds(history: number[], sections: FlowSection<unknown>[]): Set<string> {
  return new Set(history.map((i) => sections[i]?.id).filter(Boolean) as string[]);
}
