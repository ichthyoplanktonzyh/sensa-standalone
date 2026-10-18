// Local builds are deliberately unversioned. CI stamps the compiled module
// before sealing the candidate; a runtime environment variable cannot forge it.
export const releaseCommit: string | null = null;
