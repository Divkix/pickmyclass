export interface SectionRef {
  class_nbr: string;
  term: string;
}

export function sectionRefKey(ref: SectionRef): string {
  return `${ref.term}:${ref.class_nbr}`;
}
