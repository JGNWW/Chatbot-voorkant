export interface Source {
  title: string;
  url: string;
}

export interface AskResponse {
  restated_question: string;
  answer: string;
  verified: boolean;
  source: Source | null;
  related_sources: Source[];
  note: string | null;
}

export async function ask(question: string): Promise<AskResponse> {
  const resp = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => null);
    throw new Error(detail?.detail ?? `Serverfout (${resp.status})`);
  }
  return resp.json();
}
