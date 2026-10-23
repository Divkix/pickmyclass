export interface SectionRef {
  class_nbr: string;
  term: string;
}

export function sectionRefKey(ref: SectionRef): string {
  return `${ref.term}:${ref.class_nbr}`;
}

/** Just the SectionRef keys, for log fields: callers often hold a wider object (a queue message). */
export function sectionFields(ref: SectionRef): SectionRef {
  return { class_nbr: ref.class_nbr, term: ref.term };
}
