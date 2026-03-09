interface PuterAIResponse {
  message?: {
    content?: string;
  };
}

interface PuterGlobal {
  ai?: {
    chat: (input: unknown) => Promise<PuterAIResponse>;
  };
}

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

export {};
