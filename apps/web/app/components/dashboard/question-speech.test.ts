import { describe, expect, it } from "vitest";
import { questionRecognitionConstructor } from "./question-speech";

describe("browser voice-recognition capability", () => {
  it("uses standard SpeechRecognition when the browser exposes it", () => {
    class StandardRecognition {}
    const browser = { SpeechRecognition: StandardRecognition } as unknown as Window;
    expect(questionRecognitionConstructor(browser)).toBe(StandardRecognition);
  });

  it("falls back to Android Chrome's prefixed recognizer", () => {
    class ChromeRecognition {}
    const browser = { webkitSpeechRecognition: ChromeRecognition } as unknown as Window;
    expect(questionRecognitionConstructor(browser)).toBe(ChromeRecognition);
  });

  it("gracefully falls back to typed questions on unsupported devices", () => {
    expect(questionRecognitionConstructor({} as Window)).toBeNull();
  });
});
