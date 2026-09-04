const ASU_SCHOOL_ID = '15723'; // Arizona State University (Tempe) school ID on RMP
const INVALID_NAMES = ['staff', 'tba', 'tbd', 'to be announced', 'to be determined'];

export function getRateMyProfessorUrl(professorName: string | null | undefined): string | null {
  const name = professorName?.trim();
  if (!name || INVALID_NAMES.includes(name.toLowerCase())) return null;
  return `https://www.ratemyprofessors.com/search/professors/${ASU_SCHOOL_ID}?q=${encodeURIComponent(name)}`;
}
