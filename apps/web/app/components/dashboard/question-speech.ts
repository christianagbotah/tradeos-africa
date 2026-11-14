/**
 * Minimal browser speech recognition types. Recognition is started only from
 * a user gesture, and the transcript (not audio) is sent to TradeOS.
 * Browser speech services may process audio online; no browser API is required
 * for the existing typed question feature.
 */
export interface QuestionRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal?: boolean }>;
}
export interface QuestionRecognitionError { error: string }
export interface QuestionRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: QuestionRecognitionEvent) => void) | null;
  onerror: ((event: QuestionRecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => QuestionRecognition;
export function questionRecognitionConstructor(browser: Window): RecognitionConstructor | null {
  const voiceBrowser = browser as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return voiceBrowser.SpeechRecognition ?? voiceBrowser.webkitSpeechRecognition ?? null;
}
