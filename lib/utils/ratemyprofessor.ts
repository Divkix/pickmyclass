/**
 * RateMyProfessor integration utilities
 */

const ASU_SCHOOL_ID = "1081"; // Arizona State University school ID on RMP

/**
 * Generates a RateMyProfessor search URL for a professor at ASU
 * @param professorName - Full name of the professor (e.g., "James Gordon")
 * @returns RMP search URL or null if professor name is invalid
 */
export function getRateMyProfessorUrl(professorName: string | null | undefined): string | null {
  if (!professorName || professorName.trim() === "" || professorName.toLowerCase() === "staff") {
    return null;
  }

  // Clean up professor name (remove extra whitespace, titles, etc.)
  const cleanName = professorName.trim();

  // URL encode the professor name for search
  const encodedName = encodeURIComponent(cleanName);

  // RMP search URL format: https://www.ratemyprofessors.com/search/professors/{school_id}?q={professor_name}
  return `https://www.ratemyprofessors.com/search/professors/${ASU_SCHOOL_ID}?q=${encodedName}`;
}

/**
 * Check if a professor name is valid for RMP lookup
 * @param professorName - Professor name to validate
 * @returns true if the name can be looked up on RMP
 */
export function isValidProfessorName(professorName: string | null | undefined): boolean {
  if (!professorName || professorName.trim() === "") {
    return false;
  }

  const cleanName = professorName.trim().toLowerCase();

  // Common placeholder values that shouldn't be looked up
  const invalidNames = ["staff", "tba", "tbd", "to be announced", "to be determined"];

  return !invalidNames.includes(cleanName);
}
