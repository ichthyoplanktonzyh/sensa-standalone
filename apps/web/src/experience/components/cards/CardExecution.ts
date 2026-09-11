/** Optional local-runtime port. Cards submit responses; the host owns grading and persistence. */
export interface CardExecution {
  mode: 'independent' | 'first_letter' | 'choice';
  feedback: {
    correct: boolean;
    answer: string;
  } | null;
  submit: (answer: string | null) => void;
  hint: (mode: 'first_letter' | 'choice') => void;
  continue: () => void;
}
